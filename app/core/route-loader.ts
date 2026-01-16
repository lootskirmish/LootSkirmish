// ============================================================
// ROUTE-LOADER.TS - Carregador de Dados por Rota
// ============================================================

import { store, dataActions } from './persistence';
import { getActiveUser } from './session';
import { WindowManager, ErrorHandler } from './core-utils';
import { createLogger } from './logger';

const logger = createLogger('RouteLoader');


interface RouteLoader {
  [key: string]: () => Promise<void>;
}

interface SkeletonConfig {
  skeletonId: string;
  contentId: string;
}

/**
 * Utilitário para mostrar/esconder skeleton
 */
function toggleSkeleton(skeletonId: string, contentId: string, show: boolean): void {
  const skeleton = document.getElementById(skeletonId);
  const content = document.getElementById(contentId);
  
  if (skeleton) {
    skeleton.style.display = show ? 'block' : 'none';
  }
  if (content) {
    content.style.display = show ? 'none' : '';
  }
}

/**
 * Mapa de rotas para suas funções de carregamento
 */
const routeLoaders: RouteLoader = {
  'inventory': _loadInventoryRoute,
  'leaderboard': _loadLeaderboardRoute,
  'case-opening': _loadCasesRoute,
  'profile': _loadProfileRoute,
  'shop': _loadShopRoute,
  'settings': _loadSettingsRoute,
  'skill-tree': _loadSkillTreeRoute,
  'admin': _loadAdminRoute,
  'referrals': _loadReferralsRoute
};

const inFlightByScreen = new Map<string, Promise<void>>();

/**
 * Carrega dados necessários para uma rota
 */
export async function loadRouteData(screenName: string): Promise<void> {
  if (!screenName) return;

  const key = String(screenName);
  const existing = inFlightByScreen.get(key);
  const publicProfileUsername = WindowManager.getPublicProfileUsername();
  const isPublicProfileRequest = key === 'profile' && publicProfileUsername !== null;
  
  // Para perfil público, sempre iniciar um novo carregamento
  if (existing && !isPublicProfileRequest) return existing;

  const loader = routeLoaders[key];
  if (!loader) {
    logger.warn(`No route loader found for: ${key}`);
    return;
  }

  const promise = (async () => {
    try {
      await loader();
    } catch (error) {
      ErrorHandler.handle(error, {
        operation: `loadRoute:${key}`,
        config: { shouldThrow: false },
      });
    }
  })().finally(() => {
    if (inFlightByScreen.get(key) === promise) inFlightByScreen.delete(key);
  });

  inFlightByScreen.set(key, promise);
  return promise;
}

/**
 * Carrega dados do inventário
 */
async function _loadInventoryRoute(): Promise<void> {
  // Mostrar skeleton
  const skeleton = document.getElementById('inventory-skeleton');
  const content = document.getElementById('inv-grid');
  if (skeleton) skeleton.style.display = 'block';
  if (content) content.style.display = 'none';
  
  store.dispatch(dataActions.setInventoryLoading(true));
  
  try {
    const user = getActiveUser({ sync: true, allowStored: true });
    
    if (!user?.id) {
      logger.warn('No user found for inventory load');
      if (skeleton) skeleton.style.display = 'none';
      return;
    }
    
    const renderInventory = WindowManager.getWindowFunction<(userId: string) => Promise<void>>('renderInventory');
    if (!renderInventory) {
      logger.error('window.renderInventory not found');
      if (skeleton) skeleton.style.display = 'none';
      return;
    }

    await renderInventory(user.id);
    store.dispatch(dataActions.setInventory([]));
    
    // Esconder skeleton e mostrar conteúdo
    if (skeleton) skeleton.style.display = 'none';
    if (content) content.style.display = 'grid';
  } catch (error) {
    ErrorHandler.handle(error, {
      operation: 'loadInventoryRoute',
      config: { shouldThrow: false },
    });
    if (skeleton) skeleton.style.display = 'none';
  } finally {
    store.dispatch(dataActions.setInventoryLoading(false));
  }
}

/**
 * Carrega dados do leaderboard
 */
