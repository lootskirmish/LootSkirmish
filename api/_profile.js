// ============================================================
// API/_PROFILE.JS - Profile & Friends Management  
// ============================================================

import { createClient } from '@supabase/supabase-js';
import {
  applyCors,
  validateSessionAndFetchPlayerStats,
  logAudit,
  getIdentifier,
  checkRateLimit,
  cleanupOldEntries
} from './_utils.js';

import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// PROFILE SECTION - Username & Diamonds
// ============================================================

const RENAME_COST = 100;
const profileRateLimits = new Map();
let lastProfileCleanupAt = 0;

function getProfileRateLimitConfig() {
  const maxRequests = parseInt(process.env.RATE_LIMIT_PROFILE_MAX_REQUESTS || process.env.RATE_LIMIT_MAX_REQUESTS) || 20;
  const windowMs = parseInt(process.env.RATE_LIMIT_PROFILE_WINDOW_MS || process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
  return { maxRequests, windowMs };
}

// ============================================================
// Helpers
// ============================================================

function normalizeUsername(raw) {
  if (!raw) return '';
  return raw.trim();
}

function isValidUsername(username) {
  // 3-16 chars, letters/numbers/._- only (no spaces), must start with letter/number
  return typeof username === 'string'
    && username.length >= 3
    && username.length <= 16
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,15}$/.test(username);
}

