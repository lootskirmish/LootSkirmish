// ============================================================
// API/UTILS.TS - Shared helpers for API handlers (TypeScript)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ============================================================
// TYPES
// ============================================================

export interface RateLimitEntry {
  count: number;
  resetAt: number;
  lastSeenAt: number;
}

interface CorsOptions {
  allowedOrigins?: string[];
  methods?: string;
  headers?: string;
  credentials?: boolean;
  securityHeaders?: boolean;
}

interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
}

interface CleanupOptions {
  maxIdleMs?: number;
  maxDelete?: number;
}

interface WindowCounterOptions {
  windowMs?: number;
}

interface WindowLimitOptions {
  maxCount?: number;
  windowMs?: number;
}

interface SessionValidateOptions {
  select?: string;
}

export interface ApiRequest {
  headers?: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
  method?: string;
}

export interface CsrfTokenEntry {
  token: string;
  createdAt: number;
  expiresAt: number;
}

// ============================================================
// RATE LIMITING CONFIGS (Per-Endpoint)
// ============================================================

export const RATE_LIMIT_CONFIGS = {
  LOGIN: { maxRequests: 5, windowMs: 60_000 },        // 5 req/min
  REGISTER: { maxRequests: 3, windowMs: 60_000 },     // 3 req/min
  PAYMENT: { maxRequests: 3, windowMs: 60_000 },      // 3 req/min
  ADMIN: { maxRequests: 10, windowMs: 60_000 },       // 10 req/min
  WITHDRAWAL: { maxRequests: 2, windowMs: 60_000 },   // 2 req/min
  CHAT: { maxRequests: 30, windowMs: 60_000 },        // 30 req/min
  PROFILE: { maxRequests: 15, windowMs: 60_000 },     // 15 req/min
  DEFAULT: { maxRequests: 20, windowMs: 60_000 }      // 20 req/min
};

// ============================================================
// CORS HELPERS
// ============================================================

export function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function applyCors(
  req: ApiRequest,
  res: any,
  {
    allowedOrigins = getAllowedOrigins(),
    methods = 'POST, OPTIONS',
    headers = 'Content-Type, Authorization',
    credentials = false,
    securityHeaders = true,
  }: CorsOptions = {}
): void {
  const origin = req.headers?.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);
  if (credentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (securityHeaders) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Content Security Policy
    applyContentSecurityPolicy(res);
  }
}

/**
 * Aplica Content Security Policy (CSP) headers
 * 
 * Protege contra:
 * - XSS (Cross-Site Scripting)
 * - Clickjacking
 * - Data injection attacks
 * - MIME type sniffing
 * 
 * @param {any} res - Response object
 * 
 * @example
 * ```typescript
 * export default async (req, res) => {
 *   applyContentSecurityPolicy(res);
 *   res.status(200).json({ success: true });
 * }
 * ```
 */
export function applyContentSecurityPolicy(res: any): void {
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://cdnjs.cloudflare.com data:",
    "connect-src 'self' https://xgcseugigsdgmyrfrofj.supabase.co https://hcaptcha.com https://*.hcaptcha.com",
    "frame-src 'self' https://hcaptcha.com https://*.hcaptcha.com",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
    "report-uri /api/csp-report"
  ];
  
  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
}

export function getRequestIp(req: ApiRequest): string {
  const xfwd = req.headers?.['x-forwarded-for'];
  if (typeof xfwd === 'string' && xfwd.length) {
    return xfwd.split(',')[0].trim();
  }

  const xRealIp = req.headers?.['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.length) {
    return xRealIp;
  }

  return req.connection?.remoteAddress || 'unknown';
}

// ============================================================
// RATE LIMITING
// ============================================================

export function checkRateLimit(
  rateLimitMap: Map<string, RateLimitEntry>,
  identifier: string,
  { maxRequests = 30, windowMs = 60_000 }: RateLimitOptions = {}
): boolean {
  const now = Date.now();

  const entry = rateLimitMap.get(identifier);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(identifier, { count: 1, resetAt: now + windowMs, lastSeenAt: now });
    return true;
  }

  entry.lastSeenAt = now;

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count += 1;
  return true;
}

export function cleanupOldEntries(
  map: Map<string, RateLimitEntry>,
  { maxIdleMs = 10 * 60_000, maxDelete = 200 }: CleanupOptions = {}
): void {
  const now = Date.now();
  let deleted = 0;

  for (const [key, entry] of map.entries()) {
    const lastSeenAt = entry?.lastSeenAt ?? entry?.resetAt ?? 0;
    if (now - lastSeenAt > maxIdleMs) {
      map.delete(key);
      deleted += 1;
      if (deleted >= maxDelete) break;
    }
  }
}

export function maybeCleanupRateLimits(
  map: Map<string, RateLimitEntry>,
  lastCleanupAt: number,
  { maxIdleMs = 10 * 60_000, maxDelete = 200, minIntervalMs = 60_000 }: CleanupOptions & { minIntervalMs?: number } = {}
): number {
  const now = Date.now();
  if (now - lastCleanupAt < minIntervalMs) return lastCleanupAt;
  cleanupOldEntries(map, { maxIdleMs, maxDelete });
  return now;
}

// ============================================================
// WINDOW COUNTER HELPERS
// ============================================================

export function getWindowCounter(
  map: Map<string, RateLimitEntry>,
  identifier: string,
  windowMs: number
): RateLimitEntry {
  const now = Date.now();
  const entry = map.get(identifier);
  if (!entry || now >= entry.resetAt) {
    const fresh: RateLimitEntry = { count: 0, resetAt: now + windowMs, lastSeenAt: now };
    map.set(identifier, fresh);
    return fresh;
  }
  entry.lastSeenAt = now;
  return entry;
}

export function incrementWindowCounter(
  map: Map<string, RateLimitEntry>,
  identifier: string,
  { windowMs = 60_000 }: WindowCounterOptions = {}
): number {
  const entry = getWindowCounter(map, identifier, windowMs);
  entry.count += 1;
  return entry.count;
}

export function isWindowLimitExceeded(
  map: Map<string, RateLimitEntry>,
  identifier: string,
  { maxCount = 5, windowMs = 60_000 }: WindowLimitOptions = {}
): boolean {
  const now = Date.now();
  const entry = map.get(identifier);
  if (!entry || now >= entry.resetAt) return false;
  return entry.count >= maxCount;
}

// ============================================================
// AUDIT LOGGING
// ============================================================