async function _loadLeaderboardRoute(): Promise<void> {
  // Mostrar skeleton imediatamente
  toggleSkeleton('leaderboard-skeleton', 'leader-list', true);

  store.dispatch(dataActions.setLeaderboardLoading(true));
  
  try {
    const user = getActiveUser({ sync: true, allowStored: true });
    
    const initLeaderboard = WindowManager.getWindowFunction<(user: any) => Promise<void>>('initLeaderboard');
    const renderLeaderboard = WindowManager.getWindowFunction<() => Promise<void>>('renderLeaderboard');
    
    if (!initLeaderboard) {
      logger.error('window.initLeaderboard not found');
      store.dispatch(dataActions.setLeaderboardLoading(false));
      toggleSkeleton('leaderboard-skeleton', 'leader-list', false);
      return;
    }
    
    if (!renderLeaderboard) {
      logger.error('window.renderLeaderboard not found');
      store.dispatch(dataActions.setLeaderboardLoading(false));
      toggleSkeleton('leaderboard-skeleton', 'leader-list', false);
      return;
    }
    
    // Paralelizar operações independentes seria ideal, mas estas são dependentes
    // initLeaderboard deve terminar antes de renderLeaderboard
    await initLeaderboard(user);
    await renderLeaderboard();
    store.dispatch(dataActions.setLeaderboard([]));
    
    // Esconder skeleton
    toggleSkeleton('leaderboard-skeleton', 'leader-list', false);
  } catch (error) {
    ErrorHandler.handle(error, {
      operation: 'loadLeaderboardRoute',
      config: { shouldThrow: false },
    });
    toggleSkeleton('leaderboard-skeleton', 'leader-list', false);
  } finally {
    store.dispatch(dataActions.setLeaderboardLoading(false));
  }
}

/**
 * Carrega dados dos cases
 */
async function _loadCasesRoute(): Promise<void> {
  const state = store.getState();
  
  if (state.data.cases.isLoaded && !shouldReload('cases')) {
    return;
  }
  
  store.dispatch(dataActions.setCasesLoading(true));
  
  try {
    const user = getActiveUser({ sync: true, allowStored: true });
    
    const money = WindowManager.getPlayerMoney();
    const diamonds = WindowManager.getPlayerDiamonds();
    const passes = WindowManager.getUnlockedPasses();
    const discountLevel = WindowManager.getCaseDiscountLevel();
    
    const initCaseOpening = WindowManager.getWindowFunction<
      (user: any, money: number, diamonds: number, passes: string[], discountLevel: number) => Promise<void>
    >('initCaseOpening');

    if (!initCaseOpening) {
      logger.error('window.initCaseOpening not found');
      return;
    }

    await initCaseOpening(user, money, diamonds, passes, discountLevel);
    store.dispatch(dataActions.setCases([]));
  } catch (error) {
    ErrorHandler.handle(error, {
      operation: 'loadCasesRoute',
      config: { shouldThrow: false },
    });
  } finally {
    store.dispatch(dataActions.setCasesLoading(false));
  }
}

// Track in-flight public profile loads to prevent concurrent requests
let currentLoadingPublicProfile: string | null = null;
let publicProfileLoadStartTime: number = 0;

/**
 * Helper para resetar estado de profile
 */
function resetProfileLoadState(): void {
  currentLoadingPublicProfile = null;
  publicProfileLoadStartTime = 0;
}

/**
 * Helper para esconder/mostrar UI de profile
 */
function setProfileUIState(show: boolean): void {
  const skeleton = document.getElementById('profile-skeleton');
  const content = document.getElementById('profile-content');
  
  if (skeleton) skeleton.style.display = show ? 'none' : 'flex';
  if (content) content.style.display = show ? 'block' : 'none';
}

/**
 * Carrega dados do perfil
 */
