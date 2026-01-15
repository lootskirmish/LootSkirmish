// ============================================================
// APP.JS - IMPORTS
// ============================================================

import './core/store.js'; // Importar store primeiro
import './core/route-loader.js'; // Importar route loader

import {
  handleLogout as authHandleLogout,
  loadUserData as authLoadUserData,
  handleLogin,
  handleRegister,
  setupAuthStateListener,
  switchTab
} from './features/auth.js';

import {
  showMoneyPopup,
  showDiamondPopup,
  showXPPopup
} from './shared/effects.js';

import { 
  setupProfileUploadListeners
} from './features/profile.js';

import {
  renderInventory,
  sellItem,
  sellSelected,
  openSellAllModal,
  updateSellAllSummary,
  confirmSellAll
} from './features/inventory.js';

import { 
  RARITIES
} from './shared/constants.js';

import './features/settings.js';
import './features/skill-tree.js';
import './features/support.js';
import { initLegal } from './features/legal.js';

import {
  checkAndShowAdminButton,
} from './features/admin.js';

import './features/shop.js';
import './features/referrals.js';

import {
  loadInitialTheme,
  loadSavedColors
} from './shared/themes.js';

import {
  initializeStateSystem
} from './core/state.js';

import './features/caseopening.js';
import { bindGlobalClickSfx, bindGlobalHoverSfx } from './shared/sfx.js';

import { initializeChat } from './features/chat.js';
import { initializeFriends } from './features/friends.js';

import './features/leaderboard.js';

import { 
  initRouter
} from './core/router.js';

// ============================================================
// GLOBAL STATE VARIABLES
// ============================================================

// User & Authentication
let currentUser = null;

// ============================================================
// CONSOLE PROTECTION SYSTEM
// Adicionar no início do app.js (antes de tudo)
// ============================================================

(function() {
  'use strict';
  
  // 🎨 Estilos do aviso
  const styles = {
    title: 'color: #ef4444; font-size: 48px; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);',
    warning: 'color: #facc15; font-size: 16px; font-weight: bold;',
    info: 'color: #60a5fa; font-size: 14px;',
    danger: 'color: #ef4444; font-size: 14px; font-weight: bold;'
  };

  // 🚨 Mostrar aviso grande
  console.log('%c⚠️ STOP!', styles.title);
  console.log('%c⚠️ WARNING - DEVELOPER TOOLS', styles.warning);
  console.log('%cThis is a browser feature intended for developers.', styles.info);
  console.log('%cIf someone told you to copy and paste something here to enable a feature or "hack", it is a SCAM and will give them access to your account.', styles.danger);
  console.log('%c\n🔒 Do not run unknown code here!\n', styles.warning);
  console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #60a5fa;');

})();

// ============================================================
// MONEY & DIAMONDS PROXY SYSTEM
// ============================================================

let _internalMoney = 0;
let _internalDiamonds = 0;
// Bloqueia popups durante carregamentos (login/logout)
window.__suppressCurrencyPopups = false;

let moneyEl = null;
let diamondsEl = null;

const moneyProxy = new Proxy(
  { value: 0 },
  {
    get(target, prop) {
      if (prop === 'value') return _internalMoney;
      return target[prop];
    },
    set(target, prop, newValue) {
      if (prop === 'value') {
        const nextValue = Number(newValue);
        if (!Number.isFinite(nextValue)) return true;

        const oldValue = _internalMoney;
        const difference = parseFloat((nextValue - oldValue).toFixed(2));

        _internalMoney = parseFloat(nextValue.toFixed(2));
        updateMoneyDisplay();
        
        if (!window.__suppressCurrencyPopups && difference !== 0 && !isNaN(difference)) {
          showMoneyPopup(difference);
        }
        
        return true;
      }
      target[prop] = newValue;
      return true;
    }
  }
);

const diamondProxy = new Proxy(
  { value: 0 },
  {
    get(target, prop) {
      if (prop === 'value') return _internalDiamonds;
      return target[prop];
    },
    set(target, prop, newValue) {
      if (prop === 'value') {
        const oldValue = _internalDiamonds;
        const nextValue = Number.parseInt(newValue, 10);
        if (Number.isNaN(nextValue)) return true;

        const difference = nextValue - oldValue;

        _internalDiamonds = nextValue;
        updateMoneyDisplay();
        
        // Mostrar popup automaticamente quando há mudança
        if (!window.__suppressCurrencyPopups && difference !== 0 && !isNaN(difference)) {
          showDiamondPopup(difference);
        }
        
        return true;
      }
      target[prop] = newValue;
      return true;
    }
  }
);

