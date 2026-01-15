// Shared helpers for API handlers (Vercel-style serverless + local Express)

export function getAllowedOrigins() {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function applyCors(req, res, {
  allowedOrigins = getAllowedOrigins(),
  methods = 'POST, OPTIONS',
  headers = 'Content-Type, Authorization',
  credentials = false,
  securityHeaders = true,
} = {}) {
  const origin = req.headers?.origin;
  if (origin && allowedOrigins.includes(origin)) {
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

export function getRequestIp(req) {
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

// Token-bucket-ish (fixed window) rate limit: O(1), no arrays/filter.
export function checkRateLimit(rateLimitMap, identifier, {
  maxRequests = 30,
  windowMs = 60_000,
} = {}) {
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

export function cleanupOldEntries(map, {
  maxIdleMs = 10 * 60_000,
  maxDelete = 200,
} = {}) {
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

// Fixed-window counter helpers (useful for tracking failed attempts).
export function getWindowCounter(map, identifier, windowMs) {
  const now = Date.now();
  const entry = map.get(identifier);
  if (!entry || now >= entry.resetAt) {
    const fresh = { count: 0, resetAt: now + windowMs, lastSeenAt: now };
    map.set(identifier, fresh);
    return fresh;
  }
  entry.lastSeenAt = now;
  return entry;
}

export function incrementWindowCounter(map, identifier, {
  windowMs = 60_000,
} = {}) {
  const entry = getWindowCounter(map, identifier, windowMs);
  entry.count += 1;
  return entry.count;
}

export function isWindowLimitExceeded(map, identifier, {
  maxCount = 5,
  windowMs = 60_000,
} = {}) {
  const now = Date.now();
  const entry = map.get(identifier);
  if (!entry || now >= entry.resetAt) return false;
  return entry.count >= maxCount;
}

export async function logAudit(supabase, userId, action, details, req) {
  try {
    const ipAddress = getRequestIp(req);

    await supabase.from('audit_log').insert({
      user_id: userId,
      action,
      details: JSON.stringify(details ?? {}),
      ip_address: ipAddress,
      user_agent: req.headers?.['user-agent'] || 'unknown',
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Never block the main request on audit failures.
    console.error('Failed to log action:', err?.message || err);
  }
}

export async function validateSupabaseSession(supabase, authToken, expectedUserId) {
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
    console.error('Session validation error:', err?.message || err);
    return { valid: false, error: 'Validation failed' };
  }
}

export async function validateSessionAndFetchPlayerStats(supabase, authToken, expectedUserId, {
  select = 'user_id',
} = {}) {
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
    console.error('Stats validation error:', err?.message || err);
    return { valid: false, error: 'Validation failed' };
  }
}

export function getIdentifier(req, userId) {
  return userId || getRequestIp(req);
}
// ============================================================================
// TRANSACTION LOGGING - UNIFIED FUNCTION FOR NEW TRANSACTION SYSTEM
// ============================================================================
/**
 * Registra uma transação de money na nova estrutura de tabelas otimizada
 * Esta função registra transações de forma assíncrona (non-blocking)
 * 
 * @param {object} supabase - Cliente Supabase
 * @param {string} userId - ID do usuário (uuid)
 * @param {number} amount - Valor da transação (positivo para ganho, negativo para gasto)
 * @param {string} reason - Motivo da transação (ex: 'case_opening', 'shop_purchase', 'referral_withdrawal')
 * @param {number} balanceAfter - Saldo após a transação
 * @returns {Promise<void>} - Retorna promise que resolve imediatamente (não bloqueia)
 * 
 * Usa RPC para registrar a transação de forma atômica nas tabelas:
 * - transactions (dados da transação)
 * - user_transactions (relacionamento usuário-transação com particionamento)
 */
export async function registerMoneyTransaction(supabase, userId, amount, reason, balanceAfter) {
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

    // Chama RPC para registrar a transação de forma atômica
    const { error } = await supabase.rpc('register_transaction', {
      p_amount: parseFloat(amount.toFixed(2)),
      p_reason: reason,
      p_user_balances: [  // ✅ Passa o array direto!
        {
          user_id: userId,
          balance_after: parseFloat(balanceAfter.toFixed(2))
        }
      ]
    });

    if (error) {
      console.error('⚠️ Transaction logging error:', error.message);
      // Não lança erro para não bloquear o fluxo principal
      return;
    }

    console.log(`✅ Transaction registered: ${reason} (${amount > 0 ? '+' : ''}${amount}) for user ${userId.slice(0, 8)}`);
  } catch (err) {
    console.error('⚠️ Unexpected error registering transaction:', err?.message || err);
    // Não relança erro - transação de auditoria não deve bloquear a operação
  }
}

/**
 * Versão fire-and-forget: registra a transação sem aguardar a resposta
 * Use isso quando não precisar bloquear o fluxo da resposta
 * 
 * @param {object} supabase - Cliente Supabase
 * @param {string} userId - ID do usuário
 * @param {number} amount - Valor da transação
 * @param {string} reason - Motivo da transação
 * @param {number} balanceAfter - Saldo após a transação
 */
export function logMoneyTransactionAsync(supabase, userId, amount, reason, balanceAfter) {
  // Fire-and-forget: não aguarda a resposta
  registerMoneyTransaction(supabase, userId, amount, reason, balanceAfter).catch(err => {
    console.error('Async transaction logging failed:', err?.message || err);
  });
}