// ============================================================
// SESSION.JS - Fonte única (segura) do usuário ativo
// ============================================================

import { store, authActions } from './store.js';

function isValidUser(user) {
  return Boolean(user && typeof user === 'object' && user.id);
}

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Retorna o usuário ativo usando a prioridade:
 * Redux -> window.currentUser -> localStorage('currentUser')
 *
 * Se sync=true, sincroniza a fonte encontrada para Redux+window.
 */
export function getActiveUser({ sync = true, allowStored = true } = {}) {
  const stateUser = store.getState()?.auth?.user;
  if (isValidUser(stateUser)) return stateUser;

  const windowUser = typeof window !== 'undefined' ? window.currentUser : null;
  if (isValidUser(windowUser)) {
    if (sync) store.dispatch(authActions.setUser(windowUser));
    return windowUser;
  }

  if (allowStored && typeof window !== 'undefined') {
    const stored = safeGetItem('currentUser');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (isValidUser(parsed)) {
          if (sync) setActiveUser(parsed, { persist: false });
          return parsed;
        }
      } catch {
        // ignore
      }
    }
  }

  return null;
}

/**
 * Define o usuário ativo e sincroniza Redux + window.
 * Por padrão não persiste em localStorage (evita user stale).
 */
export function setActiveUser(user, { persist = false } = {}) {
  if (!isValidUser(user)) {
    clearActiveUser();
    return;
  }

  if (typeof window !== 'undefined') {
    window.currentUser = user;
  }
  store.dispatch(authActions.setUser(user));

  if (typeof window !== 'undefined') {
    if (persist) {
      try {
        safeSetItem('currentUser', JSON.stringify(user));
      } catch {
        // ignore
      }
    } else {
      safeRemoveItem('currentUser');
    }
  }
}

/**
 * Limpa o usuário ativo de todas as fontes.
 */
export function clearActiveUser() {
  if (typeof window !== 'undefined') {
    window.currentUser = null;
    safeRemoveItem('currentUser');
  }
  store.dispatch(authActions.clearUser());
}
