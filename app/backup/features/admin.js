// ============================================================
// ADMIN.JS - Sistema de Administração SEGURO (FRONTEND)
// ============================================================

import { supabase } from './auth.js';

// ============================================================
// STATE MANAGEMENT
// ============================================================

let isUpdatingAdmin = false;
let adminSubscription = null;
let adminRoleCache = null;
let adminRoleCacheTime = 0;
const ROLE_CACHE_DURATION = 30000; // 30 segundos

let adminDelegationBound = false;
let adminRefreshTimer = null;
let adminRefreshInFlight = null;
let adminRefreshQueued = false;

// ABA ATIVA (NOVO)
let activeAdminTab = 'purchases'; // 'purchases' ou 'support'

function isAdminScreenActive() {
  return document.getElementById('admin')?.classList.contains('active');
}

function bindAdminOrderDelegationOnce() {
  if (adminDelegationBound) return;

  const pendingList = document.getElementById('admin-pending-list');
  if (!pendingList) return;

  pendingList.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const approveBtn = target.closest('.approve-btn');
    if (approveBtn) {
      const orderId = approveBtn.getAttribute('data-order-id');
      if (orderId) handleApproveOrder(orderId);
      return;
    }

    const rejectBtn = target.closest('.reject-btn');
    if (rejectBtn) {
      const orderId = rejectBtn.getAttribute('data-order-id');
      if (orderId) handleRejectOrder(orderId);
    }
  });

  adminDelegationBound = true;
}

function requestAdminRefresh() {
  if (!isAdminScreenActive()) return;

  if (adminRefreshTimer) return;
  adminRefreshTimer = setTimeout(async () => {
    adminRefreshTimer = null;

    if (adminRefreshInFlight) {
      adminRefreshQueued = true;
      return;
    }

    adminRefreshInFlight = (async () => {
      await renderAdminPanel();
    })()
      .catch((err) => console.error('Admin refresh error:', err))
      .finally(() => {
        adminRefreshInFlight = null;
        if (adminRefreshQueued) {
          adminRefreshQueued = false;
          requestAdminRefresh();
        }
      });
  }, 200);
}

// ============================================================
// 🔐 ADMIN VERIFICATION (SEGURA)
// ============================================================

/**
 * Verifica se o usuário é admin (COM CACHE SEGURO)
 * @returns {Promise<{isAdmin: boolean, role: string|null}>}
 */
export async function checkIsAdmin() {
  if (!window.currentUser) {
    return { isAdmin: false, role: null };
  }
  
  try {
    const now = Date.now();
    
    // Usar cache apenas se válido
    if (adminRoleCache && (now - adminRoleCacheTime) < ROLE_CACHE_DURATION) {
      return adminRoleCache;
    }
    
    // 1. Verificar sessão atual
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
      console.warn('Invalid session');
      adminRoleCache = { isAdmin: false, role: null };
      adminRoleCacheTime = now;
      return adminRoleCache;
    }
    
    // 2. Buscar role DIRETAMENTE do banco
    const { data, error } = await supabase
      .from('player_stats')
      .select('role, user_id')
      .eq('user_id', window.currentUser.id)
      .single();
    
    if (error || !data) {
      console.warn('Failed to fetch role');
      adminRoleCache = { isAdmin: false, role: null };
      adminRoleCacheTime = now;
      return adminRoleCache;
    }
    
    // 3. CRÍTICO: Verificar integridade dos dados
    if (data.user_id !== window.currentUser.id) {
      console.error('⚠️ User ID mismatch detected!');
      adminRoleCache = { isAdmin: false, role: null };
      adminRoleCacheTime = now;
      return adminRoleCache;
    }
    
    // 4. Verificar role
    const isAdmin = data.role === 'admin' || data.role === 'support';
    
    adminRoleCache = { isAdmin, role: data.role };
    adminRoleCacheTime = now;
    
    return adminRoleCache;
    
  } catch (err) {
    console.error('Error checking admin:', err);
    adminRoleCache = { isAdmin: false, role: null };
    adminRoleCacheTime = Date.now();
    return adminRoleCache;
  }
}

/**
 * Invalida o cache de role (chamar após logout ou mudanças)
 */
export function invalidateAdminRoleCache() {
  adminRoleCache = null;
  adminRoleCacheTime = 0;
}

/**
 * Verifica e mostra botão admin se for admin
 */
