import {
  getProduct,
  saveProduct,
  getAllProducts,
  deleteProduct,
  getShoppingList,
  saveShoppingList,
  deleteShoppingList,
  getAllShoppingLists,
  getSetting,
  setSetting
} from './db.js';

import { fetchProductFromAPI } from './api.js';

import {
  getAvailableCameras,
  startScanner,
  stopScanner,
  toggleTorch
} from './scanner.js';

import { initAuth } from './auth.js';

// --- ESTADO GLOBAL DO APLICATIVO ---
let appState = {
  activeList: null,     // Lista de compras ativa atualmente (se houver)
  vibrateEnabled: true, // Configuração de vibração
  apiEnabled: true,     // Configuração de consulta à API externa
  currentTab: 'shopping', // Aba selecionada
  tempBarcode: null,    // Código temporário durante escaneamento e cadastro
  tempQty: 1,           // Quantidade temporária para inserção após scan
  torchActive: false,   // Estado da lanterna da câmera
  cameras: []           // Câmeras disponíveis
};

// --- INICIALIZAÇÃO DO APP ---
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Registra o Service Worker para suporte PWA offline
  registerServiceWorker();

  // Inicializa o controle de acesso local
  initAuth(async () => {
    // 2. Carrega configurações salvas no DB local
    appState.vibrateEnabled = await getSetting('vibrate_enabled', true);
    appState.apiEnabled = await getSetting('api_enabled', true);
    
    // Atualiza checkboxes de configuração com os estados corretos
    document.getElementById('setting-vibrate').checked = appState.vibrateEnabled;
    document.getElementById('setting-api').checked = appState.apiEnabled;

    // 3. Verifica se há uma compra ativa salva anteriormente
    const activeListId = await getSetting('active_list_id');
    if (activeListId) {
      appState.activeList = await getShoppingList(activeListId);
    }

    // 4. Inicializa os Ouvintes de Eventos da UI
    setupEventListeners();

    // 5. Configura a barra de conexão (online/offline)
    updateConnectionStatus();
    window.addEventListener('online', updateConnectionStatus);
    window.addEventListener('offline', updateConnectionStatus);

    // 6. Desenha a aba padrão (Lista de Compras)
    renderActiveList();
  });
});

// --- REGISTRO DE SERVICE WORKER (PWA) ---
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('Service Worker registrado com sucesso:', reg.scope))
        .catch((err) => console.error('Falha ao registrar Service Worker:', err));
    });
  }

  // Captura o evento de instalação do PWA
  let deferredPrompt;
  const pwaInstallContainer = document.getElementById('pwa-install-container');
  const btnPwaInstall = document.getElementById('btn-pwa-install');

  window.addEventListener('beforeinstallprompt', (e) => {
    // Previne que o Chrome mostre o prompt automático
    e.preventDefault();
    deferredPrompt = e;
    // Mostra o botão personalizado de instalação em Configurações
    if (pwaInstallContainer) {
      pwaInstallContainer.style.display = 'block';
    }
  });

  if (btnPwaInstall) {
    btnPwaInstall.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to install prompt: ${outcome}`);
      deferredPrompt = null;
      pwaInstallContainer.style.display = 'none';
    });
  }
}

// --- DETECÇÃO DE CONEXÃO ---
function updateConnectionStatus() {
  const statusBadge = document.getElementById('connection-status');
  if (navigator.onLine) {
    statusBadge.textContent = 'Online';
    statusBadge.classList.remove('offline');
  } else {
    statusBadge.textContent = 'Offline';
    statusBadge.classList.add('offline');
    showToast('Você está offline. Operações salvas localmente.', 'info');
  }
}

// --- TOAST NOTIFICATIONS HELPER ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg class="toast-icon success" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  } else if (type === 'danger') {
    iconSvg = `<svg class="toast-icon danger" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  } else {
    iconSvg = `<svg class="toast-icon info" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  }

  toast.innerHTML = `
    ${iconSvg}
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Remove toast após 3 segundos
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3000);
}

