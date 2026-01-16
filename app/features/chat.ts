// ============================================================
// APP/CHAT.JS - CHAT REALTIME FRONTEND
// ============================================================

import { supabase } from './auth';
import { addCsrfHeader } from '../core/session';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { navigateTo } from '../core/router';
import { requestFriendFromContext } from './friends';
import { showToast } from '../shared/effects';

// ============================================================
// 🛡️ XSS PROTECTION - FRONTEND ESCAPE
// ============================================================

/**
 * Escapa caracteres HTML especiais para prevenir XSS no frontend
 * @param text - Texto a ser escapado
 * @returns Texto com caracteres HTML escapados de forma segura
 */
function escapeHtml(text: string): string {
  if (typeof text !== 'string') return '';
  
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Cria elemento de texto seguro sem permitir HTML
 * @param text - Texto a ser renderizado
 * @returns String HTML segura para innerHTML
 */
function createSafeTextElement(text: string): string {
  return escapeHtml(text);
}

// ============================================================
// TYPE DEFINITIONS
// ============================================================

interface ChatMessage {
  id: string;
  user_id: string;
  username: string;
  message: string;
  created_at: string;
  avatar_url?: string;
  is_drop_notification?: boolean;
  user_rank?: number;
  user_level?: number;
}

interface User {
  id: string;
  username?: string;
  avatar_url?: string;
}

interface ChatElements {
  chatPanel: HTMLElement | null;
  chatBtn: HTMLElement | null;
  chatContainer: HTMLElement | null;
  input: HTMLInputElement | null;
  sendBtn: HTMLElement | null;
}

interface IconConfig {
  icon?: string;
  showCount?: boolean;
}

declare global {
  interface Window {
    refreshLucideIcons?: () => void;
    chatIconMarkup: typeof chatIconMarkup;
    setChatToggleIcon: typeof setChatToggleIcon;
    initializeChat: typeof initializeChat;
    sendChatMessage: typeof sendChatMessage;
    toggleChat: typeof toggleChat;
    cleanupChat: typeof cleanupChat;
  }
}

// ============================================================
// STATE
// ============================================================
let chatSubscription: RealtimeChannel | null = null;
let isChatOpen: boolean = false;
let currentUserId: string | null = null;
let lastMessageTime: number = 0;
let onlineUsersCount: number = 0;
const RATE_LIMIT_MS: number = 5000; // 5 segundos

// ✅ ADICIONAR ESTAS LINHAS:
let presenceChannel: RealtimeChannel | null = null;
let onlineUsers: Set<string> = new Set();

// ✅ ADICIONAR CACHE DE AVATARES
const avatarCache: Map<string, string> = new Map();

// ============================================================
// DOM HELPERS / ONE-TIME BINDING
// ============================================================

let chatDomBound: boolean = false;
let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

let chatPanelEl: HTMLElement | null = null;
let chatBtnEl: HTMLElement | null = null;
let chatContainerEl: HTMLElement | null = null;
let chatInputEl: HTMLInputElement | null = null;
let chatSendBtnEl: HTMLElement | null = null;

// Dropdown de ações do usuário
let userActionMenuEl: HTMLElement | null = null;
let closeMenuListenersBound: boolean = false;

function getChatEls(): ChatElements {
  chatPanelEl ||= document.getElementById('chat-panel');
  chatBtnEl ||= document.getElementById('chat-toggle-icon');
  chatContainerEl ||= document.getElementById('chat-messages-container');
  chatInputEl ||= document.getElementById('chat-input') as HTMLInputElement | null;
  chatSendBtnEl ||= document.getElementById('chat-send-btn');

  return {
    chatPanel: chatPanelEl,
    chatBtn: chatBtnEl,
    chatContainer: chatContainerEl,
    input: chatInputEl,
    sendBtn: chatSendBtnEl,
  };
}

function chatIconMarkup(count: string | number = '0', { icon = 'messages-square', showCount = true }: IconConfig = {}): string {
  const safeCount = typeof count === 'number' ? String(count) : (count || '0');
  const badge = showCount
    ? `<span class="chat-online-count" id="chat-online-count">${safeCount}</span>`
    : '';

  return `<span class="header-icon" data-lucide="${icon}"></span>${badge}`;
}

function setChatToggleIcon({ count = '0', icon = 'messages-square', showCount = true }: { count?: string | number } & IconConfig = {}): void {
  const { chatBtn } = getChatEls();
  if (!chatBtn) return;

  chatBtn.innerHTML = chatIconMarkup(count, { icon, showCount });
  if (typeof window.refreshLucideIcons === 'function') {
    window.refreshLucideIcons();
  }
}

window.chatIconMarkup = chatIconMarkup;
window.setChatToggleIcon = setChatToggleIcon;

function forceChatClosedUI({ showCount = true }: { showCount?: boolean } = {}): void {
  const { chatPanel, chatBtn } = getChatEls();

  if (chatPanel) {
    chatPanel.classList.remove('active');
    chatPanel.style.transform = '';
  }

  if (chatBtn) {
    chatBtn.classList.remove('active');
    setChatToggleIcon({ count: '0', showCount, icon: 'messages-square' });
  }

  document.body.classList.remove('chat-open-mobile');
  hideUserActionMenu();
  isChatOpen = false;
}

function cleanupChatConnections(): void {
  if (chatSubscription) {
    chatSubscription.unsubscribe();
    chatSubscription = null;
  }
  cleanupPresence();
}

// ============================================================
// REALTIME PRESENCE - RASTREAMENTO DE USUÁRIOS ONLINE
// ============================================================
function initializePresence(user: User): void {
  if (!user?.id) return;

  // Evitar múltiplos canais se initializeChat rodar mais de uma vez
  if (presenceChannel) {
    cleanupPresence();
  }
  
  // Criar canal de presence
  presenceChannel = supabase.channel('online-users', {
    config: {
      presence: {
        key: user.id,
      },
    },
  });
  
  // Rastrear mudanças de presence
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      if (!presenceChannel) return;
      const state = presenceChannel.presenceState();
      onlineUsers = new Set(Object.keys(state));
      updateOnlineCount();
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      onlineUsers.add(key);
      updateOnlineCount();
    })
    .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
      onlineUsers.delete(key);
      updateOnlineCount();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && presenceChannel) {
        // Enviar presence
        await presenceChannel.track({
          user_id: user.id,
          username: window.currentUser?.username || 'Player',
          online_at: new Date().toISOString(),
        });
      }
    });
}

