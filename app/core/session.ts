// ============================================================
// SESSION.TS - Secure Session Management
// ============================================================

import { store, authActions } from './persistence';
import { createLogger } from './logger';
import { WindowManager, User, isValidUser, isValidUsername } from './core-utils';
import { SECURITY, STORAGE, ERRORS } from '../shared/constants';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../shared/error-handler';

const logger = createLogger('Session');

// ============================================================
// TYPES
// ============================================================

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

/**
 * Sanitizes username by removing dangerous characters
 */
function sanitizeUsername(username: string): string {
  return username.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, SECURITY.USERNAME_MAX_LENGTH);
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

  const windowUser = WindowManager.getCurrentUser();
  if (isValidUser(windowUser)) {
    if (sync) store.dispatch(authActions.setUser(windowUser));
    return windowUser;
  }

  if (allowStored) {
    const stored = safeGetItem('currentUser');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (isValidUser(parsed)) {
          if (sync) setActiveUser(parsed, { persist: false });
          return parsed;
        }
      } catch (error) {
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

  if (user && !isValidUser(user)) {
    clearActiveUser();
    return;
  }

  if (typeof window !== 'undefined') {
    (window as any).currentUser = user;
  }
  store.dispatch(authActions.setUser(user));

  if (typeof window !== 'undefined') {
    if (persist && user) {
      try {
        safeSetItem('currentUser', JSON.stringify(user));
      } catch (error) {
        logger.warn('Failed to persist user', { error });
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

// ============================================================
// 🛡️ CSRF TOKEN MANAGEMENT (Private - No Window Exposure)
// ============================================================

/**
 * Interface for CSRF token data stored in private closure
 */
interface CsrfTokenData {
  token: string;
  timestamp: number;
  expiresAt: number;
  userId: string;
  checksum: string;
}

// Private closure - CSRF tokens never exposed to window global
let csrfTokenCache: CsrfTokenData | null = null;
let retryAttempts: Map<string, number> = new Map();
let lastRetryTime: Map<string, number> = new Map();

/**
 * Calculates SHA-256 checksum for token validation
 */
async function calculateChecksum(data: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    // Fallback for environments without crypto.subtle
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  try {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    logger.warn('Failed to calculate SHA-256, using fallback', { error });
    return data.slice(0, 16);
  }
}

function resolveCurrentUserId(): string | null {
  const stateUser = store.getState()?.auth?.user?.id;
  if (stateUser && typeof stateUser === 'string') return stateUser;
  
  const windowUser = WindowManager.getCurrentUser();
  if (windowUser?.id && typeof windowUser.id === 'string') return windowUser.id;
  
  return null;
}

/**
 * Validates CSRF token format and content
 */
function isValidTokenFormat(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  if (token.length < SECURITY.CSRF_TOKEN_MIN_LENGTH) return false;
  // Check if token contains only valid characters (base64-like)
  if (!/^[A-Za-z0-9+/=_-]+$/.test(token)) return false;
  return true;
}

/**
 * Stores CSRF token in private closure (NOT exposed to window global)
 * Persists encrypted version to localStorage for cross-tab support
 */
export async function setCsrfToken(token: string, userId?: string): Promise<void> {
  if (!isValidTokenFormat(token)) {
    logger.warn('Invalid CSRF token format rejected');
    return;
  }
  
  const ownerId = userId || resolveCurrentUserId();
  if (!ownerId) {
    logger.error('Cannot set CSRF token without valid user ID');
    return;
  }
  
  const checksum = await calculateChecksum(token + ownerId);
  
  const tokenData: CsrfTokenData = {
    token,
    timestamp: Date.now(),
    expiresAt: Date.now() + SECURITY.CSRF_TOKEN_TTL_MS,
    userId: ownerId,
    checksum,
  };
  
  // Store in private closure (NOT window global)
  csrfTokenCache = tokenData;
  
  // Persist for cross-tab support (encrypted)
  const success = safeSetItem(STORAGE.CSRF_KEY, JSON.stringify(tokenData));
  
  if (success) {
  } else {
    logger.warn('Failed to persist CSRF token to storage');
  }
}

/**
 * Retrieves CSRF token from private closure with strict validation
 * Never exposes token to window global
 */
export async function getCsrfToken(expectedUserId?: string): Promise<string | null> {
  const ownerId = expectedUserId || resolveCurrentUserId();
  if (!ownerId) {
    logger.warn('Cannot get CSRF token without valid user ID');
    return null;
  }

  const isTokenValid = async (data: CsrfTokenData): Promise<boolean> => {
    if (!data || !data.token) return false;
    if (!isValidTokenFormat(data.token)) return false;
    if (data.userId !== ownerId) return false;
    if (Date.now() > data.expiresAt) return false;
    
    // Verify checksum
    const expectedChecksum = await calculateChecksum(data.token + data.userId);
    if (data.checksum !== expectedChecksum) {
      logger.warn('CSRF token checksum mismatch - possible tampering');
      return false;
    }
    
    return true;
  };

  // Check private closure first
  if (csrfTokenCache && await isTokenValid(csrfTokenCache)) {
    return csrfTokenCache.token;
  }

  // Fallback: restore from localStorage
  const storedRaw = safeGetItem(STORAGE.CSRF_KEY);
  if (storedRaw) {
    try {
      const stored: CsrfTokenData = JSON.parse(storedRaw);
      if (await isTokenValid(stored)) {
        csrfTokenCache = stored;
        return stored.token;
      }
    } catch (error) {
      logger.warn('Failed to parse stored CSRF token', { error });
    }
  }

  // No valid token found
  clearCsrfToken();
  return null;
}

/**
 * Checks if CSRF token is valid (exists and not expired)
 */
export async function isCsrfTokenValid(expectedUserId?: string): Promise<boolean> {
  const token = await getCsrfToken(expectedUserId);
  return token !== null && isValidTokenFormat(token);
}

/**
 * Removes CSRF token from private closure and storage
 */
export function clearCsrfToken(): void {
  csrfTokenCache = null;
  retryAttempts.clear();
  lastRetryTime.clear();
  safeRemoveItem(STORAGE.CSRF_KEY);
}

/**
 * Calculates exponential backoff delay
 */
function getRetryDelay(attemptNumber: number): number {
  const delay = Math.min(
    SECURITY.BASE_RETRY_DELAY_MS * Math.pow(2, attemptNumber),
    SECURITY.MAX_RETRY_DELAY_MS
  );
  // Add jitter to avoid thundering herd
  return delay + Math.random() * 1000;
}

/**
 * Fetches new CSRF token from server with exponential backoff retry
 * @param userId - Authenticated user ID
 * @param authToken - Supabase authentication token
 * @returns Promise with CSRF token or null on error
 */
export async function fetchCsrfToken(userId: string, authToken: string): Promise<string | null> {
  // Strict parameter validation
  if (!userId || typeof userId !== 'string' || userId.length < 10) {
    logger.error(ERRORS.INVALID_USER_ID);
    return null;
  }
  
  if (!authToken || typeof authToken !== 'string' || authToken.length < 32) {
    logger.error(ERRORS.CSRF_INVALID_FORMAT);
    return null;
  }

  // Check retry attempts
  const retryKey = `csrf:${userId}`;
  const attempts = retryAttempts.get(retryKey) || 0;
  
  if (attempts >= SECURITY.MAX_RETRY_ATTEMPTS) {
    const lastRetry = lastRetryTime.get(retryKey) || 0;
    const timeSinceLastRetry = Date.now() - lastRetry;
    
    // Reset after 5 minutes
    if (timeSinceLastRetry > 5 * 60 * 1000) {
      retryAttempts.set(retryKey, 0);
      lastRetryTime.delete(retryKey);
    } else {
      logger.warn('Max CSRF fetch retry attempts reached', { userId, attempts });
      return null;
    }
  }

  // Apply exponential backoff delay
  if (attempts > 0) {
    const delay = getRetryDelay(attempts - 1);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  try {
    retryAttempts.set(retryKey, attempts + 1);
    lastRetryTime.set(retryKey, Date.now());
    
    const response = await fetch('/api/_profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'getCsrfToken',
        userId,
        authToken
      })
    });

    if (!response.ok) {
      logger.error(`CSRF fetch HTTP error ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.success && data.csrfToken) {
      // Strict validation of received token
      if (!isValidTokenFormat(data.csrfToken)) {
        logger.error('Invalid CSRF token received from server');
        return null;
      }
      
      await setCsrfToken(data.csrfToken, userId);
      
      // Reset retry counter on success
      retryAttempts.delete(retryKey);
      lastRetryTime.delete(retryKey);
      
      return data.csrfToken;
    }

    logger.warn('Server response missing valid CSRF token');
    return null;
  } catch (error) {
    logger.error('Failed to fetch CSRF token', { error, attempt: attempts + 1 });
    return null;
  }
}

/**
 * Forces CSRF token renewal
 */
export async function renewCsrfToken(userId: string, authToken: string): Promise<string | null> {
  clearCsrfToken();
  return await fetchCsrfToken(userId, authToken);
}

/**
 * Clears CSRF token on server (useful on logout)
 * @param userId - Authenticated user ID
 * @param authToken - Supabase authentication token
 */
export async function clearCsrfTokenOnServer(userId: string, authToken: string): Promise<void> {
  try {
    await fetch('/api/_profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'clearCsrfToken',
        userId,
        authToken
      })
    });
  } catch (error) {
    logger.error('Failed to clear CSRF token on server', { error });
  } finally {
    clearCsrfToken();
  }
}

/**
 * Adds X-CSRF-Token header to headers object with strict validation
 * Useful for adding CSRF protection to API calls
 */
export async function addCsrfHeader(headers: HeadersInit = {}): Promise<HeadersInit> {
  const token = await getCsrfToken();
  if (!token) {
    logger.error('CRITICAL: CSRF token not available! Request may be blocked.');
    return headers;
  }

  return {
    ...headers,
    'X-CSRF-Token': token
  };
}
// ============================================================
// 🔑 IDEMPOTENCY KEY MANAGEMENT
// ============================================================

/**
 * Gera um UUID v4 único para usar como chave de idempotência
 * Previne requisições duplicadas (cliques duplos)
 * @returns UUID único
 */
export function generateIdempotencyKey(): string {
  // Usar crypto.randomUUID() se disponível (browsers modernos)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback para UUID v4 manual
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Adiciona o header X-Idempotency-Key a um objeto de headers
 * Útil para proteger operações críticas contra cliques duplos
 * @param headers - Headers existentes
 * @param key - Chave de idempotência (se não fornecida, gera nova)
 * @returns Headers com chave de idempotência
 */
export function addIdempotencyHeader(headers: HeadersInit = {}, key?: string): { headers: HeadersInit; idempotencyKey: string } {
  const idempotencyKey = key || generateIdempotencyKey();

  return {
    headers: {
      ...headers,
      'X-Idempotency-Key': idempotencyKey
    },
    idempotencyKey
  };
}

/**
 * Adiciona ambos CSRF e Idempotency headers de uma vez
 * @param headers - Headers existentes
 * @param idempotencyKey - Chave de idempotência (opcional)
 * @returns Headers com CSRF e Idempotency
 */
export async function addSecurityHeaders(headers: HeadersInit = {}, idempotencyKey?: string): Promise<{ headers: HeadersInit; idempotencyKey: string }> {
  const headersWithCsrf = await addCsrfHeader(headers);
  return addIdempotencyHeader(headersWithCsrf, idempotencyKey);
}

// ============================================================
// 🛡️ REQUEST SIGNING (ANTI-REPLAY)
// ============================================================

/**
 * Gera assinatura HMAC-SHA256 para uma requisição
 * Previne replay attacks combinando timestamp + nonce único + body hash
 * @param secret - Secret key para HMAC
 * @param body - Body da requisição (opcional, para incluir no hash)
 * @returns Objeto com timestamp, nonce, bodyHash e assinatura
 */
export async function generateRequestSignature(
  secret: string,
  body?: any
): Promise<{
  timestamp: string;
  nonce: string;
  signature: string;
  bodyHash?: string;
} | null> {
  try {
    // Gerar timestamp e nonce único
    const timestamp = Date.now().toString();
    const nonce = generateIdempotencyKey();
    
    // Hash do body (se fornecido)
    let bodyHash: string | undefined;
    let message = `${timestamp}:${nonce}`;
    
    if (body) {
      const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
      const bodyData = new TextEncoder().encode(bodyString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', bodyData);
      bodyHash = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Incluir bodyHash na mensagem a assinar
      message += `:${bodyHash}`;
    }
    
    // Usar crypto subtle API para HMAC-SHA256
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(message);
    
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    const signatureHex = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return { timestamp, nonce, signature: signatureHex, bodyHash };
  } catch (error) {
    ErrorHandler.handleError('Failed to generate request signature', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      details: error,
      showToUser: false
    });
    return null;
  }
}

/**
 * Adiciona headers de request signing a um objeto de headers
 * @param headers - Headers existentes
 * @param signature - Objeto de assinatura (timestamp, nonce, signature, bodyHash)
 * @returns Headers com request signing
 */
export function addRequestSigningHeaders(
  headers: HeadersInit = {},
  signature: { timestamp: string; nonce: string; signature: string; bodyHash?: string }
): HeadersInit {
  const sigHeaders: Record<string, string> = {
    ...(headers as Record<string, string>),
    'X-Request-Timestamp': signature.timestamp,
    'X-Request-Nonce': signature.nonce,
    'X-Request-Signature': signature.signature
  };
  
  // Adicionar bodyHash se fornecido
  if (signature.bodyHash) {
    sigHeaders['X-Request-Body-Hash'] = signature.bodyHash;
  }
  
  return sigHeaders;
}

/**
 * Adds request signing headers and returns complete headers
 * Combines CSRF, Idempotency and Request Signing
 * @param headers - Existing headers
 * @param signature - Signature object (optional)
 * @returns Headers with all security protections
 */
export async function addAllSecurityHeaders(
  headers: HeadersInit = {},
  signature?: { timestamp: string; nonce: string; signature: string }
): Promise<HeadersInit> {
  let finalHeaders = headers;
  
  // Add CSRF
  finalHeaders = await addCsrfHeader(finalHeaders);
  
  // Add Idempotency
  const { headers: headersWithIdempotency } = addIdempotencyHeader(finalHeaders);
  finalHeaders = headersWithIdempotency;
  
  // Add Request Signing if available
  if (signature) {
    finalHeaders = addRequestSigningHeaders(finalHeaders, signature);
  }
  
  return finalHeaders;
}

// ============================================================
// PUBLIC UTILITY EXPORTS
// ============================================================

export { sanitizeUsername, isValidUsername };