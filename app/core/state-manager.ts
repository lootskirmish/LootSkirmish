// ============================================================
// STATE-MANAGER.TS - Gerenciamento Centralizado de Estado
// ============================================================

/**
 * 🎯 Single Source of Truth para Estado Global
 * 
 * Problema resolvido: múltiplas fontes de verdade
 * - window.currentUser
 * - window.playerMoney / playerDiamonds
 * - Redux store
 * - localStorage
 * 
 * Solução: Wrapper centralizado que sincroniza tudo automaticamente
 */

import { store, authActions, dataActions } from '../core/persistence';
import { getActiveUser, setActiveUser } from '../core/session';
import { createLogger } from '../core/logger';

const logger = createLogger('StateManager');

// ============================================================
// TYPES
// ============================================================

export interface PlayerState {
  user: {
    id: string;
    email?: string;
    username?: string;
    [key: string]: any;
  } | null;
  money: number;
  diamonds: number;
  xp: number;
  level: number;
  unlockedPasses: string[];
  caseDiscountLevel: number;
}

// ============================================================
// STATE STORE
// ============================================================

/**
 * Centralized State Manager
 * Sincroniza automaticamente: Redux ↔ window ↔ localStorage
 */
class StateManager {
  private state: PlayerState = {
    user: null,
    money: 0,
    diamonds: 0,
    xp: 0,
    level: 1,
    unlockedPasses: [],
    caseDiscountLevel: 0
  };
  
  private subscribers: Set<(state: PlayerState) => void> = new Set();
  
  constructor() {
    this.initializeProxies();
    this.loadInitialState();
  }
  
  /**
   * Inicializa proxies no window para manter compatibilidade
   */
  private initializeProxies(): void {
    // Proxy para window.playerMoney
    if (!window.playerMoney) {
      window.playerMoney = this.createCurrencyProxy('money');
    }
    
    // Proxy para window.playerDiamonds
    if (!window.playerDiamonds) {
      window.playerDiamonds = this.createCurrencyProxy('diamonds');
    }
  }
  
  /**
   * Cria proxy que sincroniza automaticamente com state centralizado
   */
  private createCurrencyProxy(key: 'money' | 'diamonds'): { value: number } {
    const self = this;
    return new Proxy(
      { _value: 0, value: 0 },
      {
        get(target, prop) {
          if (prop === 'value') {
            return self.state[key];
          }
          return target[prop as keyof typeof target];
        },
        set(target, prop, value) {
          if (prop === 'value') {
            self.updateCurrency(key, value);
            return true;
          }
          target[prop as keyof typeof target] = value;
          return true;
        }
      }
    );
  }
  
  /**
   * Carrega estado inicial de múltiplas fontes
   */
  private loadInitialState(): void {
    // 1. Tentar Redux store
    const reduxState = store.getState();
    if (reduxState?.auth?.user) {
      this.state.user = reduxState.auth.user;
    }
    
    // 2. Tentar window.currentUser (fallback)
    if (!this.state.user && (window as any).currentUser) {
      this.state.user = (window as any).currentUser;
    }
    
    // 3. Tentar getActiveUser (session)
    if (!this.state.user) {
      const user = getActiveUser({ sync: true, allowStored: true });
      if (user) {
        this.state.user = user;
      }
    }
    
    // 4. Carregar moedas dos cached values
    if ((window as any).cachedDiamonds !== undefined) {
      this.state.diamonds = (window as any).cachedDiamonds;
    }
    
    if ((window as any).cachedUnlockedPasses) {
      this.state.unlockedPasses = (window as any).cachedUnlockedPasses;
    }
    
    if ((window as any).cachedCaseDiscountLevel !== undefined) {
      this.state.caseDiscountLevel = (window as any).cachedCaseDiscountLevel;
    }
    
    logger.info('[StateManager] Initial state loaded:', this.state);
  }
  
  // ============================================================
  // USER MANAGEMENT
  // ============================================================
  
  /**
   * Define usuário ativo (sincroniza tudo)
   */
  setUser(user: PlayerState['user']): void {
    this.state.user = user;
    
    // Sincronizar com Redux
    if (user) {
      store.dispatch(authActions.setUser(user));
    } else {
      store.dispatch(authActions.clearUser());
    }
    
    // Sincronizar com window
    if ((window as any).currentUser !== user) {
      (window as any).currentUser = user;
    }
    
    // Sincronizar com session
    if (user) {
      setActiveUser(user, { persist: true });
    }
    
    this.notifySubscribers();
    logger.info('[StateManager] User updated:', user?.id);
  }
  
  /**
   * Obtém usuário ativo
   */
  getUser(): PlayerState['user'] {
    return this.state.user;
  }
  
  /**
   * Limpa usuário (logout)
   */
  clearUser(): void {
    this.setUser(null);
    this.state.money = 0;
    this.state.diamonds = 0;
    this.state.xp = 0;
    this.state.level = 1;
    this.state.unlockedPasses = [];
    this.notifySubscribers();
  }
  
  // ============================================================
  // CURRENCY MANAGEMENT
  // ============================================================
  