export async function logAudit(
  supabase: SupabaseClient,
  userId: string,
  action: string,
  details: unknown,
  req?: ApiRequest
): Promise<void> {
  try {
    const ipAddress = req ? getRequestIp(req) : 'unknown';

    await supabase.from('audit_log').insert({
      user_id: userId,
      action,
      details: JSON.stringify(details ?? {}),
      ip_address: ipAddress,
      user_agent: req?.headers?.['user-agent'] || 'unknown',
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Failed to log action:', message);
  }
}

export function buildLogAction(supabase: SupabaseClient) {
  return async (userId: string, action: string, details: any, req?: ApiRequest): Promise<void> =>
    logAudit(supabase, userId, action, details, req);
}

// ============================================================
// SESSION VALIDATION
// ============================================================

export async function validateSupabaseSession(
  supabase: SupabaseClient,
  authToken: string,
  expectedUserId?: string
): Promise<{ valid: boolean; error?: string; user?: any }> {
  try {
    if (!authToken || typeof authToken !== 'string') {
      return { valid: false, error: 'Invalid token format' };
    }

    const { data: { user } = {}, error: authError } = await supabase.auth.getUser(authToken);

    if (authError || !user) {
      return { valid: false, error: 'Invalid session' };
    }

    if (expectedUserId && user.id !== expectedUserId) {
      return { valid: false, error: 'User mismatch' };
    }

    return { valid: true, user };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Session validation error:', message);
    return { valid: false, error: 'Validation failed' };
  }
}

export async function validateSessionAndFetchPlayerStats(
  supabase: SupabaseClient,
  authToken: string,
  expectedUserId: string,
  { select = 'user_id' }: SessionValidateOptions = {}
): Promise<{ valid: boolean; error?: string; user?: any; stats?: any }> {
  const session = await validateSupabaseSession(supabase, authToken, expectedUserId);
  if (!session.valid) return session;

  try {
    const { data: stats, error: statsError } = await supabase
      .from('player_stats')
      .select(select)
      .eq('user_id', expectedUserId)
      .single();

    if (statsError || !stats) {
      return { valid: false, error: 'User not found' };
    }

    return { valid: true, user: session.user, stats };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Stats validation error:', message);
    return { valid: false, error: 'Validation failed' };
  }
}

export function getIdentifier(req: ApiRequest, userId?: string): string {
  return userId || getRequestIp(req);
}

// ============================================================
// 🛡️ CSRF PROTECTION
// ============================================================

/**
 * Gera um token CSRF único e seguro e armazena no Supabase
 */
export async function generateCsrfToken(supabase: SupabaseClient, userId: string): Promise<string | null> {
  try {
    // Tentar reusar token existente se ainda válido
    const { data: existing, error: fetchErr } = await supabase
      .from('player_stats')
      .select('csrf_token, csrf_token_expires_at')
      .eq('user_id', userId)
      .single();

    if (fetchErr) {
      console.warn('[CSRF] Não foi possível ler token atual, gerando novo:', fetchErr.message);
    }

    if (existing?.csrf_token && existing?.csrf_token_expires_at) {
      const expiresAtDate = new Date(existing.csrf_token_expires_at);
      if (expiresAtDate > new Date()) {
        // Token ainda válido, reusar
        return existing.csrf_token;
      }
    }

    // Gera token aleatório de 32 bytes (256 bits)
    const token = crypto.randomBytes(32).toString('base64url');
    
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (24 * 60 * 60 * 1000)); // 24 horas
    
    // Armazena no Supabase
    const { error } = await supabase
      .from('player_stats')
      .update({
        csrf_token: token,
        csrf_token_created_at: now.toISOString(),
        csrf_token_expires_at: expiresAt.toISOString()
      })
      .eq('user_id', userId);
    
    if (error) {
      console.error('[CSRF] Erro ao salvar token no Supabase:', error);
      return null;
    }
    
    return token;
  } catch (err) {
    console.error('[CSRF] Erro ao gerar token CSRF:', err);
    return null;
  }
}


/**
 * Valida se o token CSRF enviado é válido para o usuário com validação rigorosa
 * Busca o token do Supabase
 * 
 * @param supabase - Cliente Supabase
 * @param userId - ID do usuário
 * @param token - Token CSRF enviado
 * @returns true se válido
 */
export async function validateCsrfToken(supabase: SupabaseClient, userId: string, token: string | undefined): Promise<boolean> {
  try {
    // Validação de parâmetros
    if (!userId || typeof userId !== 'string') {
      console.error('[CSRF] UserId inválido ou ausente');
      return false;
    }
    
    if (!token || typeof token !== 'string') {
      console.error(`[CSRF] ❌ Token ausente ou inválido para user ${maskUserId(userId)}`);
      return false;
    }
    
    // Validação de tamanho mínimo do token (tokens base64url de 32 bytes = ~43 chars)
    if (token.length < 32) {
      console.error(`[CSRF] ❌ Token muito curto (${token.length} chars) para user ${maskUserId(userId)}`);
      return false;
    }
    
    // Validação de formato do token (base64url: A-Za-z0-9_-)
    if (!/^[A-Za-z0-9_-]+$/.test(token)) {
      console.error(`[CSRF] ❌ Token com formato inválido para user ${maskUserId(userId)}`);
      return false;
    }
    
    // Buscar token do Supabase
    const { data: stats, error } = await supabase
      .from('player_stats')
      .select('csrf_token, csrf_token_expires_at')
      .eq('user_id', userId)
      .single();
    
    if (error || !stats) {
      console.warn(`[CSRF] ⚠️ Usuário não encontrado para user ${maskUserId(userId)}`);
      return false;
    }
    
    if (!stats.csrf_token) {
      console.warn(`[CSRF] ⚠️ Token não encontrado no banco para user ${maskUserId(userId)}`);
      return false;
    }
    
    // Verifica se o token expirou
    if (stats.csrf_token_expires_at && new Date(stats.csrf_token_expires_at) < new Date()) {
      console.warn(`[CSRF] ⏰ Token expirado para user ${maskUserId(userId)}`);
      return false;
    }
    
    // Validação de tamanho para timing-safe comparison
    if (token.length !== stats.csrf_token.length) {
      console.error(`[CSRF] ❌ Token com tamanho incorreto para user ${maskUserId(userId)}`);
      return false;
    }
    
    // Compara tokens usando timing-safe comparison para evitar timing attacks
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(stats.csrf_token)
      );
      
      if (isValid) {
        console.log(`[CSRF] ✅ Token válido para user ${maskUserId(userId)}`);
      } else {
        console.error(`[CSRF] ❌ Token inválido (não corresponde) para user ${maskUserId(userId)}`);
        // Incrementar csrf_violations
        await incrementCsrfViolations(supabase, userId);
      }
      
      return isValid;
    } catch (err) {
      console.error(`[CSRF] ❌ Erro ao comparar tokens para user ${maskUserId(userId)}:`, err);
      await incrementCsrfViolations(supabase, userId);
      return false;
    }
  } catch (err) {
    console.error('[CSRF] Erro ao validar token:', err);
    return false;
  }
}

/**
 * Remove o token CSRF de um usuário (útil no logout)
 */
export async function clearCsrfToken(supabase: SupabaseClient, userId: string): Promise<void> {
  try {
    await supabase
      .from('player_stats')
      .update({
        csrf_token: null,
        csrf_token_created_at: null,
        csrf_token_expires_at: null
      })
      .eq('user_id', userId);
  } catch (err) {
    console.error('[CSRF] Erro ao limpar token:', err);
  }
}

/**
 * Incrementa o contador de violações de CSRF e bloqueia temporariamente se necessário
 */
async function incrementCsrfViolations(supabase: SupabaseClient, userId: string): Promise<void> {
  try {
    const { data: stats, error: fetchError } = await supabase
      .from('player_stats')
      .select('csrf_violations')
      .eq('user_id', userId)
      .single();
    
    if (fetchError || !stats) return;
    
    const newViolations = (stats.csrf_violations || 0) + 1;
    const blockedUntil = newViolations > 5 
      ? new Date(Date.now() + (15 * 60 * 1000)).toISOString() // Bloquear por 15 minutos
      : null;
    
    await supabase
      .from('player_stats')
      .update({
        csrf_violations: newViolations,
        csrf_blocked_until: blockedUntil
      })
      .eq('user_id', userId);
    
    if (newViolations > 5) {
      console.warn(`[CSRF] 🚫 Usuário bloqueado por excesso de violações CSRF: ${maskUserId(userId)}`);
    }
  } catch (err) {
    console.error('[CSRF] Erro ao incrementar violações:', err);
  }
}

/**
 * Verifica se a requisição deve ter proteção CSRF
 * Webhooks e requisições GET/OPTIONS não precisam
 */
export function requiresCsrfProtection(req: ApiRequest, path?: string): boolean {
  // GET e OPTIONS não precisam de CSRF
  const method = req.method?.toUpperCase();
  if (method === 'GET' || method === 'OPTIONS') {
    return false;
  }
  
  // Webhooks não precisam de CSRF (Stripe, MercadoPago, etc)
  const isWebhook = path?.includes('/webhook') || 
                    path?.includes('stripe') || 
                    path?.includes('mercadopago');
  if (isWebhook) {
    return false;
  }
  
  // Todas as outras requisições POST/PUT/DELETE precisam
  return true;
}

/**
 * Middleware para validar CSRF em requisições
 * Retorna true se válido, false se inválido
 * IMPORTANTE: Agora é assíncrono, use await
 */
export async function validateCsrfMiddleware(
  supabase: SupabaseClient,
  req: ApiRequest,
  userId: string,
  path?: string
): Promise<{ valid: boolean; error?: string }> {
  // Verifica se a requisição precisa de proteção CSRF
  if (!requiresCsrfProtection(req, path)) {
    return { valid: true };
  }
  
  // Extrai o token do header
  const csrfToken = req.headers?.['x-csrf-token'];
  const tokenString = Array.isArray(csrfToken) ? csrfToken[0] : csrfToken;
  
  // Valida o token (agora async)
  const isValid = await validateCsrfToken(supabase, userId, tokenString);
  
  if (!isValid) {
    return { 
      valid: false, 
      error: 'Invalid or missing CSRF token' 
    };
  }
  
  return { valid: true };
}

// ============================================================
// TRANSACTION LOGGING
// ============================================================