async function _loadProfileRoute(): Promise<void> {
  // Mostrar skeleton e esconder conteúdo
  setProfileUIState(false);
  
  store.dispatch(dataActions.setProfileLoading(true));
  
  try {
    const publicUsername = WindowManager.getPublicProfileUsername();
    const user = getActiveUser({ sync: true, allowStored: true });

    // GUARD: Se não tem publicUsername, limpar qualquer valor residual
    if (!publicUsername && WindowManager.hasValue('publicProfileUsername')) {
      resetProfileLoadState();
    }

    if (publicUsername) {
      // GUARD: Prevent concurrent loads of the same profile
      if (currentLoadingPublicProfile === publicUsername) {
        logger.warn(`Profile load already in progress for: ${publicUsername}`);
        setProfileUIState(true);
        return;
      }

      const currentTime = Date.now();
      // Debounce rapid successive requests (less than 500ms apart)
      if (publicProfileLoadStartTime && currentTime - publicProfileLoadStartTime < 500) {
        logger.warn('Profile load debounced - too soon');
        setProfileUIState(true);
        return;
      }

      currentLoadingPublicProfile = publicUsername;
      publicProfileLoadStartTime = currentTime;

      // GUARD: Perform strict server-side validation before attempting to load public profile
      try {
        const checkResponse = await fetch('/api/_profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'checkPublicProfile',
            username: publicUsername.trim()
          })
        });

        if (!checkResponse.ok) {
          const errorData = await checkResponse.json().catch(() => ({}));
          logger.warn(`[PROFILE_LOAD] Check failed - Status: ${checkResponse.status}`, { username: publicUsername, errorData });
          
          const showToast = WindowManager.getWindowFunction<(type: string, message: string) => void>('showToast');
          if (showToast) {
            showToast('error', 'Profile could not be accessed.');
          }
          
          window.history.replaceState({}, '', '/');
          await new Promise(resolve => setTimeout(resolve, 100));
          
          const checkRouteAuth = WindowManager.getWindowFunction<() => void>('checkRouteAuth');
          if (checkRouteAuth) checkRouteAuth();
          
          setProfileUIState(true);
          store.dispatch(dataActions.setProfileLoading(false));
          resetProfileLoadState();
          return;
        }

        const checkData = await checkResponse.json() as any;

        if (!checkData.success || !checkData.isPublic) {
          logger.warn(`[PROFILE_LOAD] Profile "${publicUsername}" is PRIVATE`, { success: checkData.success, isPublic: checkData.isPublic });
          
          const showToast = WindowManager.getWindowFunction<(type: string, message: string) => void>('showToast');
          if (showToast) {
            showToast('info', 'This profile is private.');
          }
          
          window.history.replaceState({}, '', '/');
          await new Promise(resolve => setTimeout(resolve, 100));
          
          const checkRouteAuth = WindowManager.getWindowFunction<() => void>('checkRouteAuth');
          if (checkRouteAuth) checkRouteAuth();
          
          setProfileUIState(true);
          store.dispatch(dataActions.setProfileLoading(false));
          resetProfileLoadState();
          return;
        }
      } catch (err) {
        logger.error(`[PROFILE_LOAD] Fetch error for "${publicUsername}"`, { error: err });
        
        const showToast = WindowManager.getWindowFunction<(type: string, message: string) => void>('showToast');
        if (showToast) {
          showToast('error', 'Could not access profile. Please try again.');
        }
        
        window.history.replaceState({}, '', '/');
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const checkRouteAuth = WindowManager.getWindowFunction<() => void>('checkRouteAuth');
        if (checkRouteAuth) checkRouteAuth();
        
        setProfileUIState(true);
        store.dispatch(dataActions.setProfileLoading(false));
        resetProfileLoadState();
        return;
      }

      // Only proceed to load profile if check passed
      const loadPublicProfile = WindowManager.getWindowFunction<
        (username: string, calculateLevel?: (points: number) => number, applyTranslations?: () => Promise<void>) => Promise<void>
      >('loadPublicProfile');

      if (!loadPublicProfile) {
        logger.error('window.loadPublicProfile not found');
        setProfileUIState(true);
        resetProfileLoadState();
        return;
      }

      const calculateLevel = WindowManager.getWindowFunction<(points: number) => number>('calculateLevel');
      const applyTranslations = WindowManager.getWindowFunction<() => Promise<void>>('applyTranslations');

      await loadPublicProfile(publicUsername, calculateLevel, applyTranslations);
      resetProfileLoadState();
    } else {
      if (!user) {
        logger.warn('No user found for profile load');
        setProfileUIState(true);
        return;
      }

      const loadProfileData = WindowManager.getWindowFunction<
        (user: any, calculateLevel?: (points: number) => number, applyTranslations?: () => Promise<void>) => Promise<void>
      >('loadProfileData');

      if (!loadProfileData) {
        logger.error('window.loadProfileData not found');
        setProfileUIState(true);
        return;
      }

      const calculateLevel = WindowManager.getWindowFunction<(points: number) => number>('calculateLevel');
      const applyTranslations = WindowManager.getWindowFunction<() => Promise<void>>('applyTranslations');

      await loadProfileData(user, calculateLevel, applyTranslations);
    }
    
    // SEMPRE esconder skeleton e mostrar conteúdo
    setProfileUIState(true);
    
    if (!publicUsername) {
      const loadUserThemes = WindowManager.getWindowFunction<() => Promise<void>>('loadUserThemes');
      if (loadUserThemes) {
        await loadUserThemes();
      }
    }
    
    store.dispatch(dataActions.setProfile(user));
  } catch (error) {
    ErrorHandler.handle(error, {
      operation: 'loadProfileRoute',
      config: { shouldThrow: false },
    });
    setProfileUIState(true);
    resetProfileLoadState();
  } finally {
    store.dispatch(dataActions.setProfileLoading(false));
  }
}