async function usernameExists(username, excludeUserId) {
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

async function updatePlayerDiamonds(userId, amount, reason, req = null) {
  // Based on _admin.js but without role requirements
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

  const { data: updateResult, error: updateError } = await supabase
    .from('player_stats')
    .update({
      diamonds: newDiamonds,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .eq('diamonds', currentDiamonds) // optimistic lock
    .select('diamonds, user_id');

  if (updateError) {
    throw new Error('Failed to update diamonds');
  }

  if (!updateResult || updateResult.length === 0) {
    throw new Error('Concurrent modification detected');
  }

  const finalDiamonds = updateResult[0].diamonds;

  // Non-blocking log
  Promise.all([
    supabase.from('diamond_transactions').insert({
      user_id: userId,
      amount: amount,
      reason,
      balance_after: finalDiamonds,
      created_at: new Date().toISOString()
    }),
    req ? logAudit(supabase, userId, 'DIAMONDS_UPDATED', { amount, reason, newBalance: finalDiamonds }, req) : Promise.resolve()
  ]).catch((err) => console.error('⚠️ Transaction logging error:', err?.message || err));

  return finalDiamonds;
}

// ============================================================
// Handler
// ============================================================

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const contentType = (req.headers?.['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ error: 'Unsupported Media Type' });
  }

  let body = null;
  try {
    body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const identifier = getIdentifier(req, body?.userId);
  const { maxRequests, windowMs } = getProfileRateLimitConfig();

  const now = Date.now();
  if (!lastProfileCleanupAt || now - lastProfileCleanupAt > windowMs) {
    cleanupOldEntries(profileRateLimits, { maxIdleMs: windowMs * 2 });
    lastProfileCleanupAt = now;
  }

  const allowed = checkRateLimit(profileRateLimits, identifier, { maxRequests, windowMs });
  if (!allowed) {
    res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
    logAudit(supabase, body?.userId || null, 'RATE_LIMIT_EXCEEDED', { identifier, maxRequests, windowMs }, req).catch(() => {});
    return res.status(429).json({ error: 'RATE_LIMITED' });
  }

  const { action } = body;

  try {
    // Profile actions
    if (action === 'changeUsername') {
      return await handleChangeUsername(req, res);
    }
    
    // Friends actions
    if (action === 'fetchState') return await handleFetchState(req, res, body);
    if (action === 'searchUsers') return await handleSearch(req, res, body);
    if (action === 'sendRequest') return await handleSendRequest(req, res, body);
    if (action === 'acceptRequest') return await handleAccept(req, res, body);
    if (action === 'rejectRequest') return await handleReject(req, res, body);
    if (action === 'cancelRequest') return await handleCancel(req, res, body);
    if (action === 'removeFriend') return await handleRemoveFriend(req, res, body);
  } catch (err) {
    console.error('Profile API error:', err?.message || err);
    return respondError(res, 500, err?.message || 'Internal server error');
  }

  return res.status(400).json({ error: 'Invalid action' });
}

async function handleChangeUsername(req, res) {
  try {
    const { userId, authToken, newUsername } = req.body || {};

    if (!userId || !authToken || !newUsername) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (typeof userId !== 'string' || userId.length > 128) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    if (typeof authToken !== 'string' || authToken.length > 8192) {
      return res.status(400).json({ error: 'Invalid authToken' });
    }

    const normalized = normalizeUsername(newUsername);
    if (!isValidUsername(normalized)) {
      return res.status(400).json({ error: 'INVALID_USERNAME' });
    }

    const session = await validateSessionAndFetchPlayerStats(supabase, authToken, userId, { select: '*' });
    const { valid, error: sessionError } = session;
    if (!valid) {
      return res.status(401).json({ error: sessionError || 'Invalid session' });
    }

    const stats = session.stats || {};
    const currentUsername = stats.username || '';
    const isSame = currentUsername?.toLowerCase() === normalized.toLowerCase();
    if (isSame) {
      return res.status(400).json({ error: 'SAME_USERNAME' });
    }

    // Uniqueness check (case-insensitive)
    const taken = await usernameExists(normalized, userId);
    if (taken) {
      return res.status(400).json({ error: 'USERNAME_TAKEN' });
    }

    const changeCount = Math.max(0, Number(stats.username_change_count) || 0);
    const isFirstChange = changeCount === 0;
    const cost = isFirstChange ? 0 : RENAME_COST;

    if (cost > 0) {
      if ((stats.diamonds || 0) < cost) {
        return res.status(400).json({ error: 'INSUFFICIENT_DIAMONDS', needed: cost - (stats.diamonds || 0) });
      }
      try {
        await updatePlayerDiamonds(userId, -cost, 'Username change', req);
      } catch (err) {
        if (err.message === 'Insufficient diamonds') {
          return res.status(400).json({ error: 'INSUFFICIENT_DIAMONDS', needed: cost });
        }
        return res.status(500).json({ error: 'Failed to charge diamonds' });
      }
    }

    const newCount = changeCount + 1;

    const { error: updErr, data: updData } = await supabase
      .from('player_stats')
      .update({
        username: normalized,
        username_change_count: newCount,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select('username, diamonds, username_change_count')
      .single();

    if (updErr) {
      // Refund if update failed and we charged
      if (cost > 0) {
        try {
          await updatePlayerDiamonds(userId, cost, 'Refund: username change failed', req);
        } catch (refundErr) {
          console.error('Refund after username change failure failed:', refundErr?.message || refundErr);
        }
      }
      return res.status(500).json({ error: 'Failed to update username' });
    }

    // Audit (non-blocking)
    logAudit(supabase, userId, 'USERNAME_CHANGED', { from: currentUsername, to: normalized, cost }, req).catch(() => {});

    return res.status(200).json({
      success: true,
      username: updData?.username || normalized,
      diamonds: updData?.diamonds ?? (stats.diamonds || 0) - cost,
      changeCount: updData?.username_change_count ?? newCount,
      costApplied: cost
    });
  } catch (error) {
    console.error('💥 Change username error:', error?.message || error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// FRIENDS SECTION - Friend Requests & Graph
// ============================================================

const DEFAULT_STATE = { friends: [], incoming: [], outgoing: [] };
const friendsRateLimits = new Map();
const FRIENDS_RATE_LIMIT_MAX = 30;
const FRIENDS_RATE_LIMIT_WINDOW = 60_000;

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const userId = typeof entry.user_id === 'string' ? entry.user_id : null;
  const username = typeof entry.username === 'string' ? entry.username : null;
  if (!userId || !username) return null;
  return {
    user_id: userId,
    username,
    created_at: entry.created_at || new Date().toISOString()
  };
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const cleaned = [];
  for (const item of list) {
    const entry = sanitizeEntry(item);
    if (entry && !seen.has(entry.user_id)) {
      seen.add(entry.user_id);
      cleaned.push(entry);
    }
  }
  return cleaned;
}

function coerceRawState(raw) {
  if (!raw) return DEFAULT_STATE;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return DEFAULT_STATE;
    }
  }
  if (typeof raw === 'object') return raw;
  return DEFAULT_STATE;
}

function normalizeState(rawState) {
  const state = coerceRawState(rawState?.state || rawState || {});
  return {
    friends: normalizeList(state.friends),
    incoming: normalizeList(state.incoming),
    outgoing: normalizeList(state.outgoing)
  };
}

async function loadState(userId) {
  const { data, error } = await supabase
    .from('player_stats')
    .select('friends')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    const code = error.code || '';
    const details = error.details || '';
    if (code === '42703' || details.includes('friends')) {
      console.error('⚠️ friends column missing on player_stats');
      return { ...DEFAULT_STATE };
    }
    throw new Error('Failed to load friends');
  }

  const rawState = data?.friends || DEFAULT_STATE;
  return normalizeState(rawState);
}

async function saveState(userId, state) {
  const normalized = normalizeState(state);
  const { error } = await supabase
    .from('player_stats')
    .update({
      friends: normalized,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId);

  if (error) {
    const code = error.code || '';
    const details = error.details || '';
    if (code === '42703' || details.includes('friends')) {
      console.error('⚠️ friends column missing on player_stats');
      return normalized;
    }
    throw new Error('Failed to persist friends');
  }

  return normalized;
}

function relationship(state, targetId) {
  if (!targetId) return 'none';
  if (state.friends.some((f) => f.user_id === targetId)) return 'friend';
  if (state.incoming.some((f) => f.user_id === targetId)) return 'incoming';
  if (state.outgoing.some((f) => f.user_id === targetId)) return 'outgoing';
  return 'none';
}

async function fetchUserSummary(userId) {
  const { data, error } = await supabase
    .from('player_stats')
    .select('user_id, username, avatar_url, level')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

async function fetchUsersSummaries(userIds = []) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return {};

  const { data, error } = await supabase
    .from('player_stats')
    .select('user_id, username, avatar_url, level')
    .in('user_id', unique);

  if (error) return {};

  const map = {};
  for (const row of data || []) {
    map[row.user_id] = row;
  }
  return map;
}

async function getTargetByUserIdOrUsername({ targetUserId, targetUsername }) {
  if (!targetUserId && !targetUsername) return null;

  let query = supabase
    .from('player_stats')
    .select('user_id, username')
    .limit(1);

  if (targetUserId) {
    query = query.eq('user_id', targetUserId);
  } else {
    query = query.ilike('username', targetUsername);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data;
}

function respondError(res, status, message, meta = {}) {
  try {
    return res.status(status).json({ error: message, ...meta });
  } catch (_) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Friends handlers
async function handleFetchState(req, res, body) {
  const { userId, authToken } = body;
  const identifier = getIdentifier(req, userId);
  const allowed = checkRateLimit(friendsRateLimits, identifier, {
    maxRequests: FRIENDS_RATE_LIMIT_MAX,
    windowMs: FRIENDS_RATE_LIMIT_WINDOW
  });
  if (!allowed) {
    res.setHeader('Retry-After', Math.ceil(FRIENDS_RATE_LIMIT_WINDOW / 1000));
    return respondError(res, 429, 'Too many requests');
  }
  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'username' }
  );

  if (!session.valid) {
    return respondError(res, 401, session.error || 'Invalid session');
  }

  const state = await loadState(userId);
  const ids = [
    ...state.friends.map((f) => f.user_id),
    ...state.incoming.map((f) => f.user_id),
    ...state.outgoing.map((f) => f.user_id)
  ];
  const profiles = await fetchUsersSummaries(ids);

  return res.status(200).json({
    success: true,
    state,
    profiles
  });
}

async function handleSearch(req, res, body) {
  const { userId, authToken, query } = body;
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return respondError(res, 400, 'Query must have at least 2 characters');
  }

  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'username' }
  );
  if (!session.valid) {
    return respondError(res, 401, session.error || 'Invalid session');
  }

  const state = await loadState(userId);

  const { data, error } = await supabase
    .from('player_stats')
    .select('user_id, username, avatar_url, level')
    .ilike('username', `%${query.trim()}%`)
    .neq('user_id', userId)
    .limit(10);

  if (error) {
    return respondError(res, 500, 'Search failed');
  }

  const results = (data || []).map((row) => ({
    ...row,
    status: relationship(state, row.user_id)
  }));

  return res.status(200).json({ success: true, results });
}

async function handleSendRequest(req, res, body) {
  const { userId, authToken, targetUserId, targetUsername } = body;
  if (!userId || !authToken) {
    return respondError(res, 400, 'Missing required fields');
  }
  const identifier = getIdentifier(req, userId);
  const allowed = checkRateLimit(friendsRateLimits, identifier, {
    maxRequests: FRIENDS_RATE_LIMIT_MAX,
    windowMs: FRIENDS_RATE_LIMIT_WINDOW
  });
  if (!allowed) {
    res.setHeader('Retry-After', Math.ceil(FRIENDS_RATE_LIMIT_WINDOW / 1000));
    return respondError(res, 429, 'Too many requests');
  }

  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'username' }
  );
  if (!session.valid) {
    return respondError(res, 401, session.error || 'Invalid session');
  }

  const requesterUsername = session.stats?.username;
  const target = await getTargetByUserIdOrUsername({ targetUserId, targetUsername });
  if (!target) {
    return respondError(res, 404, 'User not found');
  }

  if (target.user_id === userId) {
    return respondError(res, 400, 'Cannot add yourself');
  }

  const requesterState = await loadState(userId);
  const targetState = await loadState(target.user_id);

  const currentRelation = relationship(requesterState, target.user_id);
  if (currentRelation === 'friend') {
    return res.status(200).json({ success: true, state: requesterState, info: 'Already friends' });
  }
  if (currentRelation === 'outgoing') {
    return res.status(200).json({ success: true, state: requesterState, info: 'Request already sent' });
  }
  if (currentRelation === 'incoming') {
    requesterState.incoming = requesterState.incoming.filter((r) => r.user_id !== target.user_id);
    targetState.outgoing = targetState.outgoing.filter((r) => r.user_id !== userId);
    requesterState.friends.push({ user_id: target.user_id, username: target.username, created_at: new Date().toISOString() });
    targetState.friends.push({ user_id: userId, username: requesterUsername, created_at: new Date().toISOString() });
    await Promise.all([
      saveState(userId, requesterState),
      saveState(target.user_id, targetState)
    ]);
    return res.status(200).json({ success: true, state: requesterState, autoAccepted: true });
  }

  requesterState.outgoing.push({ user_id: target.user_id, username: target.username, created_at: new Date().toISOString() });
  targetState.incoming.push({ user_id: userId, username: requesterUsername, created_at: new Date().toISOString() });

  await Promise.all([
    saveState(userId, requesterState),
    saveState(target.user_id, targetState)
  ]);

  return res.status(200).json({ success: true, state: requesterState });
}

async function handleAccept(req, res, body) {
  const { userId, authToken, fromUserId } = body;
  if (!userId || !authToken || !fromUserId) {
    return respondError(res, 400, 'Missing required fields');
  }

  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'username' }
  );
  if (!session.valid) {
    return respondError(res, 401, session.error || 'Invalid session');
  }

  const fromUser = await fetchUserSummary(fromUserId);
  if (!fromUser) {
    return respondError(res, 404, 'User not found');
  }

  const meState = await loadState(userId);
  const otherState = await loadState(fromUserId);

  const hasRequest = meState.incoming.some((r) => r.user_id === fromUserId);
  if (!hasRequest) {
    return respondError(res, 400, 'No pending request');
  }

  meState.incoming = meState.incoming.filter((r) => r.user_id !== fromUserId);
  otherState.outgoing = otherState.outgoing.filter((r) => r.user_id !== userId);

  meState.friends.push({ user_id: fromUserId, username: fromUser.username, created_at: new Date().toISOString() });
  otherState.friends.push({ user_id: userId, username: session.stats?.username || 'Player', created_at: new Date().toISOString() });

  await Promise.all([
    saveState(userId, meState),
    saveState(fromUserId, otherState)
  ]);

  return res.status(200).json({ success: true, state: meState });
}

