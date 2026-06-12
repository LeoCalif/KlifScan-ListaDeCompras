const GOOGLE_CLIENT_ID = "983079006399-md2jmn4teu0o18tmua87h5vhn57qlr6l.apps.googleusercontent.com";
const STORAGE_KEY = "klif_scanner_auth_user";

/**
 * Função utilitária para decodificar o token JWT retornado pelo Google.
 * @param {string} token 
 * @returns {object|null} payload
 */
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error("Falha ao decodificar JWT:", e);
    return null;
  }
}

/**
 * Verifica se o usuário já está autorizado no localStorage.
 * @returns {boolean}
 */
export function isAuthorized() {
  return !!localStorage.getItem(STORAGE_KEY);
}

/**
 * Recupera os dados do usuário autenticado.
 * @returns {object|null}
 */
export function getLoggedUser() {
  const userJson = localStorage.getItem(STORAGE_KEY);
  return userJson ? JSON.parse(userJson) : null;
}

/**
 * Inicializa o Google Identity Services e trata o fluxo de login.
 * @param {Function} onSuccess - Callback executado quando o acesso é liberado.
 */
export function initAuth(onSuccess) {
  const lockScreen = document.getElementById('lock-screen');
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

  // Callback chamado pelo Google Identity Services após login de sucesso
  window.handleCredentialResponse = (response) => {
    const payload = parseJwt(response.credential);
    
    if (payload && payload.email_verified) {
      const userData = {
        name: payload.name,
        email: payload.email,
        picture: payload.picture
      };
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
      
      // Animação de saída na overlay
      lockScreen.style.animation = 'lockScaleOut 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
      lockScreen.classList.add('hidden');
      
      setTimeout(() => lockScreen.remove(), 500);
      if (onSuccess) onSuccess();
    } else {
      if (errorMsg) errorMsg.style.display = 'block';
    }
  };

  // Inicializa o botão do Google quando a API estiver pronta
  const initializeGoogleBtn = () => {
    if (typeof google !== 'undefined') {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: window.handleCredentialResponse
      });

      google.accounts.id.renderButton(
        document.getElementById("btn-google-container"),
        { 
          theme: "filled_blue", 
          size: "large", 
          width: "280",
          text: "signin_with",
          shape: "pill"
        }
      );

      // Exibe One Tap se disponível
      google.accounts.id.prompt();
    } else {
      // Se a biblioteca do Google ainda não carregou, tenta novamente em 100ms
      setTimeout(initializeGoogleBtn, 100);
    }
  };

  initializeGoogleBtn();
}

/**
 * Realiza o logout do usuário limpando o localStorage e resetando a sessão.
 */
export function logoutUser() {
  localStorage.removeItem(STORAGE_KEY);
  if (typeof google !== 'undefined') {
    google.accounts.id.disableAutoSelect();
  }
  window.location.reload();
}