export async function registerMoneyTransaction(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  balanceAfter: number
): Promise<void> {
  try {
    if (!userId || typeof userId !== 'string') {
      console.error('⚠️ Invalid userId for transaction:', userId ? maskUserId(userId) : 'undefined');
      return;
    }

    if (typeof amount !== 'number' || isNaN(amount)) {
      console.error('⚠️ Invalid amount for transaction:', amount);
      return;
    }

    if (!reason || typeof reason !== 'string') {
      console.error('⚠️ Invalid reason for transaction:', reason);
      return;
    }

    if (typeof balanceAfter !== 'number' || isNaN(balanceAfter)) {
      console.error('⚠️ Invalid balanceAfter for transaction:', balanceAfter);
      return;
    }

    const { error } = await supabase.rpc('register_transaction', {
      p_amount: parseFloat(amount.toFixed(2)),
      p_reason: reason,
      p_user_balances: [
        {
          user_id: userId,
          balance_after: parseFloat(balanceAfter.toFixed(2)),
        },
      ],
    });

    if (error) {
      console.error('⚠️ Transaction logging error:', error.message);
      return;
    }

    console.log(
      `✅ Transaction registered: ${reason} (${amount > 0 ? '+' : ''}${amount}) for user ${userId.slice(0, 8)}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('⚠️ Unexpected error registering transaction:', message);
  }
}

export function logMoneyTransactionAsync(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  balanceAfter: number
): void {
  registerMoneyTransaction(supabase, userId, amount, reason, balanceAfter).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Async transaction logging failed:', message);
  });
}

// ============================================================
// 🔐 ADVANCED SECURITY: INPUT VALIDATION WITH ZOD SCHEMAS
// ============================================================

// Schemas simples para validação com fallback se Zod não disponível
export interface ValidationSchema {
  validate: (data: unknown) => { success: boolean; data?: any; error?: string };
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
const referralCodeRegex = /^[A-Z0-9]{6,}$/;

export const ValidationSchemas = {
  email: {
    validate: (data: unknown) => {
      if (typeof data !== 'string') return { success: false, error: 'Email must be string' };
      if (!emailRegex.test(data)) return { success: false, error: 'Invalid email format' };
      if (data.length > 254) return { success: false, error: 'Email too long' };
      return { success: true, data };
    }
  },

  username: {
    validate: (data: unknown) => {
      if (typeof data !== 'string') return { success: false, error: 'Username must be string' };
      if (!usernameRegex.test(data)) return { success: false, error: 'Username must be 3-20 alphanumeric' };
      return { success: true, data };
    }
  },

  diamonds: {
    validate: (data: unknown) => {
      if (typeof data !== 'number') return { success: false, error: 'Diamonds must be number' };
      if (!Number.isInteger(data)) return { success: false, error: 'Diamonds must be integer' };
      if (data < 0) return { success: false, error: 'Diamonds cannot be negative' };
      if (data > 1_000_000_000) return { success: false, error: 'Diamonds amount too large' };
      return { success: true, data };
    }
  },

  amount: {
    validate: (data: unknown) => {
      if (typeof data !== 'number') return { success: false, error: 'Amount must be number' };
      if (data <= 0) return { success: false, error: 'Amount must be positive' };
      if (data > 100_000) return { success: false, error: 'Amount too large' };
      return { success: true, data };
    }
  },

  currency: {
    validate: (data: unknown) => {
      const valid = ['USD', 'BRL', 'EUR'];
      if (!valid.includes(String(data))) return { success: false, error: 'Invalid currency' };
      return { success: true, data };
    }
  },

  referralCode: {
    validate: (data: unknown) => {
      if (typeof data !== 'string') return { success: false, error: 'Referral code must be string' };
      if (!referralCodeRegex.test(data)) return { success: false, error: 'Invalid referral code format' };
      return { success: true, data };
    }
  }
};

// ============================================================
//  DATA PROTECTION & MASKING
// ============================================================

export function maskEmail(email: string): string {
  if (typeof email !== 'string' || !email.includes('@')) return 'invalid';
  const [local, domain] = email.split('@');
  const masked = local.substring(0, 1) + '*'.repeat(local.length - 2) + local.substring(local.length - 1);
  return `${masked}@${domain}`;
}

export function maskUserId(userId: string): string {
  if (typeof userId !== 'string') return 'unknown';
  return userId.substring(0, 8) + '****';
}

export function maskIp(ip: string): string {
  if (typeof ip !== 'string') return 'unknown';
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.***.***`;
  }
  // IPv6 ou outro formato
  return ip.substring(0, 8) + '***';
}

export function maskToken(token: string): string {
  if (typeof token !== 'string') return '[TOKEN]';
  return token.substring(0, 10) + '...[REDACTED]';
}

// Estruturado logging com mascaramento automático
export interface SecureLogContext {
  action: string;
  userId?: string;
  email?: string;
  ip?: string;
  statusCode?: number;
  details?: Record<string, any>;
  isSecurityEvent?: boolean;
}

export function createSecureLog(context: SecureLogContext): Record<string, any> {
  const log: Record<string, any> = {
    timestamp: new Date().toISOString(),
    action: context.action,
    isSecurityEvent: context.isSecurityEvent ?? false
  };

  if (context.userId) log.userId = maskUserId(context.userId);
  if (context.email) log.email = maskEmail(context.email);
  if (context.ip) log.ip = context.ip;
  if (context.statusCode) log.statusCode = context.statusCode;

  // Nunca logar tokens, senhas ou dados sensíveis crus
  if (context.details) {
    const safeDetails = { ...context.details };
    delete safeDetails.authToken;
    delete safeDetails.token;
    delete safeDetails.password;
    delete safeDetails.creditCard;
    delete safeDetails.cvv;
    log.details = safeDetails;
  }

  return log;
}

// ============================================================
// 💳 WEBHOOK SIGNATURE VERIFICATION
// ============================================================

export function verifyStripeSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  webhookSecret: string
): boolean {
  if (!signature || !webhookSecret) return false;

  try {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', webhookSecret);
    hmac.update(rawBody, 'utf8');
    const computed = hmac.digest('hex');
    
    // Comparação de tempo constante para evitar timing attacks
    return timingSafeEqual(computed, signature.split(', ')[0].split('=')[1]);
  } catch (err) {
    console.error('Stripe signature verification failed:', err);
    return false;
  }
}

export function verifyMercadoPagoSignature(
  body: any,
  xSignature: string | undefined,
  webhookSecret: string
): boolean {
  if (!xSignature || !webhookSecret) return false;

  try {
    const crypto = require('crypto');
    const data = `id=${body.id}&topic=${body.topic}`;
    const hash = crypto
      .createHmac('sha256', webhookSecret)
      .update(data)
      .digest('hex');
    
    return timingSafeEqual(hash, xSignature.split(',')[1].split('=')[1]);
  } catch (err) {
    console.error('MercadoPago signature verification failed:', err);
    return false;
  }
}

// Comparação de tempo constante para evitar timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  try {
    const crypto = require('crypto');
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// ============================================================
//  GENERIC USERNAME VALIDATION
// ============================================================

export function normalizeUsername(raw: string): string {
  if (!raw) return '';
  return raw.trim();
}

export function isValidUsername(username: string): boolean {
  // 3-16 chars, letters/numbers/._- only (no spaces), must start with letter/number
  return typeof username === 'string'
    && username.length >= 3
    && username.length <= 16
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,15}$/.test(username);
}

export async function usernameExists(
  supabase: SupabaseClient,
  username: string,
  excludeUserId: string
): Promise<boolean> {
  const sanitized = sanitizeSqlInput(username, 256);
  if (!sanitized) {
    throw new Error('Invalid username format');
  }

  const { data, error } = await supabase
    .from('player_stats')
    .select('user_id')
    .ilike('username', sanitized)
    .neq('user_id', excludeUserId)
    .limit(1);

  if (error) {
    throw new Error('Username lookup failed');
  }

  return Array.isArray(data) && data.length > 0;
}

// ============================================================
// 💎 GENERIC DIAMOND/BALANCE UPDATES
// ============================================================

export async function updatePlayerDiamonds(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  isAdmin: boolean = false,
  req?: ApiRequest
): Promise<number> {
  try {
    // Validar entrada
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId');
    }

    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new Error('Invalid amount');
    }

    // Buscar saldo atual COM LOCK
    const { data: currentStats, error: fetchError } = await supabase
      .from('player_stats')
      .select('diamonds, user_id')
      .eq('user_id', userId)
      .single();

    if (fetchError || !currentStats) {
      throw new Error('Failed to fetch player stats');
    }

    const currentDiamonds = currentStats.diamonds || 0;
    const newDiamonds = currentDiamonds + amount;

    if (newDiamonds < 0) {
      throw new Error('Insufficient diamonds');
    }

    // Atualizar com verificação de integridade
    const { data: updateResult, error: updateError } = await supabase
      .from('player_stats')
      .update({
        diamonds: newDiamonds,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('diamonds', currentDiamonds) // Lock otimista
      .select('diamonds, user_id');

    if (updateError) {
      throw new Error('Failed to update diamonds');
    }

    if (!updateResult || updateResult.length === 0) {
      throw new Error('Concurrent modification detected');
    }

    const finalDiamonds = updateResult[0].diamonds;

    // Registrar transação (não bloqueante)
    Promise.all([
      supabase.from('diamond_transactions').insert({
        user_id: userId,
        amount: amount,
        reason: reason,
        balance_after: finalDiamonds,
        created_at: new Date().toISOString(),
        is_admin: isAdmin
      }),
      req ? logAudit(supabase, userId, 'DIAMONDS_UPDATED', { amount, reason, newBalance: finalDiamonds }, req) : Promise.resolve()
    ]).catch(err => {
      console.error('⚠️ Transaction logging error:', err);
    });

    return finalDiamonds;
  } catch (error) {
    const err = error as Error;
    console.error('💥 updatePlayerDiamonds error:', err.message);
    throw err;
  }
}