function cleanupPresence(): void {
  if (presenceChannel) {
    presenceChannel.unsubscribe();
    presenceChannel = null;
    onlineUsers.clear();
  }
}

// ============================================================
// USER ACTION DROPDOWN
// ============================================================
function getUserActionMenu(): HTMLElement {
  if (userActionMenuEl) return userActionMenuEl;

  const menu = document.createElement('div');
  menu.id = 'chat-user-actions';
  menu.className = 'chat-user-actions';
  menu.innerHTML = `
    <button type="button" data-action="profile">Profile</button>
    <button type="button" data-action="add-friend" id="chat-action-friend-btn">Add Friend</button>
  `;

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = e.target;
    const btn = target instanceof Element ? target.closest('button[data-action]') : null;
    if (!btn) return;
    const { userId, username } = menu.dataset;
    const action = (btn as HTMLElement).dataset.action || '';
    if (userId && username) {
      handleUserAction(action, { userId, username });
    }
    hideUserActionMenu();
  });

  ['mousedown', 'mouseup', 'touchstart', 'touchend'].forEach((evt) => {
    menu.addEventListener(evt, (e) => e.stopPropagation());
  });

  document.body.appendChild(menu);
  userActionMenuEl = menu;
  return menu;
}

function hideUserActionMenu(): void {
  if (!userActionMenuEl) return;
  userActionMenuEl.classList.remove('visible');
  userActionMenuEl.style.display = 'none';
}

