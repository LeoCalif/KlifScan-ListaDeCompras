const GOOGLE_CLIENT_ID = "983079006399-md2jmn4teu0o18tmua87h5vhn57qlr6l.apps.googleusercontent.com";
const SYNC_FILE_NAME = "klif_scan_sync.json";

import {
  getAllProducts,
  saveProduct,
  getAllShoppingLists,
  saveShoppingList,
  getAllStockItems,
  saveStockItem
} from './db.js';

let tokenClient = null;
let accessToken = null;
let syncStatusCallback = null;

// Inicializa o cliente OAuth2 Token do Google
export function initDriveOAuth(onStatusChange) {
  syncStatusCallback = onStatusChange;
  
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    // Tenta re-inicializar em 150ms se a biblioteca não estiver carregada
    setTimeout(() => initDriveOAuth(onStatusChange), 150);
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    callback: async (response) => {
      if (response.error !== undefined) {
        console.error('Erro na autorização do Google Drive:', response);
        updateStatus('error', 'Erro de conexão com a nuvem');
        return;
      }
      
      accessToken = response.access_token;
      localStorage.setItem('drive_sync_enabled', 'true');
      updateStatus('connected', 'Conectado');
      
      // Executa um sincronismo imediato ao conectar
      await syncWithDrive();
    },
  });

  // Se o sincronismo já estava ativado no passado, solicita token silenciosamente
  if (localStorage.getItem('drive_sync_enabled') === 'true') {
    requestSilentToken();
  }
}

// Solicita token em background sem incomodar o usuário
export function requestSilentToken() {
  if (tokenClient) {
    try {
      tokenClient.requestAccessToken({ prompt: '' }); // Sem prompt se já foi consentido
    } catch (e) {
      console.warn('Falha no login automático do Drive:', e);
      updateStatus('disconnected', 'Desconectado');
    }
  }
}

// Dispara o fluxo visual de conexão/consentimento
export function connectDrive() {
  if (tokenClient) {
    updateStatus('connecting', 'Conectando...');
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    updateStatus('error', 'Google API não carregada');
  }
}

// Desativa sincronismo e limpa token
export function disconnectDrive() {
  accessToken = null;
  localStorage.removeItem('drive_sync_enabled');
  localStorage.removeItem('drive_last_sync_time');
  updateStatus('disconnected', 'Não Sincronizado');
}

export function isDriveConnected() {
  return !!accessToken;
}

// Envia atualizações do estado do sincronismo para a UI
function updateStatus(status, text) {
  if (syncStatusCallback) {
    const lastSync = localStorage.getItem('drive_last_sync_time');
    const lastSyncText = lastSync 
      ? `Última sincronização: ${new Date(Number(lastSync)).toLocaleString('pt-BR')}`
      : 'Nunca sincronizado';
    syncStatusCallback({ status, text, lastSyncText });
  }
}

// Procura o arquivo de sincronização na pasta oculta appDataFolder
async function findSyncFile() {
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${SYNC_FILE_NAME}'&fields=files(id,name)`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  if (!res.ok) {
    if (res.status === 401) {
      // Token expirou, solicita um novo silenciosamente
      requestSilentToken();
      throw new Error('Token expirado. Tentando reconectar...');
    }
    throw new Error('Erro ao pesquisar arquivo no Drive');
  }

  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

// Baixa os dados remotos
async function downloadSyncFile(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (!res.ok) throw new Error('Erro ao baixar arquivo do Drive');
  return await res.json();
}

// Envia dados novos ou atualiza arquivo existente no Drive
async function uploadSyncFile(backupData, fileId = null) {
  const metadata = {
    name: SYNC_FILE_NAME,
    parents: ['appDataFolder']
  };

  const fileContent = JSON.stringify(backupData);

  if (fileId) {
    // Atualiza arquivo existente
    const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: fileContent
    });
    if (!res.ok) throw new Error('Erro ao atualizar arquivo no Drive');
  } else {
    // Cria novo arquivo
    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([fileContent], { type: 'application/json' }));

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      body: form
    });
    if (!res.ok) throw new Error('Erro ao criar arquivo no Drive');
  }
}

