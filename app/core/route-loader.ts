// @ts-nocheck
// ============================================================
// ROUTE-LOADER.TS - Carregador de Dados por Rota
// ============================================================

import { store, dataActions } from './persistence';
import { getActiveUser } from './session';

/**
 * Tipos para window extensions
 */
interface WindowWithRouteLoaders extends Window {
  renderInventory?: (userId: string) => Promise<void>;
  initLeaderboard?: (user: any) => Promise<void>;
  renderLeaderboard?: () => Promise<void>;
  initCaseOpening?: (user: any, money: number, diamonds: number, passes: string[], discountLevel: number) => Promise<void>;
  loadPublicProfile?: (username: string, calculateLevel: any, applyTranslations: any) => Promise<void>;
  loadProfileData?: (user: any, calculateLevel: any, applyTranslations: any) => Promise<void>;
  loadUserThemes?: () => Promise<void>;
  initShop?: () => Promise<void>;
  loadSettingsData?: () => Promise<void>;
  applyTranslations?: () => Promise<void>;
  initSkillTree?: () => void;
  loadReferralsPanel?: () => Promise<void>;
  startAdminPolling?: () => void;
  showToast?: (type: string, message: string) => void;
  calculateLevel?: (points: any) => any;
  playerMoney?: { value: number };
  cachedDiamonds?: number;
  playerDiamonds?: { value: number };
  cachedUnlockedPasses?: string[];
  cachedCaseDiscountLevel?: number;
  publicProfileUsername?: string | null;
  checkRouteAuth?: () => void;
  loadRouteData?: (screenName: string) => Promise<void>;
  invalidateRouteData?: (dataType: string) => void;
}

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
  const isPublicProfileRequest = key === 'profile' && typeof window !== 'undefined' && !!(window as any).publicProfileUsername;
  
  // Para perfil público, sempre iniciar um novo carregamento
  if (existing && !isPublicProfileRequest) return existing;

  const loader = routeLoaders[key];
  if (!loader) return;

  const promise = (async () => {
    try {
      await loader();
    } catch (error) {
      console.error(`❌ Erro ao carregar dados de ${key}:`, error);
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
    
    if (!user || !user.id) {
      console.warn('⚠️ Nenhum usuário encontrado para carregar inventário');
      if (skeleton) skeleton.style.display = 'none';
      return;
    }
    
    const windowExt = window as any as WindowWithRouteLoaders;
    if (windowExt.renderInventory) {
      await windowExt.renderInventory(user.id);
      store.dispatch(dataActions.setInventory([]));
      
      // Esconder skeleton e mostrar conteúdo
      if (skeleton) skeleton.style.display = 'none';
      if (content) content.style.display = 'grid';
    } else {
      console.error('❌ window.renderInventory não encontrada');
      if (skeleton) skeleton.style.display = 'none';
    }
  } catch (error) {
    console.error('❌ Erro ao carregar inventário:', error);
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
    
    const windowExt = window as any as WindowWithRouteLoaders;
    if (!windowExt.initLeaderboard) {
      console.error('❌ window.initLeaderboard não encontrada');
      store.dispatch(dataActions.setLeaderboardLoading(false));
      toggleSkeleton('leaderboard-skeleton', 'leader-list', false);
      return;
    }
    
    if (!windowExt.renderLeaderboard) {
      console.error('❌ window.renderLeaderboard não encontrada');
      store.dispatch(dataActions.setLeaderboardLoading(false));
      toggleSkeleton('leaderboard-skeleton', 'leader-list', false);
      return;
    }
    
    // Inicializar e renderizar leaderboard
    await windowExt.initLeaderboard(user);
    await windowExt.renderLeaderboard();
    store.dispatch(dataActions.setLeaderboard([]));
    
    // Esconder skeleton
    toggleSkeleton('leaderboard-skeleton', 'leader-list', false);
  } catch (error) {
    console.error('❌ Erro ao carregar leaderboard:', error);
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
    // O case opening é inicializado via window.initCaseOpening (exportado em app/caseopening.js)
    const user = getActiveUser({ sync: true, allowStored: true });
    
    const windowExt = window as any as WindowWithRouteLoaders;
    const money = windowExt.playerMoney?.value ?? 0;
    const diamonds = windowExt.cachedDiamonds ?? windowExt.playerDiamonds?.value ?? 0;
    const passes = Array.isArray(windowExt.cachedUnlockedPasses)
      ? windowExt.cachedUnlockedPasses
      : [];
    const discountLevel = windowExt.cachedCaseDiscountLevel ?? 0;
    
    if (windowExt.initCaseOpening) {
      await windowExt.initCaseOpening(user, money, diamonds, passes, discountLevel);
      // Marca como carregado (evita recarregar desnecessariamente)
      store.dispatch(dataActions.setCases([]));
    } else {
      console.error('❌ window.initCaseOpening não encontrada');
    }
  } finally {
    store.dispatch(dataActions.setCasesLoading(false));
  }
}

// Track in-flight public profile loads to prevent concurrent requests
let currentLoadingPublicProfile: string | null = null;
let publicProfileLoadStartTime: number = 0;

/**
 * Carrega dados do perfil
 */
async function _loadProfileRoute(): Promise<void> {
  // Mostrar skeleton e esconder conteúdo
  const skeleton = document.getElementById('profile-skeleton');
  const content = document.getElementById('profile-content');
  if (skeleton) skeleton.style.display = 'flex';
  if (content) content.style.display = 'none';
  
  store.dispatch(dataActions.setProfileLoading(true));
  
  try {
    const windowExt = window as any as WindowWithRouteLoaders;
    const publicUsername = windowExt.publicProfileUsername;
    const user = getActiveUser({ sync: true, allowStored: true });

    // GUARD: Se não tem publicUsername, limpar qualquer valor residual
    if (!publicUsername && windowExt.publicProfileUsername !== null) {
      windowExt.publicProfileUsername = null;
      currentLoadingPublicProfile = null;
    }

    if (publicUsername) {
      // GUARD: Prevent concurrent loads of the same profile
      if (currentLoadingPublicProfile === publicUsername) {
        console.warn('Profile load already in progress for:', publicUsername);
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
        return; // Don't load again
      }

      const currentTime = Date.now();
      // Debounce rapid successive requests (less than 500ms apart)
      if (publicProfileLoadStartTime && currentTime - publicProfileLoadStartTime < 500) {
        console.warn('Profile load debounced - too soon');
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
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
          const statusText = checkResponse.statusText || 'Unknown error';
          console.warn(`[PROFILE_LOAD] Check failed - Status: ${checkResponse.status} (${statusText}), Username: "${publicUsername}"`);
          const errorData = await checkResponse.json().catch(() => ({}));
          console.warn(`[PROFILE_LOAD] Error response:`, errorData);
          // Return to safe state (menu)
          if (windowExt.showToast) {
            windowExt.showToast('error', 'Profile could not be accessed.');
          }
          window.history.replaceState({}, '', '/');
          // Force re-route to menu
          await new Promise(resolve => setTimeout(resolve, 100));
          if (windowExt.checkRouteAuth) windowExt.checkRouteAuth();
          if (skeleton) skeleton.style.display = 'none';
          if (content) content.style.display = 'block';
          store.dispatch(dataActions.setProfileLoading(false));
          windowExt.publicProfileUsername = null;
          currentLoadingPublicProfile = null;
          return;
        }

        const checkData = await checkResponse.json();
        console.log(`[PROFILE_LOAD] Check response for "${publicUsername}":`, checkData);

        if (!checkData.success || !checkData.isPublic) {
          console.warn(`[PROFILE_LOAD] Profile "${publicUsername}" is PRIVATE (success=${checkData.success}, isPublic=${checkData.isPublic})`);
          // Return to safe state (menu)
          if (windowExt.showToast) {
            windowExt.showToast('info', 'This profile is private.');
          }
          window.history.replaceState({}, '', '/');
          // Force re-route to menu
          await new Promise(resolve => setTimeout(resolve, 100));
          if (windowExt.checkRouteAuth) windowExt.checkRouteAuth();
          if (skeleton) skeleton.style.display = 'none';
          if (content) content.style.display = 'block';
          store.dispatch(dataActions.setProfileLoading(false));
          windowExt.publicProfileUsername = null;
          currentLoadingPublicProfile = null;
          return;
        }
      } catch (err: any) {
        console.error(`[PROFILE_LOAD] Fetch error for "${publicUsername}":`, err.message || err);
        // Return to safe state (menu) on error
        if (windowExt.showToast) {
          windowExt.showToast('error', 'Could not access profile. Please try again.');
        }
        window.history.replaceState({}, '', '/');
        // Force re-route to menu
        await new Promise(resolve => setTimeout(resolve, 100));
        if (windowExt.checkRouteAuth) windowExt.checkRouteAuth();
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
        store.dispatch(dataActions.setProfileLoading(false));
        windowExt.publicProfileUsername = null;
        currentLoadingPublicProfile = null;
        return;
      }

      // Only proceed to load profile if check passed
      if (windowExt.loadPublicProfile) {
        await windowExt.loadPublicProfile(publicUsername, windowExt.calculateLevel, windowExt.applyTranslations);
      } else {
        console.error('❌ window.loadPublicProfile não encontrada');
      }
      
      currentLoadingPublicProfile = null;
    } else {
      if (!user) {
        console.warn('⚠️ Nenhum usuário encontrado para carregar perfil');
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
        return;
      }
      if (windowExt.loadProfileData) {
        await windowExt.loadProfileData(user, windowExt.calculateLevel, windowExt.applyTranslations);
      } else {
        console.error('❌ window.loadProfileData não encontrada');
      }
    }
    
    // SEMPRE esconder skeleton e mostrar conteúdo
    if (skeleton) skeleton.style.display = 'none';
    if (content) content.style.display = 'block';
    
    if (!publicUsername && windowExt.loadUserThemes) {
      await windowExt.loadUserThemes();
    }
    
    store.dispatch(dataActions.setProfile(user));
  } catch (error) {
    console.error('❌ Erro ao carregar perfil:', error);
    const skeleton = document.getElementById('profile-skeleton');
    const content = document.getElementById('profile-content');
    if (skeleton) skeleton.style.display = 'none';
    if (content) content.style.display = 'block';
    currentLoadingPublicProfile = null;
  } finally {
    const windowExt = window as any as WindowWithRouteLoaders;
    windowExt.publicProfileUsername = null;
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
    const windowExt = window as any as WindowWithRouteLoaders;
    if (windowExt.initShop) {
      await windowExt.initShop();
      // Marca como carregado (evita recarregar desnecessariamente)
      store.dispatch(dataActions.setShop([]));
    }
    
    // Aguardar um pouco para o conteúdo carregar
    await new Promise(resolve => setTimeout(resolve, 500));
    
    toggleSkeleton('shop-skeleton', 'shop-packages', false);
  } catch (error) {
    console.error('❌ Erro ao carregar shop:', error);
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
    const windowExt = window as any as WindowWithRouteLoaders;
    if (windowExt.loadSettingsData) {
      await windowExt.loadSettingsData();
    } else {
      console.error('❌ window.loadSettingsData não encontrada');
    }
    
    if (windowExt.applyTranslations) {
      await windowExt.applyTranslations();
    }
    
    if (skeleton) skeleton.style.display = 'none';
  } catch (error) {
    console.error('❌ Erro ao carregar settings:', error);
    if (skeleton) skeleton.style.display = 'none';
  }
}