/**
 * Carrega dados da loja
 */
async function _loadShopRoute(): Promise<void> {
  const state = store.getState();
  
  // Criar e mostrar skeleton dinamicamente
  const shopContainer = document.getElementById('shop-packages');
  if (shopContainer && !document.getElementById('shop-skeleton')) {
    const skeleton = document.createElement('div');
    skeleton.id = 'shop-skeleton';
    skeleton.className = 'skeleton-container skeleton-shop-grid';
    skeleton.innerHTML = `
      <div class="skeleton skeleton-shop-item"></div>
      <div class="skeleton skeleton-shop-item"></div>
      <div class="skeleton skeleton-shop-item"></div>
      <div class="skeleton skeleton-shop-item"></div>
    `;
    shopContainer.parentElement?.insertBefore(skeleton, shopContainer);
  }
  
  toggleSkeleton('shop-skeleton', 'shop-packages', true);
  
  if (state.data.shop.isLoaded && !shouldReload('shop')) {
    toggleSkeleton('shop-skeleton', 'shop-packages', false);
    return;
  }
  
  store.dispatch(dataActions.setShopLoading(true));
  
  try {
    const initShop = WindowManager.getWindowFunction<() => Promise<void>>('initShop');
    if (!initShop) {
      logger.error('window.initShop not found');
      return;
    }

    await initShop();
    store.dispatch(dataActions.setShop([]));
    
    // Aguardar um pouco para o conteúdo carregar
    await new Promise(resolve => setTimeout(resolve, 500));
    
    toggleSkeleton('shop-skeleton', 'shop-packages', false);
  } catch (error) {
    ErrorHandler.handle(error, {
      operation: 'loadShopRoute',
      config: { shouldThrow: false },
    });
    toggleSkeleton('shop-skeleton', 'shop-packages', false);
  } finally {
    store.dispatch(dataActions.setShopLoading(false));
  }
}

/**
 * Carrega dados das configurações
 */
async function _loadSettingsRoute(): Promise<void> {
  // Criar skeleton simples
  const settingsContainer = document.getElementById('settings');
  if (settingsContainer && !document.getElementById('settings-skeleton')) {
    const skeleton = document.createElement('div');
    skeleton.id = 'settings-skeleton';
    skeleton.className = 'skeleton-container';
    skeleton.innerHTML = `
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    `;
    const firstChild = settingsContainer.querySelector('.settings-content, .settings-section');
    if (firstChild) {
      settingsContainer.insertBefore(skeleton, firstChild);
    }
  }
  
  const skeleton = document.getElementById('settings-skeleton');
  if (skeleton) skeleton.style.display = 'block';
  
  try {
    const loadSettingsData = WindowManager.getWindowFunction<() => Promise<void>>('loadSettingsData');
    if (!loadSettingsData) {
      logger.error('window.loadSettingsData not found');
      if (skeleton) skeleton.style.display = 'none';
      return;
    }

    await loadSettingsData();

    const applyTranslations = WindowManager.getWindowFunction<() => Promise<void>>('applyTranslations');
    if (applyTranslations) {
      await applyTranslations();
    }
    
    if (skeleton) skeleton.style.display = 'none';
  } catch (error) {
    ErrorHandler.handle(error, {
      operation: 'loadSettingsRoute',
      config: { shouldThrow: false },
    });
    if (skeleton) skeleton.style.display = 'none';
  }
}