// Minimal helpers for friends API usage from chat
async function getSessionToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function callFriendsApi(action: string, payload: Record<string, any> = {}): Promise<any> {
  const token = await getSessionToken();
  if (!currentUserId || !token) throw new Error('Not authenticated');
  const res = await fetch('/api/_profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, userId: currentUserId, authToken: token, ...payload })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Failed');
  return data;
}

async function relationToUser(targetUserId: string): Promise<string> {
  try {
    const data = await callFriendsApi('fetchState');
    const st = data?.state || { friends: [], incoming: [], outgoing: [] };
    if (st.friends?.some((f: any) => f.user_id === targetUserId)) return 'friend';
    if (st.incoming?.some((f: any) => f.user_id === targetUserId)) return 'incoming';
    if (st.outgoing?.some((f: any) => f.user_id === targetUserId)) return 'outgoing';
    return 'none';
  } catch (_) {
    return 'none';
  }
}

function handleUserAction(action: string, { userId, username }: { userId: string; username: string }): void {
  if (!userId || !username) return;

  if (action === 'profile') {
    const safeUsername = encodeURIComponent(username);
    navigateTo(`/u/${safeUsername}`);
    return;
  }

  if (action === 'add-friend') {
    void requestFriendFromContext({ userId, username });
    return;
  }

  if (action === 'remove-friend') {
    (async () => {
      try {
        await callFriendsApi('removeFriend', { targetUserId: userId });
        showToast('info', `Removed ${username}`);
      } catch (err) {
        showToast('error', ((err as any)?.message || 'Failed to remove'));
      }
    })();
    return;
  }

  if (action === 'accept-request') {
    (async () => {
      try {
        await callFriendsApi('acceptRequest', { fromUserId: userId });
        showToast('success', `Accepted ${username}`);
      } catch (err) {
        showToast('error', ((err as any)?.message || 'Failed to accept'));
      }
    })();
    return;
  }
}

function showUserActionMenu(targetEl: HTMLElement, { userId, username }: { userId: string; username: string }): void {
  if (!targetEl || !userId) return;

  const menu = getUserActionMenu();
  menu.dataset.userId = userId;
  menu.dataset.username = username;

  menu.style.display = 'flex';
  menu.style.visibility = 'hidden';
  menu.classList.add('visible');

  const rect = targetEl.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const padding = 12;

  let left = rect.left + (rect.width / 2) - (menuRect.width / 2);
  left = Math.max(padding, Math.min(left, window.innerWidth - menuRect.width - padding));

  let top = rect.top - menuRect.height - 10;
  if (top < padding) {
    top = rect.bottom + 10;
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = 'visible';

  // Update friend action button text/state based on relation
  (async () => {
    const relation = await relationToUser(userId);
    const btn = document.getElementById('chat-action-friend-btn') as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = false;
    btn.dataset.action = 'add-friend';
    if (relation === 'friend') {
      btn.textContent = 'Remove Friend';
      btn.dataset.action = 'remove-friend';
    } else if (relation === 'outgoing') {
      btn.textContent = 'Pending';
      (btn as HTMLButtonElement).disabled = true;
    } else if (relation === 'incoming') {
      btn.textContent = 'Accept Request';
      btn.dataset.action = 'accept-request';
    } else {
      btn.textContent = 'Add Friend';
      btn.dataset.action = 'add-friend';
    }
  })();

  if (!closeMenuListenersBound) {
    document.addEventListener('click', hideUserActionMenu);
    window.addEventListener('resize', hideUserActionMenu);
    window.addEventListener('scroll', hideUserActionMenu, true);
    closeMenuListenersBound = true;
  }
}

// ============================================================
// INITIALIZE CHAT
// ============================================================
export async function initializeChat(user: User): Promise<void> {
  // Sempre limpar conexões antigas antes de iniciar novamente
  cleanupChatConnections();

  if (!user || !user.id) {
    console.warn('⚠️ User not authenticated, chat disabled');
    forceChatClosedUI({ showCount: true });
    return;
  }
  
  currentUserId = user.id;
  
  // ✅ GARANTIR que chat inicie fechado
  forceChatClosedUI({ showCount: true });
  
  await loadInitialMessages();
  subscribeToChat();
  initializePresence(user);
}

// ============================================================
// LOAD INITIAL MESSAGES
// ============================================================
async function loadInitialMessages(): Promise<void> {
  try {
    const { data: messages, error } = await supabase
      .from('chat_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(50);
    
    if (error) {
      console.error('❌ Error loading messages:', error);
      return;
    }
    
    const { chatContainer } = getChatEls();
    if (!chatContainer) return;
    
    chatContainer.innerHTML = '';
    
    if (!messages || messages.length === 0) {
      chatContainer.innerHTML = `
        <div class="chat-empty-state">
          <div class="chat-empty-icon"><span class="header-icon" data-lucide="messages-square"></span></div>
          <p>No messages yet</p>
          <p class="chat-empty-hint">Be the first to say something!</p>
        </div>
      `;
      if (typeof window.refreshLucideIcons === 'function') {
        window.refreshLucideIcons();
      }
      return;
    }
    
    messages.forEach((msg) => {
      void renderMessage(msg);
    });
    if (isChatOpen) scrollToBottom();
    
  } catch (err) {
    console.error('💥 Error loading messages:', err);
  }
}

// ============================================================
// REALTIME SUBSCRIPTION
// ============================================================
function subscribeToChat(): void {
  if (chatSubscription) {
    chatSubscription.unsubscribe();
  }
  
  chatSubscription = supabase
    .channel('chat_messages_channel')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages'
      },
      (payload) => {
        void renderMessage(payload.new as ChatMessage);
        if (isChatOpen) scrollToBottom();
        
        // Remover empty state se existir
        const emptyState = document.querySelector('.chat-empty-state');
        if (emptyState) {
          emptyState.remove();
        }
      }
    )
    .subscribe((status) => {
    });
}