export async function checkAndShowAdminButton() {
  const { isAdmin } = await checkIsAdmin();
  const adminBtn = document.getElementById('admin-btn');
  
  if (adminBtn) {
    if (isAdmin) {
      adminBtn.classList.remove('hidden');
    } else {
      adminBtn.classList.add('hidden');
    }
  }
}

// ============================================================
// ADMIN PANEL RENDERING
// ============================================================

/**
 * Renderiza o painel admin completo
 */
export async function renderAdminPanel() {
  // Verificar permissão ANTES de renderizar
  const { isAdmin } = await checkIsAdmin();
  
  if (!isAdmin) {
    console.error('❌ Unauthorized access attempt to admin panel');
    alert('❌ Access denied!');
    if (window.goTo) window.goTo('home');
    return;
  }

  // Renderizar abas
  if (activeAdminTab === 'purchases') {
    await renderAdminPurchasesTab();
  } else if (activeAdminTab === 'support') {
    await renderAdminSupportTab();
  }
}

/**
 * Renderiza aba de Compras
 */
async function renderAdminPurchasesTab() {
  try {
    // Show purchases section, hide support if present
    document.getElementById('admin-purchases-section')?.classList.remove('hidden');
    document.getElementById('admin-support-section')?.classList.add('hidden');

    const stats = await fetchAdminStats();
    
    const pendingCountEl = document.getElementById('admin-pending-count');
    const approvedCountEl = document.getElementById('admin-approved-count');
    const totalUsdEl = document.getElementById('admin-total-usd');
    const totalBrlEl = document.getElementById('admin-total-brl');
    const totalLtcEl = document.getElementById('admin-total-ltc');
    
    if (pendingCountEl) pendingCountEl.textContent = stats.pendingCount;
    if (approvedCountEl) approvedCountEl.textContent = stats.approvedCount;
    if (totalUsdEl) totalUsdEl.textContent = `$ ${stats.totalUSD.toFixed(2)}`;
    if (totalBrlEl) totalBrlEl.textContent = `R$ ${stats.totalBRL.toFixed(2)}`;
    if (totalLtcEl) totalLtcEl.textContent = `${stats.totalLTC.toFixed(4)} LTC`;
    
    await renderAdminPendingOrders();
    await renderAdminHistoryOrders();
  } catch (err) {
    console.error('Error rendering purchases tab:', err);
  }
}

/**
 * Renderiza aba de Suporte
 */
async function renderAdminSupportTab() {
  try {
    const container = document.getElementById('admin-content');
    if (!container) return;

    // Hide purchases section while viewing support
    document.getElementById('admin-purchases-section')?.classList.add('hidden');

    let supportSection = document.getElementById('admin-support-section');
    if (!supportSection) {
      supportSection = document.createElement('div');
      supportSection.id = 'admin-support-section';
      supportSection.classList.add('admin-section');
      container.appendChild(supportSection);
    }

    supportSection.classList.remove('hidden');

    // Renderizar as seções de suporte
    const tickets = await fetchSupportTickets();
    
    supportSection.innerHTML = `
      <div class="admin-support-container">
        
        <!-- ABAS INTERNAS -->
        <div class="admin-support-tabs">
          <button class="admin-support-tab-btn active" onclick="window.switchSupportSubTab('tickets')">
            📋 Ticket History
          </button>
          <button class="admin-support-tab-btn" onclick="window.switchSupportSubTab('reply')">
            ✉️ Reply to Email
          </button>
          <button class="admin-support-tab-btn" onclick="window.switchSupportSubTab('inbox')">
            📧 Inbox (${tickets.length || 0})
          </button>
        </div>
        
        <!-- CONTEÚDO -->
        <div id="admin-support-tickets" class="admin-support-section active">
          ${renderSupportTicketsHistory(tickets)}
        </div>
        
        <div id="admin-support-reply" class="admin-support-section hidden">
          ${renderSupportReplyForm()}
        </div>
        
        <div id="admin-support-inbox" class="admin-support-section hidden">
          ${renderSupportInbox(tickets)}
        </div>
        
      </div>
    `;
    
  } catch (err) {
    console.error('Error rendering support tab:', err);
  }
}

/**
 * Busca tickets de suporte
 */
async function fetchSupportTickets() {
  try {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    
    return data || [];
  } catch (err) {
    console.error('Error fetching tickets:', err);
    return [];
  }
}

/**
 * Atualiza ticket de suporte
 */
