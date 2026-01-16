// ============================================================
// SESSION.TS - Fonte única (segura) do usuário ativo (TypeScript)
// ============================================================

import { store, authActions } from './persistence';

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

// ============================================================
// 🛡️ CSRF TOKEN MANAGEMENT
// ============================================================

const CSRF_STORAGE_KEY = 'ls-csrf-token-v2';
const CSRF_MEMORY_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

/**
 * Interface para armazenar dados do token CSRF na memória
 */
interface CsrfTokenData {
  token: string;
  timestamp: number;
  expiresAt: number;
  userId?: string;
}

function resolveCurrentUserId(): string | undefined {
  const stateUser = store.getState()?.auth?.user?.id;
  const windowUser = typeof window !== 'undefined'
    ? (window as any).currentUser?.id
    : undefined;
  return stateUser || windowUser || undefined;
}

/**
 * Armazena o token CSRF na memória (window.currentCsrfToken) e em localStorage
 * para permitir reuso seguro entre abas/refresh
 */
export function setCsrfToken(token: string, userId?: string): void {
  if (!token || typeof token !== 'string') {
    console.warn('[CSRF] Token inválido fornecido');
    return;
  }
  
  if (token.length < 32) {
    console.warn('[CSRF] Token muito curto - rejeitado');
    return;
  }
  
  const ownerId = userId || resolveCurrentUserId();
  const tokenData: CsrfTokenData = {
    token,
    timestamp: Date.now(),
    expiresAt: Date.now() + CSRF_MEMORY_TTL_MS,
    userId: ownerId
  };
  
  // Armazenar na memória (window)
  if (typeof window !== 'undefined') {
    (window as any).currentCsrfToken = token;
    (window as any).__csrfTokenData = tokenData;
  }
  // Persistir para reuso seguro entre abas
  safeSetItem(CSRF_STORAGE_KEY, JSON.stringify(tokenData));
  console.log('[CSRF] Token armazenado em memória com sucesso');
}

/**
 * Recupera o token CSRF da memória com validação de expiração
 * Usa a sessão ativa do Supabase como fonte de verdade
 */
export function getCsrfToken(expectedUserId?: string): string | null {
  if (typeof window === 'undefined') return null;
  
  const ownerId = expectedUserId || resolveCurrentUserId();
  const tokenData = (window as any).__csrfTokenData as CsrfTokenData | undefined;
  const token = (window as any).currentCsrfToken as string | undefined;

  const isTokenValid = (data?: CsrfTokenData, value?: string): boolean => {
    if (!data || !value) return false;
    if (typeof value !== 'string' || value.length < 32) return false;
    if (ownerId && !data.userId) return false;
    if (ownerId && data.userId && data.userId !== ownerId) return false;
    return !(data.expiresAt && Date.now() > data.expiresAt);
  };

  // Prioriza token em memória
  if (isTokenValid(tokenData, token)) return token as string;

  // Fallback: tentar recuperar do localStorage
  const storedRaw = safeGetItem(CSRF_STORAGE_KEY);
  if (storedRaw) {
    try {
      const stored: CsrfTokenData = JSON.parse(storedRaw);
      if (isTokenValid(stored, stored.token)) {
        (window as any).currentCsrfToken = stored.token;
        (window as any).__csrfTokenData = stored;
        return stored.token;
      }
    } catch {
      // ignore parse errors
    }
  }

  // Token inválido ou expirado
  clearCsrfToken();
  return null;
}

/**
 * Verifica se o token CSRF está válido (existe e não expirou)
 */
export function isCsrfTokenValid(expectedUserId?: string): boolean {
  const token = getCsrfToken(expectedUserId);
  return token !== null && token.length >= 32;
}

/**
 * Remove o token CSRF da memória (útil no logout)
 */
export function clearCsrfToken(): void {
  if (typeof window !== 'undefined') {
    (window as any).currentCsrfToken = null;
    (window as any).__csrfTokenData = null;
  }
  safeRemoveItem(CSRF_STORAGE_KEY);
}

/**
 * Busca um novo token CSRF do servidor após login com validação rigorosa
 * @param userId - ID do usuário autenticado
 * @param authToken - Token de autenticação do Supabase
 * @returns Promise com o token CSRF ou null em caso de erro
 */
export async function fetchCsrfToken(userId: string, authToken: string): Promise<string | null> {
  // Validação de parâmetros obrigatórios
  if (!userId || typeof userId !== 'string') {
    console.error('[CSRF] userId inválido ou ausente');
    return null;
  }
  
  if (!authToken || typeof authToken !== 'string') {
    console.error('[CSRF] authToken inválido ou ausente');
    return null;
  }
  
  try {
    console.log('[CSRF] Buscando novo token do servidor...');
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
      console.error(`[CSRF] Erro HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.success && data.csrfToken) {
      // Validação do token recebido
      if (typeof data.csrfToken !== 'string' || data.csrfToken.length < 32) {
        console.error('[CSRF] Token recebido do servidor é inválido');
        return null;
      }
      
      setCsrfToken(data.csrfToken, userId);
      console.log('[CSRF] ✅ Token obtido e armazenado com sucesso');
      return data.csrfToken;
    }

    console.warn('[CSRF] Resposta do servidor não contém token válido');
    return null;
  } catch (error) {
    console.error('[CSRF] Erro ao buscar token:', error);
    return null;
  }
}

/**
 * Força renovação do token CSRF
 */
export async function renewCsrfToken(userId: string, authToken: string): Promise<string | null> {
  console.log('[CSRF] Forçando renovação do token...');
  clearCsrfToken();
  return await fetchCsrfToken(userId, authToken);
}

/**
 * Limpa o token CSRF no servidor (útil no logout)
 * @param userId - ID do usuário autenticado
 * @param authToken - Token de autenticação do Supabase
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
    console.error('Error clearing CSRF token on server:', error);
  } finally {
    clearCsrfToken();
  }
}

/**
 * Adiciona o header X-CSRF-Token a um objeto de headers com validação rigorosa
 * Útil para adicionar proteção CSRF a chamadas de API
 */
export function addCsrfHeader(headers: HeadersInit = {}): HeadersInit {
  const token = getCsrfToken();
  if (!token) {
    console.error('[CSRF] ⚠️ CRÍTICO: Token CSRF não disponível! Requisição pode ser bloqueada.');
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
export function addSecurityHeaders(headers: HeadersInit = {}, idempotencyKey?: string): { headers: HeadersInit; idempotencyKey: string } {
  const headersWithCsrf = addCsrfHeader(headers);
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
    console.error('Failed to generate request signature:', error);
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
 * Adiciona request signing headers e retorna headers completos
 * Combina CSRF, Idempotency e Request Signing
 * @param headers - Headers existentes
 * @param signature - Objeto de assinatura (opcional)
 * @returns Headers com todas as proteções de segurança
 */
export async function addAllSecurityHeaders(
  headers: HeadersInit = {},
  signature?: { timestamp: string; nonce: string; signature: string }
): Promise<HeadersInit> {
  let finalHeaders = headers;
  
  // Adicionar CSRF
  finalHeaders = addCsrfHeader(finalHeaders);
  
  // Adicionar Idempotency
  const { headers: headersWithIdempotency } = addIdempotencyHeader(finalHeaders);
  finalHeaders = headersWithIdempotency;
  
  // Adicionar Request Signing se disponível
  if (signature) {
    finalHeaders = addRequestSigningHeaders(finalHeaders, signature);
  }
  
  return finalHeaders;
}