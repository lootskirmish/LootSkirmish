// ============================================================
// PERSISTENCE.TS - Sistema Unificado: Redux Store + State + Persistence
// ============================================================
// Sistema completo que integra:
// - Redux Store (state management)
// - State lifecycle (beforeunload, etc)
// - Persistence (localStorage, IndexedDB, etc)
// - Sincronização entre abas
// - Versionamento e migrações
// - Cache com TTL
// - Hooks e plugins
// ============================================================

import { configureStore, createSlice, PayloadAction } from '@reduxjs/toolkit';

// ============================================================
// REDUX STORE - TYPES
// ============================================================

interface User {
  id: string;
  username?: string;
  email?: string;
  [key: string]: unknown;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface RouterState {
  currentPath: string;
  currentScreen: string;
  previousPath: string | null;
}

interface DataItem {
  [key: string]: unknown;
}

interface LoadingData<T> {
  data: T;
  isLoaded: boolean;
  isLoading: boolean;
}

interface DataState {
  inventory: LoadingData<DataItem[]>;
  leaderboard: LoadingData<DataItem[]>;
  cases: LoadingData<DataItem[]>;
  profile: LoadingData<DataItem | null>;
  shop: LoadingData<DataItem[]>;
}

// ============================================================
// REDUX STORE - SLICES
// ============================================================

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    isAuthenticated: false,
    isLoading: false,
  } as AuthState,
  reducers: {
    setUser: (state, action: PayloadAction<User | null>) => {
      state.user = action.payload;
      state.isAuthenticated = !!action.payload;
    },
    clearUser: (state) => {
      state.user = null;
      state.isAuthenticated = false;
    },
  },
});

const routerSlice = createSlice({
  name: 'router',
  initialState: {
    currentPath: '/',
    currentScreen: 'menu',
    previousPath: null,
  } as RouterState,
  reducers: {
    setRoute: (state, action: PayloadAction<{ path: string; screen: string }>) => {
      state.previousPath = state.currentPath;
      state.currentPath = action.payload.path;
      state.currentScreen = action.payload.screen;
    },
  },
});

const dataSlice = createSlice({
  name: 'data',
  initialState: {
    inventory: {
      data: [],
      isLoaded: false,
      isLoading: false,
    },
    leaderboard: {
      data: [],
      isLoaded: false,
      isLoading: false,
    },
    cases: {
      data: [],
      isLoaded: false,
      isLoading: false,
    },
    profile: {
      data: null,
      isLoaded: false,
      isLoading: false,
    },
    shop: {
      data: [],
      isLoaded: false,
      isLoading: false,
    },
  } as DataState,
  reducers: {
    setInventory: (state, action: PayloadAction<DataItem[] | {data: DataItem[], isLoaded: boolean}>) => {
      if (Array.isArray(action.payload)) {
        state.inventory.data = action.payload;
        state.inventory.isLoaded = true;
      } else {
        state.inventory.data = action.payload.data;
        state.inventory.isLoaded = action.payload.isLoaded;
      }
      state.inventory.isLoading = false;
    },
    setInventoryLoading: (state, action: PayloadAction<boolean>) => {
      state.inventory.isLoading = action.payload;
    },
    setLeaderboard: (state, action: PayloadAction<DataItem[] | {data: DataItem[], isLoaded: boolean}>) => {
      if (Array.isArray(action.payload)) {
        state.leaderboard.data = action.payload;
        state.leaderboard.isLoaded = true;
      } else {
        state.leaderboard.data = action.payload.data;
        state.leaderboard.isLoaded = action.payload.isLoaded;
      }
      state.leaderboard.isLoading = false;
    },
    setLeaderboardLoading: (state, action: PayloadAction<boolean>) => {
      state.leaderboard.isLoading = action.payload;
    },
    setCases: (state, action: PayloadAction<DataItem[]>) => {
      state.cases.data = action.payload;
      state.cases.isLoaded = true;
      state.cases.isLoading = false;
    },
    setCasesLoading: (state, action: PayloadAction<boolean>) => {
      state.cases.isLoading = action.payload;
    },
    setProfile: (state, action: PayloadAction<(DataItem | null) | {data: (DataItem | null), isLoaded: boolean}>) => {
      if (typeof action.payload === 'object' && action.payload && 'data' in action.payload) {
        state.profile.data = action.payload.data as DataItem | null;
        state.profile.isLoaded = action.payload.isLoaded as boolean;
      } else {
        state.profile.data = action.payload;
        state.profile.isLoaded = true;
      }
      state.profile.isLoading = false;
    },
    setProfileLoading: (state, action: PayloadAction<boolean>) => {
      state.profile.isLoading = action.payload;
    },
    setShop: (state, action: PayloadAction<DataItem[] | {data: DataItem[], isLoaded: boolean}>) => {
      if (Array.isArray(action.payload)) {
        state.shop.data = action.payload;
        state.shop.isLoaded = true;
      } else {
        state.shop.data = action.payload.data;
        state.shop.isLoaded = action.payload.isLoaded;
      }
      state.shop.isLoading = false;
    },
    setShopLoading: (state, action: PayloadAction<boolean>) => {
      state.shop.isLoading = action.payload;
    },
    clearAllData: (state) => {
      state.inventory = { data: [], isLoaded: false, isLoading: false };
      state.leaderboard = { data: [], isLoaded: false, isLoading: false };
      state.cases = { data: [], isLoaded: false, isLoading: false };
      state.profile = { data: null, isLoaded: false, isLoading: false };
      state.shop = { data: [], isLoaded: false, isLoading: false };
    },
  },
});

