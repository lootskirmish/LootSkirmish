// ============================================================
// API/INVENTORY.TS - BACKEND SEGURO PARA INVENTÁRIO
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
// TYPES
// ============================================================

interface ApiRequest {
  method?: string;
  body?: {
    action?: string;
    userId?: string;
    authToken?: string;
    itemId?: string;
    itemIds?: string[];
    [key: string]: any;
  };
  headers?: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (data: any) => void;
  end: (data?: any) => void;
  setHeader: (key: string, value: string) => void;
}

interface InventoryItem {
  id: string;
  user_id: string;
  item_name: string;
  rarity: string;
  color: string;
  value: number;
  case_name: string;
  obtained_at: string;
}

// Inicializar Supabase com Service Key (bypass RLS)
const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// ============================================================
// 🛡️ RATE LIMITING
// ============================================================
const rateLimits = new Map();

let lastRateLimitCleanupAt: number = 0;
function maybeCleanupRateLimits(): void {
  const now = Date.now();
  if (now - lastRateLimitCleanupAt < 5 * 60_000) return;
  lastRateLimitCleanupAt = now;
  cleanupOldEntries(rateLimits, { maxIdleMs: 15 * 60_000 });
}

// ============================================================
// 📝 LOGGING
// ============================================================
async function logAction(userId: string, action: string, details: any, req: ApiRequest): Promise<void> {
  return logAudit(supabase, userId, action, details, req as any);
}

// ============================================================
// 🔐 VALIDAÇÃO DE SESSÃO
// ============================================================
async function validateSession(authToken: string, expectedUserId: string): Promise<any> {
  return validateSessionAndFetchPlayerStats(supabase, authToken, expectedUserId, { select: 'user_id' });
}