/**
 * Carrega dados da skill tree
 */
async function _loadSkillTreeRoute(): Promise<void> {
  try {
    setTimeout(() => {
      const windowExt = window as any as WindowWithRouteLoaders;
      if (windowExt.initSkillTree) {
        windowExt.initSkillTree();
      } else {
        console.error('❌ window.initSkillTree não encontrada');
      }
    }, 100);
  } catch (error) {
    console.error('❌ Erro ao carregar skill tree:', error);
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
    const windowExt = window as any as WindowWithRouteLoaders;
    if (windowExt.loadReferralsPanel) {
      await windowExt.loadReferralsPanel();
    } else {
      console.error('❌ window.loadReferralsPanel não encontrada');
    }
  } catch (error) {
    console.error('❌ Erro ao carregar referrals:', error);
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
    const windowExt = window as any as WindowWithRouteLoaders;
    if (windowExt.startAdminPolling) {
      windowExt.startAdminPolling();
      
      // Aguardar um pouco para o conteúdo carregar
      await new Promise(resolve => setTimeout(resolve, 500));
    } else {
      console.error('❌ window.startAdminPolling não encontrada');
    }
    
    if (skeleton) skeleton.style.display = 'none';
  } catch (error) {
    console.error('❌ Erro ao carregar admin:', error);
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
  const windowExt = window as any as WindowWithRouteLoaders;
  windowExt.loadRouteData = loadRouteData;
  windowExt.invalidateRouteData = invalidateRouteData;
}
