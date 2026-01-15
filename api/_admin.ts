// @ts-nocheck
// ============================================================
// API/ADMIN.JS - BACKEND ULTRA SEGURO
// ============================================================

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  applyCors,
  checkRateLimit,
  cleanupOldEntries,
  getIdentifier,
  incrementWindowCounter,
  isWindowLimitExceeded,
  logAudit,
} from './_utils.js';
import { applyReferralDiamondBonus } from './_referrals.js';
dotenv.config();

// Inicializar Supabase com Service Key (bypass RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// 🛡️ RATE LIMITING MELHORADO
// ============================================================
const rateLimits = new Map();
const failedAttempts = new Map();

let lastRateLimitCleanupAt = 0;
function maybeCleanupRateLimits() {
  const now = Date.now();
  if (now - lastRateLimitCleanupAt < 60_000) return;
  lastRateLimitCleanupAt = now;
  cleanupOldEntries(rateLimits, { maxIdleMs: 15 * 60_000 });
  cleanupOldEntries(failedAttempts, { maxIdleMs: 30 * 60_000 });
}

// ============================================================
// 📝 LOGGING E AUDITORIA
// ============================================================
async function logAction(userId, action, details, req) {
  return logAudit(supabase, userId, action, details, req);
}

// ============================================================
// 🔐 VALIDAÇÃO DE SESSÃO E ADMIN (CRÍTICO)
// ============================================================
async function validateAdminSession(authToken, expectedUserId, ipAddress) {
  try {
    // 1. Validar formato do token
    if (!authToken || typeof authToken !== 'string' || authToken.length < 20) {
      return { valid: false, error: 'Invalid token format' };
    }

    // 2. Verificar usuário via token do Supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser(authToken);
    
    if (authError || !user) {
      return { valid: false, error: 'Invalid session' };
    }
    
    // 3. CRÍTICO: Verificar se o usuário bate com o esperado
    if (user.id !== expectedUserId) {
      return { valid: false, error: 'User mismatch' };
    }
    
    // 4. Buscar role DIRETAMENTE do banco (usando service key)
    const { data: stats, error: statsError } = await supabase
      .from('player_stats')
      .select('role, user_id')
      .eq('user_id', expectedUserId)
      .single();
    
    if (statsError || !stats) {
      return { valid: false, error: 'User not found' };
    }
    
    // 5. CRÍTICO: Verificar role novamente
    if (stats.user_id !== expectedUserId) {
      return { valid: false, error: 'Data integrity error' };
    }
    
    if (stats.role !== 'admin' && stats.role !== 'support') {
      return { valid: false, error: 'Insufficient permissions' };
    }
    
    return { 
      valid: true, 
      user, 
      role: stats.role,
      userId: expectedUserId 
    };
    
  } catch (err) {
    console.error('Admin validation error:', err.message);
    return { valid: false, error: 'Validation failed' };
  }
}