async function updateSupportTicket(ticketId, updates) {
  try {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('support_tickets')
      .update({
        ...updates,
        updated_at: new Date()
      })
      .eq('id', ticketId)
      .select();
    
    if (error) throw error;
    
    return data ? data[0] : null;
  } catch (err) {
    console.error('Error updating ticket:', err);
    return null;
  }
}

/**
 * Renderiza histórico de tickets
 */
function renderSupportTicketsHistory(tickets) {
  if (!tickets || tickets.length === 0) {
    return '<p class="no-data">No support tickets yet</p>';
  }
  
  return `
    <div class="admin-tickets-list">
      ${tickets.map(ticket => {
        const normalizedStatus = normalizeTicketStatus(ticket.status);
        const pending = normalizedStatus === 'pending';
        const resolved = normalizedStatus === 'resolved';
        const escalation = normalizedStatus === 'escalation';
        const statusColor = pending ? '#f59e0b' : resolved ? '#10b981' : escalation ? '#f97316' : '#6b7280';
        const statusIcon = pending ? '⏳' : resolved ? '✅' : escalation ? '⚠️' : '❓';
        const ticketCode = ticket.ticket_code || ticket.id || 'N/A';
        
        return `
          <div class="admin-ticket-card" style="border-left: 4px solid ${statusColor}">
            <div class="admin-ticket-header">
              <span class="ticket-id">#${ticketCode.substring(0, 8)}...</span>
              <span class="ticket-status" style="color: ${statusColor}">${statusIcon} ${ticket.status || 'unknown'}</span>
              <span class="ticket-date">${new Date(ticket.created_at).toLocaleDateString()}</span>
            </div>
            
            <div class="admin-ticket-body">
              <div class="ticket-row">
                <strong>From:</strong> ${sanitizeHTML(ticket.user_email || 'N/A')}
              </div>
              <div class="ticket-row">
                <strong>Subject:</strong> ${sanitizeHTML(ticket.subject || 'No subject')}
              </div>
              <div class="ticket-row ticket-message">
                <strong>Message:</strong>
                <p>${sanitizeHTML(ticket.message || 'No message').substring(0, 100)}...</p>
              </div>
              <div class="ticket-row">
                <strong>Resolution:</strong> ${ticket.resolution_notes || 'No notes yet'}
              </div>
            </div>
            
            <div class="admin-ticket-actions">
              <button class="btn-resolve" onclick="window.markTicketResolved('${ticket.ticket_code || ticket.id}')">
                ✅ Mark as Resolved
              </button>
              <button class="btn-reply" onclick="window.openReplyForm('${ticket.ticket_code || ticket.id}', '${ticket.user_email}')">
                💬 Reply
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Renderiza formulário de resposta
 */
function renderSupportReplyForm() {
  return `
    <div class="admin-reply-form-container">
      <form id="admin-reply-form" class="admin-reply-form" onsubmit="event.preventDefault(); window.sendSupportReply();">
        
        <div class="form-group">
          <label for="reply-ticket-id">Ticket ID</label>
          <input type="text" id="reply-ticket-id" placeholder="Auto-filled when clicking Reply" disabled>
        </div>
        
        <div class="form-group">
          <label for="reply-to-email">To Email</label>
          <input type="email" id="reply-to-email" placeholder="Auto-filled" disabled>
        </div>
        
        <div class="form-group">
          <label for="reply-resolution">Resolution Category</label>
          <div class="resolution-buttons">
            <button type="button" class="resolution-btn" data-value="resolvable" onclick="window.setResolution('resolvable')">
              ✅ Can be Resolved
            </button>
            <button type="button" class="resolution-btn" data-value="escalation" onclick="window.setResolution('escalation')">
              ⚠️ Needs Escalation
            </button>
            <button type="button" class="resolution-btn" data-value="spam" onclick="window.setResolution('spam')">
              ❌ Invalid/Spam
            </button>
          </div>
          <input type="hidden" id="reply-resolution" value="">
        </div>
        
        <div class="form-group">
          <label for="reply-message">Response Message</label>
          <textarea id="reply-message" placeholder="Type your response here..." rows="6"></textarea>
        </div>
        
        <button type="submit" class="btn-send-reply">
          📧 Send Response
        </button>
        
      </form>
    </div>
  `;
}

/**
 * Renderiza inbox/lista de emails
 */
function renderSupportInbox(tickets) {
  const pending = tickets.filter(t => normalizeTicketStatus(t.status) === 'pending');
  
  if (pending.length === 0) {
    return '<p class="no-data">No pending support tickets</p>';
  }
  
  return `
    <div class="admin-inbox-container">
      <div class="inbox-stats">
        <span>📬 ${pending.length} pending message(s)</span>
      </div>
      
      <div class="inbox-list">
        ${pending.map(ticket => {
          const ticketCode = ticket.ticket_code || ticket.id;
          return `
          <div class="inbox-email-card" onclick="window.selectInboxEmail('${ticketCode}')">
            <div class="email-from">
              <strong>${sanitizeHTML(ticket.user_email)}</strong>
            </div>
            <div class="email-subject">
              ${sanitizeHTML(ticket.subject)}
            </div>
            <div class="email-preview">
              ${sanitizeHTML(ticket.message).substring(0, 80)}...
            </div>
            <div class="email-time">
              ${new Date(ticket.created_at).toLocaleString()}
            </div>
          </div>
        `}).join('')}
      </div>
    </div>
  `;
}

/**
 * Busca estatísticas do admin (COM VERIFICAÇÃO)
 */
async function fetchAdminStats() {
  try {
    // Verificar permissão
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) {
      throw new Error('Unauthorized');
    }
    
    const { count: approvedCount } = await supabase
      .from('purchase_orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved');
    
    const { data: usdOrders } = await supabase
      .from('purchase_orders')
      .select('amount_paid')
      .eq('status', 'approved')
      .eq('currency', 'USD');
    
    const totalUSD = usdOrders?.reduce((sum, o) => sum + (o.amount_paid || 0), 0) || 0;
    
    const { data: brlOrders } = await supabase
      .from('purchase_orders')
      .select('amount_paid')
      .eq('status', 'approved')
      .eq('currency', 'BRL');
    
    const totalBRL = brlOrders?.reduce((sum, o) => sum + (o.amount_paid || 0), 0) || 0;
    
    const { data: ltcOrders } = await supabase
      .from('purchase_orders')
      .select('amount_paid')
      .eq('status', 'approved')
      .eq('currency', 'LTC');
    
    const totalLTC = ltcOrders?.reduce((sum, o) => sum + (o.amount_paid || 0), 0) || 0;
    
    const { count: pendingCount } = await supabase
      .from('purchase_orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    
    return {
      approvedCount: approvedCount || 0,
      pendingCount: pendingCount || 0,
      totalUSD,
      totalBRL,
      totalLTC
    };
    
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    return { 
      approvedCount: 0, 
      pendingCount: 0, 
      totalUSD: 0, 
      totalBRL: 0, 
      totalLTC: 0 
    };
  }
}

/**
 * Busca pedidos pendentes (COM VERIFICAÇÃO)
 */
async function fetchPendingOrders() {
  try {
    // Verificar permissão
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) {
      throw new Error('Unauthorized');
    }
    
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(100); // Limitar quantidade
    
    if (error) {
      console.error('Error retrieving orders:', error);
      return [];
    }
    
    return data || [];
  } catch (err) {
    console.error('Error fetching pending orders:', err);
    return [];
  }
}

