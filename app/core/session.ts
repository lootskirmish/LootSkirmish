// ============================================================
// SESSION.TS - Fonte única (segura) do usuário ativo (TypeScript)
// ============================================================

import { store, authActions } from './store';

// ============================================================
// TYPES
// ============================================================

interface User {
  id: string;
  username?: string;
  email?: string;
  [key: string]: unknown;
}

interface GetActiveUserOptions {
  sync?: boolean;
  allowStored?: boolean;
}

interface SetActiveUserOptions {
  persist?: boolean;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function isValidUser(user: unknown): user is User {
  return Boolean(user && typeof user === 'object' && (user as any).id);
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveItem(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

/**
 * Retorna o usuário ativo usando a prioridade:
 * Redux -> window.currentUser -> localStorage('currentUser')
 *
 * Se sync=true, sincroniza a fonte encontrada para Redux+window.
 */
export function getActiveUser(options: GetActiveUserOptions = {}): User | null {
  const { sync = true, allowStored = true } = options;

  const stateUser = store.getState()?.auth?.user;
  if (isValidUser(stateUser)) return stateUser;

  const windowUser =
    typeof window !== 'undefined' ? (window as any).currentUser : null;
  if (isValidUser(windowUser)) {
    if (sync) store.dispatch(authActions.setUser(windowUser));
    return windowUser;
  }

  if (allowStored && typeof window !== 'undefined') {
    const stored = safeGetItem('currentUser');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as unknown;
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
export function setActiveUser(user: User | null, options: SetActiveUserOptions = {}): void {
  const { persist = false } = options;

  if (!isValidUser(user)) {
    clearActiveUser();
    return;
  }

  if (typeof window !== 'undefined') {
    (window as any).currentUser = user;
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
export function clearActiveUser(): void {
  if (typeof window !== 'undefined') {
    (window as any).currentUser = null;
    safeRemoveItem('currentUser');
  }
  store.dispatch(authActions.clearUser());
}