// --- CONFIGURAÇÃO DOS EVENTOS DO MOUSE/TOQUE ---
function setupEventListeners() {
  // 1. Roteamento de Abas
  document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
    const tabName = btn.getAttribute('data-tab');
    if (tabName) {
      btn.addEventListener('click', () => switchTab(tabName));
    }
  });

  // 2. Iniciar Compra
  document.getElementById('btn-start-shopping').addEventListener('click', () => {
    startNewShoppingList();
  });
  document.getElementById('shopping-list-name').addEventListener('input', (e) => {
    if (appState.activeList) {
      appState.activeList.name = e.target.value.trim() || 'Compra Ativa';
      saveActiveListState();
    }
  });

  // 3. Finalizar Compra
  document.getElementById('btn-finish-shopping').addEventListener('click', () => {
    finishShoppingList();
  });

  // 4. Cancelar Compra
  document.getElementById('btn-cancel-shopping').addEventListener('click', () => {
    if (confirm('Deseja realmente cancelar esta compra? Todos os itens adicionados a esta lista serão removidos.')) {
      cancelShoppingList();
    }
  });

  // 5. Configurações Toggles
  document.getElementById('setting-vibrate').addEventListener('change', (e) => {
    appState.vibrateEnabled = e.target.checked;
    setSetting('vibrate_enabled', e.target.checked);
    showToast('Preferência de vibração atualizada!', 'success');
  });

  document.getElementById('setting-api').addEventListener('change', (e) => {
    appState.apiEnabled = e.target.checked;
    setSetting('api_enabled', e.target.checked);
    showToast('Preferência de API externa atualizada!', 'success');
  });

  // 6. Backup de Dados (Exportar / Importar)
  document.getElementById('btn-export-db').addEventListener('click', exportDatabase);
  document.getElementById('btn-import-db-trigger').addEventListener('click', () => {
    document.getElementById('import-db-file').click();
  });
  document.getElementById('import-db-file').addEventListener('change', importDatabase);

  // 7. Scanner Câmera Triggers
  document.getElementById('btn-scan-trigger').addEventListener('click', openScannerOverlay);
  document.getElementById('btn-scanner-close').addEventListener('click', closeScannerOverlay);
  document.getElementById('btn-scanner-torch').addEventListener('click', handleToggleTorch);
  document.getElementById('btn-scanner-manual').addEventListener('click', handleManualBarcodeEntry);
  document.getElementById('scanner-camera-select').addEventListener('change', handleCameraChange);

  // 8. Pesquisa e Banco de Produtos
  document.getElementById('product-search-input').addEventListener('input', (e) => {
    renderProductDatabase(e.target.value);
  });
  document.getElementById('btn-new-product').addEventListener('click', () => {
    openProductModal(); // Abre em branco para novo cadastro
  });

  // 9. Formulário de Produto
  document.getElementById('btn-prod-save').addEventListener('click', saveProductFromModal);
  document.getElementById('btn-prod-delete').addEventListener('click', deleteProductFromModal);
  document.getElementById('prod-photo-container').addEventListener('click', () => {
    document.getElementById('prod-image-input').click();
  });
  document.getElementById('btn-prod-photo-remove').addEventListener('click', (e) => {
    e.stopPropagation();
    clearProductPhoto();
  });
  document.getElementById('prod-image-input').addEventListener('change', handleProductPhotoUpload);

  // 10. Formulário de Preço Rápido
  document.getElementById('btn-price-save').addEventListener('click', saveQuickPrice);
  document.getElementById('price-edit-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') saveQuickPrice();
  });

  // 11. Modal de Histórico
  document.getElementById('btn-hist-delete').addEventListener('click', deleteHistoryItem);
  document.getElementById('btn-hist-clone').addEventListener('click', cloneHistoryList);

  // Quantidade temporária no modal do scanner
  document.getElementById('scan-qty-inc').addEventListener('click', () => {
    appState.tempQty++;
    document.getElementById('scan-qty-val').textContent = appState.tempQty;
  });
  document.getElementById('scan-qty-dec').addEventListener('click', () => {
    if (appState.tempQty > 1) {
      appState.tempQty--;
      document.getElementById('scan-qty-val').textContent = appState.tempQty;
    }
  });
}

