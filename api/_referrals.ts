// @ts-nocheck
// ============================================================
// API/_REFERRALS.JS - Referrals & Commission System
// ============================================================

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  applyCors,
  checkRateLimit,
  cleanupOldEntries,
  getIdentifier,
  logAudit,
  validateSessionAndFetchPlayerStats,
  logMoneyTransactionAsync,
} from './_utils.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// REFERRAL SERVICE - Tiers, Bonuses & Logic
// ============================================================

export const REFERRAL_TIERS = [
  { min: 1, max: 9, rate: 0.005, label: 'Bronze' },
  { min: 10, max: 99, rate: 0.01, label: 'Silver' },
  { min: 100, max: 999, rate: 0.015, label: 'Gold' },
  { min: 1000, max: 9999, rate: 0.025, label: 'Platinum' },
  { min: 10000, max: Infinity, rate: 0.05, label: 'Diamond' }
];

const DIAMOND_BONUSES = [
  { min: 1800, max: Infinity, bonus: 18 },
  { min: 1000, max: 1799, bonus: 10 },
  { min: 400, max: 999, bonus: 4 },
  { min: 100, max: 399, bonus: 2.5 }
];

// Tipos de eventos de referral
export const REFERRAL_EVENT_TYPES = {
  LINK: 'link',
  REGISTER: 'register',
  SPEND_COMMISSION: 'spend_commission',
  WIN_COMMISSION: 'win_commission',
  DIAMOND_BONUS: 'diamond_bonus',
  WITHDRAWAL: 'withdrawal',
  DAILY_INTEREST: 'daily_interest'
};

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

export function getCommissionTier(referralCount = 0) {
  const count = normalizeNumber(referralCount, 0);
  const tier = REFERRAL_TIERS.find(t => count >= t.min && count <= t.max) || REFERRAL_TIERS[0];
  return {
    rate: tier.rate,
    label: tier.label,
    min: tier.min,
    max: tier.max
  };
}

export function getDiamondBonusForPackage(diamondsAmount = 0) {
  const amount = normalizeNumber(diamondsAmount, 0);
  const match = DIAMOND_BONUSES.find(entry => amount >= entry.min && amount <= entry.max);
  return match ? match.bonus : 0;
}

async function fetchReferrerId(referredId, sbInstance = null) {
  const sb = sbInstance || supabase;
  if (!referredId) return null;
  const { data, error } = await sb
    .from('referral_events')
    .select('referrer_id')
    .eq('referred_id', referredId)
    .in('kind', ['link', 'register'])
    .order('created_at', { ascending: true })
    .maybeSingle();

  if (error) {
    console.warn('referral: fetchReferrerId error', error.message);
    return null;
  }
  return data?.referrer_id || null;
}

async function countReferrals(referrerId, sbInstance = null) {
  const sb = sbInstance || supabase;
  if (!referrerId) return 0;
  const { count, error } = await sb
    .from('referral_events')
    .select('referred_id', { count: 'exact', head: true })
    .eq('referrer_id', referrerId)
    .in('kind', ['link', 'register']);
  if (error) {
    console.warn('referral: countReferrals error', error.message);
    return 0;
  }
  return count || 0;
}

async function recordReferralPayout({
  referrerId,
  referredId,
  amount,
  type,
  source,
  meta,
  req
}) {
  if (!referrerId || !amount || amount <= 0) return null;

  try {
    const { data, error } = await supabase
      .rpc('apply_referral_payout', {
        p_referrer_id: referrerId,
        p_referred_id: referredId,
        p_amount: amount,
        p_kind: type || 'spend_commission',
        p_source: source || 'spend',
        p_metadata: meta || null
      });

    if (!error) {
      if (req) logAudit(supabase, referrerId, 'REFERRAL_PAYOUT', { amount, type, source }, req).catch(() => {});
      return data;
    }
  } catch (err) {
    console.warn('referral: RPC apply_referral_payout unavailable, using fallback', err?.message || err);
  }

  const metadata = {
    ...(meta || {}),
    source: source || 'spend'
  };

  await supabase.from('referral_events').insert({
    referrer_id: referrerId,
    referred_id: referredId || null,
    amount: parseFloat(amount.toFixed(2)),
    kind: type || 'spend_commission',
    metadata
  });

  if (req) logAudit(supabase, referrerId, 'REFERRAL_PAYOUT_FALLBACK', { amount, type, source }, req).catch(() => {});

  return { pending_balance: null, total_earned: null };
}