/**
 * Renderiza pedidos pendentes (COM SANITIZAÇÃO)
 */
async function renderAdminPendingOrders() {
  const wasUpdating = isUpdatingAdmin;
  isUpdatingAdmin = false;
  
  try {
    const orders = await fetchPendingOrders();
    const list = document.getElementById('admin-pending-list');
    
    if (!list) {
      return;
    }
    
    if (!orders || orders.length === 0) {
      list.innerHTML = '<p class="no-orders">No pending orders</p>';
      return;
    }
    
    // SANITIZAR DADOS
    list.innerHTML = orders.map(order => {
      const date = new Date(order.created_at).toLocaleString('en-US');
      const totalDiamonds = (order.diamonds_base || 0) + (order.diamonds_bonus || 0);
      const orderId = String(order.id || '').slice(0, 8);
      const userEmail = sanitizeHTML(order.user_email || 'N/A');
      const amountPaid = parseFloat(order.amount_paid || 0).toFixed(2);
      const currency = sanitizeHTML(String(order.currency || 'N/A').toUpperCase());
      const paymentMethod = sanitizeHTML(String(order.payment_method || 'N/A').toUpperCase());
      
      return `
        <div class="admin-order-card" data-order-id="${orderId}">
          <div class="admin-order-header">
            <span class="admin-order-id">#${orderId}...</span>
            <span class="admin-order-date">${date}</span>
          </div>
          
          <div class="admin-order-body">
            <div class="admin-order-row">
              <span>👤 Email:</span>
              <span>${userEmail}</span>
            </div>
            <div class="admin-order-row">
              <span>💎 Diamonds:</span>
              <span>${order.diamonds_base} + ${order.diamonds_bonus} = <strong>${totalDiamonds}</strong></span>
            </div>
            <div class="admin-order-row">
              <span>💰 Value:</span>
              <span class="order-value">${amountPaid} ${currency}</span>
            </div>
            <div class="admin-order-row">
              <span>💳 Method:</span>
              <span>${paymentMethod}</span>
            </div>
          </div>
          
          <div class="admin-order-actions">
            <button class="approve-btn" data-order-id="${order.id}">
              ✅ Approve
            </button>
            <button class="reject-btn" data-order-id="${order.id}">
              ❌ Reject
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Delegação (listeners únicos)
    bindAdminOrderDelegationOnce();
    
  } catch (err) {
    console.error('❌ Error rendering requests:', err);
  } finally {
    if (wasUpdating) {
      isUpdatingAdmin = true;
    }
  }
}

/**
 * Sanitiza HTML para prevenir XSS
 */
function sanitizeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Adiciona event listeners de forma segura
 */
function attachOrderEventListeners() {
  // Mantido por compatibilidade: agora usamos delegação.
  bindAdminOrderDelegationOnce();
}

/**
 * Renderiza histórico de pedidos
 */
async function renderAdminHistoryOrders() {
  try {
    // Verificar permissão
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) {
      throw new Error('Unauthorized');
    }
    
    const { data: orders, error } = await supabase
      .from('purchase_orders')
      .select('*')
      .neq('status', 'pending')
      .order('reviewed_at', { ascending: false })
      .limit(50);
    
    const list = document.getElementById('admin-history-list');
    
    if (!list) return;
    
    if (error || !orders || orders.length === 0) {
      list.innerHTML = '<p class="no-orders">No requests in the history.</p>';
      return;
    }
    
    list.innerHTML = orders.map(order => {
      const date = new Date(order.reviewed_at || order.created_at).toLocaleString('en-US');
      const totalDiamonds = (order.diamonds_base || 0) + (order.diamonds_bonus || 0);
      const orderId = String(order.id || '').slice(0, 8);
      const userEmail = sanitizeHTML(order.user_email || 'N/A');
      const amountPaid = parseFloat(order.amount_paid || 0).toFixed(2);
      const currency = sanitizeHTML(String(order.currency || 'N/A').toUpperCase());
      
      const statusColors = {
        approved: '#22c55e',
        rejected: '#ef4444'
      };
      
      const statusText = {
        approved: '✅ Approved',
        rejected: '❌ Rejected'
      };
      
      const status = order.status || 'unknown';
      
      return `
        <div class="admin-order-card history" style="border-left-color: ${statusColors[status] || '#999'}">
          <div class="admin-order-header">
            <span class="admin-order-id">#${orderId}...</span>
            <span class="admin-order-status" style="color: ${statusColors[status] || '#999'}">${statusText[status] || status}</span>
          </div>
          
          <div class="admin-order-body">
            <div class="admin-order-row">
              <span>👤 Email:</span>
              <span>${userEmail}</span>
            </div>
            <div class="admin-order-row">
              <span>💎 Diamonds:</span>
              <span>${totalDiamonds}</span>
            </div>
            <div class="admin-order-row">
              <span>💰 Value:</span>
              <span>${amountPaid} ${currency}</span>
            </div>
            <div class="admin-order-row">
              <span>📅 Date:</span>
              <span>${date}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
  } catch (err) {
    console.error('Error rendering history:', err);
  }
}

// ============================================================
// 🔐 ORDER HANDLERS SEGUROS (CHAMAM BACKEND)
// ============================================================

/**
 * Handler seguro para aprovar pedido
 */
export async function handleApproveOrder(orderId) {
  try {
    // 1. VERIFICAR PERMISSÃO
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) {
      alert('❌ Access denied!');
      return;
    }
    
    // 2. VALIDAR INPUT
    if (!orderId || typeof orderId !== 'string') {
      alert('❌ Invalid order ID');
      return;
    }
    
    // 3. CONFIRMAR
    const confirmar = confirm('✅ Confirm approval of this order?');
    if (!confirmar) return;
    
    // 4. BUSCAR BOTÃO
    const btn = document.querySelector(`.approve-btn[data-order-id="${orderId}"]`);
    const card = btn?.closest('.admin-order-card');
    
    if (!btn || !card) {
      alert('❌ Button not found');
      return;
    }
    
    const originalText = btn.textContent;
    const approveBtn = card.querySelector('.approve-btn');
    const rejectBtn = card.querySelector('.reject-btn');
    
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    btn.textContent = '⏳ Approving...';
    btn.style.opacity = '0.6';
    
    // 5. BUSCAR SESSÃO
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
      alert('❌ Not authenticated!');
      throw new Error('Not authenticated');
    }
    
    // 6. CHAMAR BACKEND SEGURO
    const response = await fetch('/api/_admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'approveOrder',
        userId: window.currentUser.id,
        orderId: orderId,
        authToken: session.access_token
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      alert('❌ Error: ' + (result.error || 'Unknown error'));
      throw new Error(result.error);
    }
    
    // 7. SUCESSO
    if (result.success) {
      // Atualizar saldo se for o próprio usuário
      if (result.yourNewBalance !== null && result.yourNewBalance !== undefined) {
        if (window.playerDiamonds) {
          window.playerDiamonds.value = result.yourNewBalance;
        }
      }
      
      card.style.transition = 'all 0.3s ease';
      card.style.opacity = '0';
      card.style.transform = 'translateX(20px)';
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      isUpdatingAdmin = false;
      
      await renderAdminPendingOrders();
      await renderAdminHistoryOrders();
      
      const stats = await fetchAdminStats();
      const pendingCountEl = document.getElementById('admin-pending-count');
      const approvedCountEl = document.getElementById('admin-approved-count');
      const totalBrlEl = document.getElementById('admin-total-brl');
      
      if (pendingCountEl) pendingCountEl.textContent = stats.pendingCount;
      if (approvedCountEl) approvedCountEl.textContent = stats.approvedCount;
      if (totalBrlEl) totalBrlEl.textContent = `R$ ${stats.totalBRL.toFixed(2)}`;
      
      alert(result.message || '✅ Order approved successfully!');
    }
    
  } catch (err) {
    console.error('❌ Error in handler:', err);
    alert('❌ Error: ' + err.message);
    
    // Restaurar botões
    const btn = document.querySelector(`.approve-btn[data-order-id="${orderId}"]`);
    const card = btn?.closest('.admin-order-card');
    
    if (card) {
      const approveBtn = card.querySelector('.approve-btn');
      const rejectBtn = card.querySelector('.reject-btn');
      
      if (approveBtn) {
        approveBtn.disabled = false;
        approveBtn.textContent = '✅ Approve';
        approveBtn.style.opacity = '1';
      }
      
      if (rejectBtn) {
        rejectBtn.disabled = false;
      }
    }
    
    isUpdatingAdmin = false;
  }
}

