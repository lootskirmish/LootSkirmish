// ============================================================
// APP.TS - IMPORTS
// ============================================================

import './core/store'; // Importar store primeiro
import './core/route-loader'; // Importar route loader

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
} from './shared/effects';

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
} from './shared/constants';

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
} from './shared/themes';

import {
  initializeStateSystem
} from './core/state';

import './features/caseopening.js';
import { bindGlobalClickSfx, bindGlobalHoverSfx } from './shared/sfx';

import { initializeChat } from './features/chat.js';
import { initializeFriends } from './features/friends.js';

import './features/leaderboard.js';

import { 
  initRouter
} from './core/router';

// ============================================================
// GLOBAL STATE VARIABLES
// ============================================================

// User & Authentication
let currentUser: any = null;

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

let _internalMoney: number = 0;
let _internalDiamonds: number = 0;
// Bloqueia popups durante carregamentos (login/logout)
(window as any).__suppressCurrencyPopups = false;

let moneyEl: HTMLElement | null = null;
let diamondsEl: HTMLElement | null = null;

interface CurrencyValue {
  value: number;
}

const moneyProxy = new Proxy<CurrencyValue>(
  { value: 0 },
  {
    get(target: CurrencyValue, prop: string | symbol): any {
      if (prop === 'value') return _internalMoney;
      return (target as any)[prop];
    },
    set(target: CurrencyValue, prop: string | symbol, newValue: any): boolean {
      if (prop === 'value') {
        const nextValue = Number(newValue);
        if (!Number.isFinite(nextValue)) return true;

        const oldValue = _internalMoney;
        const difference = parseFloat((nextValue - oldValue).toFixed(2));

        _internalMoney = parseFloat(nextValue.toFixed(2));
        updateMoneyDisplay();
        
        if (!(window as any).__suppressCurrencyPopups && difference !== 0 && !isNaN(difference)) {
          showMoneyPopup(difference);
        }
        
        return true;
      }
      (target as any)[prop] = newValue;
      return true;
    }
  }
);

const diamondProxy = new Proxy<CurrencyValue>(
  { value: 0 },
  {
    get(target: CurrencyValue, prop: string | symbol): any {
      if (prop === 'value') return _internalDiamonds;
      return (target as any)[prop];
    },
    set(target: CurrencyValue, prop: string | symbol, newValue: any): boolean {
      if (prop === 'value') {
        const oldValue = _internalDiamonds;
        const nextValue = Number.parseInt(newValue, 10);
        if (Number.isNaN(nextValue)) return true;

        const difference = nextValue - oldValue;

        _internalDiamonds = nextValue;
        updateMoneyDisplay();
        
        // Mostrar popup automaticamente quando há mudança
        if (!(window as any).__suppressCurrencyPopups && difference !== 0 && !isNaN(difference)) {
          showDiamondPopup(difference);
        }
        
        return true;
      }
      (target as any)[prop] = newValue;
      return true;
    }
  }
);

// Expor globalmente
let playerMoney: CurrencyValue = moneyProxy;
let playerDiamonds: CurrencyValue = diamondProxy;
(window as any).playerMoney = playerMoney;
(window as any).playerDiamonds = playerDiamonds;

function updateMoneyDisplay(): void {
  moneyEl ||= document.getElementById('money');
  diamondsEl ||= document.getElementById('diamonds');

  if (moneyEl) {
    moneyEl.textContent = _internalMoney.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
    });
  }
  if (diamondsEl) {
    diamondsEl.textContent = _internalDiamonds.toString();
  }
}

function updateDiamondsDisplay(amount: number): void {
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    playerDiamonds.value = amount;
  }
}

// Exportar globalmente
(window as any).updateMoneyDisplay = updateMoneyDisplay;
(window as any).updateDiamondsDisplay = updateDiamondsDisplay;

// ============================================================
// TRANSLATION SYSTEM (AUTO ONLY)
// ============================================================

let currentLanguage: string = localStorage.getItem('language') || 'en';
const translationCache: Record<string, string | Promise<string>> = {};
let translationsRunPromise: Promise<void> | null = null;
let translationsPending: boolean = false;

const TRANSLATION_CACHE_STORAGE_KEY = 'translationCache_v1';
const TRANSLATION_CACHE_MAX_ENTRIES = 200;
let translationCacheOrder: string[] = [];
let translationCacheSaveTimer: number | null = null;