// --- GERENCIAMENTO DE ABAS (ROTEADOR DE VIEW) ---
function switchTab(tabName) {
  // Desativa abas anteriores
  document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  // Ativa a nova aba
  const activeBtn = document.querySelector(`.bottom-nav [data-tab="${tabName}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  const activePanel = document.getElementById(`panel-${tabName}`);
  if (activePanel) activePanel.classList.add('active');

  appState.currentTab = tabName;

  // Recarrega informações específicas da aba
  if (tabName === 'shopping') {
    renderActiveList();
  } else if (tabName === 'history') {
    renderHistory();
  } else if (tabName === 'products') {
    renderProductDatabase();
  }
}

// --- FLUXO DE COMPRA ATIVA ---

// Inicia uma nova lista de compras
async function startNewShoppingList() {
  const defaultName = `Compra - ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  
  const newList = {
    id: Date.now(), // timestamp usado como ID único
    date: Date.now(),
    name: defaultName,
    items: [],
    completed: false,
    total: 0
  };

  appState.activeList = newList;
  await saveShoppingList(newList);
  await setSetting('active_list_id', newList.id);

  showToast('Nova compra iniciada!', 'success');
  renderActiveList();
}

// Salva o estado atual da lista ativa no IndexedDB
async function saveActiveListState() {
  if (!appState.activeList) return;
  
  // Recalcula o total acumulado
  appState.activeList.total = appState.activeList.items.reduce((sum, item) => {
    return sum + (item.price * item.quantity);
  }, 0);

  await saveShoppingList(appState.activeList);
}

// Finaliza a lista de compras (move para o histórico)
async function finishShoppingList() {
  if (!appState.activeList) return;

  if (appState.activeList.items.length === 0) {
    showToast('Não é possível finalizar uma lista sem itens.', 'danger');
    return;
  }

  // Salva o nome customizado caso o usuário tenha editado na tela
  const nameInput = document.getElementById('shopping-list-name');
  if (nameInput && nameInput.value.trim()) {
    appState.activeList.name = nameInput.value.trim();
  }

  // Marca como completado
  appState.activeList.completed = true;
  await saveActiveListState();

  // Limpa o ID da lista ativa das configurações
  await setSetting('active_list_id', null);
  appState.activeList = null;

  showToast('Compra finalizada com sucesso! Salva no histórico.', 'success');
  switchTab('history');
}

// Cancela a lista de compras atual
async function cancelShoppingList() {
  if (!appState.activeList) return;

  const id = appState.activeList.id;
  
  // Exclui a lista incompleta do banco
  await deleteShoppingList(id);
  await setSetting('active_list_id', null);
  appState.activeList = null;

  showToast('Compra cancelada.', 'info');
  renderActiveList();
}

// Renderiza a lista de compras na tela
function renderActiveList() {
  const emptyState = document.getElementById('shopping-empty-state');
  const activeState = document.getElementById('shopping-active-state');
  
  if (!appState.activeList) {
    emptyState.style.display = 'block';
    activeState.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  activeState.style.display = 'block';

  // Seta o título da lista no input
  document.getElementById('shopping-list-name').value = appState.activeList.name;

  // Container de itens
  const container = document.getElementById('shopping-items-container');
  container.innerHTML = '';

  const items = appState.activeList.items;

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 30px 10px;">
        <svg fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 48px; height: 48px;">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <p>Lista vazia. Clique no scanner para adicionar produtos!</p>
      </div>
    `;
    updateStats(0, 0, 0);
    return;
  }

  // Agrupa itens por categoria
  const groups = {};
  items.forEach(item => {
    const cat = item.category || 'Outros';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });

  // Renderiza itens agrupados
  Object.keys(groups).sort().forEach(category => {
    // Cria header da categoria
    const groupTitle = document.createElement('div');
    groupTitle.className = 'list-group-title';
    groupTitle.textContent = category;
    container.appendChild(groupTitle);

    const groupDiv = document.createElement('div');
    groupDiv.className = 'list-group';

    groups[category].forEach(item => {
      const itemEl = document.createElement('div');
      itemEl.className = `shopping-item ${item.checked ? 'checked' : ''}`;
      
      const priceText = item.price > 0 ? `R$ ${item.price.toFixed(2)}` : 'Definir R$';
      const totalItemText = `R$ ${(item.price * item.quantity).toFixed(2)}`;

      const imageHtml = item.image 
        ? `<img src="${item.image}" class="item-image" alt="${item.name}" onerror="this.innerHTML='<svg viewBox=\'0 0 24 24\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2\'/></svg>'; this.src='';">`
        : `<div class="item-image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/></svg></div>`;

      itemEl.innerHTML = `
        <div class="item-checkbox" data-barcode="${item.barcode}">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
        </div>
        ${imageHtml}
        <div class="item-details" data-barcode="${item.barcode}">
          <div class="item-name">${item.name}</div>
          <div class="item-meta">
            <span class="item-brand">${item.brand || 'Sem marca'}</span>
            <span>•</span>
            <span class="item-price-tag" data-barcode="${item.barcode}">${priceText}</span>
          </div>
        </div>
        <div class="qty-controls">
          <button class="qty-btn qty-dec" data-barcode="${item.barcode}">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12h-15"/></svg>
          </button>
          <span class="qty-val">${item.quantity}</span>
          <button class="qty-btn qty-inc" data-barcode="${item.barcode}">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          </button>
        </div>
        <button class="btn-delete" data-barcode="${item.barcode}" title="Remover item">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
        </button>
      `;

      // Evento de Check/Uncheck
      itemEl.querySelector('.item-checkbox').addEventListener('click', () => {
        toggleItemChecked(item.barcode);
      });

      // Evento de Editar Preço Rápido
      itemEl.querySelector('.item-price-tag').addEventListener('click', (e) => {
        e.stopPropagation();
        openPriceEditor(item.barcode);
      });

      // Clique no nome abre edição master do produto
      itemEl.querySelector('.item-details').addEventListener('click', () => {
        openProductModal(item.barcode);
      });

      // Eventos de Quantidade (+ / -)
      itemEl.querySelector('.qty-dec').addEventListener('click', () => {
        updateItemQty(item.barcode, -1);
      });

      itemEl.querySelector('.qty-inc').addEventListener('click', () => {
        updateItemQty(item.barcode, 1);
      });

      // Evento de Deletar
      itemEl.querySelector('.btn-delete').addEventListener('click', () => {
        removeItemFromActiveList(item.barcode);
      });

      groupDiv.appendChild(itemEl);
    });

    container.appendChild(groupDiv);
  });

  // Atualiza os stats de rodapé da lista
  const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const totalItemsCount = items.length;
  const checkedItemsCount = items.filter(i => i.checked).length;

  updateStats(checkedItemsCount, totalItemsCount, total);
}