/**
 * Handler seguro para rejeitar pedido
 */
export async function handleRejectOrder(orderId) {
  try {
    // 1. VERIFICAR PERMISSÃO
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) {
      alert('❌ Access denied!');
      return;
    }
    
    // 2. VALIDAR INPUT
    if (!orderId || typeof orderId !== 'string') {
      alert('❌ Invalid order ID');
      return;
    }
    
    // 3. CONFIRMAR
    const confirmar = confirm('❌ Confirm rejection of this order?');
    if (!confirmar) return;
    
    // 4. BUSCAR BOTÃO
    const btn = document.querySelector(`.reject-btn[data-order-id="${orderId}"]`);
    const card = btn?.closest('.admin-order-card');
    
    if (!btn || !card) {
      alert('❌ Button not found');
      return;
    }
    
    const originalText = btn.textContent;
    const approveBtn = card.querySelector('.approve-btn');
    const rejectBtn = card.querySelector('.reject-btn');
    
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    btn.textContent = '⏳ Rejecting...';
    btn.style.opacity = '0.6';
    
    // 5. BUSCAR SESSÃO
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
      alert('❌ Not authenticated!');
      throw new Error('Not authenticated');
    }
    
    // 6. CHAMAR BACKEND SEGURO
    const response = await fetch('/api/_admin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'rejectOrder',
        userId: window.currentUser.id,
        orderId: orderId,
        authToken: session.access_token
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      alert('❌ Error: ' + (result.error || 'Unknown error'));
      throw new Error(result.error);
    }
    
    // 7. SUCESSO
    if (result.success) {
      card.style.transition = 'all 0.3s ease';
      card.style.opacity = '0';
      card.style.transform = 'translateX(20px)';
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      isUpdatingAdmin = false;
      await renderAdminPendingOrders();
      await renderAdminHistoryOrders();
      
      const stats = await fetchAdminStats();
      const pendingCountEl = document.getElementById('admin-pending-count');
      if (pendingCountEl) pendingCountEl.textContent = stats.pendingCount;
      
      alert('✅ Order rejected!');
    }
    
  } catch (err) {
    console.error('❌ Handler error:', err);
    alert('❌ Error: ' + err.message);
    
    // Restaurar botões
    const btn = document.querySelector(`.reject-btn[data-order-id="${orderId}"]`);
    const card = btn?.closest('.admin-order-card');
    
    if (card) {
      const approveBtn = card.querySelector('.approve-btn');
      const rejectBtn = card.querySelector('.reject-btn');
      
      if (rejectBtn) {
        rejectBtn.disabled = false;
        rejectBtn.textContent = '❌ Reject';
        rejectBtn.style.opacity = '1';
      }
      
      if (approveBtn) {
        approveBtn.disabled = false;
      }
    }
    
    isUpdatingAdmin = false;
  }
}

