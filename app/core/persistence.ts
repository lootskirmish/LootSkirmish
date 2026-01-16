// ============================================================
// PERSISTENCE.TS - Sistema de Persistência Robusta com Sincronização Entre Abas
// ============================================================

import { store, dataActions, authActions } from './store';
import { routerActions } from './store';

// ============================================================
// CONSTANTS
// ============================================================

const PERSISTENCE_KEY = 'app-state-v2';
const PERSISTENCE_EXPIRY = 20 * 60 * 1000; // 20 minutos
const SYNC_DEBOUNCE_MS = 300;
const AUTO_SAVE_INTERVAL = 5000; // 5 segundos
const STORAGE_SIZE_LIMIT = 4.5 * 1024 * 1024; // 4.5MB (safe limit para localStorage)

// ============================================================
// TYPES
// ============================================================

interface PersistedState {
  userId: string;
  timestamp: number;
  expiresAt: number;
  data: {
    // Router
    route?: {
      currentPath: string;
      currentScreen: string;
      previousPath: string | null;
    };

    // Screen & Navigation
    currentScreen: string;
    
    // Case Opening State
    caseOpening?: {
      selectedCaseId?: string;
      selectedQuantity?: number;
      totalCost?: number;
      baselineCost?: number;
      discountLevel?: number;
      openingInProgress?: boolean;
      lastOpenedAt?: number;
    };
    
    // Inventory
    inventory?: {
      items?: any[];
      lastFetched?: number;
    };
    
    // Shop
    shop?: {
      items?: any[];
      lastFetched?: number;
    };
    
    // Profile
    profile?: {
      stats?: any;
      lastFetched?: number;
    };
    
    // Leaderboard
    leaderboard?: {
      data?: any[];
      lastFetched?: number;
    };

    // Cases catalog
    cases?: {
      data?: any[];
      lastFetched?: number;
    };
    
    // User Balance
    playerMoney?: number;
    playerDiamonds?: number;
    
    // Generic feature state (para qualquer jogo/feature)
    featureState?: Record<string, any>;

    // Additional cached data
    [key: string]: any;
  };
}

interface PersistenceConfig {
  debounce?: number;
  autoSaveInterval?: number;
  sizeLimit?: number;
}

// ============================================================
// STATE VARIABLES
// ============================================================

let isRestoring = false;
let autoSaveTimer: ReturnType<typeof setInterval> | null = null;
let debounceSaveTimer: ReturnType<typeof setTimeout> | null = null;
let broadcastChannel: BroadcastChannel | null = null;
let lastSavedState: PersistedState | null = null;
let isSaving = false;
let featureState: Record<string, any> = {};

// ============================================================
// CORE PERSISTENCE FUNCTIONS
// ============================================================

/**
 * Obtém estado atual para persistência
 */
function getCurrentState(): PersistedState | null {
  const state = store.getState();
  const userId = state.auth?.user?.id;
  
  if (!userId) return null;
  
  const now = Date.now();
  const expiresAt = now + PERSISTENCE_EXPIRY;
  
  // Recolher dados de diferentes partes da aplicação
  const persistData: PersistedState['data'] = {
    route: {
      currentPath: state.router?.currentPath ?? '/',
      currentScreen: state.router?.currentScreen ?? 'menu',
      previousPath: state.router?.previousPath ?? null,
    },
    currentScreen: (document.querySelector('.screen.active') as HTMLElement)?.id || 'menu',
    
    // Inventory
    inventory: {
      items: state.data?.inventory?.data || [],
      lastFetched: state.data?.inventory?.isLoaded ? now : 0,
    },
    
    // Shop
    shop: {
      items: state.data?.shop?.data || [],
      lastFetched: state.data?.shop?.isLoaded ? now : 0,
    },
    
    // Profile
    profile: {
      stats: state.data?.profile?.data || null,
      lastFetched: state.data?.profile?.isLoaded ? now : 0,
    },
    
    // Leaderboard
    leaderboard: {
      data: state.data?.leaderboard?.data || [],
      lastFetched: state.data?.leaderboard?.isLoaded ? now : 0,
    },

    // Cases
    cases: {
      data: state.data?.cases?.data || [],
      lastFetched: state.data?.cases?.isLoaded ? now : 0,
    },
    
    // Window globals
    playerMoney: (window as any).playerMoney?.value,
    playerDiamonds: (window as any).playerDiamonds?.value,

    // Feature state genérico (qualquer jogo/feature pode registrar aqui)
    featureState,
  };
  
  return {
    userId,
    timestamp: now,
    expiresAt,
    data: persistData,
  };
}

/**
 * Persiste o estado no localStorage
 */
