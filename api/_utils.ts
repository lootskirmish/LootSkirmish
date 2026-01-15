// ============================================================
// API/UTILS.TS - Shared helpers for API handlers (TypeScript)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

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
}

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
  }
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
      console.error('⚠️ Invalid userId for transaction:', userId);
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
  const escaped = username.replace(/([_%])/g, '\\$1');

  const { data, error } = await supabase
    .from('player_stats')
    .select('user_id')
    .ilike('username', escaped)
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