// ============================================================
// RENDER MESSAGE
// ============================================================

// Modificar renderMessage() para buscar avatar do Supabase:
async function renderMessage(msg: ChatMessage): Promise<void> {
  const { chatContainer } = getChatEls();
  if (!chatContainer) return;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = msg.is_drop_notification ? 'chat-message drop-notification' : 'chat-message';
  
  const isOwnMessage = msg.user_id === currentUserId;
  if (isOwnMessage && !msg.is_drop_notification) {
    messageDiv.classList.add('own-message');
  }
  if (!msg.is_drop_notification && msg.user_id) {
    messageDiv.dataset.userId = msg.user_id;
    messageDiv.dataset.username = msg.username || 'Player';

    if (!isOwnMessage) {
      messageDiv.classList.add('has-user-actions');
      messageDiv.addEventListener('click', (event) => {
        event.stopPropagation();
        showUserActionMenu(messageDiv, {
          userId: msg.user_id,
          username: msg.username || 'Player'
        });
      });
    }
  }
  
  if (msg.is_drop_notification) {
    messageDiv.innerHTML = `
      <div class="drop-notification-content">
        <div class="drop-icon">🎉</div>
        <div class="drop-text">${escapeHtml(msg.message)}</div>
      </div>
    `;
  } else {
    // ✅ BUSCAR AVATAR DO SUPABASE (com cache)
    let avatarUrl = msg.avatar_url;
    
    if (!avatarUrl) {
      // Buscar do banco se não veio na mensagem
      if (!avatarCache.has(msg.user_id)) {
        const { data } = await supabase
          .from('player_stats')
          .select('avatar_url')
          .eq('user_id', msg.user_id)
          .single();
        
        // 🛡️ Sanitizar username antes de usar na URL
        const safeUsername = encodeURIComponent(msg.username || 'Player');
        avatarUrl = data?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${safeUsername}`;
        if (msg.user_id && avatarUrl) {
          avatarCache.set(msg.user_id, avatarUrl);
        }
      } else {
        avatarUrl = avatarCache.get(msg.user_id) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(msg.username || 'Player')}`;
      }
    }
    
    const rankBadge = msg.user_rank && msg.user_rank <= 100 
      ? `<span class="chat-rank-badge">#${msg.user_rank}</span>` 
      : '';
    
    messageDiv.innerHTML = `
      <img src="${avatarUrl}" alt="${escapeHtml(msg.username)}" class="chat-message-avatar">
      <div class="chat-message-content">
        <div class="chat-message-header">
          <span class="chat-username">${escapeHtml(msg.username)}</span>
          <span class="chat-level">Lv ${msg.user_level || 1}</span>
          ${rankBadge}
        </div>
        <div class="chat-message-text">${escapeHtml(msg.message)}</div>
        <div class="chat-message-time">${formatTime(msg.created_at)}</div>
      </div>
    `;
  }
  
  chatContainer.appendChild(messageDiv);
  
  const messages = chatContainer.querySelectorAll('.chat-message');
  if (messages.length > 50) {
    messages[0].remove();
  }
}