// Atualiza informações de totais e progresso
function updateStats(checkedCount, totalCount, totalPrice) {
  document.getElementById('stat-items-count').textContent = `${checkedCount} / ${totalCount}`;
  document.getElementById('stat-total-price').textContent = `R$ ${totalPrice.toFixed(2)}`;

  const progressEl = document.getElementById('shopping-progress');
  if (totalCount > 0) {
    const pct = Math.round((checkedCount / totalCount) * 100);
    progressEl.style.width = `${pct}%`;
  } else {
    progressEl.style.width = '0%';
  }
}

// Alterna o estado de marcação do produto
async function toggleItemChecked(barcode) {
  if (!appState.activeList) return;

  const item = appState.activeList.items.find(i => i.barcode === barcode);
  if (item) {
    item.checked = !item.checked;
    await saveActiveListState();
    renderActiveList();
  }
}

// Atualiza a quantidade do item na compra ativa
async function updateItemQty(barcode, change) {
  if (!appState.activeList) return;

  const itemIndex = appState.activeList.items.findIndex(i => i.barcode === barcode);
  if (itemIndex > -1) {
    const item = appState.activeList.items[itemIndex];
    const newQty = item.quantity + change;

    if (newQty <= 0) {
      if (confirm(`Deseja remover o produto "${item.name}" da lista?`)) {
        appState.activeList.items.splice(itemIndex, 1);
        showToast('Produto removido da lista.', 'info');
      }
    } else {
      item.quantity = newQty;
    }
    
    await saveActiveListState();
    renderActiveList();
  }
}

// Remove o item da lista
async function removeItemFromActiveList(barcode) {
  if (!appState.activeList) return;

  const itemIndex = appState.activeList.items.findIndex(i => i.barcode === barcode);
  if (itemIndex > -1) {
    appState.activeList.items.splice(itemIndex, 1);
    await saveActiveListState();
    showToast('Produto removido.', 'info');
    renderActiveList();
  }
}

// --- FLUXO DO SCANNER DE CÓDIGO DE BARRAS ---

async function openScannerOverlay() {
  // O scanner exige uma compra ativa! Se não houver, inicia uma automaticamente.
  if (!appState.activeList) {
    await startNewShoppingList();
  }

  const overlay = document.getElementById('scanner-container');
  overlay.classList.add('active');

  // Inicializa botões
  appState.torchActive = false;
  document.getElementById('btn-scanner-torch').style.color = '#fff';

  try {
    // 1. Obtém as câmeras
    const cameras = await getAvailableCameras();
    appState.cameras = cameras;

    const select = document.getElementById('scanner-camera-select');
    select.innerHTML = '';

    if (cameras.length === 0) {
      select.innerHTML = '<option value="">Câmera não encontrada</option>';
    } else {
      // Ordena de forma que a traseira apareça primeiro (normalmente contém "back" ou "trás" no label)
      cameras.forEach(cam => {
        const option = document.createElement('option');
        option.value = cam.id;
        option.textContent = cam.label || `Câmera ${select.length + 1}`;
        select.appendChild(option);
      });

      // Tenta selecionar automaticamente a última câmera (normalmente a traseira principal com zoom/wide em smartphones modernos)
      let selectedCamId = cameras[cameras.length - 1].id;
      // Mas se houver uma expressamente chamada "back", prefere ela
      const backCam = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('traseira') || c.label.toLowerCase().includes('trás'));
      if (backCam) {
        selectedCamId = backCam.id;
      }
      select.value = selectedCamId;
    }

    // 2. Inicia o scanner físico de tela inteira
    await startScanningDevice(select.value);
  } catch (error) {
    showToast('Não foi possível acessar a câmera.', 'danger');
    closeScannerOverlay();
  }
}

async function startScanningDevice(cameraId) {
  try {
    await startScanner(
      'scanner-reader', 
      handleDecodedBarcode, 
      null, // ignora ruídos normais de erro
      cameraId
    );
  } catch (err) {
    showToast('Falha ao iniciar captura de vídeo.', 'danger');
    closeScannerOverlay();
  }
}

async function closeScannerOverlay() {
  const overlay = document.getElementById('scanner-container');
  overlay.classList.remove('active');
  await stopScanner();
}

async function handleCameraChange(e) {
  const cameraId = e.target.value;
  if (cameraId) {
    showToast('Trocando câmera...', 'info');
    await startScanningDevice(cameraId);
  }
}

async function handleToggleTorch() {
  const nextState = !appState.torchActive;
  const success = await toggleTorch(nextState);
  if (success) {
    appState.torchActive = nextState;
    document.getElementById('btn-scanner-torch').style.color = nextState ? 'var(--accent-cyan)' : '#fff';
    showToast(nextState ? 'Lanterna ligada!' : 'Lanterna desligada', 'info');
  } else {
    showToast('Lanterna não suportada nesta câmera.', 'info');
  }
}

// Entrada de código de barras manual quando a câmera falha ou código está rasgado
function handleManualBarcodeEntry() {
  const code = prompt('Digite o código de barras (EAN-13 ou EAN-8):');
  if (code && code.trim()) {
    handleDecodedBarcode(code.trim());
  }
}

