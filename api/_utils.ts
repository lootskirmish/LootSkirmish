// ============================================================
// API/UTILS.TS - Shared helpers for API handlers (TypeScript)
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// TYPES
// ============================================================

interface RateLimitEntry {
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