// ============================================================
// 🔍 VALIDAÇÃO DE OWNERSHIP
// ============================================================
async function validateItemOwnership(itemId: string, userId: string): Promise<InventoryItem | null> {
  try {
    const { data: item, error } = await supabase
      .from('inventory')
      .select('id, user_id, item_name, rarity, color, value, case_name, obtained_at')
      .eq('id', itemId)
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error) {
      console.error('❌ Supabase error:', error);
      return null;
    }
    
    if (!item) {
      return null;
    }
    
    if (typeof item.value !== 'number' || item.value < 0 || !isFinite(item.value)) {
      console.error('Invalid item value:', item.value);
      return null;
    }
    
    return item;
  } catch (err) {
    console.error('Error validating item:', err);
    return null;
  }
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req as any, res as any);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { action, userId, authToken } = req.body || {};

  maybeCleanupRateLimits();

  const identifier = getIdentifier(req as any, userId);
  if (!checkRateLimit(rateLimits, identifier, { maxRequests: 50, windowMs: 60_000 })) {
    logAction(userId || 'unknown', 'RATE_LIMIT_EXCEEDED', { action }, req).catch(() => {});
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
  
  const { valid, error: sessionError } = await validateSession(authToken, userId);
  if (!valid) {
    logAction(userId, 'AUTH_FAILED', { action, error: sessionError }, req).catch(() => {});
    return res.status(401).json({ error: sessionError });
  }
  
  try {
    switch (action) {
      case 'sellItem':
        return await handleSellItem(req, res, userId, authToken);
      case 'sellSelected':
        return await handleSellSelected(req, res, userId, authToken);
      case 'sellAll':
        return await handleSellAll(req, res, userId, authToken);
      case 'upgradeInventory':
        return await handleUpgradeInventory(req, res, userId, authToken);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    const err = error as Error;
    console.error('Unhandled error:', err.message);
    logAction(userId || 'unknown', 'ERROR', { action, error: err.message }, req).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// HANDLER 1: VENDER ITEM INDIVIDUAL
// ============================================================
async function handleSellItem(req: ApiRequest, res: ApiResponse, userId: string, authToken: string): Promise<void> {
  try {
    const { itemId } = req.body || {};
    
    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ error: 'Invalid item ID' });
    }
    
    const item = await validateItemOwnership(itemId, userId);
    
    if (!item) {
      logAction(userId, 'SELL_ITEM_NOT_FOUND', { itemId }, req).catch(() => {});
      return res.status(404).json({ error: 'Item not found or not owned by you' });
    }
    
    const itemValue = parseFloat(item.value.toFixed(2));
    
    const { error: deleteError } = await supabase
      .from('inventory')
      .delete()
      .eq('id', itemId)
      .eq('user_id', userId);
    
    if (deleteError) {
      console.error('Delete error:', deleteError);
      logAction(userId, 'SELL_ITEM_DELETE_FAILED', { itemId, error: deleteError.message }, req).catch(() => {});
      return res.status(500).json({ error: 'Failed to delete item' });
    }
    
    let newBalance;
    try {
      newBalance = await updatePlayerBalance(
        supabase,
        userId,
        itemValue,
        `Sold ${item.item_name}`,
        { casesOpened: 0, req }
      );
    } catch (error) {
      const err = error as Error;
      console.error('💥 Balance update failed after delete:', err.message);
      
      await supabase.from('inventory').insert({
        id: item.id,
        user_id: item.user_id,
        item_name: item.item_name,
        rarity: item.rarity,
        color: item.color,
        value: item.value,
        case_name: item.case_name,
        obtained_at: item.obtained_at
      });
      
      logAction(userId, 'SELL_ITEM_BALANCE_FAILED_ROLLBACK', { itemId, error: err.message }, req).catch(() => {});
      return res.status(500).json({ error: 'Transaction failed. Item restored.' });
    }
    
    logAction(userId, 'SELL_ITEM_SUCCESS', {
      itemId,
      itemName: item.item_name,
      value: itemValue,
      newBalance
    }, req).catch(() => {});
    
    return res.status(200).json({
      success: true,
      soldValue: itemValue,
      newBalance: newBalance,
      itemName: item.item_name
    });
    
  } catch (error) {
    const err = error as Error;
    console.error('💥 Error in handleSellItem:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// HANDLER 2: VENDER MÚLTIPLOS ITENS
// ============================================================
async function handleSellSelected(req: ApiRequest, res: ApiResponse, userId: string, authToken: string): Promise<void> {
  try {
    const { itemIds } = req.body || {};
    
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'Invalid item IDs' });
    }
    
    if (itemIds.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 items at once' });
    }
    
    const { data: items, error: fetchError } = await supabase
      .from('inventory')
      .select('id, user_id, item_name, rarity, color, value, case_name, obtained_at')
      .in('id', itemIds)
      .eq('user_id', userId);
    
    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch items' });
    }
    
    if (!items || items.length === 0) {
      logAction(userId, 'SELL_SELECTED_NO_ITEMS', { requestedCount: itemIds.length }, req).catch(() => {});
      return res.status(404).json({ error: 'No valid items found' });
    }
    
    const validItems = items.filter(item => 
      typeof item.value === 'number' && 
      item.value >= 0 && 
      isFinite(item.value)
    );
    
    if (validItems.length === 0) {
      return res.status(400).json({ error: 'No valid items to sell' });
    }
    
    const totalValue = parseFloat(validItems.reduce((sum, item) => sum + item.value, 0).toFixed(2));
    
    const validItemIds = validItems.map(item => item.id);
    
    const { error: deleteError } = await supabase
      .from('inventory')
      .delete()
      .in('id', validItemIds)
      .eq('user_id', userId);
    
    if (deleteError) {
      console.error('Delete error:', deleteError);
      logAction(userId, 'SELL_SELECTED_DELETE_FAILED', { 
        count: validItemIds.length, 
        error: deleteError.message 
      }, req).catch(() => {});
      return res.status(500).json({ error: 'Failed to delete items' });
    }
    
    let newBalance;
    try {
        newBalance = await updatePlayerBalance(
          supabase,
          userId,
          totalValue,
          `Sold ${validItems.length} items (bulk)`,
          { casesOpened: 0, req }
      );
    } catch (error) {
      const err = error as Error;
      console.error('💥 Balance update failed after delete:', err.message);
      
      await supabase.from('inventory').insert(
        validItems.map(item => ({
          id: item.id,
          user_id: item.user_id,
          item_name: item.item_name,
          rarity: item.rarity,
          color: item.color,
          value: item.value,
          case_name: item.case_name,
          obtained_at: item.obtained_at
        }))
      );
      
      logAction(userId, 'SELL_SELECTED_BALANCE_FAILED_ROLLBACK', { 
        count: validItems.length, 
        error: err.message 
      }, req).catch(() => {});
      return res.status(500).json({ error: 'Transaction failed. Items restored.' });
    }
    
    logAction(userId, 'SELL_SELECTED_SUCCESS', {
      count: validItems.length,
      totalValue,
      newBalance
    }, req).catch(() => {});
    
    return res.status(200).json({
      success: true,
      soldCount: validItems.length,
      totalValue: totalValue,
      newBalance: newBalance
    });
    
  } catch (error) {
    const err = error as Error;
    console.error('💥 Error in handleSellSelected:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// HANDLER 3: VENDER POR RARIDADE
// ============================================================
async function handleSellAll(req: ApiRequest, res: ApiResponse, userId: string, authToken: string): Promise<void> {
  try {
    const { rarities } = req.body || {};
    
    if (!Array.isArray(rarities) || rarities.length === 0) {
      return res.status(400).json({ error: 'Invalid rarities' });
    }
    
    const validRarities = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
    const filteredRarities = rarities.filter(r => validRarities.includes(r));
    
    if (filteredRarities.length === 0) {
      return res.status(400).json({ error: 'No valid rarities' });
    }
    
    const { data: items, error: fetchError } = await supabase
      .from('inventory')
      .select('id, user_id, item_name, rarity, color, value, case_name, obtained_at')
      .eq('user_id', userId)
      .in('rarity', filteredRarities);
    
    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch items' });
    }
    
    if (!items || items.length === 0) {
      logAction(userId, 'SELL_ALL_NO_ITEMS', { rarities: filteredRarities }, req).catch(() => {});
      return res.status(404).json({ error: 'No items found with selected rarities' });
    }
    
    const validItems = items.filter(item => 
      typeof item.value === 'number' && 
      item.value >= 0 && 
      isFinite(item.value)
    );
    
    if (validItems.length === 0) {
      return res.status(400).json({ error: 'No valid items to sell' });
    }
    
    const totalValue = parseFloat(validItems.reduce((sum, item) => sum + item.value, 0).toFixed(2));
    
    const validItemIds = validItems.map(item => item.id);
    
    const { error: deleteError } = await supabase
      .from('inventory')
      .delete()
      .in('id', validItemIds)
      .eq('user_id', userId);
    
    if (deleteError) {
      console.error('Delete error:', deleteError);
      logAction(userId, 'SELL_ALL_DELETE_FAILED', { 
        count: validItemIds.length, 
        error: deleteError.message 
      }, req).catch(() => {});
      return res.status(500).json({ error: 'Failed to delete items' });
    }
    
    let newBalance;
    try {
      newBalance = await updatePlayerBalance(
        supabase,
        userId,
        totalValue,
        `Sold ${validItems.length} items (Sell All)`,
        { casesOpened: 0, req }
      );
    } catch (error) {
      const err = error as Error;
      console.error('💥 Balance update failed after delete:', err.message);
      
      await supabase.from('inventory').insert(
        validItems.map(item => ({
          id: item.id,
          user_id: item.user_id,
          item_name: item.item_name,
          rarity: item.rarity,
          color: item.color,
          value: item.value,
          case_name: item.case_name,
          obtained_at: item.obtained_at
        }))
      );
      
      logAction(userId, 'SELL_ALL_BALANCE_FAILED_ROLLBACK', { 
        count: validItems.length, 
        error: err.message 
      }, req).catch(() => {});
      return res.status(500).json({ error: 'Transaction failed. Items restored.' });
    }
    
    logAction(userId, 'SELL_ALL_SUCCESS', {
      rarities: filteredRarities,
      count: validItems.length,
      totalValue,
      newBalance
    }, req).catch(() => {});
    
    return res.status(200).json({
      success: true,
      soldCount: validItems.length,
      totalValue: totalValue,
      newBalance: newBalance
    });
    
  } catch (error) {
    const err = error as Error;
    console.error('💥 Error in handleSellAll:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// HANDLER 4: UPGRADE INVENTORY CAPACITY
// ============================================================
async function handleUpgradeInventory(req: ApiRequest, res: ApiResponse, userId: string, authToken: string): Promise<void> {
  try {
    const session = await validateSessionAndFetchPlayerStats(supabase, authToken, userId, {
      select: 'diamonds, max_inventory'
    });

    if (!session.valid) {
      return res.status(401).json({ error: session.error });
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc('upgrade_inventory', {
      p_user_id: userId
    });

    if (rpcError) {
      console.error('RPC upgrade_inventory error:', rpcError);
      return res.status(500).json({ error: 'Failed to upgrade inventory' });
    }

    const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;

    if (!result || result.success === false) {
      if (result?.error === 'INSUFFICIENT_DIAMONDS') {
        return res.status(400).json({
          error: 'INSUFFICIENT_DIAMONDS',
          current: result.current,
          needed: result.needed
        });
      }
      if (result?.error === 'MAX_CAPACITY_REACHED') {
        return res.status(400).json({ error: 'MAX_CAPACITY_REACHED', current: result.current });
      }
      if (result?.error === 'USER_NOT_FOUND') {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(500).json({ error: result?.error || 'Unknown error' });
    }

    const payload = {
      success: true,
      newMax: result.newmax || result.newMax,
      newDiamonds: result.newdiamonds || result.newDiamonds,
      cost: result.cost,
      discountApplied: result.discountapplied || result.discountApplied
    };

    logAction(userId, 'INVENTORY_UPGRADED', payload, req).catch(() => {});

    return res.status(200).json(payload);
  } catch (error) {
    const err = error as Error;
    console.error('handleUpgradeInventory error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}