// Callback invocado após sucesso na leitura de código
async function handleDecodedBarcode(barcode) {
  // Fecha a câmera
  await closeScannerOverlay();

  showToast(`Código escaneado: ${barcode}`, 'success');

  // Verifica se o produto já existe no banco de dados local
  const localProduct = await getProduct(barcode);
  if (localProduct) {
    // Adiciona direto na lista de compras ativa com quantidade padrão 1
    await addItemToActiveShoppingList(localProduct, 1);
    showToast(`Adicionado: ${localProduct.name} (+1)`, 'success');
    renderActiveList();
  } else {
    // Produto não encontrado localmente
    appState.tempBarcode = barcode;
    appState.tempQty = 1;
    document.getElementById('scan-qty-val').textContent = 1;

    // Se estiver online e a busca na API estiver habilitada
    if (navigator.onLine && appState.apiEnabled) {
      showToast('Buscando dados do produto na nuvem...', 'info');
      
      const apiProduct = await fetchProductFromAPI(barcode);
      if (apiProduct) {
        // Abre o modal pré-preenchido
        openProductModalWithData(apiProduct, true);
      } else {
        // Não achou na API externa, abre em branco com código preenchido
        openProductModalWithData({ barcode: barcode, name: '', brand: '', category: 'Mercearia', price: 0 }, true);
        showToast('Produto não encontrado na nuvem. Insira os dados.', 'info');
      }
    } else {
      // Offline ou API desativada
      openProductModalWithData({ barcode: barcode, name: '', brand: '', category: 'Mercearia', price: 0 }, true);
    }
  }
}

// Auxiliar para inserir o produto no array da lista ativa
async function addItemToActiveShoppingList(product, quantity = 1) {
  if (!appState.activeList) return;

  // Verifica se o item já está na lista
  const item = appState.activeList.items.find(i => i.barcode === product.barcode);
  if (item) {
    item.quantity += quantity;
  } else {
    appState.activeList.items.push({
      barcode: product.barcode,
      name: product.name,
      brand: product.brand,
      category: product.category,
      image: product.image,
      price: product.price || 0,
      quantity: quantity,
      checked: false
    });
  }

  await saveActiveListState();
}

// --- MODAL DE GERENCIAMENTO / CADASTRO DE PRODUTO ---

// Abre modal de produto
async function openProductModal(barcode = null) {
  appState.tempBarcode = barcode;
  appState.tempQty = 1;

  const titleEl = document.getElementById('modal-product-title');
  const deleteBtn = document.getElementById('btn-prod-delete');
  const barcodeInput = document.getElementById('prod-barcode');
  const nameInput = document.getElementById('prod-name');
  const brandInput = document.getElementById('prod-brand');
  const catSelect = document.getElementById('prod-category');
  const priceInput = document.getElementById('prod-price');
  
  // Oculta a área de quantidade de escaneamento para cadastros simples
  document.getElementById('scan-qty-section').style.display = 'none';

  // Reseta input de arquivo
  document.getElementById('prod-image-input').value = '';

  if (barcode) {
    // Editar existente
    titleEl.textContent = 'Editar Produto';
    deleteBtn.style.display = 'block';

    const p = await getProduct(barcode);
    if (p) {
      barcodeInput.value = p.barcode;
      nameInput.value = p.name;
      brandInput.value = p.brand || '';
      catSelect.value = p.category || 'Mercearia';
      priceInput.value = p.price > 0 ? p.price.toFixed(2) : '';
      updateProductPhotoUI(p.image);
    }
  } else {
    // Novo sem código de barras (geramos um id aleatório para itens sem código real)
    titleEl.textContent = 'Cadastrar Produto';
    deleteBtn.style.display = 'none';

    // Gera um código interno único temporário para produtos genéricos que não têm EAN real
    const localBarcode = 'INT-' + Date.now();
    barcodeInput.value = localBarcode;
    nameInput.value = '';
    brandInput.value = '';
    catSelect.value = 'Mercearia';
    priceInput.value = '';
    updateProductPhotoUI('');
    appState.tempBarcode = localBarcode;
  }

  document.getElementById('modal-product').classList.add('active');
}

// Abre o modal populado dinamicamente (normalmente pós-escaneamento)
function openProductModalWithData(prod, isScanFlow = false) {
  const titleEl = document.getElementById('modal-product-title');
  const deleteBtn = document.getElementById('btn-prod-delete');
  const barcodeInput = document.getElementById('prod-barcode');
  const nameInput = document.getElementById('prod-name');
  const brandInput = document.getElementById('prod-brand');
  const catSelect = document.getElementById('prod-category');
  const priceInput = document.getElementById('prod-price');

  titleEl.textContent = isScanFlow ? 'Confirmar Produto Escaneado' : 'Editar Produto';
  deleteBtn.style.display = 'none'; // Não permite deletar durante o scan flow rápido

  // Reseta input de arquivo
  document.getElementById('prod-image-input').value = '';

  barcodeInput.value = prod.barcode;
  nameInput.value = prod.name || '';
  brandInput.value = prod.brand || '';
  catSelect.value = prod.category || 'Mercearia';
  priceInput.value = prod.price > 0 ? prod.price : '';
  updateProductPhotoUI(prod.image);

  // Exibe painel de quantidade especial se for fluxo de scan
  const qtySection = document.getElementById('scan-qty-section');
  if (isScanFlow) {
    qtySection.style.display = 'block';
  } else {
    qtySection.style.display = 'none';
  }

  document.getElementById('modal-product').classList.add('active');
  
  // Foca no nome se estiver em branco
  if (!prod.name) {
    setTimeout(() => nameInput.focus(), 150);
  } else {
    setTimeout(() => priceInput.focus(), 150);
  }
}