// Adicionar função para atualizar contador online:
function updateOnlineCount(): void {
  const count = Math.max(onlineUsers.size, 1);
  
  const onlineCountEl = document.getElementById('chat-online-count');
  const onlineUsersEl = document.getElementById('chat-online-users');
  
  if (onlineCountEl) {
    onlineCountEl.textContent = String(count);
  }
  
  if (onlineUsersEl) {
    onlineUsersEl.textContent = String(count);
  }
}

// ============================================================
// SEND MESSAGE
// ============================================================
export async function sendChatMessage(): Promise<void> {
  const input = document.getElementById('chat-input') as HTMLInputElement | null;
  if (!input) return;
  
  const message = input.value.trim();
  
  if (!message) {
    showChatError('Message cannot be empty');
    return;
  }
  
  if (message.length > 60) {
    showChatError('Message too long (max 60 chars)');
    return;
  }
  
  // Rate limiting local
  const now = Date.now();
  const timeSinceLastMessage = now - lastMessageTime;
  
  if (timeSinceLastMessage < RATE_LIMIT_MS) {
    const remainingSeconds = Math.ceil((RATE_LIMIT_MS - timeSinceLastMessage) / 1000);
    showChatError(`Wait ${remainingSeconds}s before sending another message`);
    return;
  }
  
  // Desabilitar input temporariamente
  input.disabled = true;
  const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement | null;
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = '⏳';
  }
  
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showChatError('Not authenticated');
      return;
    }
    
    const response = await fetch('/api/_chat', {
      method: 'POST',
      headers: addCsrfHeader({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        action: 'sendMessage',
        userId: currentUserId,
        authToken: session.access_token,
        message: message
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      showChatError(result.error || 'Failed to send message');
      return;
    }
    
    // Sucesso
    input.value = '';
    lastMessageTime = now;
    
  } catch (err) {
    console.error('💥 Error sending message:', err);
    showChatError('Connection error');
  } finally {
    input.disabled = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = '➤';
    }
    input.focus();
  }
}