// ============================================================
// 💰 GENERIC MONEY BALANCE UPDATES (RPC)
// ============================================================

interface UpdateBalanceOptions {
  casesOpened?: number;
  req?: ApiRequest | null;
  referralCallback?: () => Promise<void>;
}

export async function updatePlayerBalance(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  { casesOpened = 0, req = null, referralCallback }: UpdateBalanceOptions = {}
): Promise<number> {
  try {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId');
    }

    if (typeof amount !== 'number' || isNaN(amount)) {
      throw new Error('Invalid amount');
    }

    const { data: rpcResult, error: updateError } = await supabase.rpc('update_player_money', {
      p_user_id: userId,
      p_money_change: amount,
      p_cases_opened: casesOpened,
    });

    if (updateError) {
      if (updateError.message?.includes('Insufficient funds')) {
        throw new Error('Insufficient funds');
      }
      if (updateError.code === '23514' || updateError.message?.includes('constraint')) {
        throw new Error('Balance changed. Please try again.');
      }
      throw new Error('Failed to update balance');
    }

    if (!rpcResult || (Array.isArray(rpcResult) && rpcResult.length === 0)) {
      throw new Error('RPC returned no data');
    }

    // rpcResult can be array or object; handle array of objects with new_money
    const first = Array.isArray(rpcResult) ? rpcResult[0] : (rpcResult as any);
    const newBalance = first?.new_money ?? first?.new_money_after ?? first?.new_balance;

    if (typeof newBalance !== 'number') {
      throw new Error('Invalid RPC response');
    }

    // Registrar transação (non-blocking)
    logMoneyTransactionAsync(supabase, userId, amount, reason, newBalance);

    // Registrar auditoria
    if (req) {
      logAudit(supabase, userId, 'BALANCE_UPDATED', { amount, reason, newBalance }, req).catch(() => {});
    }

    // Callback opcional (ex: comissão de referral)
    if (referralCallback && amount > 0) {
      await referralCallback();
    }

    return newBalance;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('💥 updatePlayerBalance error:', message);
    throw error;
  }
}

// ============================================================
// 🛡️ XSS PROTECTION - SANITIZAÇÃO E VALIDAÇÃO
// ============================================================

/**
 * Lista de tags HTML perigosas que devem ser bloqueadas
 */
const DANGEROUS_TAGS = [
  'script', 'iframe', 'object', 'embed', 'applet',
  'link', 'style', 'meta', 'base', 'form',
  'input', 'button', 'select', 'textarea', 'img',
  'audio', 'video', 'source', 'track'
];

/**
 * Padrões perigosos que indicam tentativa de XSS
 */