// Salva dados do modal de produto
async function saveProductFromModal() {
  const name = document.getElementById('prod-name').value.trim();
  if (!name) {
    showToast('O nome do produto é obrigatório.', 'danger');
    return;
  }

  const barcode = document.getElementById('prod-barcode').value;
  const brand = document.getElementById('prod-brand').value.trim();
  const category = document.getElementById('prod-category').value;
  const price = parseFloat(document.getElementById('prod-price').value) || 0;
  const image = document.getElementById('prod-image').value;

  const product = {
    barcode,
    name,
    brand,
    category,
    price,
    image
  };

  // Salva no banco de dados local (IndexedDB)
  await saveProduct(product);

  // Se o modal foi aberto a partir de um fluxo de scan, adiciona também na lista de compras ativa
  const isScanFlow = document.getElementById('scan-qty-section').style.display === 'block';
  if (isScanFlow && appState.activeList) {
    await addItemToActiveShoppingList(product, appState.tempQty);
    
    // Atualiza o item também na lista ativa caso ele já existisse com outros valores
    const activeItem = appState.activeList.items.find(i => i.barcode === barcode);
    if (activeItem) {
      activeItem.name = product.name;
      activeItem.brand = product.brand;
      activeItem.category = product.category;
      activeItem.price = product.price;
      await saveActiveListState();
    }
  } else if (appState.activeList) {
    // Se editou os dados de um item que já estava na lista, reflete as alterações na lista de compras
    const activeItem = appState.activeList.items.find(i => i.barcode === barcode);
    if (activeItem) {
      activeItem.name = product.name;
      activeItem.brand = product.brand;
      activeItem.category = product.category;
      activeItem.price = product.price;
      await saveActiveListState();
    }
  }

  document.getElementById('modal-product').classList.remove('active');
  showToast('Produto salvo com sucesso!', 'success');

  // Atualiza as visualizações correspondentes
  if (appState.currentTab === 'shopping') {
    renderActiveList();
  } else if (appState.currentTab === 'products') {
    renderProductDatabase();
  }
}

// Exclui produto do banco local
async function deleteProductFromModal() {
  const barcode = appState.tempBarcode;
  if (!barcode) return;

  if (confirm('Deseja excluir este produto permanentemente do banco de dados local?')) {
    await deleteProduct(barcode);
    
    // Remove da lista ativa caso ele estivesse nela
    if (appState.activeList) {
      const idx = appState.activeList.items.findIndex(i => i.barcode === barcode);
      if (idx > -1) {
        appState.activeList.items.splice(idx, 1);
        await saveActiveListState();
      }
    }

    document.getElementById('modal-product').classList.remove('active');
    showToast('Produto excluído.', 'info');
    
    if (appState.currentTab === 'shopping') {
      renderActiveList();
    } else if (appState.currentTab === 'products') {
      renderProductDatabase();
    }
  }
}

// --- MODAL DE EDIÇÃO DE PREÇO RÁPIDO ---

let priceEditBarcode = null;

function openPriceEditor(barcode) {
  if (!appState.activeList) return;

  const item = appState.activeList.items.find(i => i.barcode === barcode);
  if (item) {
    priceEditBarcode = barcode;
    document.getElementById('price-edit-product-name').textContent = item.name;
    document.getElementById('price-edit-input').value = item.price > 0 ? item.price : '';
    document.getElementById('modal-price').classList.add('active');
    
    // Foca o input de preço automaticamente
    setTimeout(() => {
      document.getElementById('price-edit-input').focus();
      document.getElementById('price-edit-input').select();
    }, 150);
  }
}

async function saveQuickPrice() {
  const barcode = priceEditBarcode;
  if (!barcode || !appState.activeList) return;

  const inputVal = document.getElementById('price-edit-input').value;
  const newPrice = parseFloat(inputVal) || 0;

  // 1. Atualiza na lista de compras ativa
  const item = appState.activeList.items.find(i => i.barcode === barcode);
  if (item) {
    item.price = newPrice;
    await saveActiveListState();
  }

  // 2. Atualiza o banco de dados principal do produto para que ele já venha com esse preço na próxima compra
  const product = await getProduct(barcode);
  if (product) {
    product.price = newPrice;
    await saveProduct(product);
  }

  document.getElementById('modal-price').classList.remove('active');
  showToast('Preço atualizado com sucesso!', 'success');
  renderActiveList();
}

