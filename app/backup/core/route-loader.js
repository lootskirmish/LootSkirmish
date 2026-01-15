// ============================================================
// ROUTE-LOADER.JS - Carregador de Dados por Rota
// ============================================================

import { store, dataActions } from './store.js';
import { getActiveUser } from './session.js';

/**
 * Utilitário para mostrar/esconder skeleton
 */
function toggleSkeleton(skeletonId, contentId, show) {
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
const routeLoaders = {
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

const inFlightByScreen = new Map();

/**
 * Carrega dados necessários para uma rota
 * @param {string} screenName - Nome da tela/rota
 */
export async function loadRouteData(screenName) {
  if (!screenName) return;

  const key = String(screenName);
  const existing = inFlightByScreen.get(key);
  const isPublicProfileRequest = key === 'profile' && typeof window !== 'undefined' && !!window.publicProfileUsername;
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
async function _loadInventoryRoute() {
  
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
    
    if (window.renderInventory) {
      await window.renderInventory(user.id);
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
async function _loadLeaderboardRoute() {
  // Mostrar skeleton imediatamente
  toggleSkeleton('leaderboard-skeleton', 'leader-list', true);

  store.dispatch(dataActions.setLeaderboardLoading(true));
  
  try {
    const user = getActiveUser({ sync: true, allowStored: true });
    
    if (!window.initLeaderboard) {
      console.error('❌ window.initLeaderboard não encontrada');
      store.dispatch(dataActions.setLeaderboardLoading(false));
      toggleSkeleton('leaderboard-skeleton', 'leader-list', false);
      return;
    }
    
    if (!window.renderLeaderboard) {
      console.error('❌ window.renderLeaderboard não encontrada');
      store.dispatch(dataActions.setLeaderboardLoading(false));
      toggleSkeleton('leaderboard-skeleton', 'leader-list', false);
      return;
    }
    
    // Inicializar e renderizar leaderboard
    await window.initLeaderboard(user);
    await window.renderLeaderboard();
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
async function _loadCasesRoute() {
  const state = store.getState();
  
  if (state.data.cases.isLoaded && !shouldReload('cases')) {
    return;
  }
  
  store.dispatch(dataActions.setCasesLoading(true));
  
  try {
    // O case opening é inicializado via window.initCaseOpening (exportado em app/caseopening.js)
    const user = getActiveUser({ sync: true, allowStored: true });
    const money = window.playerMoney?.value ?? 0;
    const diamonds = window.cachedDiamonds ?? window.playerDiamonds?.value ?? 0;
    const passes = Array.isArray(window.cachedUnlockedPasses)
      ? window.cachedUnlockedPasses
      : [];
    const discountLevel = window.cachedCaseDiscountLevel ?? 0;
    if (window.initCaseOpening) {
      await window.initCaseOpening(user, money, diamonds, passes, discountLevel);
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
let currentLoadingPublicProfile = null;
let publicProfileLoadStartTime = 0;

/**
 * Carrega dados do perfil
 */
async function _loadProfileRoute() {
  
  // Mostrar skeleton e esconder conteúdo
  const skeleton = document.getElementById('profile-skeleton');
  const content = document.getElementById('profile-content');
  if (skeleton) skeleton.style.display = 'flex';
  if (content) content.style.display = 'none';
  
  store.dispatch(dataActions.setProfileLoading(true));
  
  try {
    const publicUsername = window.publicProfileUsername;
    const user = getActiveUser({ sync: true, allowStored: true });

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
            if (window.showToast) {
              window.showToast('error', 'Profile could not be accessed.');
            }
          window.history.replaceState({}, '', '/');
          // Force re-route to menu
          await new Promise(resolve => setTimeout(resolve, 100));
          if (window.checkRouteAuth) window.checkRouteAuth();
          if (skeleton) skeleton.style.display = 'none';
          if (content) content.style.display = 'block';
          store.dispatch(dataActions.setProfileLoading(false));
          window.publicProfileUsername = null;
          currentLoadingPublicProfile = null;
          return;
        }

        const checkData = await checkResponse.json();
        console.log(`[PROFILE_LOAD] Check response for "${publicUsername}":`, checkData);

        if (!checkData.success || !checkData.isPublic) {
          console.warn(`[PROFILE_LOAD] Profile "${publicUsername}" is PRIVATE (success=${checkData.success}, isPublic=${checkData.isPublic})`);
          // Return to safe state (menu)
            if (window.showToast) {
              window.showToast('info', 'This profile is private.');
            }
          window.history.replaceState({}, '', '/');
          // Force re-route to menu
          await new Promise(resolve => setTimeout(resolve, 100));
          if (window.checkRouteAuth) window.checkRouteAuth();
          if (skeleton) skeleton.style.display = 'none';
          if (content) content.style.display = 'block';
          store.dispatch(dataActions.setProfileLoading(false));
          window.publicProfileUsername = null;
          currentLoadingPublicProfile = null;
          return;
        }
      } catch (err) {
        console.error(`[PROFILE_LOAD] Fetch error for "${publicUsername}":`, err.message || err);
        // Return to safe state (menu) on error
        if (window.showToast) {
          window.showToast('error', 'Could not access profile. Please try again.');
        }
        window.history.replaceState({}, '', '/');
        // Force re-route to menu
        await new Promise(resolve => setTimeout(resolve, 100));
        if (window.checkRouteAuth) window.checkRouteAuth();
        if (skeleton) skeleton.style.display = 'none';
        if (content) content.style.display = 'block';
        store.dispatch(dataActions.setProfileLoading(false));
        window.publicProfileUsername = null;
        currentLoadingPublicProfile = null;
        return;
      }

      // Only proceed to load profile if check passed
      if (window.loadPublicProfile) {
        await window.loadPublicProfile(publicUsername, window.calculateLevel, window.applyTranslations);
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
      if (window.loadProfileData) {
        await window.loadProfileData(user, window.calculateLevel, window.applyTranslations);
      } else {
        console.error('❌ window.loadProfileData não encontrada');
      }
    }
    
    // SEMPRE esconder skeleton e mostrar conteúdo
    if (skeleton) skeleton.style.display = 'none';
    if (content) content.style.display = 'block';
    
    if (!publicUsername && window.loadUserThemes) {
      await window.loadUserThemes();
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
    window.publicProfileUsername = null;
    store.dispatch(dataActions.setProfileLoading(false));
  }
}

/**
 * Carrega dados da loja
 */
async function _loadShopRoute() {
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
    shopContainer.parentElement.insertBefore(skeleton, shopContainer);
  }
  
  toggleSkeleton('shop-skeleton', 'shop-packages', true);
  
  if (state.data.shop.isLoaded && !shouldReload('shop')) {
    toggleSkeleton('shop-skeleton', 'shop-packages', false);
    return;
  }
  
  store.dispatch(dataActions.setShopLoading(true));
  
  try {
    if (window.initShop) {
      await window.initShop();
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
async function _loadSettingsRoute() {
  
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
    if (window.loadSettingsData) {
      await window.loadSettingsData();
    } else {
      console.error('❌ window.loadSettingsData não encontrada');
    }
    
    if (window.applyTranslations) {
      await window.applyTranslations();
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
async function _loadSkillTreeRoute() {
  
  try {
    setTimeout(() => {
      if (window.initSkillTree) {
        window.initSkillTree();
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
async function _loadReferralsRoute() {
  const skeleton = document.getElementById('referrals-skeleton');
  const content = document.getElementById('referrals-content');
  if (skeleton) skeleton.style.display = 'grid';
  if (content) content.style.display = 'none';

  try {
    if (window.loadReferralsPanel) {
      await window.loadReferralsPanel();
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
async function _loadAdminRoute() {
  
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
    const firstChild = adminContainer.querySelector('.admin-panel, .admin-content');
    if (firstChild) {
      adminContainer.insertBefore(skeleton, firstChild);
    }
  }
  
  const skeleton = document.getElementById('admin-skeleton');
  if (skeleton) skeleton.style.display = 'block';
  
  try {
    if (window.startAdminPolling) {
      window.startAdminPolling();
      
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
function shouldReload(dataType) {
  return false;
}

/**
 * Limpa flag de carregado para forçar recarga na próxima vez
 */
export function invalidateRouteData(dataType) {
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
  window.loadRouteData = loadRouteData;
  window.invalidateRouteData = invalidateRouteData;
}