export async function applyReferralCommissionForSpend({
  supabase: sb,
  spenderId,
  amountSpent,
  reason,
  source = 'spend',
  req = null
}) {
  if (!sb || !spenderId) return;
  const spent = normalizeNumber(amountSpent, 0);
  if (spent <= 0) return;

  const referrerId = await fetchReferrerId(spenderId, sb);
  if (!referrerId) return;

  const count = await countReferrals(referrerId, sb);
  const tier = getCommissionTier(count || 0);
  const commission = parseFloat((Math.abs(spent) * tier.rate).toFixed(2));
  if (commission <= 0) return;

  await recordReferralPayout({
    referrerId,
    referredId: spenderId,
    amount: commission,
    type: 'win_commission',
    source,
    meta: {
      reason: reason || 'win',
      won: Math.abs(spent),
      rate: tier.rate,
      referralCount: count || 0
    },
    req
  });
}

export async function applyReferralDiamondBonus({
  supabase: sb,
  buyerId,
  diamondsBought,
  source = 'diamond_purchase',
  req = null
}) {
  if (!sb || !buyerId) {
    console.warn('referral diamond bonus: missing supabase or buyerId');
    return;
  }
  const diamonds = normalizeNumber(diamondsBought, 0);
  if (diamonds <= 0) {
    console.warn('referral diamond bonus: invalid diamonds amount', diamondsBought);
    return;
  }

  const referrerId = await fetchReferrerId(buyerId, sb);
  if (!referrerId) {
    console.log('referral diamond bonus: no referrer found for buyer', buyerId);
    return;
  }

  const bonus = getDiamondBonusForPackage(diamonds);
  if (!bonus) {
    console.warn('referral diamond bonus: no bonus for diamonds amount', diamonds);
    return;
  }

  console.log('💎 Applying referral diamond bonus:', { referrerId, buyerId, diamonds, bonus });

  await recordReferralPayout({
    referrerId,
    referredId: buyerId,
    amount: bonus,
    type: 'diamond_bonus',
    source,
    meta: { diamonds }
  });
}

export async function getReferralSnapshot(userId, { limit = 10, offset = 0 } = {}) {
  // 🔥 VERDADE ABSOLUTA: referral_balances é a fonte única
  const { data: balance, error: balanceError } = await supabase
    .from('referral_balances')
    .select('*')
    .eq('referrer_id', userId)
    .single();

  // Se não existe, criar com zeros (trigger vai manter sincronizado)
  if (balanceError || !balance) {
    const { data: newBalance, error: insertError } = await supabase
      .from('referral_balances')
      .insert({
        referrer_id: userId,
        pending_balance: 0,
        total_earned: 0,
        total_withdrawn: 0,
        referred_count: 0,
        last_withdraw_at: null
      })
      .select()
      .single();

    if (insertError || !newBalance) {
      console.error('Error creating referral_balances record:', insertError);
      throw new Error('Failed to initialize referral balance');
    }

    balance = newBalance;
  }

  // 🔥 VALORES VÊEM EXCLUSIVAMENTE DE referral_balances
  const pendingBalance = Number(balance.pending_balance || 0);
  const totalEarned = Number(balance.total_earned || 0);
  const totalWithdrawn = Number(balance.total_withdrawn || 0);
  const lastWithdrawAt = balance.last_withdraw_at;
  const referredCount = balance.referred_count || 0;

  // Histórico vem de referral_events (para exibição)
  const { data: transactions = [] } = await supabase
    .from('referral_events')
    .select('id, amount, kind, created_at, referred_id, metadata')
    .eq('referrer_id', userId)
    .not('kind', 'in', '("link","register")')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  return {
    balance: {
      referrer_id: userId,
      pending_balance: pendingBalance,
      total_withdrawn: totalWithdrawn,
      total_earned: totalEarned,
      referred_count: referredCount,
      last_withdraw_at: lastWithdrawAt
    },
    referredCount,
    transactions: (transactions || []).map(tx => ({
      ...tx,
      type: tx.kind
    }))
  };
}

// ============================================================
// API SECTION - Handlers
// ============================================================

const rateLimits = new Map();
let lastRateLimitCleanupAt = 0;

function maybeCleanupRateLimits() {
  const now = Date.now();
  if (now - lastRateLimitCleanupAt < 5 * 60_000) return;
  lastRateLimitCleanupAt = now;
  cleanupOldEntries(rateLimits, { maxIdleMs: 15 * 60_000 });
}

async function validateSession(authToken, expectedUserId) {
  return validateSessionAndFetchPlayerStats(supabase, authToken, expectedUserId, { select: 'user_id, username' });
}

function sanitizeCode(code) {
  if (!code) return null;
  return String(code).trim();
}