// --- ABA DE BANCO DE PRODUTOS ---

async function renderProductDatabase(searchQuery = '') {
  const grid = document.getElementById('products-grid-container');
  const emptyState = document.getElementById('products-empty-state');
  
  grid.innerHTML = '';

  const products = await getAllProducts();

  // Filtra de acordo com o query de busca
  const query = searchQuery.trim().toLowerCase();
  const filteredProducts = products.filter(p => {
    return p.name.toLowerCase().includes(query) || 
           (p.brand && p.brand.toLowerCase().includes(query)) ||
           p.barcode.includes(query) ||
           p.category.toLowerCase().includes(query);
  });

  if (filteredProducts.length === 0) {
    grid.style.display = 'none';
    emptyState.style.display = 'block';
    if (query) {
      emptyState.querySelector('p').textContent = 'Nenhum produto atende aos termos da busca.';
    } else {
      emptyState.querySelector('p').textContent = 'Nenhum produto cadastrado localmente.';
    }
    return;
  }

  emptyState.style.display = 'none';
  grid.style.display = 'grid';

  filteredProducts.forEach(p => {
    const card = document.createElement('div');
    card.className = 'product-card';
    
    const priceText = p.price > 0 ? `R$ ${p.price.toFixed(2)}` : 'R$ 0,00';
    
    const imageHtml = p.image 
      ? `<img src="${p.image}" class="item-image" alt="${p.name}">`
      : `<div class="item-image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/></svg></div>`;

    card.innerHTML = `
      ${imageHtml}
      <div class="item-details">
        <div class="item-name">${p.name}</div>
        <div class="item-meta">
          <span>${p.brand || 'Sem marca'}</span>
          <span>•</span>
          <span style="color: var(--accent-violet);">${p.category}</span>
          <span>•</span>
          <span style="color: var(--accent-cyan); font-weight: 600;">${priceText}</span>
        </div>
      </div>
      <div style="font-size: 11px; color: var(--text-muted); font-family: monospace;">${p.barcode}</div>
    `;

    card.addEventListener('click', () => {
      openProductModal(p.barcode);
    });

    grid.appendChild(card);
  });
}

// --- ABA E HISTÓRICO DE COMPRAS ---

async function renderHistory() {
  const container = document.getElementById('history-list-container');
  const emptyState = document.getElementById('history-empty-state');
  
  container.innerHTML = '';

  const allLists = await getAllShoppingLists();
  const completedLists = allLists.filter(l => l.completed);

  if (completedLists.length === 0) {
    container.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  container.style.display = 'flex';

  completedLists.forEach(list => {
    const card = document.createElement('div');
    card.className = 'history-card';

    const dateStr = new Date(list.date).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const itemsCount = list.items.length;
    const itemsTotalQty = list.items.reduce((sum, i) => sum + i.quantity, 0);

    card.innerHTML = `
      <div class="history-card-header">
        <span class="history-date">${list.name}</span>
        <span class="history-total">R$ ${list.total.toFixed(2)}</span>
      </div>
      <div class="history-details-summary">
        <span>${dateStr}</span>
        <span>${itemsCount} produtos (${itemsTotalQty} volumes)</span>
      </div>
    `;

    card.addEventListener('click', () => {
      openHistoryDetailModal(list.id);
    });

    container.appendChild(card);
  });
}

let historyDetailListId = null;

// Modal de visualização da compra passada
async function openHistoryDetailModal(listId) {
  historyDetailListId = listId;
  const list = await getShoppingList(listId);
  if (!list) return;

  document.getElementById('hist-detail-title').textContent = list.name;
  
  const dateStr = new Date(list.date).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  document.getElementById('hist-detail-date').textContent = dateStr;
  document.getElementById('hist-detail-total').textContent = `R$ ${list.total.toFixed(2)}`;

  const itemsContainer = document.getElementById('hist-detail-items');
  itemsContainer.innerHTML = '';

  list.items.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.style.display = 'flex';
    itemEl.style.justify = 'space-between';
    itemEl.style.alignItems = 'center';
    itemEl.style.padding = '8px 0';
    itemEl.style.borderBottom = '1px solid var(--border-glass)';

    itemEl.innerHTML = `
      <div>
        <div style="font-size: 13px; font-weight: 600;">${item.name}</div>
        <div style="font-size: 11px; color: var(--text-secondary);">${item.brand || 'Sem marca'} • R$ ${item.price.toFixed(2)} un.</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 13px; font-weight: 700;">x${item.quantity}</div>
        <div style="font-size: 12px; color: var(--accent-cyan); font-weight: 600;">R$ ${(item.price * item.quantity).toFixed(2)}</div>
      </div>
    `;
    itemsContainer.appendChild(itemEl);
  });

  document.getElementById('modal-history-detail').classList.add('active');
}

// Exclui um item do histórico
async function deleteHistoryItem() {
  const id = historyDetailListId;
  if (!id) return;

  if (confirm('Deseja realmente excluir esta lista de compra do histórico?')) {
    await deleteShoppingList(id);
    document.getElementById('modal-history-detail').classList.remove('active');
    showToast('Lista de compras excluída do histórico.', 'info');
    renderHistory();
  }
}