export function saveState(): void {
  if (isRestoring || isSaving) return;
  
  isSaving = true;
  
  try {
    const state = getCurrentState();
    if (!state) {
      isSaving = false;
      return;
    }
    
    // Verificar se realmente mudou
    if (lastSavedState && JSON.stringify(lastSavedState) === JSON.stringify(state)) {
      isSaving = false;
      return;
    }
    
    // Verificar tamanho
    const stateStr = JSON.stringify(state);
    if (stateStr.length > STORAGE_SIZE_LIMIT) {
      console.warn('[PERSIST] Estado muito grande, truncando...');
      // Remover dados menos importantes
      delete state.data.leaderboard;
      delete state.data.inventory;
    }
    
    localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(state));
    lastSavedState = state;
    
    // Broadcast para outras abas
    if (broadcastChannel) {
      broadcastChannel.postMessage({
        type: 'STATE_UPDATED',
        state,
      });
    }
  } catch (err) {
    console.error('[PERSIST] Erro ao salvar estado:', err);
  } finally {
    isSaving = false;
  }
}

/**
 * Debounce automático para salvar estado
 */
export function debounceSave(): void {
  if (debounceSaveTimer) clearTimeout(debounceSaveTimer);
  
  debounceSaveTimer = setTimeout(() => {
    saveState();
    debounceSaveTimer = null;
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Restaura estado do localStorage
 */
export async function restoreState(): Promise<boolean> {
  if (isRestoring) return false;
  
  isRestoring = true;
  
  try {
    const stored = localStorage.getItem(PERSISTENCE_KEY);
    if (!stored) return false;
    
    const state: PersistedState = JSON.parse(stored);
    
    // Validar expiração
    if (Date.now() > state.expiresAt) {
      console.log('[PERSIST] Estado expirado');
      clearStoredState();
      return false;
    }
    
    // Validar userId
    const currentUser = store.getState().auth?.user?.id;
    if (state.userId !== currentUser) {
      console.log('[PERSIST] Usuário diferente, ignorando estado');
      return false;
    }
    
    // Restaurar dados no Redux
    if (state.data.inventory?.items?.length) {
      store.dispatch(dataActions.setInventory({
        data: state.data.inventory.items,
        isLoaded: true,
      }));
    }
    
    if (state.data.shop?.items?.length) {
      store.dispatch(dataActions.setShop({
        data: state.data.shop.items,
        isLoaded: true,
      }));
    }
    
    if (state.data.profile?.stats) {
      store.dispatch(dataActions.setProfile({
        data: state.data.profile.stats,
        isLoaded: true,
      }));
    }
    
    if (state.data.leaderboard?.data?.length) {
      store.dispatch(dataActions.setLeaderboard({
        data: state.data.leaderboard.data,
        isLoaded: true,
      }));
    }

    if (state.data.cases?.data?.length) {
      store.dispatch(dataActions.setCases({
        data: state.data.cases.data,
        isLoaded: true,
      }));
    }

    if (state.data.route) {
      store.dispatch(routerActions.setRoute({
        path: state.data.route.currentPath,
        screen: state.data.route.currentScreen,
      }));
    }
    
    // Restaurar globals
    if (state.data.playerMoney !== undefined && (window as any).playerMoney) {
      (window as any).playerMoney.value = state.data.playerMoney;
    }
    
    if (state.data.playerDiamonds !== undefined && (window as any).playerDiamonds) {
      (window as any).playerDiamonds.value = state.data.playerDiamonds;
    }

    // Restaurar feature state genérico
    if (state.data.featureState) {
      featureState = state.data.featureState;
      (window as any).__featureState = featureState;
    }
    
    console.log('[PERSIST] Estado restaurado com sucesso');
    lastSavedState = state;
    return true;
  } catch (err) {
    console.error('[PERSIST] Erro ao restaurar estado:', err);
    return false;
  } finally {
    isRestoring = false;
  }
}

/**
 * Limpa estado persistido
 */
export function clearStoredState(): void {
  try {
    localStorage.removeItem(PERSISTENCE_KEY);
    lastSavedState = null;
  } catch (err) {
    console.error('[PERSIST] Erro ao limpar estado:', err);
  }
}

/**
 * Inicia sincronização automática entre abas
 */
export function initializeSyncChannel(): void {
  if (!('BroadcastChannel' in window)) {
    console.warn('[PERSIST] BroadcastChannel não suportado, usando fallback com storage events');
    setupStorageEventListener();
    return;
  }
  
  try {
    broadcastChannel = new BroadcastChannel('lootskirmish-sync');
    
    broadcastChannel.onmessage = (event) => {
      const { type, state } = event.data;
      
      if (type === 'STATE_UPDATED') {
        handleRemoteStateUpdate(state);
      }
    };
    
    console.log('[PERSIST] BroadcastChannel inicializado');
  } catch (err) {
    console.warn('[PERSIST] Erro ao inicializar BroadcastChannel:', err);
    setupStorageEventListener();
  }
}

/**
 * Fallback para storage events (se BroadcastChannel não disponível)
 */
function setupStorageEventListener(): void {
  window.addEventListener('storage', (event) => {
    if (event.key === PERSISTENCE_KEY && event.newValue) {
      try {
        const state: PersistedState = JSON.parse(event.newValue);
        handleRemoteStateUpdate(state);
      } catch (err) {
        console.error('[PERSIST] Erro ao processar storage event:', err);
      }
    }
  });
}

/**
 * Processa atualização de estado de outra aba
 */
function handleRemoteStateUpdate(state: PersistedState): void {
  // Não restaurar se ainda em processo de restauração
  if (isRestoring) return;
  
  // Verificar se é do mesmo usuário
  const currentUser = store.getState().auth?.user?.id;
  if (state.userId !== currentUser) return;
  
  // Verificar expiração
  if (Date.now() > state.expiresAt) return;
  
  console.log('[PERSIST] Recebendo atualização de outra aba');
  
  // Atualizar dados sem substituir tudo
  if (state.data.inventory?.items?.length) {
    store.dispatch(dataActions.setInventory({
      data: state.data.inventory.items,
      isLoaded: true,
    }));
  }
  
  if (state.data.shop?.items?.length) {
    store.dispatch(dataActions.setShop({
      data: state.data.shop.items,
      isLoaded: true,
    }));
  }
  
  if (state.data.profile?.stats) {
    store.dispatch(dataActions.setProfile({
      data: state.data.profile.stats,
      isLoaded: true,
    }));
  }
  
  // Atualizar globals
  if (state.data.playerMoney !== undefined && (window as any).playerMoney) {
    (window as any).playerMoney.value = state.data.playerMoney;
  }
  
  if (state.data.playerDiamonds !== undefined && (window as any).playerDiamonds) {
    (window as any).playerDiamonds.value = state.data.playerDiamonds;
  }

  if (state.data.featureState) {
    featureState = state.data.featureState;
    (window as any).__featureState = featureState;
  }
  
  // Dispatch evento customizado para componentes se atualizarem
  window.dispatchEvent(new CustomEvent('app-state-synced', { detail: state }));
}

/**
 * Inicia auto-save automático
 */
export function startAutoSave(): void {
  if (autoSaveTimer) return;
  
  autoSaveTimer = setInterval(() => {
    saveState();
  }, AUTO_SAVE_INTERVAL);
  
  console.log('[PERSIST] Auto-save iniciado');
}

/**
 * Para auto-save
 */
export function stopAutoSave(): void {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
    console.log('[PERSIST] Auto-save parado');
  }
}

/**
 * Cleanup
 */
export function closeSyncChannel(): void {
  if (broadcastChannel) {
    broadcastChannel.close();
    broadcastChannel = null;
  }
  
  stopAutoSave();
  
  if (debounceSaveTimer) {
    clearTimeout(debounceSaveTimer);
    debounceSaveTimer = null;
  }
}

// ============================================================
// LIFECYCLE HOOKS
// ============================================================

/**
 * Inicializa sistema de persistência (deve ser chamado no bootstrap)
 */
export async function initializePersistence(): Promise<void> {
  console.log('[PERSIST] Inicializando sistema de persistência...');
  // Evita piscada de render durante restauração
  const root = document.documentElement;
  const previousVisibility = root.style.visibility;
  root.style.visibility = 'hidden';
  
  try {
    // Restaurar estado
    await restoreState();
    
    // Setup sincronização
    initializeSyncChannel();
    
    // Iniciar auto-save
    startAutoSave();
    
    // Salvar ao fazer logout
    const originalLogout = (window as any).handleLogout;
    if (originalLogout && !originalLogout._persistenceWrapped) {
      (window as any).handleLogout = async function() {
        closeSyncChannel();
        clearStoredState();
        return originalLogout.call(this);
      };
      originalLogout._persistenceWrapped = true;
    }
    
    console.log('[PERSIST] ✅ Sistema de persistência iniciado');
  } catch (err) {
    console.error('[PERSIST] Erro ao inicializar persistência:', err);
  } finally {
    // Restaurar visibilidade
    root.style.visibility = previousVisibility;
  }
}

/**
 * Para sistema de persistência (ao desmontar app)
 */
export function shutdownPersistence(): void {
  closeSyncChannel();
  clearStoredState();
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Força salvamento imediato
 */
export function forceSave(): void {
  if (debounceSaveTimer) {
    clearTimeout(debounceSaveTimer);
    debounceSaveTimer = null;
  }
  saveState();
}

// ============================================================
// FEATURE STATE HELPERS (GENÉRICOS)
// ============================================================

export function setFeatureState(key: string, value: any): void {
  featureState[key] = value;
  (window as any).__featureState = featureState;
  debounceSave();
}

export function getFeatureState<T = any>(key: string): T | undefined {
  return featureState[key] as T | undefined;
}

export function clearFeatureState(key?: string): void {
  if (key) {
    delete featureState[key];
  } else {
    featureState = {};
  }
  (window as any).__featureState = featureState;
  debounceSave();
}

/**
 * Obtém tempo restante para expiração (em segundos)
 */
export function getExpirationTime(): number {
  try {
    const stored = localStorage.getItem(PERSISTENCE_KEY);
    if (!stored) return 0;
    
    const state: PersistedState = JSON.parse(stored);
    const remaining = Math.max(0, state.expiresAt - Date.now());
    return Math.ceil(remaining / 1000);
  } catch {
    return 0;
  }
}
