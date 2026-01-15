// ============================================================
// API/APP.TS - BACKEND SEGURO PARA CASES E BATTLES (TypeScript)
// ============================================================

import { createClient, type PostgrestSingleResponse, type SupabaseClient } from '@supabase/supabase-js';
import { handleOpenCases } from './_caseopening.js';
import {
  applyCors,
  checkRateLimit,
  cleanupOldEntries,
  getIdentifier,
  logAudit,
  validateSessionAndFetchPlayerStats,
  logMoneyTransactionAsync,
  updatePlayerBalance,
} from './_utils.js';
import { applyReferralCommissionForSpend } from './_referrals.js';

import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// 🔠 TIPOS UTILITÁRIOS
// ============================================================
type HeaderValue = string | string[] | undefined;

type ApiRequestBody = {
  action?: string;
  userId?: string;
  authToken?: string;
};

export interface ApiRequest {
  method?: string;
  headers?: Record<string, HeaderValue>;
  body?: ApiRequestBody;
  query?: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
}

export interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (data: unknown) => void;
  end: (data?: unknown) => void;
  setHeader: (key: string, value: string) => void;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
  lastSeenAt: number;
}

type ValidateSessionResult = Awaited<ReturnType<typeof validateSessionAndFetchPlayerStats>>;
type UpdateMoneyRow = { new_money: number };

// ============================================================
// 🔌 SUPABASE CLIENT
// ============================================================
const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_KEY ?? ''
);

// ============================================================
// 🛡️ RATE LIMITING
// ============================================================
const rateLimits = new Map<string, RateLimitEntry>();

let lastRateLimitCleanupAt = 0;
function maybeCleanupRateLimits(): void {
  const now = Date.now();
  if (now - lastRateLimitCleanupAt < 5 * 60_000) return;
  lastRateLimitCleanupAt = now;
  cleanupOldEntries(rateLimits, { maxIdleMs: 15 * 60_000 });
}

// ============================================================
// 📝 LOGGING E AUDITORIA
// ============================================================
async function logAction(userId: string, action: string, details: unknown, req: ApiRequest | null): Promise<void> {
  return logAudit(supabase, userId, action, details, req ?? undefined);
}

// ============================================================
// 🔐 VALIDAÇÃO DE SESSÃO MELHORADA
// ============================================================
async function validateSession(authToken: string, expectedUserId: string): Promise<ValidateSessionResult> {
  return validateSessionAndFetchPlayerStats(supabase, authToken, expectedUserId, { select: 'user_id' });
}

// ============================================================
// MAIN HANDLER (ROTEAMENTO SEGURO)
// ============================================================
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  // 1. CORS RESTRITO (safe when env missing)
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { action, userId, authToken } = req.body ?? {};
  maybeCleanupRateLimits();

  // 2. RATE LIMITING
  const identifier = getIdentifier(req, userId);
  const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '0', 10) || 30;
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '0', 10) || 60_000;
  if (!checkRateLimit(rateLimits, identifier, { maxRequests, windowMs })) {
    logAction(userId ?? 'unknown', 'RATE_LIMIT_EXCEEDED', { action }, req).catch(() => {});
    res.status(429).json({ error: 'Too many requests. Please wait.' });
    return;
  }

  // 3. VALIDAÇÃO BÁSICA
  if (!action || typeof action !== 'string') {
    res.status(400).json({ error: 'Invalid action' });
    return;
  }

  if (!userId || typeof userId !== 'string') {
    res.status(400).json({ error: 'Invalid userId' });
    return;
  }

  if (!authToken || typeof authToken !== 'string') {
    res.status(400).json({ error: 'Invalid authToken' });
    return;
  }

  // 4. VALIDAÇÃO DE SESSÃO
  const session = await validateSession(authToken, userId);
  if (!session.valid) {
    const sessionError = (session as { error?: string }).error ?? 'Validation failed';
    logAction(userId, 'AUTH_FAILED', { action, error: sessionError }, req).catch(() => {});
    res.status(401).json({ error: sessionError });
    return;
  }

  // 5. ROTEAMENTO
  try {
    switch (action) {
      case 'openCases':
        await handleOpenCases(req, res);
        return;
      default:
        res.status(400).json({ error: 'Invalid action' });
        return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Unhandled error:', message);
    logAction(userId, 'ERROR', { action, error: message }, req).catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  }
}