// Clona a lista do histórico para iniciar uma nova compra ativa
async function cloneHistoryList() {
  const id = historyDetailListId;
  if (!id) return;

  const pastList = await getShoppingList(id);
  if (!pastList) return;

  if (appState.activeList) {
    if (!confirm('Você já possui uma compra ativa. Deseja substituí-la pelos produtos desta lista de histórico?')) {
      return;
    }
    // Deleta a lista ativa se ela foi criada mas está sendo substituída
    await deleteShoppingList(appState.activeList.id);
  }

  // Cria um clone
  const newName = `Cópia de: ${pastList.name}`;
  const newList = {
    id: Date.now(),
    date: Date.now(),
    name: newName,
    items: pastList.items.map(item => ({
      ...item,
      checked: false // reseta os checks dos produtos
    })),
    completed: false,
    total: pastList.total
  };

  appState.activeList = newList;
  await saveShoppingList(newList);
  await setSetting('active_list_id', newList.id);

  document.getElementById('modal-history-detail').classList.remove('active');
  showToast('Lista importada com sucesso!', 'success');
  switchTab('shopping');
}

// --- IMPORTAÇÃO / EXPORTAÇÃO JSON ---

// Exporta banco de dados IndexedDB completo para JSON
async function exportDatabase() {
  showToast('Exportando dados...', 'info');

  try {
    const products = await getAllProducts();
    const lists = await getAllShoppingLists();
    
    const backupData = {
      version: 1,
      exportedAt: Date.now(),
      products,
      shoppingLists: lists
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement('a');
    
    const dateStr = new Date().toISOString().slice(0,10);
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `klif_scan_backup_${dateStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    showToast('Backup exportado com sucesso!', 'success');
  } catch (error) {
    console.error(error);
    showToast('Erro ao exportar backup.', 'danger');
  }
}

// Importa dados a partir de arquivo JSON
async function importDatabase(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      
      if (!data.products || !data.shoppingLists) {
        showToast('Formato de backup inválido.', 'danger');
        return;
      }

      showToast('Importando produtos...', 'info');

      // Importa produtos
      for (const prod of data.products) {
        await saveProduct(prod);
      }

      // Importa listas
      for (const list of data.shoppingLists) {
        await saveShoppingList(list);
      }

      showToast('Importação concluída com sucesso!', 'success');
      
      // Reseta input de file
      event.target.value = '';

      // Atualiza views
      if (appState.currentTab === 'shopping') {
        // Se a lista ativa foi substituída ou atualizada, carrega novamente
        const activeListId = await getSetting('active_list_id');
        if (activeListId) {
          appState.activeList = await getShoppingList(activeListId);
        }
        renderActiveList();
      } else if (appState.currentTab === 'products') {
        renderProductDatabase();
      } else if (appState.currentTab === 'history') {
        renderHistory();
      }
    } catch (err) {
      console.error(err);
      showToast('Erro ao processar arquivo de backup.', 'danger');
    }
  };
  reader.readAsText(file);
}

// --- AUXILIARES DE IMAGEM/FOTO DO PRODUTO ---

// Atualiza a visualização da foto do produto no modal
function updateProductPhotoUI(imageSrc) {
  const placeholder = document.getElementById('prod-photo-placeholder');
  const img = document.getElementById('prod-photo-img');
  const removeBtn = document.getElementById('btn-prod-photo-remove');
  const hiddenInput = document.getElementById('prod-image');

  hiddenInput.value = imageSrc || '';

  if (imageSrc) {
    img.src = imageSrc;
    img.style.display = 'block';
    placeholder.style.display = 'none';
    removeBtn.style.display = 'flex';
  } else {
    img.src = '';
    img.style.display = 'none';
    placeholder.style.display = 'flex';
    removeBtn.style.display = 'none';
  }
}

// Remove a foto do produto no formulário
function clearProductPhoto() {
  updateProductPhotoUI('');
  document.getElementById('prod-image-input').value = '';
}

// Lida com o upload e compressão da foto do produto
function handleProductPhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  showToast('Processando imagem...', 'info');

  const reader = new FileReader();
  reader.onload = function(e) {
    const imgObj = new Image();
    imgObj.onload = function() {
      // Cria canvas para redimensionar a imagem
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Define tamanho máximo (ex: 200px de largura/altura)
      const maxDim = 200;
      let width = imgObj.width;
      let height = imgObj.height;

      if (width > height) {
        if (width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;

      // Desenha e comprime
      ctx.drawImage(imgObj, 0, 0, width, height);
      
      // Converte para JPEG com compressão de 80% (alta qualidade e tamanho minúsculo, ~10KB)
      const base64Data = canvas.toDataURL('image/jpeg', 0.8);

      updateProductPhotoUI(base64Data);
      showToast('Imagem adicionada!', 'success');
    };
    imgObj.onerror = function() {
      showToast('Erro ao processar imagem.', 'danger');
    };
    imgObj.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
