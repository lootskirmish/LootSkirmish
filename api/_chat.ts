// ============================================================
// API/CHAT.TS - BACKEND SEGURO PARA CHAT
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { applyCors, validateSessionAndFetchPlayerStats, validateSupabaseSession, ValidationSchemas, createSecureLog, validateCsrfMiddleware, sanitizeHtml, containsDangerousContent } from './_utils.js';

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
    message?: string;
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

interface RateLimitResult {
  allowed: boolean;
  remainingSeconds?: number;
}

interface PlayerStats {
  username: string;
  level: number;
  avatar_url?: string;
}

const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ============================================================
// RATE LIMITING (Usando banco de dados ao invés de memória)
// ============================================================
async function checkRateLimit(userId: string): Promise<RateLimitResult> {
  try {
    if (!userId) {
      return { allowed: true };
    }
    const now = Date.now();
    const chatRateLimit = parseInt(process.env.CHAT_RATE_LIMIT_MS || '5000') || 5000;
    const rateLimitAgo = new Date(now - chatRateLimit).toISOString();
    
    const { data: recentMessages, error } = await supabase
      .from('chat_messages')
      .select('created_at')
      .eq('user_id', userId as string)
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
async function validateSession(authToken: string, expectedUserId: string): Promise<any> {
  return validateSupabaseSession(supabase, authToken, expectedUserId);
}

// ============================================================
// SEND MESSAGE HANDLER
// ============================================================
async function handleSendMessage(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const { userId, authToken, message } = req.body || {};
    
    // 1. Validação de schema
    const userIdValidation = ValidationSchemas.email.validate(userId) || { success: false };
    if (!userIdValidation.success) {
      const log = createSecureLog({
        action: 'INVALID_USER_ID',
        userId,
        statusCode: 400,
        isSecurityEvent: true
      });
      console.log('⚠️', JSON.stringify(log));
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    // 2. Validação básica
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
    
    // 🛡️ XSS PROTECTION - Verificar e sanitizar mensagem
    if (containsDangerousContent(trimmedMessage)) {
      // Registrar tentativa de XSS
      const log = createSecureLog({
        action: 'XSS_ATTEMPT_BLOCKED',
        userId,
        details: { messagePreview: trimmedMessage.substring(0, 50) },
        statusCode: 400,
        isSecurityEvent: true
      });
      console.warn('⚠️ XSS attempt in chat:', JSON.stringify(log));
      
      // Registrar no audit_log
      await supabase.from('audit_log').insert({
        user_id: userId,
        action: 'XSS_ATTEMPT_BLOCKED',
        details: { 
          context: 'chat_message',
          messageLength: trimmedMessage.length,
          containedTags: true
        },
        ip_address: (req.connection?.remoteAddress || req.headers?.['x-forwarded-for'] || 'unknown') as string
      });
      
      return res.status(400).json({ error: 'Message contains invalid content' });
    }
    
    // Sanitizar mensagem (mesmo que não tenha detectado perigo, sempre sanitizar)
    const sanitizedMessage = sanitizeHtml(trimmedMessage);
    
    if (sanitizedMessage.length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty after sanitization' });
    }
    
    // 3. Validar sessão
    const { valid, error: sessionError, stats } = await validateSessionAndFetchPlayerStats(
      supabase,
      authToken,
      userId,
      { select: 'username, level, avatar_url' }
    );
    if (!valid) {
      return res.status(401).json({ error: sessionError || 'Invalid session' });
    }
    
    if (!stats) {
      return res.status(401).json({ error: 'Invalid session' });
    }
    
    // 🛡️ Validar CSRF token
    const csrfValidation = await validateCsrfMiddleware(supabase, req, userId);
    if (!csrfValidation.valid) {
      console.warn('⚠️ CSRF validation failed:', { userId, error: csrfValidation.error });
      return res.status(403).json({ error: 'Security validation failed' });
    }
    
    // 4. Rate limiting
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
    
    // 6. ✅ USAR RPC FUNCTION para inserir mensagem (com mensagem sanitizada)
    const { data: result, error: insertError } = await supabase
      .rpc('insert_chat_message', {
        p_user_id: userId,
        p_username: stats.username,
        p_message: sanitizedMessage,  // 🛡️ Usar mensagem sanitizada
        p_user_level: (stats as any).level,
        p_user_rank: userRank,
        p_avatar_url: (stats as any).avatar_url
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
async function handleGetMessages(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const { userId, authToken } = req.body || {};
    
    // 1. Validar sessão
    const { valid, error: sessionError } = await validateSession(authToken || '', userId || '');
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
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  // CORS Headers (safe when env missing)
  applyCors(req as any, res as any, { credentials: true });
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { action } = req.body || {};
  
  if (action === 'sendMessage') {
    return await handleSendMessage(req, res);
  }
  
  if (action === 'getMessages') {
    return await handleGetMessages(req, res);
  }
  
  return res.status(400).json({ error: 'Invalid action' });
}