async function handleReject(req, res, body) {
  const { userId, authToken, fromUserId } = body;
  if (!userId || !authToken || !fromUserId) {
    return respondError(res, 400, 'Missing required fields');
  }

  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'username' }
  );
  if (!session.valid) {
    return respondError(res, 401, session.error || 'Invalid session');
  }

  const meState = await loadState(userId);
  const otherState = await loadState(fromUserId);

  meState.incoming = meState.incoming.filter((r) => r.user_id !== fromUserId);
  otherState.outgoing = otherState.outgoing.filter((r) => r.user_id !== userId);

  await Promise.all([
    saveState(userId, meState),
    saveState(fromUserId, otherState)
  ]);

  return res.status(200).json({ success: true, state: meState });
}

async function handleCancel(req, res, body) {
  const { userId, authToken, targetUserId } = body;
  if (!userId || !authToken || !targetUserId) {
    return respondError(res, 400, 'Missing required fields');
  }

  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'username' }
  );
  if (!session.valid) {
    return respondError(res, 401, session.error || 'Invalid session');
  }

  const meState = await loadState(userId);
  const otherState = await loadState(targetUserId);

  meState.outgoing = meState.outgoing.filter((r) => r.user_id !== targetUserId);
  otherState.incoming = otherState.incoming.filter((r) => r.user_id !== userId);

  await Promise.all([
    saveState(userId, meState),
    saveState(targetUserId, otherState)
  ]);

  return res.status(200).json({ success: true, state: meState });
}

async function handleRemoveFriend(req, res, body) {
  const { userId, authToken, targetUserId } = body;
  if (!userId || !authToken || !targetUserId) {
    return respondError(res, 400, 'Missing required fields');
  }

  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'username' }
  );
  if (!session.valid) {
    return respondError(res, 401, session.error || 'Invalid session');
  }

  const meState = await loadState(userId);
  const otherState = await loadState(targetUserId);

  meState.friends = meState.friends.filter((r) => r.user_id !== targetUserId);
  otherState.friends = otherState.friends.filter((r) => r.user_id !== userId);

  await Promise.all([
    saveState(userId, meState),
    saveState(targetUserId, otherState)
  ]);

  return res.status(200).json({ success: true, state: meState });
}