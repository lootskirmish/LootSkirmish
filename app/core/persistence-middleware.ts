// ============================================================
// PERSISTENCE-MIDDLEWARE.TS - Middleware para sincronizar Redux com Persistence
// ============================================================

import { debounceSave } from './persistence';

/**
 * Wrap do store.subscribe para trigger auto-save quando Redux muda
 */
export function setupPersistenceMiddleware(store: any): void {
  // Se Redux mudar, agenda save automático
  store.subscribe(() => {
    debounceSave();
  });
}