function loadPersistentTranslationCache(): void {
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

function schedulePersistTranslationCache(): void {
  if (translationCacheSaveTimer) return;
  translationCacheSaveTimer = window.setTimeout(() => {
    translationCacheSaveTimer = null;
    try {
      const entries: Record<string, string> = {};
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

function rememberTranslation(cacheKey: string, translated: string): void {
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

async function translateText(text: string, targetLang: string): Promise<string> {
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

async function translateElement(element: HTMLElement, text: string): Promise<void> {
  if (!text || !element) return;
  
  const targetLang = currentLanguage;
  
  // Se for inglês (idioma padrão), mostrar o texto original
  if (targetLang === 'en') {
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      (element as HTMLInputElement).placeholder = text;
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
    (element as HTMLInputElement).placeholder = translated;
  } else {
    const textNode = Array.from(element.childNodes).find(node => node.nodeType === 3);
    if (textNode) {
      textNode.textContent = translated;
    } else {
      element.textContent = translated;
    }
  }
}

async function applyTranslations(): Promise<void> {
  const elements = document.querySelectorAll('[data-translate]');

  // Executar com concorrência limitada para não travar UI
  const list = Array.from(elements);
  const concurrency = 4;
  let index = 0;

  async function worker() {
    while (index < list.length) {
      const el = list[index++] as HTMLElement;
      const originalText = el.getAttribute('data-original') || el.textContent || (el as HTMLInputElement).placeholder || '';

      if (!el.getAttribute('data-original')) {
        el.setAttribute('data-original', originalText);
      }

      await translateElement(el, originalText);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, list.length) }, () => worker());
  await Promise.all(workers);
}

function runTranslations(): Promise<void> {
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

(window as any).applyTranslations = runTranslations;

// Atualizar idioma em runtime quando houver troca
document.addEventListener('languageChanged', function() {
  currentLanguage = localStorage.getItem('language') || 'en';
});

// ============================================================
// AUTHENTICATION & USER DATA
// ============================================================

// Auth Tab Switching
(window as any).showAuthTab = function(tab: string, evt?: MouseEvent) {
  const tabs = document.querySelectorAll('.auth-tab');
  tabs.forEach(t => t.classList.remove('active'));
  if (evt && evt.target) (evt.target as HTMLElement).classList.add('active');
  
  switchTab(tab);
};

// Auth Actions
(window as any).handleLogin = handleLogin;
(window as any).handleRegister = handleRegister;
(window as any).handleLogout = () => authHandleLogout(false);

// Load User Data
async function loadUserData(user: any): Promise<void> {
  currentUser = user;
  (window as any).currentUser = user;

  function rebindCurrencyProxiesFromWindow() {
    // ✅ PROTEÇÃO PARA MONEY
    if (typeof (window as any).playerMoney === 'number') {
      _internalMoney = (window as any).playerMoney;
      (window as any).playerMoney = playerMoney;
    }

    // ✅ PROTEÇÃO PARA DIAMONDS
    if (typeof (window as any).playerDiamonds === 'number') {
      _internalDiamonds = (window as any).playerDiamonds;
      (window as any).playerDiamonds = playerDiamonds;
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
    (window as any).goTo
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
    if (typeof (window as any).setChatToggleIcon === 'function') {
      (window as any).setChatToggleIcon({ count: '0', icon: 'messages-square', showCount: true });
    } else {
      chatBtn.innerHTML = '<span class="header-icon" data-lucide="messages-square"></span><span class="chat-online-count" id="chat-online-count">0</span>';
      if (typeof (window as any).refreshLucideIcons === 'function') {
        (window as any).refreshLucideIcons();
      }
    }
  }

  await initializeChat(user);
  await initializeFriends(user);
  
  // Inicializar modal de suporte
  if ((window as any).initSupport) {
    (window as any).initSupport();
  }
}

// Auth State Listener
setupAuthStateListener(loadUserData);

let themeInitPromise: Promise<void> | null = null;
function ensureThemeLoaded({ force = false } = {}): Promise<void> {
  if (force) themeInitPromise = null;
  themeInitPromise ||= loadInitialTheme();
  return themeInitPromise;
}

// ============================================================
// UTILITY FUNCTIONS (SHARED)
// ============================================================

interface LevelInfo {
  level: number;
  currentXP: number;
  nextLevelXP: number;
  totalXP: number;
}

// Level Calculation
function calculateLevel(totalXP: number): LevelInfo {
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
let routerStarted: boolean = false;
function startRouterOnce(): void {
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
(window as any).goToProfile = function() {
  document.getElementById('profile-dropdown')?.classList.remove('active');
  (window as any).goTo('profile');
};

// ============================================================
// INVENTORY SYSTEM (WRAPPERS)
// ============================================================

// ============ VENDER ITEM INDIVIDUAL ============
(window as any).sellItem = async function(itemId: string) {
  if (!currentUser?.id) return;
  await sellItem(itemId, currentUser.id, async () => {
    await renderInventory(currentUser.id);
  });
};

// ============ VENDER SELECIONADOS ============
(window as any).sellSelected = async function() {
  if (!currentUser?.id) return;
  await sellSelected(currentUser.id, async () => {
    await renderInventory(currentUser.id);
  });
};

// ============ FILTROS ============
(window as any).openFilterModal = function() {
  const modal = document.getElementById('filter-modal');
  if (modal) modal.classList.add('active');
};

(window as any).closeFilterModal = function() {
  const modal = document.getElementById('filter-modal');
  if (modal) modal.classList.remove('active');
};

// ============ SELL ALL MODAL (MANTIDO) ============
(window as any).openSellAllModal = async function() {
  if (!currentUser?.id) return;
  await openSellAllModal(currentUser.id);
};

(window as any).closeSellAllModal = function() {
  const modal = document.getElementById('sell-all-modal');
  if (modal) modal.classList.add('hidden');
};

// ============ UPDATE SELL ALL SUMMARY - VERSÃO MELHORADA ============
(window as any).confirmSellAll = async function() {
  if (!currentUser?.id) return;
  await confirmSellAll(currentUser.id, async () => {
    await renderInventory(currentUser.id);
  });
};

(window as any).updateSellAllSummary = async function() {
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
(window as any).RARITIES = RARITIES;

// Functions - Effects
(window as any).showMoneyPopup = showMoneyPopup;
(window as any).showDiamondPopup = showDiamondPopup;
(window as any).showXPPopup = showXPPopup;

// Functions - Utility
(window as any).calculateLevel = calculateLevel;