/**
 * Carrega dados da skill tree
 */
async function _loadSkillTreeRoute(): Promise<void> {
  try {
    setTimeout(() => {
      const initSkillTree = WindowManager.getWindowFunction<() => void>('initSkillTree');
      if (!initSkillTree) {
        logger.error('window.initSkillTree not found');
        return;
      }

      initSkillTree();
    }, 100);
  } catch (error) {
    ErrorHandler.handle(error, {
      operation: 'loadSkillTreeRoute',
      config: { shouldThrow: false },
    });
  }
}

/**
 * Carrega dados do painel de referências
 */
async function _loadReferralsRoute(): Promise<void> {
  const skeleton = document.getElementById('referrals-skeleton');
  const content = document.getElementById('referrals-content');
  if (skeleton) skeleton.style.display = 'grid';
  if (content) content.style.display = 'none';

  try {
    const loadReferralsPanel = WindowManager.getWindowFunction<() => Promise<void>>('loadReferralsPanel');
    if (!loadReferralsPanel) {
      logger.error('window.loadReferralsPanel not found');
      return;
    }

    await loadReferralsPanel();
  } catch (error) {
    ErrorHandler.handle(error, {
      operation: 'loadReferralsRoute',
      config: { shouldThrow: false },
    });
  } finally {
    if (skeleton) skeleton.style.display = 'none';
    if (content) content.style.display = 'block';
  }
}

/**
 * Carrega dados do admin
 */
async function _loadAdminRoute(): Promise<void> {
  // Criar skeleton simples
  const adminContainer = document.getElementById('admin');
  if (adminContainer && !document.getElementById('admin-skeleton')) {
    const skeleton = document.createElement('div');
    skeleton.id = 'admin-skeleton';
    skeleton.className = 'skeleton-container skeleton-admin';
    skeleton.innerHTML = `
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton-admin-stats">
        <div class="skeleton skeleton-admin-stat"></div>
        <div class="skeleton skeleton-admin-stat"></div>
        <div class="skeleton skeleton-admin-stat"></div>
      </div>
      <div class="skeleton skeleton-admin-table"></div>
    `;
    const firstChild = adminContainer?.querySelector('.admin-panel, .admin-content');
    if (firstChild) {
      adminContainer.insertBefore(skeleton, firstChild);
    }
  }
  
  const skeleton = document.getElementById('admin-skeleton');
  if (skeleton) skeleton.style.display = 'block';
  
  try {
    const startAdminPolling = WindowManager.getWindowFunction<() => void>('startAdminPolling');
    if (!startAdminPolling) {
      logger.error('window.startAdminPolling not found');
      if (skeleton) skeleton.style.display = 'none';
      return;
    }

    startAdminPolling();
    
    // Aguardar um pouco para o conteúdo carregar
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (skeleton) skeleton.style.display = 'none';
  } catch (error) {
    ErrorHandler.handle(error, {
      operation: 'loadAdminRoute',
      config: { shouldThrow: false },
    });
    if (skeleton) skeleton.style.display = 'none';
  }
}

/**
 * Verifica se deve recarregar os dados
 */
function shouldReload(dataType: string): boolean {
  return false;
}

/**
 * Limpa flag de carregado para forçar recarga na próxima vez
 */
export function invalidateRouteData(dataType: string): void {
  switch (dataType) {
    case 'inventory':
      store.dispatch(dataActions.setInventory([]));
      break;
    case 'leaderboard':
      store.dispatch(dataActions.setLeaderboard([]));
      break;
    case 'cases':
      store.dispatch(dataActions.setCases([]));
      break;
    case 'profile':
      store.dispatch(dataActions.setProfile(null));
      break;
    case 'shop':
      store.dispatch(dataActions.setShop([]));
      break;
    case 'all':
      store.dispatch(dataActions.clearAllData());
      break;
  }
}

// Expor funções globalmente
if (typeof window !== 'undefined') {
  WindowManager.registerRouteLoaders({
    loadRouteData,
    invalidateRouteData,
  });
}
