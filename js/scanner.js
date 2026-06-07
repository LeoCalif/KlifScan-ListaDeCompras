// O script html5-qrcode.min.js deve ser carregado no index.html antes deste módulo,
// fazendo com que o objeto Html5Qrcode e Html5QrcodeSupportedFormats fiquem disponíveis globalmente.

let html5QrcodeScanner = null;
let currentCameraId = null;
let isStarting = false;
let shouldStopAfterStart = false;

/**
 * Obtém a lista de câmeras disponíveis no dispositivo.
 * Solicita permissão se necessário.
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
export async function getAvailableCameras() {
  try {
    const devices = await Html5Qrcode.getCameras();
    return devices || [];
  } catch (error) {
    console.error('Erro ao obter câmeras:', error);
    throw error;
  }
}

/**
 * Inicializa e inicia o leitor de código de barras.
 * @param {string} elementId - ID do elemento HTML onde o vídeo será renderizado
 * @param {Function} onScanSuccess - Callback chamado ao ler um código de barras com sucesso. Recebe (decodedText).
 * @param {Function} onScanError - Callback chamado ao falhar na leitura (ruído, etc. - opcional)
 * @param {string|null} preferredCameraId - ID da câmera preferida. Se nulo, usará a câmera traseira padrão.
 * @returns {Promise<void>}
 */
export async function startScanner(elementId, onScanSuccess, onScanError = null, preferredCameraId = null) {
  // Se já houver um scanner ativo, finaliza-o primeiro
  if (html5QrcodeScanner) {
    await stopScanner();
  }

  // Cria a instância do leitor apontando para o elemento HTML
  html5QrcodeScanner = new Html5Qrcode(elementId);
  isStarting = true;
  shouldStopAfterStart = false;

  // Configuração focada em códigos de barras de varejo (EAN, UPC, etc.)
  const formats = [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39
  ];

  const scanConfig = {
    fps: 15, // Aumenta a velocidade de detecção
    qrbox: (width, height) => {
      // Define uma caixa retangular ideal para códigos de barras (mais larga do que alta)
      const boxWidth = Math.min(width * 0.85, 280);
      const boxHeight = Math.min(boxWidth * 0.5, 140);
      return {
        width: Math.floor(boxWidth),
        height: Math.floor(boxHeight)
      };
    },
    formatsToSupport: formats,
    // Restrições de resolução HD inseridas aqui
    videoConstraints: {
      width: { min: 640, ideal: 1280, max: 1920 },
      height: { min: 480, ideal: 720, max: 1080 }
    }
  };

  const handleSuccess = (decodedText, decodedResult) => {
    // Se o fechamento foi disparado no meio tempo, ignora leituras
    if (shouldStopAfterStart) return;

    // Feedback tátil de sucesso (vibração de 120 milissegundos)
    if (navigator.vibrate) {
      try {
        navigator.vibrate(120);
      } catch (e) {
        // Ignora erros de vibração (alguns navegadores requerem interação prévia do usuário)
      }
    }

    if (onScanSuccess) {
      onScanSuccess(decodedText, decodedResult);
    }
  };

  const handleError = (errorMessage) => {
    if (onScanError) {
      onScanError(errorMessage);
    }
  };

  // Define qual câmera usar (Exatamente 1 chave se for objeto para obedecer a biblioteca)
  let cameraConfig = { facingMode: 'environment' }; 
  if (preferredCameraId) {
    cameraConfig = preferredCameraId; // Passa o ID da câmera diretamente como string
    currentCameraId = preferredCameraId;
  }

  try {
    await html5QrcodeScanner.start(
      cameraConfig,
      scanConfig,
      handleSuccess,
      handleError
    );
    isStarting = false;

    // Se o usuário clicou para fechar enquanto estava iniciando
    if (shouldStopAfterStart) {
      console.log('[Scanner] Inicialização tardia cancelada pelo usuário. Parando câmera...');
      await stopScanner();
    }
  } catch (error) {
    isStarting = false;
    shouldStopAfterStart = false;
    console.error('Erro ao iniciar a câmera:', error);
    html5QrcodeScanner = null;
    throw error;
  }
}

/**
 * Para a câmera e limpa a instância do scanner.
 * @returns {Promise<void>}
 */
export async function stopScanner() {
  if (isStarting) {
    console.log('[Scanner] Câmera está abrindo. Sinalizando para fechar logo após iniciar.');
    shouldStopAfterStart = true;
    return Promise.resolve();
  }

  if (!html5QrcodeScanner) return Promise.resolve();

  try {
    if (html5QrcodeScanner.isScanning) {
      await html5QrcodeScanner.stop();
    }
  } catch (error) {
    console.error('Erro ao parar o scanner:', error);
  } finally {
    html5QrcodeScanner = null;
    isStarting = false;
    shouldStopAfterStart = false;
  }
}

/**
 * Alterna a lanterna (torch), caso o navegador suporte.
 * @param {boolean} enable - Ativar ou desativar
 * @returns {Promise<boolean>} Retorna true se a ação foi realizada com sucesso
 */
export async function toggleTorch(enable) {
  if (!html5QrcodeScanner || !html5QrcodeScanner.isScanning) return false;
  
  try {
    // O html5QrcodeScanner.applyVideoConstraints nos permite aplicar propriedades como torch
    await html5QrcodeScanner.applyVideoConstraints({
      advanced: [{ torch: enable }]
    });
    return true;
  } catch (error) {
    console.warn('Lanterna não suportada neste dispositivo:', error);
    return false;
  }
}
