// ============================================================
// API/APP.JS - BACKEND SEGURO PARA CASES E BATTLES
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { handleOpenCases } from './_caseopening.js';
import {
  applyCors,
  checkRateLimit,
  cleanupOldEntries,
  getIdentifier,
  logAudit,
  validateSessionAndFetchPlayerStats,
  logMoneyTransactionAsync,
} from './_utils.js';
import { applyReferralCommissionForSpend } from './_referrals.js';

import dotenv from 'dotenv';
dotenv.config();

// Inicializar Supabase com Service Key (bypass RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// 🛡️ RATE LIMITING
// ============================================================
const rateLimits = new Map();

let lastRateLimitCleanupAt = 0;
function maybeCleanupRateLimits() {
  const now = Date.now();
  if (now - lastRateLimitCleanupAt < 5 * 60_000) return;
  lastRateLimitCleanupAt = now;
  cleanupOldEntries(rateLimits, { maxIdleMs: 15 * 60_000 });
}

// ============================================================
// 📝 LOGGING E AUDITORIA
// ============================================================
async function logAction(userId, action, details, req) {
  return logAudit(supabase, userId, action, details, req);
}

// ============================================================
// 💰 FUNÇÃO UTILITÁRIA CENTRALIZADA PARA ATUALIZAR SALDO
// ============================================================
/**
 * Atualiza saldo do jogador de forma atômica e registra tudo
 * @param {string} userId - ID do usuário
 * @param {number} amount - Valor a adicionar/remover (negativo para gastar)
 * @param {string} reason - Motivo da transação
 * @param {number} casesOpened - Quantidade de cases abertos (opcional, padrão 0)
 * @param {Object} req - Request object para auditoria
 * @returns {Promise<number>} Novo saldo após atualização
 */
async function updatePlayerBalance(userId, amount, reason, casesOpened = 0, req = null) {
  try {
    // Atualizar saldo no banco com RPC (ATÔMICO)
    const { data: rpcResult, error: updateError } = await supabase
      .rpc('update_player_money', {
        p_user_id: userId,
        p_money_change: amount,
        p_cases_opened: casesOpened
      });

    if (updateError) {
      if (updateError.message.includes('Insufficient funds')) {
        throw new Error('Insufficient funds');
      }
      if (updateError.code === '23514' || updateError.message.includes('constraint')) {
        throw new Error('Balance changed. Please try again.');
      }
      throw new Error('Failed to update balance');
    }

    if (!rpcResult || rpcResult.length === 0) {
      throw new Error('RPC returned no data');
    }

    const newBalance = rpcResult[0].new_money;
    
    // Registrar transação na nova estrutura otimizada (non-blocking)
    logMoneyTransactionAsync(supabase, userId, amount, reason, newBalance);
    
    // Registrar auditoria
    if (req) {
      logAction(userId, 'BALANCE_UPDATED', { amount, reason, newBalance }, req).catch(() => {});
    }

    if (amount > 0) {
      // Aguarda a criação do evento para que o painel de referrals veja imediatamente
      await applyReferralCommissionForSpend({
        supabase,
        spenderId: userId,
        amountSpent: amount,
        reason,
        source: 'app',
        req
      });
    }
    
    return newBalance;
    
  } catch (error) {
    console.error('💥 updatePlayerBalance error:', error.message);
    throw error;
  }
}

// ============================================================
// 🔐 VALIDAÇÃO DE SESSÃO MELHORADA
// ============================================================
async function validateSession(authToken, expectedUserId) {
  return validateSessionAndFetchPlayerStats(supabase, authToken, expectedUserId, { select: 'user_id' });
}

// ============================================================
// MAIN HANDLER (ROTEAMENTO SEGURO)
// ============================================================
export default async function handler(req, res) {
  // 1. CORS RESTRITO (safe when env missing)
  applyCors(req, res);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { action, userId, authToken } = req.body;
  maybeCleanupRateLimits();
  
  // 2. RATE LIMITING
  const identifier = getIdentifier(req, userId);
  const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 30;
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
  if (!checkRateLimit(rateLimits, identifier, { maxRequests, windowMs })) {
    logAction(userId, 'RATE_LIMIT_EXCEEDED', { action }, req).catch(() => {});
    return res.status(429).json({ error: 'Too many requests. Please wait.' });
  }
  
  // 3. VALIDAÇÃO BÁSICA
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'Invalid action' });
  }
  
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  
  if (!authToken || typeof authToken !== 'string') {
    return res.status(400).json({ error: 'Invalid authToken' });
  }
  
  // 4. VALIDAÇÃO DE SESSÃO
  const { valid, error: sessionError } = await validateSession(authToken, userId);
  if (!valid) {
    logAction(userId, 'AUTH_FAILED', { action, error: sessionError }, req).catch(() => {});
    return res.status(401).json({ error: sessionError });
  }
  
  // 5. ROTEAMENTO
  try {
    switch (action) {
      case 'openCases':
        return await handleOpenCases(req, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Unhandled error:', error.message);
    logAction(userId, 'ERROR', { action, error: error.message }, req).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
}