function buildShareLink(username, req) {
  const fallbackHost = req?.headers?.host ? `https://${req.headers.host}` : null;
  const base = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || fallbackHost || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/auth?ref=${encodeURIComponent(username)}`;
}

async function grantDiamonds(userId, amount, reason = 'Referral bonus') {
  if (!userId || amount <= 0) return null;

  const { data: current, error: fetchError } = await supabase
    .from('player_stats')
    .select('diamonds')
    .eq('user_id', userId)
    .single();

  if (fetchError || !current) throw new Error('Failed to fetch diamonds');

  const currentDiamonds = Number(current.diamonds || 0);
  const nextDiamonds = currentDiamonds + amount;

  const { data: updateResult, error: updateError } = await supabase
    .from('player_stats')
    .update({ diamonds: nextDiamonds })
    .eq('user_id', userId)
    .eq('diamonds', currentDiamonds)
    .select('diamonds');

  if (updateError || !updateResult?.length) {
    throw new Error('Failed to update diamonds');
  }

  await supabase.from('diamond_transactions').insert({
    user_id: userId,
    amount,
    reason,
    balance_after: nextDiamonds
  });

  return nextDiamonds;
}

async function handleRegisterReferral(req, res, { userId, username }) {
  const referralCodeRaw = req.body?.referralCode;
  const referralCode = sanitizeCode(referralCodeRaw);

  if (!referralCode) {
    return res.status(400).json({ error: 'Referral code is required' });
  }

  if (referralCode.toLowerCase() === String(username || '').toLowerCase()) {
    return res.status(400).json({ error: 'You cannot refer yourself' });
  }

  const { data: existingLink } = await supabase
    .from('referral_events')
    .select('referrer_id')
    .eq('referred_id', userId)
    .eq('kind', 'link')
    .maybeSingle();

  if (existingLink?.referrer_id) {
    return res.status(200).json({ success: true, alreadyLinked: true });
  }

  const { data: referrer, error: referrerError } = await supabase
    .from('player_stats')
    .select('user_id, username')
    .ilike('username', referralCode)
    .single();

  if (referrerError || !referrer) {
    return res.status(404).json({ error: 'Referral code not found' });
  }

  if (referrer.user_id === userId) {
    return res.status(400).json({ error: 'You cannot refer yourself' });
  }

  const insertPayload = {
    referrer_id: referrer.user_id,
    referred_id: userId,
    kind: 'link',
    metadata: { referred_username: username || null, referrer_username: referrer.username || null, source: 'signup' }
  };

  const { error: insertError } = await supabase
    .from('referral_events')
    .insert(insertPayload);

  if (insertError) {
    console.error('referral: insert relation error', insertError);
    return res.status(500).json({ error: 'Failed to link referral' });
  }

  const bonusDiamonds = 100;
  try {
    await grantDiamonds(userId, bonusDiamonds, 'Referral signup bonus');
  } catch (err) {
    console.warn('referral: grant diamonds failed', err.message);
  }

  logAudit(supabase, userId, 'REFERRAL_LINKED', { referrerId: referrer.user_id }, req).catch(() => {});
  logAudit(supabase, referrer.user_id, 'REFERRAL_NEW_USER', { referredId: userId }, req).catch(() => {});

  return res.status(200).json({ success: true, referrerId: referrer.user_id, bonusDiamonds });
}

function getNextWithdrawInfo(lastWithdrawAt) {
  if (!lastWithdrawAt) return { canWithdraw: true, nextWithdrawAt: null };
  
  const now = new Date();
  const last = new Date(lastWithdrawAt);
  
  // Verificar se o último saque foi no mesmo dia UTC
  const lastDayUTC = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  
  // Se foi no mesmo dia UTC, não pode sacar
  if (lastDayUTC === todayUTC) {
    // Próximo saque: 00:00 UTC de amanhã
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    return { canWithdraw: false, nextWithdrawAt: next.toISOString() };
  }
  
  return { canWithdraw: true, nextWithdrawAt: null };
}

async function handleGetReferralStats(req, res, { userId, username }) {
  const snapshot = await getReferralSnapshot(userId, { limit: 10, offset: 0 });
  const balance = snapshot.balance;
  const referredCount = snapshot.referredCount;
  const tier = getCommissionTier(referredCount);
  const { canWithdraw, nextWithdrawAt } = getNextWithdrawInfo(balance.last_withdraw_at);
  const shareLink = buildShareLink(username, req);

  return res.status(200).json({
    success: true,
    code: username,
    shareLink,
    referredCount,
    tierPercent: tier.rate * 100,
    tierLabel: tier.label,
    pendingBalance: Number(balance.pending_balance || 0),
    totalWithdrawn: Number(balance.total_withdrawn || 0),
    totalEarned: Number(balance.total_earned || 0),
    lastWithdrawAt: balance.last_withdraw_at,
    nextWithdrawAt,
    canWithdraw,
    transactions: snapshot.transactions || []
  });
}

async function handleGetTransactionHistory(req, res, { userId }) {
  const page = Math.max(1, Number(req.body?.page || 1));
  const pageSize = Math.min(50, Math.max(5, Number(req.body?.pageSize || 15)));
  const offset = (page - 1) * pageSize;

  const { data: transactions = [], error } = await supabase
    .from('referral_events')
    .select('id, amount, kind, created_at, referred_id, metadata')
    .eq('referrer_id', userId)
    .not('kind', 'in', '("link","register")')
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    console.error('referral: history error', error);
    return res.status(500).json({ error: 'Failed to load history' });
  }

  const { count } = await supabase
    .from('referral_events')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', userId)
    .not('kind', 'in', '("link","register")');

  return res.status(200).json({
    success: true,
    transactions: (transactions || []).map(tx => ({
      ...tx,
      type: tx.kind
    })),
    page,
    pageSize,
    total: count || 0
  });
}

async function handleWithdrawEarnings(req, res, { userId }) {
  const snapshot = await getReferralSnapshot(userId, { limit: 0, offset: 0 });
  const balance = snapshot.balance;
  const pending = Number(balance.pending_balance || 0);

  if (pending <= 0) {
    return res.status(400).json({ error: 'No earnings available to withdraw' });
  }

  const { canWithdraw, nextWithdrawAt } = getNextWithdrawInfo(balance.last_withdraw_at);
  if (!canWithdraw) {
    return res.status(429).json({ error: 'Withdraw already done today', nextWithdrawAt });
  }

  const nowIso = new Date().toISOString();

  const { data: moneyResult, error: moneyError } = await supabase
    .rpc('update_player_money', {
      p_user_id: userId,
      p_money_change: pending,
      p_cases_opened: 0
    });

  if (moneyError) {
    console.error('referral: withdraw credit failed', moneyError);
    return res.status(500).json({ error: 'Failed to credit balance, please contact support' });
  }

  const newWalletBalance = moneyResult?.[0]?.new_money ?? null;

  // Registrar transação na nova estrutura otimizada (non-blocking)
  logMoneyTransactionAsync(supabase, userId, pending, 'referral_withdrawal', newWalletBalance);

  const { error: evError } = await supabase.from('referral_events').insert({
    referrer_id: userId,
    referred_id: null,
    amount: pending,
    kind: 'withdrawal',
    metadata: { newWalletBalance, source: 'referral' }
  });

  if (evError) {
    console.error('referral: withdraw event failed', evError);
    return res.status(500).json({ error: 'Failed to record withdraw' });
  }

  logAudit(supabase, userId, 'REFERRAL_WITHDRAW', { amount: pending }, req).catch(() => {});

  const totalWithdrawn = Number(balance.total_withdrawn || 0) + pending;

  return res.status(200).json({
    success: true,
    withdrawn: pending,
    newWalletBalance,
    totalWithdrawn,
    lastWithdrawAt: nowIso
  });
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, userId, authToken } = req.body;
  maybeCleanupRateLimits();

  const identifier = getIdentifier(req, userId);
  if (!checkRateLimit(rateLimits, identifier, { maxRequests: 30, windowMs: 60_000 })) {
    logAudit(supabase, userId, 'REFERRAL_RATE_LIMIT', { action }, req).catch(() => {});
    return res.status(429).json({ error: 'Too many requests. Please wait.' });
  }

  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'Invalid action' });
  }
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  if (!authToken || typeof authToken !== 'string') {
    return res.status(400).json({ error: 'Invalid authToken' });
  }

  const { valid, error: sessionError, stats } = await validateSession(authToken, userId);
  if (!valid) {
    logAudit(supabase, userId, 'REFERRAL_AUTH_FAILED', { action, error: sessionError }, req).catch(() => {});
    return res.status(401).json({ error: sessionError });
  }

  try {
    switch (action) {
      case 'registerReferral':
        return await handleRegisterReferral(req, res, { userId, username: stats?.username });
      case 'getReferralStats':
        return await handleGetReferralStats(req, res, { userId, username: stats?.username });
      case 'withdrawEarnings':
        return await handleWithdrawEarnings(req, res, { userId });
      case 'getTransactionHistory':
        return await handleGetTransactionHistory(req, res, { userId });
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('referral: unhandled error', error);
    logAudit(supabase, userId, 'REFERRAL_ERROR', { action, error: error.message }, req).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
}