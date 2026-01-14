// ============================================================
// API/CHAT.JS - BACKEND SEGURO PARA CHAT (FIXED)
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { applyCors, validateSessionAndFetchPlayerStats, validateSupabaseSession } from './_utils.js';

import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// RATE LIMITING (Usando banco de dados ao invés de memória)
// ============================================================
async function checkRateLimit(userId) {
  try {
    const now = Date.now();
    const chatRateLimit = parseInt(process.env.CHAT_RATE_LIMIT_MS) || 5000;
    const rateLimitAgo = new Date(now - chatRateLimit).toISOString();
    
    const { data: recentMessages, error } = await supabase
      .from('chat_messages')
      .select('created_at')
      .eq('user_id', userId)
      .gte('created_at', rateLimitAgo) 
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (error) {
      console.error('Rate limit check error:', error);
      return { allowed: true }; // Em caso de erro, permitir (fail-open)
    }
    
    if (recentMessages && recentMessages.length > 0) {
      const lastMessageTime = new Date(recentMessages[0].created_at).getTime();
      const timeSinceLastMessage = now - lastMessageTime;
      
      if (timeSinceLastMessage < chatRateLimit) { // ✅ Mudado aqui
        const remainingTime = Math.ceil((chatRateLimit - timeSinceLastMessage) / 1000);
        return { 
          allowed: false, 
          remainingSeconds: remainingTime 
        };
      }
    }
    
    return { allowed: true };
    
  } catch (err) {
    console.error('Rate limit error:', err);
    return { allowed: true }; // Fail-open
  }
}

// ============================================================
// SESSION VALIDATION
// ============================================================
async function validateSession(authToken, expectedUserId) {
  return validateSupabaseSession(supabase, authToken, expectedUserId);
}

// ============================================================
// SEND MESSAGE HANDLER
// ============================================================
async function handleSendMessage(req, res) {
  try {
    const { userId, authToken, message } = req.body;
    
    // 1. Validação básica
    if (!userId || !message || !authToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (typeof message !== 'string') {
      return res.status(400).json({ error: 'Message must be string' });
    }
    
    const trimmedMessage = message.trim();
    
    if (trimmedMessage.length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    
    if (trimmedMessage.length > 60) {
      return res.status(400).json({ error: 'Message too long (max 60 chars)' });
    }
    
    // 2. Validar sessão
    const { valid, error: sessionError, stats } = await validateSessionAndFetchPlayerStats(
      supabase,
      authToken,
      userId,
      { select: 'username, level, avatar_url' }
    );
    if (!valid) {
      return res.status(401).json({ error: sessionError || 'Invalid session' });
    }
    
    // 3. Rate limiting
    const rateCheck = await checkRateLimit(userId);
    if (!rateCheck.allowed) {
      return res.status(429).json({ 
        error: `Wait ${rateCheck.remainingSeconds}s before sending another message`,
        remainingSeconds: rateCheck.remainingSeconds
      });
    }
    
    // 5. Buscar posição no leaderboard (opcional)
    let userRank = null;
    try {
      const { data: rankData } = await supabase
        .rpc('get_user_leaderboard_rank', { p_user_id: userId });
      userRank = rankData;
    } catch (rankError) {
      console.warn('Rank fetch failed (non-critical):', rankError);
    }
    
    // 6. ✅ USAR RPC FUNCTION para inserir mensagem
    const { data: result, error: insertError } = await supabase
      .rpc('insert_chat_message', {
        p_user_id: userId,
        p_username: stats.username,
        p_message: trimmedMessage,
        p_user_level: stats.level,
        p_user_rank: userRank,
        p_avatar_url: stats.avatar_url
      });
    
    if (insertError) {
      console.error('RPC error:', insertError);
      return res.status(500).json({ error: 'Failed to send message' });
    }
    
    // Verificar se a function retornou erro interno
    if (result && !result.success) {
      console.error('Function returned error:', result.error);
      return res.status(500).json({ error: 'Failed to send message' });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Message sent'
    });
    
  } catch (error) {
    console.error('FATAL ERROR in handleSendMessage:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// GET RECENT MESSAGES HANDLER
// ============================================================
async function handleGetMessages(req, res) {
  try {
    const { userId, authToken } = req.body;
    
    // 1. Validar sessão
    const { valid, error: sessionError } = await validateSession(authToken, userId);
    if (!valid) {
      return res.status(401).json({ error: sessionError });
    }
    
    // 2. Buscar últimas 50 mensagens
    const { data: messages, error: fetchError } = await supabase
      .from('chat_messages')
      .select('id, user_id, username, message, user_level, user_rank, avatar_url, is_drop_notification, created_at')
      .order('created_at', { ascending: true })
      .limit(50);
    
    if (fetchError) {
      console.error('Fetch messages error:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }
    
    return res.status(200).json({
      success: true,
      messages: messages || []
    });
    
  } catch (error) {
    console.error('FATAL ERROR in handleGetMessages:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================
export default async function handler(req, res) {
  // CORS Headers (safe when env missing)
  applyCors(req, res, { credentials: true });
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { action } = req.body;
  
  if (action === 'sendMessage') {
    return await handleSendMessage(req, res);
  }
  
  if (action === 'getMessages') {
    return await handleGetMessages(req, res);
  }
  
  return res.status(400).json({ error: 'Invalid action' });
}