  /**
   * Atualiza moeda (money ou diamonds)
   */
  updateCurrency(type: 'money' | 'diamonds', value: number): void {
    const oldValue = this.state[type];
    this.state[type] = value;
    
    // Sincronizar com cached values
    if (type === 'diamonds') {
      (window as any).cachedDiamonds = value;
    }
    
    // Notificar subscribers apenas se valor mudou
    if (oldValue !== value) {
      this.notifySubscribers();
      logger.debug(`[StateManager] ${type} updated: ${oldValue} → ${value}`);
    }
  }
  
  /**
   * Obtém money
   */
  getMoney(): number {
    return this.state.money;
  }
  
  /**
   * Define money
   */
  setMoney(value: number): void {
    this.updateCurrency('money', value);
  }
  
  /**
   * Atualiza money (alias para setMoney)
   */
  updateMoney(value: number): void {
    this.setMoney(value);
  }
  
  /**
   * Adiciona money
   */
  addMoney(amount: number): void {
    this.setMoney(this.state.money + amount);
  }
  
  /**
   * Obtém diamonds
   */
  getDiamonds(): number {
    return this.state.diamonds;
  }
  
  /**
   * Define diamonds
   */
  setDiamonds(value: number): void {
    this.updateCurrency('diamonds', value);
  }
  
  /**
   * Atualiza diamonds (alias para setDiamonds)
   */
  updateDiamonds(value: number): void {
    this.setDiamonds(value);
  }
  
  /**
   * Adiciona diamonds
   */
  addDiamonds(amount: number): void {
    this.setDiamonds(this.state.diamonds + amount);
  }
  
  // ============================================================
  // PLAYER STATS
  // ============================================================
  
  /**
   * Atualiza múltiplos campos de uma vez
   */
  updateStats(stats: Partial<Omit<PlayerState, 'user'>>): void {
    let changed = false;
    
    if (stats.money !== undefined && stats.money !== this.state.money) {
      this.state.money = stats.money;
      changed = true;
    }
    
    if (stats.diamonds !== undefined && stats.diamonds !== this.state.diamonds) {
      this.state.diamonds = stats.diamonds;
      (window as any).cachedDiamonds = stats.diamonds;
      changed = true;
    }
    
    if (stats.xp !== undefined && stats.xp !== this.state.xp) {
      this.state.xp = stats.xp;
      changed = true;
    }
    
    if (stats.level !== undefined && stats.level !== this.state.level) {
      this.state.level = stats.level;
      changed = true;
    }
    
    if (stats.unlockedPasses !== undefined) {
      this.state.unlockedPasses = stats.unlockedPasses;
      (window as any).cachedUnlockedPasses = stats.unlockedPasses;
      changed = true;
    }
    
    if (stats.caseDiscountLevel !== undefined) {
      this.state.caseDiscountLevel = stats.caseDiscountLevel;
      (window as any).cachedCaseDiscountLevel = stats.caseDiscountLevel;
      changed = true;
    }
    
    if (changed) {
      this.notifySubscribers();
      logger.debug('[StateManager] Stats updated:', stats);
    }
  }
  
  /**
   * Obtém todo o estado
   */
  getState(): Readonly<PlayerState> {
    return { ...this.state };
  }
  
  // ============================================================
  // SUBSCRIPTION
  // ============================================================
  
  /**
   * Inscreve listener para mudanças de estado
   */
  subscribe(callback: (state: PlayerState) => void): () => void {
    this.subscribers.add(callback);
    
    // Retorna função para cancelar inscrição
    return () => {
      this.subscribers.delete(callback);
    };
  }
  
  /**
   * Notifica todos os subscribers
   */
  private notifySubscribers(): void {
    const state = this.getState();
    this.subscribers.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        logger.error('[StateManager] Subscriber error:', error);
      }
    });
  }
  
  // ============================================================
  // UTILITIES
  // ============================================================
  
  /**
   * Debug: mostra estado atual
   */
  debug(): void {
    console.group('[StateManager] Current State');
    console.log('User:', this.state.user);
    console.log('Money:', this.state.money);
    console.log('Diamonds:', this.state.diamonds);
    console.log('XP:', this.state.xp);
    console.log('Level:', this.state.level);
    console.log('Unlocked Passes:', this.state.unlockedPasses);
    console.log('Subscribers:', this.subscribers.size);
    console.groupEnd();
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

export const stateManager = new StateManager();

// ============================================================
// HELPER FUNCTIONS (Compatibilidade)
// ============================================================

/**
 * Atualiza window.playerMoney e window.playerDiamonds
 * DEPRECATED: Use stateManager.setMoney() / setDiamonds() diretamente
 */
export function updateGlobalCurrency(money?: number, diamonds?: number): void {
  if (money !== undefined) {
    stateManager.setMoney(money);
  }
  if (diamonds !== undefined) {
    stateManager.setDiamonds(diamonds);
  }
}

/**
 * Obtém valores de moeda atuais
 * DEPRECATED: Use stateManager.getMoney() / getDiamonds()
 */
export function getGlobalCurrency(): { money: number; diamonds: number } {
  return {
    money: stateManager.getMoney(),
    diamonds: stateManager.getDiamonds()
  };
}

// ============================================================
// GLOBAL ACCESS (para debug)
// ============================================================

if (typeof window !== 'undefined') {
  (window as any).__stateManager = stateManager;
}

// ============================================================
// EXPORTS
// ============================================================

export default stateManager;
