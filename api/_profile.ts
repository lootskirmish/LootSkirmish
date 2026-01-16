// ============================================================
// API/_PROFILE.TS - Profile & Friends Management  
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  applyCors,
  validateSessionAndFetchPlayerStats,
  logAudit,
  getIdentifier,
  checkRateLimit,
  cleanupOldEntries,
  normalizeUsername,
  isValidUsername,
  usernameExists,
  updatePlayerDiamonds,
  generateCsrfToken,
  validateCsrfMiddleware,
  clearCsrfToken,
  generateTwoFactorSecret,
  verifyTwoFactorCode,
  sanitizeUsername,
  sanitizeBio,
  sanitizeText,
  maskUserId,
  type RateLimitEntry
} from './_utils.js';

import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// TYPES
// ============================================================

interface ApiRequest {
  method?: string;
  body?: any;
  headers?: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (data: any) => void;
  end: (data?: any) => void;
  setHeader: (key: string, value: string) => void;
}

const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ============================================================
// PROFILE SECTION - Username & Diamonds
// ============================================================

const RENAME_COST: number = 100;
const profileRateLimits: Map<string, RateLimitEntry> = new Map();
let lastProfileCleanupAt: number = 0;

function getProfileRateLimitConfig(): { maxRequests: number; windowMs: number } {
  const maxRequests = parseInt(process.env.RATE_LIMIT_PROFILE_MAX_REQUESTS || process.env.RATE_LIMIT_MAX_REQUESTS || '') || 20;
  const windowMs = parseInt(process.env.RATE_LIMIT_PROFILE_WINDOW_MS || process.env.RATE_LIMIT_WINDOW_MS || '') || 60_000;
  return { maxRequests, windowMs };
}

// ============================================================
// Handler
// ============================================================

export default async function handler(req: ApiRequest, res: ApiResponse) {
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

  const contentType = ((req.headers?.['content-type'] as string) || '').toLowerCase();
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
    res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
    logAudit(supabase, body?.userId || null, 'RATE_LIMIT_EXCEEDED', { identifier, maxRequests, windowMs }, req).catch(() => {});
    return res.status(429).json({ error: 'RATE_LIMITED' });
  }

  const { action } = body;

  try {
    // 🛡️ CSRF Token Management
    if (action === 'getCsrfToken') {
      return await handleGetCsrfToken(req, res, body);
    }
    if (action === 'clearCsrfToken') {
      return await handleClearCsrfToken(req, res, body);
    }
    
    // 🛡️ 2FA Management
    if (action === 'setup2FA') {
      return await handleSetup2FA(req, res, body);
    }
    if (action === 'verify2FA') {
      return await handleVerify2FA(req, res, body);
    }
    if (action === 'disable2FA') {
      return await handleDisable2FA(req, res, body);
    }
    
    // Profile actions
    if (action === 'changeUsername') {
      return await handleChangeUsername(req, res);
    }
    if (action === 'updatePublicProfile') {
      return await handleUpdatePublicProfile(req, res);
    }
    if (action === 'checkPublicProfile') {
      return await handleCheckPublicProfile(req, res);
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
    console.error('Profile API error:', err instanceof Error ? err.message : err);
    return respondError(res, 500, err instanceof Error ? err.message : 'Internal server error');
  }

  return res.status(400).json({ error: 'Invalid action' });
}