const DANGEROUS_PATTERNS = [
  /javascript:/gi,
  /data:text\/html/gi,
  /vbscript:/gi,
  /on\w+\s*=/gi,  // event handlers (onclick, onerror, etc)
  /<\s*script/gi,
  /<\s*iframe/gi,
  /eval\s*\(/gi,
  /expression\s*\(/gi,
  /import\s*\(/gi,
  /document\./gi,
  /window\./gi,
  /alert\s*\(/gi,
  /prompt\s*\(/gi,
  /confirm\s*\(/gi
];

/**
 * Escapa caracteres HTML especiais para prevenir XSS
 * @param text - Texto a ser escapado
 * @returns Texto com caracteres HTML escapados
 */
export function escapeHtmlEntities(text: string): string {
  if (typeof text !== 'string') return '';
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Verifica se o texto contém conteúdo perigoso (scripts, iframes, etc)
 * @param text - Texto a ser verificado
 * @returns true se contém conteúdo perigoso
 */
export function containsDangerousContent(text: string): boolean {
  if (typeof text !== 'string') return false;
  
  const lowerText = text.toLowerCase();
  
  // Verifica tags perigosas
  for (const tag of DANGEROUS_TAGS) {
    if (lowerText.includes(`<${tag}`) || lowerText.includes(`</${tag}`)) {
      return true;
    }
  }
  
  // Verifica padrões perigosos
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Sanitiza texto para prevenir ataques XSS
 * Remove/escapa tags HTML, scripts e conteúdo perigoso
 * @param text - Texto a ser sanitizado
 * @returns Texto sanitizado e seguro
 */
export function sanitizeHtml(text: string): string {
  if (typeof text !== 'string') return '';
  
  // 1. Trim e validação básica
  let sanitized = text.trim();
  
  if (sanitized.length === 0) return '';
  
  // 2. Remover null bytes
  sanitized = sanitized.replace(/\0/g, '');
  
  // 3. Verificar conteúdo perigoso ANTES de escapar
  // (para registrar tentativas de ataque)
  if (containsDangerousContent(sanitized)) {
    console.warn('⚠️ XSS attempt detected and blocked:', {
      originalLength: text.length,
      preview: text.substring(0, 50)
    });
  }
  
  // 4. Remover todas as tags HTML
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  
  // 5. Escapar caracteres especiais
  sanitized = escapeHtmlEntities(sanitized);
  
  // 6. Remover sequências de controle perigosas
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // 7. Limitar caracteres Unicode perigosos (emoji bombs, etc)
  // Permitir emojis comuns mas remover variações seletor
  sanitized = sanitized.replace(/[\uFE00-\uFE0F\u200D]/g, '');
  
  return sanitized;
}

/**
 * Sanitiza username (alfanumérico + alguns caracteres especiais)
 * @param username - Username a sanitizar
 * @returns Username sanitizado
 */
export function sanitizeUsername(username: string): string {
  if (typeof username !== 'string') return '';
  
  // Remove espaços, permite apenas: a-z, A-Z, 0-9, _, -, .
  let sanitized = username.trim().replace(/[^a-zA-Z0-9_\-\.]/g, '');
  
  // Limitar tamanho
  if (sanitized.length > 16) sanitized = sanitized.substring(0, 16);
  
  return sanitized;
}

/**
 * Sanitiza bio/descrição (remove HTML, limita tamanho)
 * @param bio - Texto da bio
 * @returns Bio sanitizada
 */
export function sanitizeBio(bio: string): string {
  if (typeof bio !== 'string') return '';
  
  // Usar sanitizeHtml base
  let sanitized = sanitizeHtml(bio);
  
  // Limitar tamanho (500 caracteres)
  if (sanitized.length > 500) sanitized = sanitized.substring(0, 500);
  
  return sanitized;
}

/**
 * Sanitiza texto genérico (product name, reason, etc.)
 * @param text - Texto a sanitizar
 * @param maxLength - Tamanho máximo (padrão: 200)
 * @returns Texto sanitizado
 */
export function sanitizeText(text: string, maxLength: number = 200): string {
  if (typeof text !== 'string') return '';
  
  // Usar sanitizeHtml base
  let sanitized = sanitizeHtml(text);
  
  // Limitar tamanho
  if (sanitized.length > maxLength) sanitized = sanitized.substring(0, maxLength);
  
  return sanitized;
}

// ============================================================
// 🔑 IDEMPOTENCY KEYS - PROTEÇÃO CONTRA REQUISIÇÕES DUPLICADAS
// ============================================================

export interface IdempotencyKeyEntry {
  idempotency_key: string;
  user_id: string;
  action: string;
  status: 'processing' | 'completed' | 'failed';
  result?: any;
  request_data?: any;
  response_code?: number;
  created_at?: string;
  completed_at?: string;
  expires_at?: string;
}

export interface IdempotencyCheckResult {
  exists: boolean;
  status?: 'processing' | 'completed' | 'failed';
  result?: any;
  response_code?: number;
  shouldWait?: boolean;
}

/**
 * Verifica se uma chave de idempotência já foi processada
 * @param supabase - Cliente Supabase
 * @param idempotencyKey - Chave única gerada pelo frontend
 * @param userId - ID do usuário (para validação)
 * @returns Objeto com informações sobre a key
 */
export async function checkIdempotencyKey(
  supabase: SupabaseClient,
  idempotencyKey: string,
  userId: string
): Promise<IdempotencyCheckResult> {
  try {
    if (!idempotencyKey || !userId) {
      return { exists: false };
    }

    const { data, error } = await supabase
      .from('idempotency_keys')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Não encontrado - key não existe
        return { exists: false };
      }
      console.error('Error checking idempotency key:', error);
      return { exists: false };
    }

    if (!data) {
      return { exists: false };
    }

    // Verificar se o userId bate (segurança)
    if (data.user_id !== userId) {
      console.warn('⚠️ Idempotency key user mismatch:', {
        key: idempotencyKey,
        expectedUser: userId,
        actualUser: data.user_id
      });
      return { exists: false };
    }

    // Key existe - retornar informações
    return {
      exists: true,
      status: data.status,
      result: data.result,
      response_code: data.response_code,
      shouldWait: data.status === 'processing'
    };

  } catch (err) {
    console.error('checkIdempotencyKey error:', err);
    return { exists: false };
  }
}

/**
 * Salva uma chave de idempotência com status inicial (processing)
 * @param supabase - Cliente Supabase
 * @param entry - Dados da chave de idempotência
 * @returns true se salvou com sucesso
 */
export async function saveIdempotencyKey(
  supabase: SupabaseClient,
  entry: IdempotencyKeyEntry
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('idempotency_keys')
      .insert({
        idempotency_key: entry.idempotency_key,
        user_id: entry.user_id,
        action: entry.action,
        status: entry.status || 'processing',
        result: entry.result || null,
        request_data: entry.request_data || null,
        response_code: entry.response_code || null
      });

    if (error) {
      // Erro de duplicata é esperado (race condition)
      if (error.code === '23505') {
        console.log('⚠️ Idempotency key already exists (race condition):', entry.idempotency_key);
        return false;
      }
      console.error('Error saving idempotency key:', error);
      return false;
    }

    return true;

  } catch (err) {
    console.error('saveIdempotencyKey error:', err);
    return false;
  }
}

/**
 * Atualiza uma chave de idempotência com resultado final
 * @param supabase - Cliente Supabase
 * @param idempotencyKey - Chave única
 * @param status - Status final (completed ou failed)
 * @param result - Resultado da operação
 * @param responseCode - Código HTTP da resposta
 * @returns true se atualizou com sucesso
 */
export async function updateIdempotencyKey(
  supabase: SupabaseClient,
  idempotencyKey: string,
  status: 'completed' | 'failed',
  result: any,
  responseCode: number
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('idempotency_keys')
      .update({
        status,
        result,
        response_code: responseCode,
        completed_at: new Date().toISOString()
      })
      .eq('idempotency_key', idempotencyKey);

    if (error) {
      console.error('Error updating idempotency key:', error);
      return false;
    }

    return true;

  } catch (err) {
    console.error('updateIdempotencyKey error:', err);
    return false;
  }
}

/**
 * Remove chaves de idempotência expiradas (>24h)
 * @param supabase - Cliente Supabase
 * @returns Número de keys removidas
 */
export async function cleanupOldIdempotencyKeys(
  supabase: SupabaseClient
): Promise<number> {
  try {
    const { data, error } = await supabase
      .rpc('cleanup_expired_idempotency_keys');

    if (error) {
      console.error('Error cleaning up idempotency keys:', error);
      return 0;
    }

    return data || 0;

  } catch (err) {
    console.error('cleanupOldIdempotencyKeys error:', err);
    return 0;
  }
}

// ============================================================
// 🚫 IP BLOCKING - BLOQUEIO AUTOMÁTICO DE IPs SUSPEITOS
// ============================================================

export interface BlockedIpEntry {
  ip_address: string;
  reason: string;
  details?: any;
  block_type: 'manual' | 'automatic' | 'temporary';
  blocked_by?: string;
  suspicious_attempts?: number;
  expires_at?: string;
}

export interface IpBlockCheckResult {
  blocked: boolean;
  reason?: string;
  expires_at?: string;
  block_type?: string;
}

/**
 * Verifica se um IP está bloqueado
 * @param supabase - Cliente Supabase
 * @param ipAddress - Endereço IP a verificar
 * @returns Resultado com informações do bloqueio
 */
export async function checkIpBlocked(
  supabase: SupabaseClient,
  ipAddress: string
): Promise<IpBlockCheckResult> {
  try {
    if (!ipAddress || ipAddress === 'unknown') {
      return { blocked: false };
    }

    // Cleanup de bloqueios temporários expirados
    await supabase.rpc('cleanup_expired_ip_blocks');

    const { data, error } = await supabase
      .from('blocked_ips')
      .select('*')
      .eq('ip_address', ipAddress)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Não encontrado - IP não está bloqueado
        return { blocked: false };
      }
      console.error('Error checking IP block:', error);
      return { blocked: false };
    }

    if (!data) {
      return { blocked: false };
    }

    // Verificar se bloqueio temporário expirou
    if (data.expires_at) {
      const expiresAt = new Date(data.expires_at);
      if (expiresAt < new Date()) {
        return { blocked: false };
      }
    }

    return {
      blocked: true,
      reason: data.reason,
      expires_at: data.expires_at,
      block_type: data.block_type
    };

  } catch (err) {
    console.error('checkIpBlocked error:', err);
    return { blocked: false };
  }
}

// ============================================================
// 🌍 IP GEOLOCATION CHECKING
// ============================================================

interface GeolocationResult {
  country: string | null;
  city: string | null;
  region: string | null;
  isBlocked: boolean;
  reason?: string;
}

interface IpApiResponse {
  country_code?: string;
  country_name?: string;
  city?: string;
  region?: string;
}

// Lista de países bloqueados (exemplo: pode ser configurável)
const BLOCKED_COUNTRIES = new Set<string>([
  // Adicionar códigos ISO se necessário, ex: 'KP', 'IR', 'SY'
]);

/**
 * Verifica geolocalização de um IP usando API gratuita com cache no banco
 * @param ip - Endereço IP a verificar
 * @param supabase - Cliente Supabase para cache
 * @returns Informações de geolocalização
 */
export async function checkIpGeolocation(
  ip: string, 
  supabase?: SupabaseClient
): Promise<GeolocationResult> {
  try {
    // Se temos supabase, verificar cache primeiro (24h)
    if (supabase) {
      const cacheExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: cached } = await supabase
        .from('ip_geolocation_cache')
        .select('*')
        .eq('ip_address', ip)
        .gt('created_at', cacheExpiry)
        .single();

      if (cached) {
        return {
          country: cached.country,
          city: cached.city,
          region: cached.region,
          isBlocked: cached.is_blocked,
          reason: cached.block_reason
        };
      }
    }

    // Fazer requisição à API externa
    const response = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: {
        'User-Agent': 'LootSkirmish/1.0'
      }
    });

    if (!response.ok) {
      console.warn('Geolocation API failed:', response.status);
      return {
        country: null,
        city: null,
        region: null,
        isBlocked: false
      };
    }

    const data = await response.json() as IpApiResponse;
    
    // Verificar se país está bloqueado
    const isBlocked = BLOCKED_COUNTRIES.has(data.country_code || '');
    
    const result: GeolocationResult = {
      country: data.country_name || null,
      city: data.city || null,
      region: data.region || null,
      isBlocked,
      reason: isBlocked ? `Country ${data.country_name || 'Unknown'} is blocked` : undefined
    };

    // Salvar no cache se temos supabase
    if (supabase) {
      await supabase
        .from('ip_geolocation_cache')
        .upsert({
          ip_address: ip,
          country: result.country,
          city: result.city,
          region: result.region,
          is_blocked: result.isBlocked,
          block_reason: result.reason || null,
          created_at: new Date().toISOString()
        }, {
          onConflict: 'ip_address'
        })
        .select()
        .single();
    }

    return result;
  } catch (error) {
    console.error('Geolocation check failed:', error);
    return {
      country: null,
      city: null,
      region: null,
      isBlocked: false
    };
  }
}

/**
 * Bloqueia um IP
 * @param supabase - Cliente Supabase
 * @param entry - Dados do bloqueio
 * @returns true se bloqueou com sucesso
 */
export async function blockIp(
  supabase: SupabaseClient,
  entry: BlockedIpEntry
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('blocked_ips')
      .insert({
        ip_address: entry.ip_address,
        reason: entry.reason,
        details: entry.details || null,
        block_type: entry.block_type,
        blocked_by: entry.blocked_by || null,
        suspicious_attempts: entry.suspicious_attempts || 0,
        expires_at: entry.expires_at || null
      });

    if (error) {
      // Se já existe, atualizar
      if (error.code === '23505') {
        const { error: updateError } = await supabase
          .from('blocked_ips')
          .update({
            is_active: true,
            reason: entry.reason,
            details: entry.details,
            block_type: entry.block_type,
            blocked_at: new Date().toISOString(),
            expires_at: entry.expires_at || null
          })
          .eq('ip_address', entry.ip_address);

        if (updateError) {
          console.error('Error updating IP block:', updateError);
          return false;
        }

        return true;
      }

      console.error('Error blocking IP:', error);
      return false;
    }

    console.log('✅ IP blocked:', entry.ip_address, '-', entry.reason);
    return true;

  } catch (err) {
    console.error('blockIp error:', err);
    return false;
  }
}