// ============================================================
// TOGGLE CHAT
// ============================================================
export function toggleChat(): void {
  const chatPanel = document.getElementById('chat-panel');
  const chatBtn = document.getElementById('chat-toggle-icon');
  
  if (!chatPanel || !chatBtn) {
    console.warn('⚠️ Chat elements not found');
    return;
  }
  
  // ✅ VERIFICAR se usuário está autenticado
  if (!currentUserId) {
    console.warn('⚠️ User not authenticated, chat disabled');
    alert('Please login to use the chat!');
    return;
  }
  
  isChatOpen = !isChatOpen;
  
  // ✅ PREVENIR SCROLL NO BODY (MOBILE)
  const isMobile = window.innerWidth <= 768;
  
  if (isChatOpen) {
    // ✅ ABRIR
    chatPanel.classList.add('active');
    chatBtn.classList.add('active');
    
    // ✅ Fechar friends se estiver aberto
    const friendsPanel = document.getElementById('friends-panel');
    const friendsBtn = document.getElementById('friends-toggle-icon');
    if (friendsPanel) friendsPanel.classList.remove('active');
    if (friendsBtn) friendsBtn.classList.remove('active');
    document.body.classList.remove('friends-open-mobile');
    
    // ✅ Bloquear scroll no mobile
    if (isMobile) {
      document.body.classList.add('chat-open-mobile');
    }
    
    // ✅ MANTER O CONTADOR DE ONLINE
    const currentCount = document.getElementById('chat-online-count');
    const onlineCount = currentCount ? currentCount.textContent : '0';
    setChatToggleIcon({ count: onlineCount, icon: 'x', showCount: true });
    
    // Auto-focus input (apenas desktop)
    if (!isMobile) {
      setTimeout(() => {
        const input = document.getElementById('chat-input');
        if (input) input.focus();
      }, 300);
    }
    
    scrollToBottom();
  } else {
    // ✅ FECHAR
    chatPanel.classList.remove('active');
    chatBtn.classList.remove('active');
    hideUserActionMenu();
    
    // ✅ Liberar scroll no mobile
    if (isMobile) {
      document.body.classList.remove('chat-open-mobile');
    }
    
    // ✅ MANTER O CONTADOR DE ONLINE
    const currentCount = document.getElementById('chat-online-count');
    const onlineCount = currentCount ? currentCount.textContent : '0';
    setChatToggleIcon({ count: onlineCount, icon: 'messages-square', showCount: true });
  }
}

// ============================================================
// UTILITIES
// ============================================================

function scrollToBottom() {
  const { chatContainer: container } = getChatEls();
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

function showChatError(message: string): void {
  const errorDiv = document.getElementById('chat-error');
  if (!errorDiv) return;
  
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  
  setTimeout(() => {
    errorDiv.style.display = 'none';
  }, 3000);
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

// ============================================================
// CLEANUP
// ============================================================
export function cleanupChat(): void {
  cleanupChatConnections();

  // ✅ FORÇAR FECHAMENTO DO CHAT
  forceChatClosedUI({ showCount: true });

  currentUserId = null;
  avatarCache.clear();
  hideUserActionMenu();
}

// ============================================================
// EVENT LISTENERS
// ============================================================
function bindChatDomOnce(): void {
  if (chatDomBound) return;
  chatDomBound = true;

  // Estado inicial fechado (crítico para mobile)
  forceChatClosedUI({ showCount: true });

  const { input, sendBtn, chatBtn, chatPanel, chatContainer } = getChatEls();

  // Enter key para enviar mensagem
  if (input && input.dataset.bound !== '1') {
    input.dataset.bound = '1';
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendChatMessage();
      }
    });
  }

  // Botão de enviar
  if (sendBtn && sendBtn.dataset.bound !== '1') {
    sendBtn.dataset.bound = '1';
    sendBtn.addEventListener('click', () => {
      void sendChatMessage();
    });
  }

  // Botão de toggle
  if (chatBtn && chatBtn.dataset.bound !== '1') {
    chatBtn.dataset.bound = '1';
    chatBtn.removeAttribute('onclick');
    chatBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.toggleChat();
    });
  }

  // Prevenir abertura acidental no resize
  window.addEventListener('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (!isChatOpen && chatPanel) {
        chatPanel.classList.remove('active');
        if (chatBtn) chatBtn.classList.remove('active');
      }
    }, 100);
  });

  if (chatContainer) {
    chatContainer.addEventListener('scroll', hideUserActionMenu, { passive: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindChatDomOnce, { once: true });
} else {
  bindChatDomOnce();
}

// ============================================================
// EXPORTS GLOBAIS
// ============================================================
window.initializeChat = initializeChat;
window.sendChatMessage = sendChatMessage;
window.toggleChat = toggleChat;
window.cleanupChat = cleanupChat;
