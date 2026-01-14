// ============================================================
// STATE.JS - Sistema de Persistência de Estado Otimizado
// ============================================================

// ============================================================
// CONSTANTS
// ============================================================

const STATE_KEY = 'appState';
const STATE_EXPIRY = 2 * 60 * 60 * 1000; // 2 horas

// ============================================================
// STATE VARIABLES
// ============================================================

let isRestoringState = false;
let listenersBound = false;
let overridesBound = false;
let lastSavedScreenState = null;
let lastSavedAt = 0;

// ============================================================
// CORE STATE MANAGEMENT
// ============================================================

/**
 * Salva o estado mínimo da aplicação
 * Apenas: screen (auth/menu/battle) e timestamp
 */
export function saveAppState() {
  if (!window.currentUser?.id) return;
  if (isRestoringState) return;

  // Evitar gravações repetidas em sequência
  const now = Date.now();
  if (now - lastSavedAt < 250) return;
  
  const activeScreen = document.querySelector('.screen.active');
  const currentScreen = activeScreen?.id || 'menu';
  
  // Mapear para estados essenciais
  let screenState = 'menu';
  if (currentScreen === 'auth-screen') screenState = 'auth';
  else if (currentScreen === 'battle-room') screenState = 'battle';
  
  const state = {
    screen: screenState,
    timestamp: Date.now()
  };

  if (lastSavedScreenState === screenState && now - lastSavedAt < 1500) {
    return;
  }
  
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    lastSavedScreenState = screenState;
    lastSavedAt = now;
  } catch (err) {
    console.warn('⚠️ Failed to save state:', err);
  }
}

/**
 * Restaura o estado da aplicação (apenas se não estiver em batalha)
 */
export async function restoreAppState() {
  if (isRestoringState) return false;
  
  isRestoringState = true;
  
  try {
    let saved = null;
    try {
      saved = localStorage.getItem(STATE_KEY);
    } catch (err) {
      console.warn('⚠️ Failed to read state:', err);
      return false;
    }
    if (!saved) return false;
    
    const state = JSON.parse(saved);
    
    // Verificar expiração
    if (Date.now() - state.timestamp > STATE_EXPIRY) {
      localStorage.removeItem(STATE_KEY);
      return false;
    }
    
    // NÃO restaurar automaticamente - deixar o router gerenciar
    // Apenas marcar que havia estado salvo
    window.willRestoreState = false; // Desabilitar restauração automática
    
    return false; // Retornar false para não restaurar automaticamente
    
  } catch (err) {
    console.error('❌ State restore failed:', err);
    try { localStorage.removeItem(STATE_KEY); } catch (_) {}
  } finally {
    isRestoringState = false;
  }
  
  return false;
}

/**
 * Limpa estado geral (não afeta batalha)
 */
export function clearAppState() {
  try { localStorage.removeItem(STATE_KEY); } catch (_) {}
}

// ============================================================
// EVENT LISTENERS
// ============================================================

/**
 * Setup de listeners otimizados
 */
export function setupStateListeners() {
  if (listenersBound) return;
  listenersBound = true;
  
  // 1. Beforeunload - Salvar e avisar se em batalha
  window.addEventListener('beforeunload', (e) => {
    // Parar pollings
    if (window.stopShopPolling) window.stopShopPolling();
    if (window.stopAdminPolling) window.stopAdminPolling();
    if (window.stopRoomPolling) window.stopRoomPolling();
    
    // Salvar estado
    saveAppState();
  });

}

// ============================================================
// FUNCTION OVERRIDES
// ============================================================

/**
 * Setup de overrides para integração
 */
export function setupStateOverrides() {
  if (overridesBound) return;
  overridesBound = true;
  
  // Override handleLogout
  if (window.handleLogout && !window.handleLogout._stateWrapped) {
    const original = window.handleLogout;
    window.handleLogout = async function() {
      clearAppState();
      // clearBattleState não existe mais, removido
      await original();
    };
    window.handleLogout._stateWrapped = true;
  }
  
  // Override goTo para salvar estado (mas não se já foi interceptado pelo router)
  if (window.goTo && !window.goTo._stateWrapped) {
    const originalGoTo = window.goTo;
    const wrapped = function(screen) {
      originalGoTo(screen);
      // Salvar após transição (deixa o router fazer o resto)
      setTimeout(() => saveAppState(), 300);
    };
    wrapped._stateWrapped = true;
    wrapped._routerIntercepted = Boolean(originalGoTo._routerIntercepted);
    window.goTo = wrapped;
  }
  
}

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Inicializa sistema de state
 */
export function initializeStateSystem() {
  setupStateListeners();
  setupStateOverrides();
}

// ============================================================
// EXPORTS GLOBAIS
// ============================================================

window.saveAppState = saveAppState;
window.restoreAppState = restoreAppState;
window.clearAppState = clearAppState;