// ============================================================
// TAB SWITCHING
// ============================================================

/**
 * Troca entre abas principais do admin
 */
export function switchMainAdminTab(tab) {
  activeAdminTab = tab;
  
  // Atualizar botões
  document.querySelectorAll('.admin-main-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  
  // Renderizar conteúdo
  renderAdminPanel();
}

/**
 * Troca entre abas internas de suporte
 */
export function switchSupportSubTab(subtab) {
  document.querySelectorAll('.admin-support-section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.admin-support-tab-btn').forEach(b => b.classList.remove('active'));
  
  document.getElementById(`admin-support-${subtab}`)?.classList.remove('hidden');
  event?.target?.classList.add('active');
}

/**
 * Marca ticket como resolvido
 */
export async function markTicketResolved(ticketId) {
  if (!confirm('Mark this ticket as resolved?')) return;
  
  try {
    const updates = { status: 'resolved', updated_at: new Date().toISOString() };

    let { error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('ticket_code', ticketId);

    if (error) {
      console.warn('⚠️ Ticket update by ticket_code failed, trying by id:', error.message);
      ({ error } = await supabase
        .from('support_tickets')
        .update(updates)
        .eq('id', ticketId));
    }

    if (error) throw error;
    
    await renderAdminPanel();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

/**
 * Abre formulário de resposta
 */
export function openReplyForm(ticketId, email) {
  switchSupportSubTab('reply');
  
  document.getElementById('reply-ticket-id').value = ticketId;
  document.getElementById('reply-to-email').value = email;
  document.getElementById('reply-resolution').value = '';
  document.getElementById('reply-message').value = '';
  
  // Remover seleção anterior
  document.querySelectorAll('.resolution-btn').forEach(btn => btn.classList.remove('selected'));
}

/**
 * Define categoria de resolução
 */
export function setResolution(value) {
  document.getElementById('reply-resolution').value = value;
  
  document.querySelectorAll('.resolution-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  document.querySelector(`[data-value="${value}"]`)?.classList.add('selected');
}

/**
 * Seleciona email no inbox
 */
export function selectInboxEmail(ticketId) {
  // TODO: Abrir preview do email
  console.log('Selected ticket:', ticketId);
}

/**
 * Envia resposta por email e atualiza ticket
 */
export async function sendSupportReply() {
  try {
    const ticketId = document.getElementById('reply-ticket-id').value;
    const toEmail = document.getElementById('reply-to-email').value;
    const resolutionRaw = document.getElementById('reply-resolution').value;
    const message = document.getElementById('reply-message').value;
    const resolution = resolutionRaw || 'resolvable';
    
    if (!ticketId || !toEmail || !resolution || !message) {
      alert('❌ Fill all required fields');
      return;
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      alert('❌ Not authenticated');
      return;
    }
    
    // Enviar para backend
    const response = await fetch('/api/_support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sendAdminReply',
        ticketId,
        toEmail,
        resolutionCategory: resolution,
        message,
        authToken: session.access_token,
        userId: window.currentUser?.id
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) throw new Error(data.error);
    
    alert('✅ Response sent successfully!');
    
    // Limpar form
    document.getElementById('reply-ticket-id').value = '';
    document.getElementById('reply-to-email').value = '';
    document.getElementById('reply-resolution').value = '';
    document.getElementById('reply-message').value = '';
    
    // Recarregar tickets
    await renderAdminPanel();
    
  } catch (err) {
    alert('❌ Error: ' + err.message);
  }
}

function normalizeTicketStatus(status) {
  const value = (status || '').toLowerCase();
  if (value === 'pending' || value === 'pendente') return 'pending';
  if (value === 'resolved' || value === 'resolvido') return 'resolved';
  if (value === 'escalation' || value === 'needs_escalation') return 'escalation';
  if (value === 'spam' || value === 'invalid') return 'spam';
  return 'unknown';
}

/**
 * Troca entre abas do admin (OLD VERSION - MANTIDO POR COMPATIBILIDADE)
 */
export function switchAdminTab(tab) {
  const currentTab = (typeof event !== 'undefined') ? event?.currentTarget : null;
  
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  if (currentTab) currentTab.classList.add('active');
  
  const pendingList = document.getElementById('admin-pending-list');
  const historyList = document.getElementById('admin-history-list');
  
  if (tab === 'pending') {
    if (pendingList) pendingList.classList.remove('hidden');
    if (historyList) historyList.classList.add('hidden');
  } else {
    if (pendingList) pendingList.classList.add('hidden');
    if (historyList) historyList.classList.remove('hidden');
  }
}

// ============================================================
// NAVIGATION
// ============================================================

/**
 * Navega para o painel admin (COM VERIFICAÇÃO)
 */
export async function goToAdmin() {
  const { isAdmin } = await checkIsAdmin();
  
  if (!isAdmin) {
    alert('❌ Access denied!');
    return;
  }
  
  const dropdown = document.getElementById('profile-dropdown');
  if (dropdown) dropdown.classList.remove('active');
  
  if (window.goTo) {
    window.goTo('admin');
  }
  
  await renderAdminPanel();
}

// ============================================================
// REALTIME SUBSCRIPTION
// ============================================================

/**
 * Inicia subscription do admin (COM VERIFICAÇÃO)
 */
export async function startAdminPolling() {
  // Verificar permissão
  const { isAdmin } = await checkIsAdmin();
  if (!isAdmin) {
    console.warn('User is not admin, skipping subscription');
    return;
  }
  
  // Cancelar subscription anterior
  if (adminSubscription) {
    adminSubscription.unsubscribe();
    adminSubscription = null;
  }
  
  // Renderizar inicial
  if (isAdminScreenActive()) {
    requestAdminRefresh();
  }
  
  // Criar subscription
  adminSubscription = supabase
    .channel('admin-orders')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'purchase_orders'
      },
      async (payload) => {
        
        // Verificar permissão antes de atualizar
        const { isAdmin: stillAdmin } = await checkIsAdmin();
        if (!stillAdmin) {
          console.warn('User no longer admin, stopping updates');
          stopAdminPolling();
          return;
        }
        
        // Atualizar UI (debounced)
        requestAdminRefresh();
      }
    )
    .subscribe((status) => {
    });
}

/**
 * Para subscription do admin
 */
export function stopAdminPolling() {
  if (adminSubscription) {
    adminSubscription.unsubscribe();
    adminSubscription = null;
  }

  if (adminRefreshTimer) {
    clearTimeout(adminRefreshTimer);
    adminRefreshTimer = null;
  }
  adminRefreshQueued = false;
}

// ============================================================
// EXPOR FUNÇÕES GLOBALMENTE (COM SEGURANÇA)
// ============================================================

window.checkIsAdmin = checkIsAdmin;
window.checkAndShowAdminButton = checkAndShowAdminButton;
window.renderAdminPanel = renderAdminPanel;
window.handleApproveOrder = handleApproveOrder;
window.handleRejectOrder = handleRejectOrder;
window.switchAdminTab = switchAdminTab;
window.switchMainAdminTab = switchMainAdminTab;
window.switchSupportSubTab = switchSupportSubTab;
window.markTicketResolved = markTicketResolved;
window.openReplyForm = openReplyForm;
window.setResolution = setResolution;
window.selectInboxEmail = selectInboxEmail;
window.sendSupportReply = sendSupportReply;
window.goToAdmin = goToAdmin;
window.startAdminPolling = startAdminPolling;
window.stopAdminPolling = stopAdminPolling;
window.invalidateAdminRoleCache = invalidateAdminRoleCache;