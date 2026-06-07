// Hash SHA-256 da senha padrão ("Pilhaderadio.")
const AUTH_HASH = "ed1cd5803a3ab9adf61e0c7529094da460c71d545c428c1cc3b65fbb971bd5a9";
const STORAGE_KEY = "klif_scanner_auth_token";

/**
 * Gera o hash SHA-256 de uma string utilizando a Web Crypto API nativa.
 * @param {string} message 
 * @returns {Promise<string>} hash hex
 */
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifica se o usuário já está autorizado no localStorage.
 * @returns {boolean}
 */
export function isAuthorized() {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

/**
 * Inicializa a tela de bloqueio e gerencia os ouvintes de eventos da autenticação.
 * @param {Function} onSuccess - Callback executado quando o acesso é liberado.
 */
export function initAuth(onSuccess) {
  const lockScreen = document.getElementById('lock-screen');
  const input = document.getElementById('auth-passcode');
  const submitBtn = document.getElementById('btn-auth-submit');
  const errorMsg = document.getElementById('auth-error');

  if (!lockScreen) return;

  if (isAuthorized()) {
    lockScreen.classList.add('hidden');
    // Remove o lockscreen do DOM depois da transição para evitar consumo desnecessário de CPU
    setTimeout(() => lockScreen.remove(), 500);
    if (onSuccess) onSuccess();
    return;
  }

  // Garante que o lockscreen seja exibido se não estiver autorizado
  lockScreen.classList.remove('hidden');
  if (input) input.focus();

  const handleAuth = async () => {
    const password = input.value;
    if (!password) return;

    submitBtn.disabled = true;
    if (errorMsg) errorMsg.style.display = 'none';

    // Remove classes antigas de shake caso existam
    const container = lockScreen.querySelector('.lock-screen-container');
    if (container) container.classList.remove('shake');

    try {
      const hash = await sha256(password);
      if (hash === AUTH_HASH) {
        localStorage.setItem(STORAGE_KEY, "true");
        
        // Aplica animação de saída na overlay
        lockScreen.style.animation = 'lockScaleOut 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
        lockScreen.classList.add('hidden');
        
        setTimeout(() => lockScreen.remove(), 500);
        if (onSuccess) onSuccess();
      } else {
        if (errorMsg) errorMsg.style.display = 'block';
        
        // Efeito shake de erro no container do modal
        if (container) {
          // Pequeno hack para forçar re-render e rodar a animação novamente
          void container.offsetWidth; 
          container.classList.add('shake');
        }

        input.value = '';
        input.focus();
        
        // Feedback tátil de erro no celular (iOS/Android)
        if (navigator.vibrate) {
          try {
            navigator.vibrate([100, 50, 100]);
          } catch (e) {
            // Alguns navegadores barram vibração sem interação física direta prévia
          }
        }
      }
    } catch (err) {
      console.error('Erro na autenticação local:', err);
      alert('Erro inesperado de criptografia no navegador.');
    } finally {
      submitBtn.disabled = false;
    }
  };

  if (submitBtn) {
    submitBtn.addEventListener('click', handleAuth);
  }
  
  if (input) {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleAuth();
    });
  }
}
