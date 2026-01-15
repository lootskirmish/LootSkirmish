// ============================================================
// STATE.TS - Sistema de Persistência de Estado Otimizado (TypeScript)
// ============================================================

// ============================================================
// CONSTANTS
// ============================================================

const STATE_KEY = 'appState';
const STATE_EXPIRY = 2 * 60 * 60 * 1000; // 2 horas

// ============================================================
// TYPES
// ============================================================

interface AppStateData {
  screen: 'auth' | 'menu' | 'battle';
  timestamp: number;
}

interface WindowWithState extends Window {
  currentUser?: { id: string; [key: string]: unknown };
  willRestoreState?: boolean;
  stopShopPolling?: () => void;
  stopAdminPolling?: () => void;
  stopRoomPolling?: () => void;
  handleLogout?: ((...args: any[]) => Promise<void>) & { _stateWrapped?: boolean };
  goTo?: ((screen: string) => void) & { _stateWrapped?: boolean; _routerIntercepted?: boolean };
  saveAppState?: (state: AppStateData) => void;
  restoreAppState?: () => Promise<boolean>;
  clearAppState?: () => void;
}

// ============================================================
// STATE VARIABLES
// ============================================================

let isRestoringState = false;
let listenersBound = false;
let overridesBound = false;
let lastSavedScreenState: string | null = null;
let lastSavedAt = 0;

// ============================================================
// CORE STATE MANAGEMENT
// ============================================================

/**
 * Salva o estado mínimo da aplicação
 * Apenas: screen (auth/menu/battle) e timestamp
 */
export function saveAppState(): void {
  const win = window as WindowWithState;
  
  if (!win.currentUser?.id) return;
  if (isRestoringState) return;

  // Evitar gravações repetidas em sequência
  const now = Date.now();
  if (now - lastSavedAt < 250) return;

  const activeScreen = document.querySelector('.screen.active');
  const currentScreen = (activeScreen as HTMLElement)?.id || 'menu';

  // Mapear para estados essenciais
  let screenState: 'auth' | 'menu' | 'battle' = 'menu';
  if (currentScreen === 'auth-screen') screenState = 'auth';
  else if (currentScreen === 'battle-room') screenState = 'battle';

  const state: AppStateData = {
    screen: screenState,
    timestamp: Date.now(),
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
export async function restoreAppState(): Promise<boolean> {
  if (isRestoringState) return false;

  isRestoringState = true;

  try {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STATE_KEY);
    } catch (err) {
      console.warn('⚠️ Failed to read state:', err);
      return false;
    }

    if (!saved) return false;

    const state: AppStateData = JSON.parse(saved);

    // Verificar expiração
    if (Date.now() - state.timestamp > STATE_EXPIRY) {
      localStorage.removeItem(STATE_KEY);
      return false;
    }

    // NÃO restaurar automaticamente - deixar o router gerenciar
    // Apenas marcar que havia estado salvo
    (window as WindowWithState).willRestoreState = false; // Desabilitar restauração automática

    return false; // Retornar false para não restaurar automaticamente
  } catch (err) {
    console.error('❌ State restore failed:', err);
    try {
      localStorage.removeItem(STATE_KEY);
    } catch (_) {
      // ignore
    }
  } finally {
    isRestoringState = false;
  }

  return false;
}

/**
 * Limpa estado geral (não afeta batalha)
 */
export function clearAppState(): void {
  try {
    localStorage.removeItem(STATE_KEY);
  } catch (_) {
    // ignore
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

/**
 * Setup de listeners otimizados
 */
export function setupStateListeners(): void {
  if (listenersBound) return;
  listenersBound = true;

  const win = window as WindowWithState;

  // 1. Beforeunload - Salvar e avisar se em batalha
  win.addEventListener('beforeunload', () => {
    // Parar pollings
    if (win.stopShopPolling) win.stopShopPolling();
    if (win.stopAdminPolling) win.stopAdminPolling();
    if (win.stopRoomPolling) win.stopRoomPolling();

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
export function setupStateOverrides(): void {
  if (overridesBound) return;
  overridesBound = true;

  const win = window as WindowWithState;

  // Override handleLogout
  if (win.handleLogout && !(win.handleLogout as any)._stateWrapped) {
    const original = win.handleLogout;
    win.handleLogout = async function (this: WindowWithState) {
      clearAppState();
      await original.call(this);
    } as any;
    (win.handleLogout as any)._stateWrapped = true;
  }

  // Override goTo para salvar estado (mas não se já foi interceptado pelo router)
  if (win.goTo && !(win.goTo as any)._stateWrapped) {
    const originalGoTo = win.goTo;
    const wrapped = function (this: WindowWithState, screen: string) {
      originalGoTo.call(this, screen);
      // Salvar após transição (deixa o router fazer o resto)
      setTimeout(() => saveAppState(), 300);
    } as any;
    wrapped._stateWrapped = true;
    wrapped._routerIntercepted = Boolean((originalGoTo as any)._routerIntercepted);
    win.goTo = wrapped;
  }
}

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Inicializa sistema de state
 */
export function initializeStateSystem(): void {
  setupStateListeners();
  setupStateOverrides();
}

// ============================================================
// EXPORTS GLOBAIS
// ============================================================

if (typeof window !== 'undefined') {
  const win = window as WindowWithState;
  win.saveAppState = saveAppState;
  win.restoreAppState = restoreAppState;
  win.clearAppState = clearAppState;
}