// ============================================================
// REDUX STORE - CONFIGURATION
// ============================================================

export const store = configureStore({
  reducer: {
    auth: authSlice.reducer,
    router: routerSlice.reducer,
    data: dataSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export const authActions = authSlice.actions;
export const routerActions = routerSlice.actions;
export const dataActions = dataSlice.actions;

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// ============================================================
// TYPES & INTERFACES
// ============================================================

type StorageType = 'localStorage' | 'sessionStorage' | 'indexedDB';
type PersistenceHook = 'beforeSave' | 'afterSave' | 'beforeRestore' | 'afterRestore' | 'onError';

interface PersistenceConfig {
  version: number;
  storageType: StorageType;
  keyPrefix: string;
  ttl: number; // Time to live em ms
  compressionEnabled: boolean;
  autoSave: boolean;
  autoSaveInterval: number;
  syncAcrossTabs: boolean;
  debounceMs: number;
  maxRetries: number;
  debug: boolean;
}

interface PersistedData {
  version: number;
  userId: string;
  timestamp: number;
  expiresAt: number;
  compressed: boolean;
  checksum?: string;
  state: AppState;
}

interface AppState {
  // Router
  router?: {
    currentPath: string;
    currentScreen: string;
    previousPath: string | null;
  };
  
  // Redux Data
  data?: {
    inventory?: { items: any[]; lastFetched: number; };
    shop?: { items: any[]; lastFetched: number; };
    profile?: { stats: any; lastFetched: number; };
    leaderboard?: { data: any[]; lastFetched: number; };
    cases?: { data: any[]; lastFetched: number; };
  };
  
  // Global State
  globals?: {
    playerMoney?: number;
    playerDiamonds?: number;
  };
  
  // Feature State (genérico para qualquer feature)
  features?: Record<string, any>;
  
  // Cache Layer
  cache?: Record<string, CacheEntry>;
}

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

interface Migration {
  from: number;
  to: number;
  migrate: (data: any) => any;
}

type HookCallback = (data?: any) => void | Promise<void>;

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_CONFIG: PersistenceConfig = {
  version: 3,
  storageType: 'localStorage',
  keyPrefix: 'lootskirmish-v3',
  ttl: 30 * 60 * 1000, // 30 minutos
  compressionEnabled: true,
  autoSave: true,
  autoSaveInterval: 3000, // 3 segundos
  syncAcrossTabs: true,
  debounceMs: 500,
  maxRetries: 3,
  debug: false,
}


const STORAGE_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB limite seguro

// ============================================================
// STATE MANAGEMENT
// ============================================================

class PersistenceManager {
  private config: PersistenceConfig;
  private hooks: Map<PersistenceHook, HookCallback[]>;
  private migrations: Migration[];
  private storage: StorageAdapter;
  private broadcastChannel: BroadcastChannel | null;
  private autoSaveTimer: ReturnType<typeof setInterval> | null;
  private debounceTimer: ReturnType<typeof setTimeout> | null;
  private isRestoring: boolean;
  private isSaving: boolean;
  private lastSavedChecksum: string | null;
  private retryCount: number;

  constructor(config: Partial<PersistenceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.hooks = new Map();
    this.migrations = [];
    this.storage = this.createStorageAdapter();
    this.broadcastChannel = null;
    this.autoSaveTimer = null;
    this.debounceTimer = null;
    this.isRestoring = false;
    this.isSaving = false;
    this.lastSavedChecksum = null;
    this.retryCount = 0;

    this.log('PersistenceManager criado', this.config);
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================

  async initialize(): Promise<boolean> {
    this.log('Inicializando sistema de persistência...');
    
    try {
      // Executar hooks
      await this.executeHooks('beforeRestore');
      
      // Restaurar estado
      const restored = await this.restore();
      
      // Executar hooks
      await this.executeHooks('afterRestore', restored);
      
      // Inicializar sincronização entre abas
      if (this.config.syncAcrossTabs) {
        this.initializeSync();
      }
      
      // Iniciar auto-save
      if (this.config.autoSave) {
        this.startAutoSave();
      }
      
      this.log('✅ Sistema de persistência inicializado');
      return true;
    } catch (error) {
      this.logError('Erro ao inicializar persistência', error);
      await this.executeHooks('onError', error);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.log('Encerrando sistema de persistência...');
    
    try {
      // Salvar estado final
      await this.save();
      
      // Parar auto-save
      this.stopAutoSave();
      
      // Fechar broadcast channel
      if (this.broadcastChannel) {
        this.broadcastChannel.close();
        this.broadcastChannel = null;
      }
      
      // Limpar timers
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      
      this.log('✅ Sistema de persistência encerrado');
    } catch (error) {
      this.logError('Erro ao encerrar persistência', error);
    }
  }

  // ============================================================
  // SAVE & RESTORE
  // ============================================================

  async save(): Promise<boolean> {
    if (this.isRestoring || this.isSaving) {
      this.log('Save bloqueado: operação em andamento');
      return false;
    }

    this.isSaving = true;

    try {
      // Executar hooks
      await this.executeHooks('beforeSave');

      // Coletar estado
      const state = this.collectState();
      if (!state) {
        this.log('Nenhum estado para salvar (usuário não autenticado)');
        this.isSaving = false;
        return false;
      }

      // Criar objeto de dados persistidos
      const data = this.createPersistedData(state);

      // Verificar se mudou
      const checksum = this.calculateChecksum(data);
      if (checksum === this.lastSavedChecksum) {
        this.log('Estado não mudou, skip save');
        this.isSaving = false;
        return false;
      }

      // Comprimir se necessário
      let serialized = JSON.stringify(data);
      if (this.config.compressionEnabled && serialized.length > 10000) {
        serialized = this.compress(serialized);
        data.compressed = true;
      }

      // Verificar tamanho
      if (serialized.length > STORAGE_SIZE_LIMIT) {
        this.log('Estado muito grande, aplicando estratégias de redução...');
        serialized = this.reduceStateSize(data);
      }

      // Salvar no storage
      await this.storage.set(this.getStorageKey(), serialized);
      this.lastSavedChecksum = checksum;

      // Broadcast para outras abas
      if (this.broadcastChannel && this.config.syncAcrossTabs) {
        this.broadcastChannel.postMessage({
          type: 'STATE_UPDATED',
          checksum,
          timestamp: Date.now(),
        });
      }

      // Executar hooks
      await this.executeHooks('afterSave', data);

      this.log('✅ Estado salvo com sucesso');
      this.retryCount = 0;
      return true;
    } catch (error) {
      this.logError('Erro ao salvar estado', error);
      await this.executeHooks('onError', error);
      
      // Retry logic
      if (this.retryCount < this.config.maxRetries) {
        this.retryCount++;
        this.log(`Tentando novamente... (${this.retryCount}/${this.config.maxRetries})`);
        await this.delay(1000 * this.retryCount);
        return this.save();
      }
      
      return false;
    } finally {
      this.isSaving = false;
    }
  }

  async restore(): Promise<boolean> {
    if (this.isRestoring) {
      this.log('Restore bloqueado: operação em andamento');
      return false;
    }

    this.isRestoring = true;

    try {
      // Buscar dados do storage
      const serialized = await this.storage.get(this.getStorageKey());
      if (!serialized) {
        this.log('Nenhum estado salvo encontrado');
        this.isRestoring = false;
        return false;
      }

      // Descomprimir se necessário
      let data: PersistedData;
      try {
        const parsed = JSON.parse(serialized);
        if (parsed.compressed) {
          const decompressed = this.decompress(serialized);
          data = JSON.parse(decompressed);
        } else {
          data = parsed;
        }
      } catch (parseError) {
        this.logError('Erro ao parsear dados', parseError);
        await this.clear();
        this.isRestoring = false;
        return false;
      }

      // Validar dados
      if (!this.validateData(data)) {
        this.log('Dados inválidos, limpando storage');
        await this.clear();
        this.isRestoring = false;
        return false;
      }

      // Verificar expiração
      if (Date.now() > data.expiresAt) {
        this.log('Estado expirado');
        await this.clear();
        this.isRestoring = false;
        return false;
      }

      // Verificar userId
      const currentUserId = this.getCurrentUserId();
      if (data.userId !== currentUserId) {
        this.log('UserId diferente, ignorando estado');
        this.isRestoring = false;
        return false;
      }

      // Aplicar migrações se necessário
      if (data.version < this.config.version) {
        this.log(`Migrando dados de v${data.version} para v${this.config.version}`);
        data = this.applyMigrations(data);
      }

      // Restaurar estado
      this.applyState(data.state);

      // Salvar checksum
      this.lastSavedChecksum = this.calculateChecksum(data);

      this.log('✅ Estado restaurado com sucesso');
      return true;
    } catch (error) {
      this.logError('Erro ao restaurar estado', error);
      await this.executeHooks('onError', error);
      return false;
    } finally {
      this.isRestoring = false;
    }
  }

  // ============================================================
  // STATE COLLECTION & APPLICATION
  // ============================================================

  private collectState(): AppState | null {
    const reduxState = store.getState();
    const userId = reduxState.auth?.user?.id;

    if (!userId) return null;

    const now = Date.now();

    return {
      router: {
        currentPath: reduxState.router?.currentPath ?? '/',
        currentScreen: reduxState.router?.currentScreen ?? 'menu',
        previousPath: reduxState.router?.previousPath ?? null,
      },
      
      data: {
        inventory: {
          items: reduxState.data?.inventory?.data || [],
          lastFetched: reduxState.data?.inventory?.isLoaded ? now : 0,
        },
        shop: {
          items: reduxState.data?.shop?.data || [],
          lastFetched: reduxState.data?.shop?.isLoaded ? now : 0,
        },
        profile: {
          stats: reduxState.data?.profile?.data || null,
          lastFetched: reduxState.data?.profile?.isLoaded ? now : 0,
        },
        leaderboard: {
          data: reduxState.data?.leaderboard?.data || [],
          lastFetched: reduxState.data?.leaderboard?.isLoaded ? now : 0,
        },
        cases: {
          data: reduxState.data?.cases?.data || [],
          lastFetched: reduxState.data?.cases?.isLoaded ? now : 0,
        },
      },
      
      globals: {
        playerMoney: (window as any).playerMoney?.value,
        playerDiamonds: (window as any).playerDiamonds?.value,
      },
      
      features: (window as any).__featureState || {},
      
      cache: this.getCache(),
    };
  }

  private applyState(state: AppState): void {
    // Router
    if (state.router) {
      store.dispatch(routerActions.setRoute({
        path: state.router.currentPath,
        screen: state.router.currentScreen,
      }));
    }

    // Redux Data
    if (state.data) {
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
        store.dispatch(dataActions.setCases(state.data.cases.data as any[]));
      }
    }

    // Globals
    if (state.globals) {
      if (state.globals.playerMoney !== undefined && (window as any).playerMoney) {
        (window as any).playerMoney.value = state.globals.playerMoney;
      }

      if (state.globals.playerDiamonds !== undefined && (window as any).playerDiamonds) {
        (window as any).playerDiamonds.value = state.globals.playerDiamonds;
      }
    }

    // Features
    if (state.features) {
      (window as any).__featureState = state.features;
    }

    // Cache
    if (state.cache) {
      this.restoreCache(state.cache);
    }

    // Dispatch evento customizado
    window.dispatchEvent(new CustomEvent('persistence:state-restored', { detail: state }));
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private createPersistedData(state: AppState): PersistedData {
    const now = Date.now();
    const userId = this.getCurrentUserId();

    return {
      version: this.config.version,
      userId: userId!,
      timestamp: now,
      expiresAt: now + this.config.ttl,
      compressed: false,
      state,
    };
  }

  private validateData(data: any): boolean {
    if (!data || typeof data !== 'object') return false;
    if (!data.userId || typeof data.userId !== 'string') return false;
    if (!data.timestamp || typeof data.timestamp !== 'number') return false;
    if (!data.expiresAt || typeof data.expiresAt !== 'number') return false;
    if (!data.state || typeof data.state !== 'object') return false;
    return true;
  }

  private getCurrentUserId(): string | null {
    const state = store.getState();
    return state.auth?.user?.id || null;
  }

  private getStorageKey(): string {
    const userId = this.getCurrentUserId();
    return `${this.config.keyPrefix}:${userId}`;
  }

  private calculateChecksum(data: PersistedData): string {
    // Simples hash para verificar mudanças
    const str = JSON.stringify(data.state);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  private compress(data: string): string {
    // Implementação simples de compressão (pode usar LZ-string ou similar)
    try {
      return btoa(encodeURIComponent(data));
    } catch {
      return data;
    }
  }

  private decompress(data: string): string {
    try {
      return decodeURIComponent(atob(data));
    } catch {
      return data;
    }
  }

  private reduceStateSize(data: PersistedData): string {
    // Estratégias para reduzir tamanho
    const reduced = { ...data };
    
    // Remover dados menos importantes em ordem
    if (reduced.state.data?.leaderboard) {
      delete reduced.state.data.leaderboard;
    }
    
    if (reduced.state.cache) {
      delete reduced.state.cache;
    }
    
    // Limitar itens do inventário
    if (reduced.state.data?.inventory?.items && reduced.state.data.inventory.items.length > 100) {
      reduced.state.data.inventory.items = reduced.state.data.inventory.items.slice(0, 100);
    }

    return JSON.stringify(reduced);
  }

  // ============================================================
  // AUTO-SAVE
  // ============================================================

  private startAutoSave(): void {
    if (this.autoSaveTimer) return;

    this.autoSaveTimer = setInterval(() => {
      this.save();
    }, this.config.autoSaveInterval);

    this.log('Auto-save iniciado');
  }

  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
      this.log('Auto-save parado');
    }
  }

  debounceSave(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.save();
      this.debounceTimer = null;
    }, this.config.debounceMs);
  }

  forceSave(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.save();
  }

  // ============================================================
  // SYNC ACROSS TABS
  // ============================================================

  private initializeSync(): void {
    if (!('BroadcastChannel' in window)) {
      this.log('BroadcastChannel não suportado, usando storage events');
      this.setupStorageEventListener();
      return;
    }

    try {
      this.broadcastChannel = new BroadcastChannel(`${this.config.keyPrefix}:sync`);

      this.broadcastChannel.onmessage = (event) => {
        this.handleSyncMessage(event.data);
      };

      this.log('BroadcastChannel inicializado');
    } catch (error) {
      this.logError('Erro ao inicializar BroadcastChannel', error);
      this.setupStorageEventListener();
    }
  }

  private setupStorageEventListener(): void {
    window.addEventListener('storage', (event) => {
      if (event.key === this.getStorageKey() && event.newValue) {
        this.handleStorageChange(event.newValue);
      }
    });
  }

  private async handleSyncMessage(message: any): Promise<void> {
    if (message.type === 'STATE_UPDATED' && message.checksum !== this.lastSavedChecksum) {
      this.log('Recebendo atualização de outra aba');
      await this.restore();
    }
  }

  private async handleStorageChange(newValue: string): Promise<void> {
    try {
      const data: PersistedData = JSON.parse(newValue);
      const checksum = this.calculateChecksum(data);
      
      if (checksum !== this.lastSavedChecksum) {
        this.log('Storage alterado em outra aba');
        await this.restore();
      }
    } catch (error) {
      this.logError('Erro ao processar storage change', error);
    }
  }

  // ============================================================
  // CACHE SYSTEM
  // ============================================================

  private cacheStore: Map<string, CacheEntry> = new Map();

  setCache(key: string, data: any, ttl: number = 5 * 60 * 1000): void {
    this.cacheStore.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
    this.debounceSave();
  }

  getCache(): Record<string, CacheEntry> {
    const cache: Record<string, CacheEntry> = {};
    const now = Date.now();

    this.cacheStore.forEach((entry, key) => {
      if (now - entry.timestamp < entry.ttl) {
        cache[key] = entry;
      } else {
        this.cacheStore.delete(key);
      }
    });

    return cache;
  }

  getCacheItem<T = any>(key: string): T | null {
    const entry = this.cacheStore.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cacheStore.delete(key);
      return null;
    }

    return entry.data as T;
  }

  clearCache(key?: string): void {
    if (key) {
      this.cacheStore.delete(key);
    } else {
      this.cacheStore.clear();
    }
    this.debounceSave();
  }

  private restoreCache(cache: Record<string, CacheEntry>): void {
    const now = Date.now();
    Object.entries(cache).forEach(([key, entry]) => {
      if (now - entry.timestamp < entry.ttl) {
        this.cacheStore.set(key, entry);
      }
    });
  }

  // ============================================================
  // HOOKS SYSTEM
  // ============================================================

  addHook(hook: PersistenceHook, callback: HookCallback): void {
    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, []);
    }
    this.hooks.get(hook)!.push(callback);
    this.log(`Hook adicionado: ${hook}`);
  }

  removeHook(hook: PersistenceHook, callback: HookCallback): void {
    const callbacks = this.hooks.get(hook);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
        this.log(`Hook removido: ${hook}`);
      }
    }
  }

  private async executeHooks(hook: PersistenceHook, data?: any): Promise<void> {
    const callbacks = this.hooks.get(hook);
    if (!callbacks || callbacks.length === 0) return;

    for (const callback of callbacks) {
      try {
        await callback(data);
      } catch (error) {
        this.logError(`Erro ao executar hook ${hook}`, error);
      }
    }
  }

  // ============================================================
  // MIGRATIONS SYSTEM
  // ============================================================

  addMigration(migration: Migration): void {
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.from - b.from);
    this.log(`Migração adicionada: v${migration.from} -> v${migration.to}`);
  }

  private applyMigrations(data: PersistedData): PersistedData {
    let currentData = data;
    
    for (const migration of this.migrations) {
      if (currentData.version === migration.from) {
        this.log(`Aplicando migração: v${migration.from} -> v${migration.to}`);
        currentData.state = migration.migrate(currentData.state);
        currentData.version = migration.to;
      }
    }

    return currentData;
  }

  // ============================================================
  // STORAGE ADAPTER
  // ============================================================

  private createStorageAdapter(): StorageAdapter {
    switch (this.config.storageType) {
      case 'localStorage':
        return new LocalStorageAdapter();
      case 'sessionStorage':
        return new SessionStorageAdapter();
      case 'indexedDB':
        return new IndexedDBAdapter();
      default:
        return new LocalStorageAdapter();
    }
  }

  // ============================================================
  // UTILS & CLEAR
  // ============================================================

  async clear(): Promise<void> {
    try {
      await this.storage.remove(this.getStorageKey());
      this.lastSavedChecksum = null;
      this.cacheStore.clear();
      this.log('Storage limpo');
    } catch (error) {
      this.logError('Erro ao limpar storage', error);
    }
  }

  getStats(): any {
    return {
      config: this.config,
      isRestoring: this.isRestoring,
      isSaving: this.isSaving,
      lastSavedChecksum: this.lastSavedChecksum,
      cacheSize: this.cacheStore.size,
      retryCount: this.retryCount,
    };
  }

  // ============================================================
  // LOGGING
  // ============================================================

  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[Persistence]', ...args);
    }
  }

  private logError(...args: any[]): void {
    console.error('[Persistence]', ...args);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================
// STORAGE ADAPTERS
// ============================================================

interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

class LocalStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      throw new Error(`Erro ao salvar no localStorage: ${error}`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignorar erros
    }
  }
}

class SessionStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      sessionStorage.setItem(key, value);
    } catch (error) {
      throw new Error(`Erro ao salvar no sessionStorage: ${error}`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Ignorar erros
    }
  }
}

class IndexedDBAdapter implements StorageAdapter {
  private dbName = 'lootskirmish-persistence';
  private storeName = 'state';
  private db: IDBDatabase | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(value, key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      throw new Error(`Erro ao salvar no IndexedDB: ${error}`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch {
      // Ignorar erros
    }
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

let persistenceInstance: PersistenceManager | null = null;

export function createPersistence(config?: Partial<PersistenceConfig>): PersistenceManager {
  if (persistenceInstance) {
    console.warn('[Persistence] Instância já existe, retornando existente');
    return persistenceInstance;
  }

  persistenceInstance = new PersistenceManager(config);
  return persistenceInstance;
}

export function getPersistence(): PersistenceManager {
  if (!persistenceInstance) {
    throw new Error('[Persistence] Instância não inicializada. Chame createPersistence() primeiro.');
  }
  return persistenceInstance;
}

// ============================================================
// PUBLIC API (Backward Compatibility)
// ============================================================

export async function initializePersistence(config?: Partial<PersistenceConfig>): Promise<void> {
  const persistence = createPersistence(config);
  await persistence.initialize();
}

export async function shutdownPersistence(): Promise<void> {
  if (persistenceInstance) {
    await persistenceInstance.shutdown();
    persistenceInstance = null;
  }
}

export function saveState(): void {
  if (persistenceInstance) {
    persistenceInstance.save();
  }
}

export function debounceSave(): void {
  if (persistenceInstance) {
    persistenceInstance.debounceSave();
  }
}

export function forceSave(): void {
  if (persistenceInstance) {
    persistenceInstance.forceSave();
  }
}

export async function restoreState(): Promise<boolean> {
  if (persistenceInstance) {
    return persistenceInstance.restore();
  }
  return false;
}

export async function clearStoredState(): Promise<void> {
  if (persistenceInstance) {
    await persistenceInstance.clear();
  }
}

// ============================================================
// CACHE API
// ============================================================

export function setCache(key: string, data: any, ttl?: number): void {
  if (persistenceInstance) {
    persistenceInstance.setCache(key, data, ttl);
  }
}

export function getCacheItem<T = any>(key: string): T | null {
  if (persistenceInstance) {
    return persistenceInstance.getCacheItem<T>(key);
  }
  return null;
}

export function clearCache(key?: string): void {
  if (persistenceInstance) {
    persistenceInstance.clearCache(key);
  }
}

// ============================================================
// FEATURE STATE API (mantém compatibilidade)
// ============================================================

export function setFeatureState(key: string, value: any): void {
  (window as any).__featureState = (window as any).__featureState || {};
  (window as any).__featureState[key] = value;
  debounceSave();
}

export function getFeatureState<T = any>(key: string): T | undefined {
  const featureState = (window as any).__featureState || {};
  return featureState[key] as T | undefined;
}

export function clearFeatureState(key?: string): void {
  if (key) {
    const featureState = (window as any).__featureState || {};
    delete featureState[key];
  } else {
    (window as any).__featureState = {};
  }
  debounceSave();
}

// ============================================================
// HOOKS API
// ============================================================

export function addPersistenceHook(hook: PersistenceHook, callback: HookCallback): void {
  if (persistenceInstance) {
    persistenceInstance.addHook(hook, callback);
  }
}

export function removePersistenceHook(hook: PersistenceHook, callback: HookCallback): void {
  if (persistenceInstance) {
    persistenceInstance.removeHook(hook, callback);
  }
}

// ============================================================
// MIGRATION API
// ============================================================

export function addMigration(from: number, to: number, migrate: (data: any) => any): void {
  if (persistenceInstance) {
    persistenceInstance.addMigration({ from, to, migrate });
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

export function getPersistenceStats(): any {
  if (persistenceInstance) {
    return persistenceInstance.getStats();
  }
  return null;
}

export function getExpirationTime(): number {
  // Backward compatibility
  return 0;
}

// ============================================================
// STATE LIFECYCLE MANAGEMENT (ex state.ts)
// ============================================================

interface WindowWithState {
  currentUser?: { id: string; [key: string]: unknown };
  willRestoreState?: boolean;
  stopShopPolling?: () => void;
  stopAdminPolling?: () => void;
  stopRoomPolling?: () => void;
  handleLogout?: ((...args: any[]) => Promise<void>) & { _stateWrapped?: boolean };
  goTo?: ((screen: string) => void) & { _stateWrapped?: boolean; _routerIntercepted?: boolean };
  saveAppState?: () => void;
  restoreAppState?: () => Promise<boolean>;
  clearAppState?: () => void;
  addEventListener: Window['addEventListener'];
  [key: string]: any;
}

let stateListenersBound = false;
let stateOverridesBound = false;

/**
 * Setup de listeners para lifecycle da aplicação
 */
function setupStateListeners(): void {
  if (stateListenersBound) return;
  stateListenersBound = true;

  const win = window as WindowWithState;

  win.addEventListener('beforeunload', () => {
    // Parar pollings
    if (win.stopShopPolling) win.stopShopPolling();
    if (win.stopAdminPolling) win.stopAdminPolling();
    if (win.stopRoomPolling) win.stopRoomPolling();

    // Salvar estado final
    forceSave();
  });
}

/**
 * Setup de overrides para integração com auth e router
 */
function setupStateOverrides(): void {
  if (stateOverridesBound) return;
  stateOverridesBound = true;

  const win = window as WindowWithState;

  // Override handleLogout para limpar estado
  if (win.handleLogout && !(win.handleLogout as any)._stateWrapped) {
    const original = win.handleLogout;
    win.handleLogout = async function (this: WindowWithState) {
      await clearStoredState();
      await original.call(this);
    } as any;
    (win.handleLogout as any)._stateWrapped = true;
  }

  // Override goTo para salvar estado após navegação
  if (win.goTo && !(win.goTo as any)._stateWrapped) {
    const originalGoTo = win.goTo;
    const wrapped = function (this: WindowWithState, screen: string) {
      originalGoTo.call(this, screen);
      setTimeout(() => debounceSave(), 300);
    } as any;
    wrapped._stateWrapped = true;
    wrapped._routerIntercepted = Boolean((originalGoTo as any)._routerIntercepted);
    win.goTo = wrapped;
  }
}

/**
 * Inicializa sistema de state lifecycle
 */
export function initializeStateSystem(): void {
  setupStateListeners();
  setupStateOverrides();
}

// ============================================================
// PERSISTENCE MIDDLEWARE
// ============================================================

/**
 * Conecta Redux ao sistema de persistência
 */
export function setupPersistenceMiddleware(reduxStore: typeof store): void {
  const setupSubscribe = () => {
    try {
      const persistence = getPersistence();
      
      reduxStore.subscribe(() => {
        persistence.debounceSave();
      });

      console.log('[Persistence] ✅ Middleware conectado ao Redux');
    } catch (error) {
      console.warn('[Persistence] Aguardando inicialização...');
      setTimeout(setupSubscribe, 100);
    }
  };

  setupSubscribe();
}

// ============================================================
// GLOBAL EXPORTS
// ============================================================

if (typeof window !== 'undefined') {
  (window as any).store = store;
  (window as any).authActions = authActions;
  (window as any).routerActions = routerActions;
  (window as any).dataActions = dataActions;
  (window as any).playerMoney = (window as any).playerMoney || { value: 0 };
  (window as any).playerDiamonds = (window as any).playerDiamonds || { value: 0 };
}

// ============================================================
// TYPES EXPORT
// ============================================================

export type {
  PersistenceConfig,
  PersistedData,
  AppState,
  StorageType,
  PersistenceHook,
  Migration,
  AuthState,
  RouterState,
  DataState,
  User,
};