async function handleChangeUsername(req: ApiRequest, res: ApiResponse): Promise<void> {
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

    // 🛡️ Sanitizar username (XSS protection)
    const sanitized = sanitizeUsername(newUsername);
    const normalized = normalizeUsername(sanitized);
    
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
    const taken = await usernameExists(supabase, normalized, userId);
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
        await updatePlayerDiamonds(supabase, userId, -cost, 'Username change', false, req);
      } catch (err) {
        if (err instanceof Error && err.message === 'Insufficient diamonds') {
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
          await updatePlayerDiamonds(supabase, userId, cost, 'Refund: username change failed', false, req);
        } catch (refundErr) {
          console.error('Refund after username change failure failed:', refundErr instanceof Error ? refundErr.message : refundErr);
        }
      }
      return res.status(500).json({ error: 'Failed to update username' });
    }

    // Audit (non-blocking)
    logAudit(supabase, userId, 'USERNAME_CHANGED', { from: currentUsername, to: normalized, cost }, req).catch(() => {});

    return res.status(200).json({
      success: true,
      username: (updData as any)?.username || normalized,
      diamonds: (updData as any)?.diamonds ?? ((stats as any).diamonds || 0) - cost,
      changeCount: (updData as any)?.username_change_count ?? newCount,
      costApplied: cost
    });
  } catch (error) {
    console.error('💥 Change username error:', error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleUpdatePublicProfile(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const { userId, authToken, publicProfile } = req.body || {};

    if (!userId || !authToken || typeof publicProfile !== 'boolean') {
      return res.status(400).json({ error: 'Missing or invalid required fields' });
    }

    if (typeof userId !== 'string' || userId.length > 128) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    if (typeof authToken !== 'string' || authToken.length > 8192) {
      return res.status(400).json({ error: 'Invalid authToken' });
    }

    // Strict validation: Verify the user owns this userId
    const session = await validateSessionAndFetchPlayerStats(supabase, authToken, userId, { select: 'user_id, public' });
    const { valid, error: sessionError } = session;
    if (!valid) {
      logAudit(supabase, userId, 'PUBLIC_PROFILE_UNAUTHORIZED_ATTEMPT', { publicProfile }, req).catch(() => {});
      return res.status(401).json({ error: sessionError || 'Invalid session' });
    }

    // Verify user still exists in DB
    const { data: userExists } = await supabase
      .from('player_stats')
      .select('user_id')
      .eq('user_id', userId)
      .single();

    if (!userExists) {
      logAudit(supabase, userId, 'PUBLIC_PROFILE_USER_NOT_FOUND', { publicProfile }, req).catch(() => {});
      return res.status(404).json({ error: 'User not found' });
    }

    const { error: updErr } = await supabase
      .from('player_stats')
      .update({
        public: publicProfile,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (updErr) {
      logAudit(supabase, userId, 'PUBLIC_PROFILE_UPDATE_FAILED', { publicProfile, error: updErr.message }, req).catch(() => {});
      return res.status(500).json({ error: 'Failed to update public profile setting' });
    }

    // Audit (non-blocking)
    logAudit(supabase, userId, 'PUBLIC_PROFILE_UPDATED', { publicProfile }, req).catch(() => {});

    return res.status(200).json({ success: true, publicProfile });
  } catch (error) {
    console.error('💳 Update public profile error:', error instanceof Error ? error.message : error);
    logAudit(supabase, req.body?.userId || null, 'PUBLIC_PROFILE_ERROR', { error: error instanceof Error ? error.message : String(error) }, req).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Strictly check if a profile is public before allowing access
 * This endpoint is for rigorous verification
 */
async function handleCheckPublicProfile(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const { username } = req.body || {};
    const identifier = getIdentifier(req);

    if (!username || typeof username !== 'string') {
      console.warn(`[CHECK_PUBLIC_PROFILE] Invalid username format from ${identifier}:`, { type: typeof username, length: username?.length });
      return res.status(400).json({ error: 'Missing or invalid username' });
    }

    // 🛡️ Sanitizar username antes de buscar
    const sanitized = sanitizeUsername(username);

    if (sanitized.length > 256) {
      console.warn(`[CHECK_PUBLIC_PROFILE] Username too long from ${identifier}:`, sanitized.length);
      return res.status(400).json({ error: 'Invalid username' });
    }

    console.log(`[CHECK_PUBLIC_PROFILE] Checking profile request from ${identifier}`);

    // Fetch profile without authentication - but only public field
    const { data: profile, error } = await supabase
      .from('player_stats')
      .select('user_id, username, public')
      .ilike('username', sanitized)
      .single();

    if (error) {
      console.error(`[CHECK_PUBLIC_PROFILE] Database error:`, error.code, error.message);
      // Don't expose whether profile exists or not
      return res.status(404).json({ error: 'Profile not found' });
    }

    if (!profile) {
      console.warn(`[CHECK_PUBLIC_PROFILE] Profile not found from ${identifier}`);
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Strict check: profile must be explicitly true
    const isPublic = profile.public === true || profile.public === 'true';

    console.log(`[CHECK_PUBLIC_PROFILE] Profile (${maskUserId(profile.user_id)}): public=${profile.public} (isPublic=${isPublic}) from ${identifier}`);

    // Audit access attempts
    if (!isPublic) {
      console.warn(`[CHECK_PUBLIC_PROFILE] Access attempt to PRIVATE profile from ${identifier}`);
      logAudit(supabase, profile.user_id, 'PRIVATE_PROFILE_ACCESS_ATTEMPT', { attemptedBy: identifier }, req).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      isPublic,
      username: profile.username,
      userId: profile.user_id,
      debug: {
        publicField: profile.public,
        checked: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('💳 Check public profile error:', error instanceof Error ? error.message : error);
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

function sanitizeEntry(entry: any): { user_id: string; username: string; created_at: string } | null {
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

function normalizeList(list: any): any[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const cleaned: any[] = [];
  for (const item of list) {
    const entry = sanitizeEntry(item);
    if (entry && !seen.has(entry.user_id)) {
      seen.add(entry.user_id);
      cleaned.push(entry);
    }
  }
  return cleaned;
}

function coerceRawState(raw: any): any {
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

function normalizeState(rawState: any): any {
  const state = coerceRawState(rawState?.state || rawState || {});
  return {
    friends: normalizeList(state.friends),
    incoming: normalizeList(state.incoming),
    outgoing: normalizeList(state.outgoing)
  };
}

async function loadState(userId: string): Promise<any> {
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

async function saveState(userId: string, state: any): Promise<void> {
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

function relationship(state: any, targetId: string): string {
  if (!targetId) return 'none';
  if (state.friends.some((f: any) => f.user_id === targetId)) return 'friend';
  if (state.incoming.some((f: any) => f.user_id === targetId)) return 'incoming';
  if (state.outgoing.some((f: any) => f.user_id === targetId)) return 'outgoing';
  return 'none';
}

async function fetchUserSummary(userId: string): Promise<any> {
  const { data, error } = await supabase
    .from('player_stats')
    .select('user_id, username, avatar_url, level')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

async function fetchUsersSummaries(userIds: string[] = []): Promise<any> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return {};

  const { data, error } = await supabase
    .from('player_stats')
    .select('user_id, username, avatar_url, level')
    .in('user_id', unique);

  if (error) return {};

  const map: Record<string, any> = {};
  for (const row of (data || [])) {
    map[(row as any).user_id] = row;
  }
  return map;
}

async function getTargetByUserIdOrUsername({ targetUserId, targetUsername }: { targetUserId?: string; targetUsername?: string }): Promise<any> {
  if (!targetUserId && !targetUsername) return null;

  let query = supabase
    .from('player_stats')
    .select('user_id, username')
    .limit(1);

  if (targetUserId) {
    query = query.eq('user_id', targetUserId);
  } else if (targetUsername) {
    query = query.ilike('username', targetUsername);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data;
}

function respondError(res: ApiResponse, status: number, message: string, meta: Record<string, any> = {}): void {
  try {
    res.status(status).json({ error: message, ...meta });
  } catch (_) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Friends handlers
async function handleFetchState(req: ApiRequest, res: ApiResponse, body: any): Promise<void> {
  const { userId, authToken } = body;
  const identifier = getIdentifier(req, userId);
  const allowed = checkRateLimit(friendsRateLimits, identifier, {
    maxRequests: FRIENDS_RATE_LIMIT_MAX,
    windowMs: FRIENDS_RATE_LIMIT_WINDOW
  });
  if (!allowed) {
    res.setHeader('Retry-After', String(Math.ceil(FRIENDS_RATE_LIMIT_WINDOW / 1000)));
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
    ...state.friends.map((f: any) => f.user_id),
    ...state.incoming.map((f: any) => f.user_id),
    ...state.outgoing.map((f: any) => f.user_id)
  ];
  const profiles = await fetchUsersSummaries(ids);

  return res.status(200).json({
    success: true,
    state,
    profiles
  });
}

async function handleSearch(req: ApiRequest, res: ApiResponse, body: any): Promise<void> {
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

async function handleSendRequest(req: ApiRequest, res: ApiResponse, body: any) {
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
    res.setHeader('Retry-After', String(Math.ceil(FRIENDS_RATE_LIMIT_WINDOW / 1000)));
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

  const requesterState: any = await loadState(userId);
  const targetState: any = await loadState(target.user_id);

  const currentRelation = relationship(requesterState, target.user_id);
  if (currentRelation === 'friend') {
    return res.status(200).json({ success: true, state: requesterState, info: 'Already friends' });
  }
  if (currentRelation === 'outgoing') {
    return res.status(200).json({ success: true, state: requesterState, info: 'Request already sent' });
  }
  if (currentRelation === 'incoming') {
    requesterState.incoming = requesterState.incoming.filter((r: any) => r.user_id !== target.user_id);
    targetState.outgoing = targetState.outgoing.filter((r: any) => r.user_id !== userId);
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

async function handleAccept(req: ApiRequest, res: ApiResponse, body: any) {
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

  const hasRequest = meState.incoming.some((r: any) => r.user_id === fromUserId);
  if (!hasRequest) {
    return respondError(res, 400, 'No pending request');
  }

  meState.incoming = meState.incoming.filter((r: any) => r.user_id !== fromUserId);
  otherState.outgoing = otherState.outgoing.filter((r: any) => r.user_id !== userId);

  meState.friends.push({ user_id: fromUserId, username: fromUser.username, created_at: new Date().toISOString() });
  otherState.friends.push({ user_id: userId, username: session.stats?.username || 'Player', created_at: new Date().toISOString() });

  await Promise.all([
    saveState(userId, meState),
    saveState(fromUserId, otherState)
  ]);

  return res.status(200).json({ success: true, state: meState });
}

async function handleReject(req: ApiRequest, res: ApiResponse, body: any) {
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

  meState.incoming = meState.incoming.filter((r: any) => r.user_id !== fromUserId);
  otherState.outgoing = otherState.outgoing.filter((r: any) => r.user_id !== userId);

  await Promise.all([
    saveState(userId, meState),
    saveState(fromUserId, otherState)
  ]);

  return res.status(200).json({ success: true, state: meState });
}

async function handleCancel(req: ApiRequest, res: ApiResponse, body: any) {
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

  meState.outgoing = meState.outgoing.filter((r: any) => r.user_id !== targetUserId);
  otherState.incoming = otherState.incoming.filter((r: any) => r.user_id !== userId);

  await Promise.all([
    saveState(userId, meState),
    saveState(targetUserId, otherState)
  ]);

  return res.status(200).json({ success: true, state: meState });
}

async function handleRemoveFriend(req: ApiRequest, res: ApiResponse, body: any) {
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

  meState.friends = meState.friends.filter((r: any) => r.user_id !== targetUserId);
  otherState.friends = otherState.friends.filter((r: any) => r.user_id !== userId);

  await Promise.all([
    saveState(userId, meState),
    saveState(targetUserId, otherState)
  ]);

  return res.status(200).json({ success: true, state: meState });
}
// ============================================================
// 🛡️ CSRF TOKEN HANDLERS
// ============================================================

/**
 * Gera e retorna um token CSRF para o usuário autenticado
 * Este endpoint deve ser chamado após o login bem-sucedido
 */
async function handleGetCsrfToken(req: ApiRequest, res: ApiResponse, body: any) {
  const { userId, authToken } = body;
  
  if (!userId || !authToken) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Valida a sessão do usuário
  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'user_id' }
  );
  
  if (!session.valid) {
    return res.status(401).json({ error: session.error || 'Invalid session' });
  }

  // Gera o token CSRF
  const csrfToken = generateCsrfToken(userId);
  
  return res.status(200).json({ 
    success: true, 
    csrfToken 
  });
}

/**
 * Remove o token CSRF do usuário (útil no logout)
 */
async function handleClearCsrfToken(req: ApiRequest, res: ApiResponse, body: any) {
  const { userId, authToken } = body;
  
  if (!userId || !authToken) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Valida a sessão do usuário
  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'user_id' }
  );
  
  if (!session.valid) {
    return res.status(401).json({ error: session.error || 'Invalid session' });
  }

  // Remove o token CSRF
  clearCsrfToken(userId);
  
  return res.status(200).json({ 
    success: true 
  });
}

// ============================================================
// 2FA HANDLERS
// ============================================================

/**
 * Generate 2FA secret and QR code for setup
 */
async function handleSetup2FA(req: ApiRequest, res: ApiResponse, body: any) {
  const { userId, authToken } = body;
  
  if (!userId || !authToken) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate session
  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'user_id' }
  );
  
  if (!session.valid) {
    return res.status(401).json({ error: session.error || 'Invalid session' });
  }

  try {
    // Generate 2FA secret with QR code
    const { secret, qrCode } = generateTwoFactorSecret(userId);
    
    // Don't save to database yet - user must verify the code first
    return res.status(200).json({
      success: true,
      secret,
      qrCode,
      message: 'Please scan the QR code with your authenticator app and verify the 6-digit code'
    });
  } catch (err) {
    console.error('2FA setup error:', err);
    return res.status(500).json({ error: 'Failed to generate 2FA secret' });
  }
}

/**
 * Verify 2FA code and enable 2FA for user
 */
async function handleVerify2FA(req: ApiRequest, res: ApiResponse, body: any) {
  const { userId, authToken, secret, code } = body;
  
  if (!userId || !authToken || !secret || !code) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate session
  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'user_id' }
  );
  
  if (!session.valid) {
    return res.status(401).json({ error: session.error || 'Invalid session' });
  }

  try {
    // Verify the provided code
    const isValid = verifyTwoFactorCode(secret, code, 1); // Allow 1 period window (±30s)
    
    if (!isValid) {
      logAudit(supabase, userId, '2FA_VERIFY_FAILED', { attempt: 'invalid_code' }, req as any).catch(() => {});
      return res.status(400).json({ error: 'Invalid authentication code' });
    }

    // Save 2FA secret to user profile (encrypted ideally)
    const { error: updateError } = await supabase
      .from('player_profiles')
      .update({
        two_factor_secret: secret,
        two_factor_enabled: true,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('Failed to enable 2FA:', updateError);
      return res.status(500).json({ error: 'Failed to enable 2FA' });
    }

    logAudit(supabase, userId, '2FA_ENABLED', {}, req as any).catch(() => {});

    return res.status(200).json({
      success: true,
      message: '2FA has been successfully enabled'
    });
  } catch (err) {
    console.error('2FA verification error:', err);
    return res.status(500).json({ error: 'Failed to verify 2FA code' });
  }
}

/**
 * Disable 2FA for user
 */
async function handleDisable2FA(req: ApiRequest, res: ApiResponse, body: any) {
  const { userId, authToken, code } = body;
  
  if (!userId || !authToken || !code) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate session
  const session = await validateSessionAndFetchPlayerStats(
    supabase,
    authToken,
    userId,
    { select: 'user_id' }
  );
  
  if (!session.valid) {
    return res.status(401).json({ error: session.error || 'Invalid session' });
  }

  try {
    // Get user's 2FA secret
    const { data: profile, error: fetchError } = await supabase
      .from('player_profiles')
      .select('two_factor_secret')
      .eq('user_id', userId)
      .single();

    if (fetchError || !profile?.two_factor_secret) {
      return res.status(400).json({ error: '2FA is not enabled for this account' });
    }

    // Verify the code before disabling
    const isValid = verifyTwoFactorCode(profile.two_factor_secret, code, 1);
    
    if (!isValid) {
      logAudit(supabase, userId, '2FA_DISABLE_FAILED', { attempt: 'invalid_code' }, req as any).catch(() => {});
      return res.status(400).json({ error: 'Invalid authentication code' });
    }

    // Disable 2FA
    const { error: updateError } = await supabase
      .from('player_profiles')
      .update({
        two_factor_secret: null,
        two_factor_enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('Failed to disable 2FA:', updateError);
      return res.status(500).json({ error: 'Failed to disable 2FA' });
    }

    logAudit(supabase, userId, '2FA_DISABLED', {}, req as any).catch(() => {});

    return res.status(200).json({
      success: true,
      message: '2FA has been successfully disabled'
    });
  } catch (err) {
    console.error('2FA disable error:', err);
    return res.status(500).json({ error: 'Failed to disable 2FA' });
  }
}