// ============================================================
// 💎 FUNÇÃO PARA ATUALIZAR DIAMANTES (COM TRANSAÇÃO)
// ============================================================
async function updatePlayerDiamonds(userId, amount, reason, req = null) {
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
        created_at: new Date().toISOString()
      }),
      req ? logAction(userId, 'DIAMONDS_UPDATED', { 
        amount, 
        reason, 
        newBalance: finalDiamonds 
      }, req) : Promise.resolve()
    ]).catch(err => {
      console.error('⚠️ Transaction logging error:', err);
    });
    
    return finalDiamonds;
    
  } catch (error) {
    console.error('💥 updatePlayerDiamonds error:', error.message);
    throw error;
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  const startTime = Date.now();
  
  // 1. CORS RESTRITO
  applyCors(req, res);
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // 2. EXTRAIR IP
  const ipAddress = getIdentifier(req, null);
  
  // 3. VALIDAR BODY
  let body;
  try {
    body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  
  const { action, userId, authToken } = body;
  maybeCleanupRateLimits();
  
  // 4. VALIDAÇÃO BÁSICA
  if (!action || typeof action !== 'string' || action.length > 50) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  
  if (!userId || typeof userId !== 'string' || userId.length > 100) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  
  if (!authToken || typeof authToken !== 'string') {
    return res.status(400).json({ error: 'Invalid authToken' });
  }
  
  // 5. RATE LIMITING
  const identifier = `${userId}:${ipAddress}`;
  
  // Verificar se está bloqueado por tentativas falhas
  if (isWindowLimitExceeded(failedAttempts, identifier, { maxCount: 5, windowMs: 300_000 })) {
    logAction(userId, 'ADMIN_BLOCKED_FAILED_ATTEMPTS', { ipAddress }, req).catch(() => {});
    return res.status(429).json({ 
      error: 'Too many failed attempts. Try again later.' 
    });
  }
  
  if (!checkRateLimit(rateLimits, identifier, { maxRequests: 10, windowMs: 60_000 })) {
    logAction(userId, 'ADMIN_RATE_LIMIT_EXCEEDED', { action, ipAddress }, req).catch(() => {});
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  // 6. VALIDAÇÃO DE ADMIN (CRÍTICO)
  const validation = await validateAdminSession(authToken, userId, ipAddress);
  
  if (!validation.valid) {
    incrementWindowCounter(failedAttempts, identifier, { windowMs: 300_000 });
    logAction(userId, 'ADMIN_AUTH_FAILED', { 
      action, 
      error: validation.error,
      ipAddress 
    }, req).catch(() => {});
    return res.status(401).json({ error: validation.error });
  }
  
  // 7. ROTEAMENTO
  try {
    let result;
    
    switch (action) {
      case 'approveOrder':
        result = await handleApproveOrder(req, res, validation);
        break;
      case 'rejectOrder':
        result = await handleRejectOrder(req, res, validation);
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    const duration = Date.now() - startTime;
    
    return result;
    
  } catch (error) {
    console.error('Unhandled error:', error.message);
    logAction(userId, 'ADMIN_ERROR', { 
      action, 
      error: error.message,
      ipAddress 
    }, req).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// HANDLER 1: APROVAR PEDIDO
// ============================================================
async function handleApproveOrder(req, res, validation) {
  const { userId, role, user } = validation;
  const { orderId } = req.body;
  
  try {
    // 1. Validar orderId
    if (!orderId || typeof orderId !== 'string' || orderId.length > 100) {
      return res.status(400).json({ error: 'Invalid orderId' });
    }
    
    // 2. BUSCAR PEDIDO COM LOCK
    const { data: order, error: orderError } = await supabase
      .from('purchase_orders')
      .select('id, status, user_id, user_email, diamonds_base, diamonds_bonus')
      .eq('id', orderId)
      .single();
    
    if (orderError || !order) {
      logAction(userId, 'APPROVE_ORDER_NOT_FOUND', { orderId }, req).catch(() => {});
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // 3. VALIDAR STATUS
    if (order.status !== 'pending') {
      logAction(userId, 'APPROVE_ORDER_ALREADY_PROCESSED', { 
        orderId, 
        status: order.status 
      }, req).catch(() => {});
      return res.status(400).json({ 
        error: `Order already processed (${order.status})` 
      });
    }
    
    // 4. VALIDAR DADOS DO PEDIDO - CORRIGIDO AQUI
    if (!order.user_id) {
      logAction(userId, 'APPROVE_ORDER_INVALID_DATA', { orderId, reason: 'missing user_id' }, req).catch(() => {});
      return res.status(400).json({ error: 'Invalid order data: missing user_id' });
    }
    
    // Garantir que diamonds_base e diamonds_bonus sejam números
    const diamondsBase = parseInt(order.diamonds_base) || 0;
    const diamondsBonus = parseInt(order.diamonds_bonus) || 0;
    
    if (diamondsBase < 0 || diamondsBonus < 0) {
      logAction(userId, 'APPROVE_ORDER_INVALID_DATA', { orderId, reason: 'negative diamonds' }, req).catch(() => {});
      return res.status(400).json({ error: 'Invalid order data: negative diamond values' });
    }
    
    const totalDiamonds = diamondsBase + diamondsBonus;
    
    if (totalDiamonds <= 0 || totalDiamonds > 1000000) {
      logAction(userId, 'APPROVE_ORDER_INVALID_AMOUNT', { 
        orderId, 
        totalDiamonds 
      }, req).catch(() => {});
      return res.status(400).json({ error: 'Invalid diamond amount' });
    }
    
    // 5. VERIFICAR SE USUÁRIO EXISTE
    const { data: targetStats, error: statsError } = await supabase
      .from('player_stats')
      .select('diamonds, username, user_id')
      .eq('user_id', order.user_id)
      .single();
    
    if (statsError || !targetStats) {
      logAction(userId, 'APPROVE_ORDER_USER_NOT_FOUND', { 
        orderId, 
        targetUserId: order.user_id 
      }, req).catch(() => {});
      return res.status(404).json({ error: 'Target user not found' });
    }
    
    // 6. ATUALIZAR PEDIDO COM LOCK OTIMISTA
    const { data: updateResult, error: updateOrderError } = await supabase
      .from('purchase_orders')
      .update({
        status: 'approved',
        reviewed_by: userId,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .eq('status', 'pending') // LOCK OTIMISTA
      .select();

    if (updateOrderError) {
      console.error('Update order error:', updateOrderError);
      logAction(userId, 'APPROVE_ORDER_UPDATE_FAILED', { 
        orderId, 
        error: updateOrderError.message 
      }, req).catch(() => {});
      return res.status(500).json({ error: 'Failed to update order' });
    }
    
    if (!updateResult || updateResult.length === 0) {
      logAction(userId, 'APPROVE_ORDER_RACE_CONDITION', { orderId }, req).catch(() => {});
      return res.status(409).json({ 
        error: 'Order was already processed by another admin' 
      });
    }
    
    if (updateResult[0].status !== 'approved') {
      logAction(userId, 'APPROVE_ORDER_STATUS_MISMATCH', { 
        orderId, 
        actualStatus: updateResult[0].status 
      }, req).catch(() => {});
      return res.status(500).json({ error: 'Status update verification failed' });
    }

    // 7. ADICIONAR DIAMANTES
    let newBalance;
    try {
      newBalance = await updatePlayerDiamonds(
        order.user_id,
        totalDiamonds,
        `Purchase order #${orderId.slice(0, 8)} approved by admin`,
        req
      );
    } catch (error) {
      console.error('Failed to add diamonds:', error);
      
      // ROLLBACK: Reverter status do pedido
      await supabase
        .from('purchase_orders')
        .update({ 
          status: 'pending', 
          reviewed_by: null, 
          reviewed_at: null 
        })
        .eq('id', orderId);
      
      logAction(userId, 'APPROVE_ORDER_DIAMONDS_FAILED', { 
        orderId, 
        error: error.message 
      }, req).catch(() => {});
      return res.status(500).json({ 
        error: 'Failed to add diamonds (order reverted)' 
      });
    }

    try {
      await applyReferralDiamondBonus({
        supabase,
        buyerId: order.user_id,
        diamondsBought: diamondsBase,
        source: 'shop_order',
        req
      });
      console.log('✅ Referral diamond bonus applied for order', orderId, 'diamonds:', diamondsBase);
    } catch (err) {
      console.error('❌ Referral diamond bonus failed:', err?.message || err, { orderId, buyerId: order.user_id, diamonds: diamondsBase });
    }
    
    // 8. LOG DE SUCESSO
    logAction(userId, 'APPROVE_ORDER_SUCCESS', {
      orderId,
      targetUserId: order.user_id,
      targetEmail: order.user_email,
      diamondsAdded: totalDiamonds,
      newBalance: newBalance,
      adminRole: role
    }, req).catch(() => {});
    
    // 9. RETORNAR SUCESSO
    const yourNewBalance = (order.user_id === userId) ? newBalance : null;
    
    return res.status(200).json({
      success: true,
      message: `Order approved! ${totalDiamonds} diamonds added to ${order.user_email}`,
      yourNewBalance: yourNewBalance
    });
    
  } catch (error) {
    console.error('💥 Error in handleApproveOrder:', error.message);
    logAction(userId, 'APPROVE_ORDER_ERROR', { 
      error: error.message 
    }, req).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// HANDLER 2: REJEITAR PEDIDO
// ============================================================
async function handleRejectOrder(req, res, validation) {
  const { userId, role } = validation;
  const { orderId } = req.body;
  
  try {
    // 1. Validar orderId
    if (!orderId || typeof orderId !== 'string' || orderId.length > 100) {
      return res.status(400).json({ error: 'Invalid orderId' });
    }
    
    // 2. BUSCAR PEDIDO
    const { data: order, error: orderError } = await supabase
      .from('purchase_orders')
      .select('status, user_email, id')
      .eq('id', orderId)
      .single();
    
    if (orderError || !order) {
      logAction(userId, 'REJECT_ORDER_NOT_FOUND', { orderId }, req).catch(() => {});
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // 3. VALIDAR STATUS
    if (order.status !== 'pending') {
      logAction(userId, 'REJECT_ORDER_ALREADY_PROCESSED', { 
        orderId, 
        status: order.status 
      }, req).catch(() => {});
      return res.status(400).json({ 
        error: `Order already processed (${order.status})` 
      });
    }
    
    // 4. ATUALIZAR STATUS COM LOCK OTIMISTA
    const { data: updateResult, error: updateError } = await supabase
      .from('purchase_orders')
      .update({
        status: 'rejected',
        reviewed_by: userId,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .eq('status', 'pending') // LOCK OTIMISTA
      .select();

    if (updateError) {
      console.error('Update order error:', updateError);
      logAction(userId, 'REJECT_ORDER_UPDATE_FAILED', { 
        orderId, 
        error: updateError.message 
      }, req).catch(() => {});
      return res.status(500).json({ error: 'Failed to update order' });
    }
    
    if (!updateResult || updateResult.length === 0) {
      logAction(userId, 'REJECT_ORDER_RACE_CONDITION', { orderId }, req).catch(() => {});
      return res.status(409).json({ 
        error: 'Order was already processed by another admin' 
      });
    }
    
    if (updateResult[0].status !== 'rejected') {
      logAction(userId, 'REJECT_ORDER_STATUS_MISMATCH', { 
        orderId, 
        actualStatus: updateResult[0].status 
      }, req).catch(() => {});
      return res.status(500).json({ error: 'Status update verification failed' });
    }

    // 5. LOG DE SUCESSO
    logAction(userId, 'REJECT_ORDER_SUCCESS', {
      orderId,
      targetEmail: order.user_email,
      adminRole: role
    }, req).catch(() => {});
    
    return res.status(200).json({
      success: true,
      message: 'Order rejected successfully'
    });
    
  } catch (error) {
    console.error('💥 Error in handleRejectOrder:', error.message);
    logAction(userId, 'REJECT_ORDER_ERROR', { 
      error: error.message 
    }, req).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
}