/**
 * Desbloqueia um IP
 * @param supabase - Cliente Supabase
 * @param ipAddress - IP a desbloquear
 * @param unblockedBy - Admin que desbloqueou
 * @returns true se desbloqueou com sucesso
 */
export async function unblockIp(
  supabase: SupabaseClient,
  ipAddress: string,
  unblockedBy?: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('blocked_ips')
      .update({
        is_active: false,
        unblocked_at: new Date().toISOString()
      })
      .eq('ip_address', ipAddress);

    if (error) {
      console.error('Error unblocking IP:', error);
      return false;
    }

    console.log('✅ IP unblocked:', ipAddress, unblockedBy ? `by ${unblockedBy}` : '');
    return true;

  } catch (err) {
    console.error('unblockIp error:', err);
    return false;
  }
}

/**
 * Middleware para checar se IP está bloqueado
 * @param supabase - Cliente Supabase
 * @param req - Request
 * @returns Resultado da verificação
 */
export async function ipBlockMiddleware(
  supabase: SupabaseClient,
  req: ApiRequest
): Promise<IpBlockCheckResult> {
  const ipAddress = getIpAddress(req);
  return await checkIpBlocked(supabase, ipAddress);
}

/**
 * Extrai endereço IP da requisição
 * @param req - Request
 * @returns Endereço IP
 */
export function getIpAddress(req: ApiRequest): string {
  // Tentar X-Forwarded-For primeiro (proxies, CDNs)
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
    return ip;
  }

  // Fallback para remoteAddress
  return req.connection?.remoteAddress || 'unknown';
}

// ============================================================
// 🛡️ MIDDLEWARE HELPER - SIMPLIFICA VALIDAÇÃO COMPLETA
// ============================================================

export interface SecurityMiddlewareOptions {
  userId: string;
  authToken: string;
  idempotencyKey?: string;
  action: string;
  requestData?: any;
}

export interface SecurityMiddlewareResult {
  allowed: boolean;
  error?: string;
  statusCode?: number;
  cachedResult?: any;
  isIdempotencyHit?: boolean;
}

/**
 * Middleware completo que valida:
 * 1. IP bloqueado
 * 2. Idempotency key (se fornecida)
 * Retorna resultado pronto para usar
 */
export async function securityMiddleware(
  supabase: SupabaseClient,
  req: ApiRequest,
  options: SecurityMiddlewareOptions
): Promise<SecurityMiddlewareResult> {
  const { userId, idempotencyKey, action, requestData } = options;

  // 1. Verificar IP bloqueado
  const ipCheck = await ipBlockMiddleware(supabase, req);
  if (ipCheck.blocked) {
    console.warn('⚠️ Blocked IP attempted access:', getIpAddress(req), 'action:', action);
    return {
      allowed: false,
      error: ipCheck.block_type === 'temporary' ? 'Temporarily blocked' : 'Access denied',
      statusCode: 403
    };
  }

  // 2. Verificar Idempotency Key
  if (idempotencyKey) {
    const idempotencyCheck = await checkIdempotencyKey(supabase, idempotencyKey, userId);

    if (idempotencyCheck.exists) {
      if (idempotencyCheck.status === 'processing') {
        return {
          allowed: false,
          error: 'Request is being processed',
          statusCode: 409,
          cachedResult: { status: 'processing' }
        };
      }

      if (idempotencyCheck.status === 'completed') {
        return {
          allowed: false,
          statusCode: idempotencyCheck.response_code || 200,
          cachedResult: idempotencyCheck.result,
          isIdempotencyHit: true
        };
      }

      if (idempotencyCheck.status === 'failed') {
        return {
          allowed: false,
          statusCode: idempotencyCheck.response_code || 500,
          cachedResult: idempotencyCheck.result,
          isIdempotencyHit: true
        };
      }
    }

    // Salvar key com status "processing"
    await saveIdempotencyKey(supabase, {
      idempotency_key: idempotencyKey,
      user_id: userId,
      action,
      status: 'processing',
      request_data: requestData
    });
  }

  return { allowed: true };
}

// ============================================================
// 🔐 WEBHOOK SIGNATURE VERIFICATION
// ============================================================

/**
 * Verifica assinatura HMAC-SHA256 de webhook MercadoPago
 * @param payload - Corpo do webhook (JSON string)
 * @param signature - Header x-signature do webhook
 * @param secret - Secret key do MercadoPago (process.env.MERCADOPAGO_WEBHOOK_SECRET)
 * @returns true se assinatura é válida
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string | string[] | undefined,
  secret: string
): boolean {
  if (!payload || !signature || !secret) {
    console.warn('⚠️ Missing webhook signature components');
    return false;
  }

  // Signature pode vir como string ou array
  const sig = Array.isArray(signature) ? signature[0] : signature;

  try {
    // MercadoPago usa format: "ts=<timestamp>,v1=<hmac>"
    // Extrair o HMAC v1
    const parts = sig.split(',');
    let hmacFromHeader = '';

    for (const part of parts) {
      if (part.startsWith('v1=')) {
        hmacFromHeader = part.substring(3);
        break;
      }
    }

    if (!hmacFromHeader) {
      console.warn('⚠️ No v1 signature found in header');
      return false;
    }

    // Calcular HMAC-SHA256
    const calculatedHmac = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // Usar timing-safe comparison
    const bufferCalculated = Buffer.from(calculatedHmac);
    const bufferFromHeader = Buffer.from(hmacFromHeader);

    const isValid = crypto.timingSafeEqual(bufferCalculated, bufferFromHeader);

    if (!isValid) {
      console.warn('⚠️ Webhook signature verification failed');
    }

    return isValid;

  } catch (err) {
    console.error('Webhook signature verification error:', err);
    return false;
  }
}

// ============================================================
// ⏱️ REQUEST SIGNING (ANTI-REPLAY)
// ============================================================

// Cache de nonces usados (cleanup automático após 5 minutos)
const usedNonces = new Map<string, number>();
const NONCE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Limpa nonces expirados do cache
 */
function cleanupExpiredNonces(): void {
  const now = Date.now();
  for (const [nonce, timestamp] of usedNonces.entries()) {
    if (now - timestamp > NONCE_EXPIRY_MS) {
      usedNonces.delete(nonce);
    }
  }
}

/**
 * Valida assinatura de requisição (anti-replay attack)
 * Verifica:
 * 1. Timestamp está dentro de 5 minutos
 * 2. Nonce não foi usado antes
 * 3. Assinatura está correta (HMAC-SHA256)
 * @param req - Request
 * @param secret - Secret para assinar (userId + auth token)
 * @returns { valid, error? }
 */
export function validateRequestSignature(
  req: any,
  secret: string
): { valid: boolean; error?: string } {
  try {
    const timestamp = req.headers?.['x-request-timestamp'];
    const nonce = req.headers?.['x-request-nonce'];
    const signature = req.headers?.['x-request-signature'];
    const bodyHash = req.headers?.['x-request-body-hash'];

    if (!timestamp || !nonce || !signature) {
      return { valid: false, error: 'Missing signature headers' };
    }

    // 1. Validar timestamp (dentro de 5 minutos)
    const requestTime = parseInt(timestamp as string);
    const now = Date.now();
    const timeDiff = Math.abs(now - requestTime);

    if (timeDiff > NONCE_EXPIRY_MS) {
      return { valid: false, error: 'Request timestamp expired' };
    }

    // 2. Validar nonce (não usado antes)
    if (usedNonces.has(nonce as string)) {
      console.warn('⚠️ Nonce replay detected:', nonce);
      return { valid: false, error: 'Nonce already used (replay attack)' };
    }

    // 3. Validar assinatura (INCLUINDO BODY SE FORNECIDO)
    // Formato: HMAC-SHA256(timestamp:nonce[:bodyHash])
    let messageToSign = `${timestamp}:${nonce}`;
    
    // Se bodyHash foi fornecido, incluir na assinatura
    if (bodyHash) {
      messageToSign += `:${bodyHash}`;
    }
    
    const calculatedSignature = crypto
      .createHmac('sha256', secret)
      .update(messageToSign)
      .digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(calculatedSignature),
      Buffer.from(signature as string)
    );

    if (!isValid) {
      return { valid: false, error: 'Invalid request signature' };
    }

    // 4. Adicionar nonce ao cache
    usedNonces.set(nonce as string, now);

    // Cleanup periódico (a cada 100 validações)
    if (usedNonces.size % 100 === 0) {
      cleanupExpiredNonces();
    }

    return { valid: true };

  } catch (err) {
    console.error('Request signature validation error:', err);
    return { valid: false, error: 'Signature validation failed' };
  }
}