// Expor globalmente
let playerMoney = moneyProxy;
let playerDiamonds = diamondProxy;
window.playerMoney = playerMoney;
window.playerDiamonds = playerDiamonds;

function updateMoneyDisplay() {
  moneyEl ||= document.getElementById('money');
  diamondsEl ||= document.getElementById('diamonds');

  if (moneyEl) {
    moneyEl.textContent = _internalMoney.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
    });
  }
  if (diamondsEl) {
    diamondsEl.textContent = _internalDiamonds;
  }
}

function updateDiamondsDisplay(amount) {
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    playerDiamonds.value = amount;
  }
}

// Exportar globalmente
window.updateMoneyDisplay = updateMoneyDisplay;
window.updateDiamondsDisplay = updateDiamondsDisplay;

// ============================================================
// TRANSLATION SYSTEM (AUTO ONLY)
// ============================================================

let currentLanguage = localStorage.getItem('language') || 'en';
const translationCache = {};
let translationsRunPromise = null;
let translationsPending = false;

const TRANSLATION_CACHE_STORAGE_KEY = 'translationCache_v1';
const TRANSLATION_CACHE_MAX_ENTRIES = 200;
let translationCacheOrder = [];
let translationCacheSaveTimer = null;

function loadPersistentTranslationCache() {
  try {
    const raw = localStorage.getItem(TRANSLATION_CACHE_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    const entries = parsed?.entries;
    const order = parsed?.order;

    if (entries && typeof entries === 'object') {
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === 'string') translationCache[key] = value;
      }
    }

    if (Array.isArray(order)) {
      translationCacheOrder = order.filter(k => typeof k === 'string');
    } else {
      translationCacheOrder = Object.keys(entries || {});
    }
  } catch {
    // se o cache estiver corrompido, ignorar silenciosamente
  }
}

function schedulePersistTranslationCache() {
  if (translationCacheSaveTimer) return;
  translationCacheSaveTimer = window.setTimeout(() => {
    translationCacheSaveTimer = null;
    try {
      const entries = {};
      for (const key of translationCacheOrder) {
        const value = translationCache[key];
        if (typeof value === 'string') entries[key] = value;
      }
      localStorage.setItem(
        TRANSLATION_CACHE_STORAGE_KEY,
        JSON.stringify({ entries, order: translationCacheOrder })
      );
    } catch {
      // sem espaço / modo privado: ignorar
    }
  }, 250);
}

function rememberTranslation(cacheKey, translated) {
  if (typeof translated !== 'string') return;
  if (!translationCacheOrder.includes(cacheKey)) {
    translationCacheOrder.push(cacheKey);
  }

  while (translationCacheOrder.length > TRANSLATION_CACHE_MAX_ENTRIES) {
    const oldest = translationCacheOrder.shift();
    if (oldest) delete translationCache[oldest];
  }

  schedulePersistTranslationCache();
}

// Carregar cache persistido cedo
loadPersistentTranslationCache();