// --- CORE: FLUXO DE RECONCILIAÇÃO E MESCLAGEM ---
export async function syncWithDrive(silent = false) {
  if (!accessToken) {
    if (localStorage.getItem('drive_sync_enabled') === 'true') {
      requestSilentToken();
    }
    return false;
  }

  if (!silent) updateStatus('syncing', 'Sincronizando...');

  try {
    const file = await findSyncFile();
    
    // 1. Obtém dados locais do IndexedDB (incluindo os deletados/tombstones)
    const localProducts = await getAllProducts(true);
    const localLists = await getAllShoppingLists(true);
    const localStock = await getAllStockItems(true);

    let mergedProducts = [...localProducts];
    let mergedLists = [...localLists];
    let mergedStock = [...localStock];

    let fileId = null;

    if (file) {
      fileId = file.id;
      // 2. Se o arquivo existe na nuvem, baixa e executa a mesclagem
      const remoteData = await downloadSyncFile(fileId);

      // Reconcilia PRODUTOS (compara timestamps de modificação)
      if (remoteData.products) {
        const remoteMap = new Map(remoteData.products.map(p => [p.barcode, p]));
        const localMap = new Map(localProducts.map(p => [p.barcode, p]));

        // Une todos os códigos de barras únicos
        const allBarcodes = new Set([...remoteMap.keys(), ...localMap.keys()]);
        mergedProducts = [];

        for (const barcode of allBarcodes) {
          const local = localMap.get(barcode);
          const remote = remoteMap.get(barcode);

          if (local && remote) {
            // Ambos existem: prevalece o mais recente
            const localTime = local.lastUpdated || 0;
            const remoteTime = remote.lastUpdated || 0;
            mergedProducts.push(localTime >= remoteTime ? local : remote);
          } else {
            // Apenas um existe: adiciona ao merged
            mergedProducts.push(local || remote);
          }
        }
      }

      // Reconcilia LISTAS DE COMPRAS
      if (remoteData.shoppingLists) {
        const remoteMap = new Map(remoteData.shoppingLists.map(l => [l.id, l]));
        const localMap = new Map(localLists.map(l => [l.id, l]));

        const allListIds = new Set([...remoteMap.keys(), ...localMap.keys()]);
        mergedLists = [];

        for (const id of allListIds) {
          const local = localMap.get(id);
          const remote = remoteMap.get(id);

          if (local && remote) {
            const localTime = local.lastUpdated || 0;
            const remoteTime = remote.lastUpdated || 0;
            mergedLists.push(localTime >= remoteTime ? local : remote);
          } else {
            mergedLists.push(local || remote);
          }
        }
      }

      // Reconcilia ESTOQUE / DISPENSA
      if (remoteData.stock) {
        const remoteMap = new Map(remoteData.stock.map(s => [s.barcode, s]));
        const localMap = new Map(localStock.map(s => [s.barcode, s]));

        const allStockBarcodes = new Set([...remoteMap.keys(), ...localMap.keys()]);
        mergedStock = [];

        for (const barcode of allStockBarcodes) {
          const local = localMap.get(barcode);
          const remote = remoteMap.get(barcode);

          if (local && remote) {
            const localTime = local.lastUpdated || 0;
            const remoteTime = remote.lastUpdated || 0;
            mergedStock.push(localTime >= remoteTime ? local : remote);
          } else {
            mergedStock.push(local || remote);
          }
        }
      }
    }

    // 3. Grava os dados mesclados de volta no IndexedDB local (sem sobrescrever lastUpdated!)
    for (const prod of mergedProducts) {
      await saveProduct(prod, false); // false = não atualiza timestamp
    }
    for (const list of mergedLists) {
      await saveShoppingList(list, false);
    }
    for (const item of mergedStock) {
      await saveStockItem(item, false);
    }

    // 4. Cria o payload atualizado e envia de volta ao Drive
    const backupData = {
      version: 2,
      exportedAt: Date.now(),
      products: mergedProducts,
      shoppingLists: mergedLists,
      stock: mergedStock
    };

    await uploadSyncFile(backupData, fileId);

    // Salva data de sucesso
    localStorage.setItem('drive_last_sync_time', String(Date.now()));
    updateStatus('connected', 'Sincronizado');
    return true;
  } catch (error) {
    console.error('Erro durante o sincronismo com Google Drive:', error);
    updateStatus('error', 'Falha no sincronismo');
    return false;
  }
}