// ============================================================
// 🔐 TWO-FACTOR AUTHENTICATION (2FA) - TOTP
// ============================================================

interface TwoFactorSecret {
  secret: string;
  qrCode: string;
}

/**
 * Gera secret TOTP para 2FA
 * Usa authenticator apps como Google Authenticator
 * @param email - Email do usuário (para label no QR code)
 * @returns { secret, qrCode }
 */
export function generateTwoFactorSecret(email: string): TwoFactorSecret {
  try {
    // Gerar secret aleatório (32 bytes = 256 bits)
    const secret = crypto
      .randomBytes(32)
      .toString('base64')
      .replace(/[^A-Z0-9]/g, '')
      .substring(0, 32);

    // Criar URL otpauth para QR code
    // Formato: otpauth://totp/issuer:email?secret=...&issuer=issuer
    const otpauthUrl = `otpauth://totp/LootSkirmish:${encodeURIComponent(
      email
    )}?secret=${secret}&issuer=LootSkirmish`;

    // Para gerar QR code, retornar a URL
    // Frontend vai usar biblioteca como qrcode.js
    // Aqui retornamos apenas a URL
    // Na prática, você usaria algo como: require('qrcode').toDataURL(otpauthUrl)
    return {
      secret,
      qrCode: otpauthUrl // Frontend vai converter para QR
    };

  } catch (err) {
    console.error('Error generating 2FA secret:', err);
    throw err;
  }
}

/**
 * Verifica código TOTP (6 dígitos)
 * @param secret - Secret TOTP armazenado
 * @param code - Código de 6 dígitos do authenticator
 * @param window - Janela de tolerância em passos de 30s (default 1)
 * @returns true se código é válido
 */
export function verifyTwoFactorCode(
  secret: string,
  code: string,
  window: number = 1
): boolean {
  try {
    if (!secret || !code || code.length !== 6 || !/^\d+$/.test(code)) {
      return false;
    }

    // Converter secret de base32 para buffer
    // Usar algoritmo HMAC-SHA1 com período de 30 segundos
    const PERIOD = 30;
    const now = Math.floor(Date.now() / 1000);

    // Testar código no time atual e janela de tolerância
    for (let i = -window; i <= window; i++) {
      const time = now + i * PERIOD;
      const timeHex = Buffer.alloc(8);
      let timeCounter = time;

      // Converter timestamp para big-endian bytes
      for (let j = 7; j >= 0; j--) {
        timeHex[j] = timeCounter & 0xff;
        timeCounter = timeCounter >> 8;
      }

      // Calcular HMAC-SHA1
      // Base32 decode
      const secretBuffer = Buffer.from(decodeBase32(secret));
      const hmac = crypto.createHmac('sha1', secretBuffer).update(timeHex).digest();

      // Extrair 4 bytes e converter para número
      const offset = hmac[hmac.length - 1] & 0x0f;
      const otp =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

      const totp = (otp % 1000000).toString().padStart(6, '0');

      if (totp === code) {
        return true;
      }
    }

    return false;

  } catch (err) {
    console.error('Error verifying 2FA code:', err);
    return false;
  }
}

/**
 * Decodifica base32 (usado por autenticadores TOTP)
 */
function decodeBase32(encoded: string): number[] {
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const result: number[] = [];

  for (let i = 0; i < encoded.length; i++) {
    const charIndex = base32Chars.indexOf(encoded[i].toUpperCase());
    if (charIndex === -1) throw new Error('Invalid base32 character');

    value = (value << 5) | charIndex;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      result.push((value >> bits) & 0xff);
    }
  }

  return result;
}

// ============================================================
// ENVIRONMENT VARIABLES VALIDATION
// ============================================================

export interface EnvironmentValidationResult {
  valid: boolean;
  missingCritical: string[];
  missingOptional: string[];
  errors: string[];
}

/**
 * Valida que todas as variáveis de ambiente críticas estão definidas
 * 
 * **Categorias:**
 * - CRITICAL: Variáveis essenciais - servidor não deve iniciar sem elas
 * - OPTIONAL: Variáveis opcionais - apenas warning no log
 * 
 * @returns {EnvironmentValidationResult} Resultado da validação
 * 
 * @example
 * ```typescript
 * const validation = validateEnvironmentVariables();
 * if (!validation.valid) {
 *   console.error('Missing critical env vars:', validation.missingCritical);
 *   process.exit(1);
 * }
 * ```
 */
export function validateEnvironmentVariables(): EnvironmentValidationResult {
  const result: EnvironmentValidationResult = {
    valid: true,
    missingCritical: [],
    missingOptional: [],
    errors: []
  };

  // ============================================================
  // CRITICAL VARIABLES (servidor não deve iniciar sem elas)
  // ============================================================
  const CRITICAL_VARS = [
    // Supabase (Database & Auth)
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_ANON_KEY',
    
    // Security Keys
    'REQUEST_SIGNING_SECRET',
    'CSRF_TOKEN_SECRET',
    'JWT_SECRET',
    
    // Payment Gateways (pelo menos um deve estar configurado)
    // Nota: Validação especial abaixo
  ];

  // ============================================================
  // OPTIONAL VARIABLES (apenas warnings)
  // ============================================================
  const OPTIONAL_VARS = [
    // Email (se não configurado, emails não serão enviados)
    'GMAIL_USER',
    'GMAIL_APP_PASSWORD',
    
    // Discord (se não configurado, notificações desabilitadas)
    'DISCORD_WEBHOOK_URL',
    
    // Feature Flags (defaults existem no código)
    'ENABLE_SHOP',
    'ENABLE_BATTLES',
    'ENABLE_CASE_OPENING',
    
    // Monitoring (opcional)
    'SENTRY_DSN',
    'GA_TRACKING_ID',
  ];

  // ============================================================
  // VALIDAR VARIÁVEIS CRÍTICAS
  // ============================================================
  for (const varName of CRITICAL_VARS) {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      result.missingCritical.push(varName);
      result.valid = false;
      result.errors.push(`❌ CRITICAL: ${varName} is not set or empty`);
    }
  }

  // ============================================================
  // VALIDAR PAYMENT GATEWAYS (pelo menos um deve estar configurado)
  // ============================================================
  const paymentGateways = {
    mercadopago: ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_PUBLIC_KEY'],
    stripe: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY'],
    nowpayments: ['NOWPAYMENTS_API_KEY']
  };

  let hasAtLeastOnePaymentGateway = false;
  for (const [gateway, vars] of Object.entries(paymentGateways)) {
    const allConfigured = vars.every(varName => {
      const value = process.env[varName];
      return value && value.trim() !== '';
    });
    
    if (allConfigured) {
      hasAtLeastOnePaymentGateway = true;
      break;
    }
  }

  if (!hasAtLeastOnePaymentGateway) {
    result.missingCritical.push('PAYMENT_GATEWAY (MercadoPago, Stripe, or NOWPayments)');
    result.valid = false;
    result.errors.push(
      '❌ CRITICAL: No payment gateway configured. Please set up at least one:\n' +
      '  - MercadoPago: MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_PUBLIC_KEY\n' +
      '  - Stripe: STRIPE_SECRET_KEY, STRIPE_PUBLIC_KEY\n' +
      '  - NOWPayments: NOWPAYMENTS_API_KEY'
    );
  }

  // ============================================================
  // VALIDAR VARIÁVEIS OPCIONAIS
  // ============================================================
  for (const varName of OPTIONAL_VARS) {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      result.missingOptional.push(varName);
    }
  }

  // ============================================================
  // VALIDAR FORMATO DE URLs
  // ============================================================
  const urlVars = ['SUPABASE_URL', 'FRONTEND_URL', 'PUBLIC_SITE_URL'];
  for (const varName of urlVars) {
    const value = process.env[varName];
    if (value) {
      try {
        new URL(value);
      } catch (err) {
        result.errors.push(`⚠️  ${varName} is not a valid URL: ${value}`);
        if (CRITICAL_VARS.includes(varName)) {
          result.valid = false;
        }
      }
    }
  }

  // ============================================================
  // VALIDAR FORMATO DE SECRETS (devem ter comprimento mínimo)
  // ============================================================
  const secretVars = ['REQUEST_SIGNING_SECRET', 'CSRF_TOKEN_SECRET', 'JWT_SECRET'];
  for (const varName of secretVars) {
    const value = process.env[varName];
    if (value && value.length < 32) {
      result.errors.push(
        `⚠️  ${varName} is too short (${value.length} chars). Recommended: 64+ characters for security.`
      );
      // Não marca como inválido, mas avisa
    }
  }

  return result;
}