async function translateText(text, targetLang) {
  const cacheKey = `${text}_${targetLang}`;
  const cached = translationCache[cacheKey];
  if (cached) return await cached;
  
  // Se for inglês (idioma padrão), não traduzir
  if (targetLang === 'en') {
    return text;
  }
  
  try {
    // Converter código de idioma
    const langCode = targetLang === 'pt-BR' ? 'pt' : targetLang;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${langCode}`;

    const promise = (async () => {
      const response = await fetch(url);
      const data = await response.json();

      if (data.responseStatus === 200 && data.responseData) {
        return data.responseData.translatedText;
      }

      return text;
    })();

    // Cache como Promise para deduplicar chamadas concorrentes
    translationCache[cacheKey] = promise;

    const translated = await promise;
    translationCache[cacheKey] = translated;
    rememberTranslation(cacheKey, translated);
    return translated;
  } catch (err) {
    console.error('Erro na tradução:', err);
    delete translationCache[cacheKey];
    return text;
  }
}

async function translateElement(element, text) {
  if (!text || !element) return;
  
  const targetLang = currentLanguage;
  
  // Se for inglês (idioma padrão), mostrar o texto original
  if (targetLang === 'en') {
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      element.placeholder = text;
    } else {
      const textNode = Array.from(element.childNodes).find(node => node.nodeType === 3);
      if (textNode) {
        textNode.textContent = text;
      } else {
        element.textContent = text;
      }
    }
    return;
  }
  
  // Usar API de tradução automática
  const translated = await translateText(text, targetLang);
  
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    element.placeholder = translated;
  } else {
    const textNode = Array.from(element.childNodes).find(node => node.nodeType === 3);
    if (textNode) {
      textNode.textContent = translated;
    } else {
      element.textContent = translated;
    }
  }
}

async function applyTranslations() {
  const elements = document.querySelectorAll('[data-translate]');

  // Executar com concorrência limitada para não travar UI
  const list = Array.from(elements);
  const concurrency = 4;
  let index = 0;

  async function worker() {
    while (index < list.length) {
      const el = list[index++];
      const originalText = el.getAttribute('data-original') || el.textContent || el.placeholder;

      if (!el.getAttribute('data-original')) {
        el.setAttribute('data-original', originalText);
      }

      await translateElement(el, originalText);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, list.length) }, () => worker());
  await Promise.all(workers);
}

function runTranslations() {
  if (translationsRunPromise) {
    translationsPending = true;
    return translationsRunPromise;
  }

  translationsRunPromise = (async () => {
    await applyTranslations();
  })().finally(() => {
    translationsRunPromise = null;
    if (translationsPending) {
      translationsPending = false;
      // Re-executa uma vez, caso tenha entrado pedido durante a execução
      runTranslations();
    }
  });

  return translationsRunPromise;
}

window.applyTranslations = runTranslations;

// Atualizar idioma em runtime quando houver troca
document.addEventListener('languageChanged', function() {
  currentLanguage = localStorage.getItem('language') || 'en';
});

// ============================================================
// AUTHENTICATION & USER DATA
// ============================================================

// Auth Tab Switching
window.showAuthTab = function(tab, evt) {
  const tabs = document.querySelectorAll('.auth-tab');
  tabs.forEach(t => t.classList.remove('active'));
  if (evt && evt.target) evt.target.classList.add('active');
  
  switchTab(tab);
};

// Auth Actions
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleLogout = () => authHandleLogout(false);

// Load User Data
async function loadUserData(user) {
  currentUser = user;
  window.currentUser = user;

  function rebindCurrencyProxiesFromWindow() {
    // ✅ PROTEÇÃO PARA MONEY
    if (typeof window.playerMoney === 'number') {
      _internalMoney = window.playerMoney;
      window.playerMoney = playerMoney;
    }

    // ✅ PROTEÇÃO PARA DIAMONDS
    if (typeof window.playerDiamonds === 'number') {
      _internalDiamonds = window.playerDiamonds;
      window.playerDiamonds = playerDiamonds;
    }

    updateMoneyDisplay();
  }
  
  await authLoadUserData(
    user,
    () => {
      rebindCurrencyProxiesFromWindow();
    },
    calculateLevel,
    loadSavedColors,
    checkAndShowAdminButton,
    runTranslations,
    window.goTo
  );

  // ✅ GARANTIA FINAL
  rebindCurrencyProxiesFromWindow();

  setupProfileUploadListeners(user.id);

  // Single-flight: evita re-carregar tema várias vezes em sequência
  await ensureThemeLoaded();

  // ✅ ADICIONAR ANTES de initializeChat:
  const chatPanel = document.getElementById('chat-panel');
  const chatBtn = document.getElementById('chat-toggle-icon');
  if (chatPanel) chatPanel.classList.remove('active');
  if (chatBtn) {
    chatBtn.classList.remove('active');
    if (typeof window.setChatToggleIcon === 'function') {
      window.setChatToggleIcon({ count: '0', icon: 'messages-square', showCount: true });
    } else {
      chatBtn.innerHTML = '<span class="header-icon" data-lucide="messages-square"></span><span class="chat-online-count" id="chat-online-count">0</span>';
      if (typeof window.refreshLucideIcons === 'function') {
        window.refreshLucideIcons();
      }
    }
  }

  await initializeChat(user);
  await initializeFriends(user);
  
  // Inicializar modal de suporte
  if (window.initSupport) {
    window.initSupport();
  }
}

// Auth State Listener
setupAuthStateListener(loadUserData);

let themeInitPromise = null;
function ensureThemeLoaded({ force = false } = {}) {
  if (force) themeInitPromise = null;
  themeInitPromise ||= loadInitialTheme();
  return themeInitPromise;
}

// ============================================================
// UTILITY FUNCTIONS (SHARED)
// ============================================================

// Level Calculation
function calculateLevel(totalXP) {
  let level = 1;
  let xpNeeded = 0;
  let accumulatedXP = 0;
  
  // Fórmula quadrática: level² * 50
  while (true) {
    xpNeeded = level * level * 50;
    
    if (accumulatedXP + xpNeeded > totalXP) {
      break;
    }
    
    accumulatedXP += xpNeeded;
    level++;
    
    // Limite máximo de level 50
    if (level >= 50) break;
  }
  
  const currentLevelXP = totalXP - accumulatedXP;
  const nextLevelXP = level * level * 50;
  
  return {
    level: level,
    currentXP: currentLevelXP,
    nextLevelXP: nextLevelXP,
    totalXP: totalXP
  };
}

// Inicializar o router cedo (plano A): goTo apenas navega e o loader roda pela rota
let routerStarted = false;
function startRouterOnce() {
  if (routerStarted) return;
  routerStarted = true;

  try {
    initRouter();
    bindGlobalClickSfx();
    bindGlobalHoverSfx();
  } catch (err) {
    console.error('Falha ao iniciar router (vai tentar no DOMContentLoaded):', err);
    // fallback: tentar novamente quando DOM estiver pronto
    window.addEventListener(
      'DOMContentLoaded',
      () => {
        try {
          initRouter();
        } catch (err2) {
          console.error('Falha ao iniciar router no DOMContentLoaded:', err2);
        }
      },
      { once: true }
    );
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startRouterOnce, { once: true });
} else {
  startRouterOnce();
}

// Profile Navigation
window.goToProfile = function() {
  document.getElementById('profile-dropdown')?.classList.remove('active');
  window.goTo('profile');
};

// ============================================================
// INVENTORY SYSTEM (WRAPPERS)
// ============================================================

// ============ VENDER ITEM INDIVIDUAL ============
window.sellItem = async function(itemId) {
  if (!currentUser?.id) return;
  await sellItem(itemId, currentUser.id, async () => {
    await renderInventory(currentUser.id);
  });
};

// ============ VENDER SELECIONADOS ============
window.sellSelected = async function() {
  if (!currentUser?.id) return;
  await sellSelected(currentUser.id, async () => {
    await renderInventory(currentUser.id);
  });
};

// ============ FILTROS ============
window.openFilterModal = function() {
  document.getElementById('filter-modal').classList.add('active');
};

window.closeFilterModal = function() {
  document.getElementById('filter-modal').classList.remove('active');
};

// ============ SELL ALL MODAL (MANTIDO) ============
window.openSellAllModal = async function() {
  if (!currentUser?.id) return;
  await openSellAllModal(currentUser.id);
};

window.closeSellAllModal = function() {
  document.getElementById('sell-all-modal').classList.add('hidden');
};

// ============ UPDATE SELL ALL SUMMARY - VERSÃO MELHORADA ============
window.confirmSellAll = async function() {
  if (!currentUser?.id) return;
  await confirmSellAll(currentUser.id, async () => {
    await renderInventory(currentUser.id);
  });
};

window.updateSellAllSummary = async function() {
  if (!currentUser?.id) return;
  await updateSellAllSummary(currentUser.id);
};

// ============================================================
// INITIALIZATION & EVENT LISTENERS
// ============================================================

window.addEventListener('DOMContentLoaded', async function() {
  await ensureThemeLoaded();
  await runTranslations();
  initializeStateSystem();
  initLegal(); // Inicializar sistema de páginas legais
});

document.addEventListener('languageChanged', async function() {
  await runTranslations();
});

// ============================================================
// GLOBAL EXPORTS
// ============================================================

// Constants
window.RARITIES = RARITIES;

// Functions - Effects
window.showMoneyPopup = showMoneyPopup;
window.showDiamondPopup = showDiamondPopup;
window.showXPPopup = showXPPopup;

// Functions - Utility
window.calculateLevel = calculateLevel;