/**
 * Loga o resultado da validação de variáveis de ambiente
 * 
 * @param {EnvironmentValidationResult} result - Resultado da validação
 * @param {boolean} throwOnError - Se true, lança erro em caso de validação falhar (default: true)
 */
export function logEnvironmentValidation(
  result: EnvironmentValidationResult,
  throwOnError: boolean = true
): void {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 ENVIRONMENT VARIABLES VALIDATION');
  console.log('='.repeat(60) + '\n');

  if (result.valid) {
    console.log('✅ All critical environment variables are set!\n');
  } else {
    console.error('❌ VALIDATION FAILED - Missing critical environment variables:\n');
    for (const error of result.errors) {
      console.error(error);
    }
    console.error('\n' + '⚠️  Server cannot start without these variables!');
    console.error('Please check your .env.local file and ensure all critical variables are set.\n');
  }

  // Warnings para variáveis opcionais
  if (result.missingOptional.length > 0) {
    console.warn('⚠️  Optional environment variables not set (features may be disabled):');
    for (const varName of result.missingOptional) {
      console.warn(`   - ${varName}`);
    }
    console.warn('');
  }

  console.log('='.repeat(60) + '\n');

  // Se validação falhar e throwOnError = true, lançar erro
  if (!result.valid && throwOnError) {
    throw new Error('Environment validation failed. Please check the logs above.');
  }
}

// ============================================================
// 🔒 ADVANCED SECURITY FEATURES
// ============================================================

/**
 * Escapa caracteres especiais para prevenir SQL Injection em queries .ilike()
 * 
 * @param {string} input - String de entrada do usuário
 * @returns {string} String escapada segura para usar em queries
 * 
 * @example
 * ```typescript
 * const userInput = "test%_\\";
 * const safe = escapeSqlLikePattern(userInput);
 * // safe = "test\\%\\_\\\\"
 * ```
 */
export function escapeSqlLikePattern(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  // Escapar caracteres especiais do LIKE: %, _, \
  return input
    .replace(/\\/g, '\\\\')  // Backslash primeiro
    .replace(/%/g, '\\%')    // Percent
    .replace(/_/g, '\\_');   // Underscore
}

/**
 * Valida e sanitiza input para uso em queries .ilike()
 * 
 * @param {string} input - String de entrada do usuário
 * @param {number} maxLength - Tamanho máximo permitido (default: 256)
 * @returns {string | null} String sanitizada ou null se inválida
 */
export function sanitizeSqlInput(input: string, maxLength: number = 256): string | null {
  if (!input || typeof input !== 'string') return null;
  
  const trimmed = input.trim();
  
  // Verificar tamanho
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  
  // Remover caracteres de controle e não-ASCII perigosos
  const cleaned = trimmed.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Escapar padrões LIKE
  return escapeSqlLikePattern(cleaned);
}

/**
 * Verifica se as API keys estão próximas da expiração recomendada
 * 
 * @param {Date} lastRotation - Data da última rotação
 * @param {number} maxDays - Dias máximos recomendados (default: 90)
 * @returns {boolean} true se precisa rotacionar
 */
export function shouldRotateApiKeys(lastRotation: Date, maxDays: number = 90): boolean {
  const daysSinceRotation = (Date.now() - lastRotation.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceRotation >= maxDays;
}

/**
 * Interface para eventos de segurança que devem ser monitorados
 */
export interface SecurityEvent {
  type: 'RATE_LIMIT_EXCEEDED' | 'BRUTE_FORCE_ATTEMPT' | 'SQL_INJECTION_ATTEMPT' | 
        'XSS_ATTEMPT' | 'CSRF_VIOLATION' | 'WEBHOOK_REPLAY' | 'SUSPICIOUS_IP' | 
        'API_KEY_ROTATION_NEEDED' | 'CSP_VIOLATION' | 'AUTH_FAILURE';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  userId?: string;
  ip?: string;
  details: Record<string, any>;
  timestamp: string;
}

/**
 * Cria um evento de segurança estruturado para logging/monitoring
 * 
 * @param {SecurityEvent} event - Dados do evento de segurança
 * @returns {Record<string, any>} Evento estruturado para logging
 * 
 * @example
 * ```typescript
 * const event = createSecurityEvent({
 *   type: 'BRUTE_FORCE_ATTEMPT',
 *   severity: 'HIGH',
 *   userId: 'user123',
 *   ip: '192.168.1.1',
 *   details: { endpoint: '/api/login', attempts: 5 }
 * });
 * 
 * // Enviar para sistema de monitoring (Sentry, DataDog, etc)
 * if (process.env.SENTRY_DSN) {
 *   Sentry.captureEvent(event);
 * }
 * ```
 */
export function createSecurityEvent(event: Omit<SecurityEvent, 'timestamp'>): SecurityEvent {
  const securityEvent: SecurityEvent = {
    ...event,
    timestamp: new Date().toISOString()
  };
  
  // Mascarar dados sensíveis
  if (securityEvent.userId) {
    securityEvent.userId = maskUserId(securityEvent.userId);
  }
  if (securityEvent.ip) {
    securityEvent.ip = maskIp(securityEvent.ip);
  }
  
  // Log estruturado
  console.warn('🚨 SECURITY EVENT:', JSON.stringify(securityEvent));
  
  // TODO: Integrar com serviço de monitoring externo
  // if (process.env.SENTRY_DSN) {
  //   Sentry.captureEvent(securityEvent);
  // }
  
  return securityEvent;
}

/**
 * Rastreador de tentativas de login falhadas por IP/userId
 * Usado para implementar proteção contra brute-force
 */
export class BruteForceTracker {
  private attempts: Map<string, { count: number; firstAttempt: number; requiresCaptcha: boolean }> = new Map();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly captchaThreshold: number;
  
  constructor(maxAttempts: number = 5, windowMs: number = 300_000, captchaThreshold: number = 3) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs; // 5 minutos padrão
    this.captchaThreshold = captchaThreshold;
  }
  
  /**
   * Registra uma tentativa falhada
   * @returns {boolean} true se deve bloquear (excedeu limite)
   */
  recordFailedAttempt(identifier: string): boolean {
    const now = Date.now();
    const entry = this.attempts.get(identifier);
    
    if (!entry || now - entry.firstAttempt > this.windowMs) {
      // Nova janela de tentativas
      this.attempts.set(identifier, {
        count: 1,
        firstAttempt: now,
        requiresCaptcha: false
      });
      return false;
    }
    
    // Incrementar contador
    entry.count += 1;
    
    // Exigir captcha após threshold
    if (entry.count >= this.captchaThreshold) {
      entry.requiresCaptcha = true;
    }
    
    // Bloquear se exceder máximo
    if (entry.count >= this.maxAttempts) {
      createSecurityEvent({
        type: 'BRUTE_FORCE_ATTEMPT',
        severity: 'HIGH',
        details: { identifier, attempts: entry.count }
      });
      return true;
    }
    
    return false;
  }
  
  /**
   * Verifica se deve exigir captcha para este identificador
   */
  requiresCaptcha(identifier: string): boolean {
    const entry = this.attempts.get(identifier);
    return entry?.requiresCaptcha ?? false;
  }
  
  /**
   * Limpa as tentativas após login bem-sucedido
   */
  clearAttempts(identifier: string): void {
    this.attempts.delete(identifier);
  }
  
  /**
   * Limpa tentativas antigas
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts.entries()) {
      if (now - entry.firstAttempt > this.windowMs) {
        this.attempts.delete(key);
      }
    }
  }
}

/**
 * Validador de rotação de API keys
 * Monitora e alerta sobre keys que precisam ser rotacionadas
 */
export interface ApiKeyInfo {
  name: string;
  lastRotated: Date;
  rotationIntervalDays: number;
}

export function checkApiKeysRotation(keys: ApiKeyInfo[]): {
  needsRotation: ApiKeyInfo[];
  warnings: string[];
} {
  const needsRotation: ApiKeyInfo[] = [];
  const warnings: string[] = [];
  
  for (const key of keys) {
    const daysSinceRotation = (Date.now() - key.lastRotated.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceRotation >= key.rotationIntervalDays) {
      needsRotation.push(key);
      warnings.push(`🔑 ${key.name} needs rotation (last rotated ${Math.floor(daysSinceRotation)} days ago)`);
    } else if (daysSinceRotation >= key.rotationIntervalDays * 0.8) {
      warnings.push(`⚠️  ${key.name} will need rotation soon (${Math.floor(daysSinceRotation)} days old)`);
    }
  }
  
  return { needsRotation, warnings };
}