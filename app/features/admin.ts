// @ts-nocheck

// ============================================================
// ADMIN.JS - Sistema de Administração SEGURO (FRONTEND)
// ============================================================

import { supabase } from './auth';

// ============================================================
// STATE MANAGEMENT
// ============================================================

let isUpdatingAdmin: boolean = false;
let adminSubscription: any = null;
let adminRoleCache: any = null;
let adminRoleCacheTime: number = 0;
const ROLE_CACHE_DURATION: number = 30000; // 30 segundos

let adminDelegationBound: boolean = false;
let adminRefreshTimer: any = null;
let adminRefreshInFlight: any = null;
let adminRefreshQueued: boolean = false;

// ABA ATIVA (NOVO)
let activeAdminTab: string = 'purchases'; // 'purchases' ou 'support'

function isAdminScreenActive(): boolean {
  return document.getElementById('admin')?.classList.contains('active') || false;
}

function bindAdminOrderDelegationOnce(): void {
  if (adminDelegationBound) return;

  const pendingList: HTMLElement | null = document.getElementById('admin-pending-list');
  if (!pendingList) return;

  pendingList.addEventListener('click', (e: Event) => {
    const target: any = e.target;
    if (!(target instanceof Element)) return;

    const approveBtn: HTMLElement | null = target.closest('.approve-btn');
    if (approveBtn) {
      const orderId: string | null = approveBtn.getAttribute('data-order-id');
      if (orderId) handleApproveOrder(orderId);
      return;
    }

    const rejectBtn: HTMLElement | null = target.closest('.reject-btn');
    if (rejectBtn) {
      const orderId: string | null = rejectBtn.getAttribute('data-order-id');
      if (orderId) handleRejectOrder(orderId);
    }
  });

  adminDelegationBound = true;
}

function requestAdminRefresh(): void {
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
      .catch((err: any) => console.error('Admin refresh error:', err))
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
    const now: number = Date.now();
    
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
    const isAdmin: boolean = data.role === 'admin' || data.role === 'support';
    
    adminRoleCache = { isAdmin, role: data.role };
    adminRoleCacheTime = now;
    
    return adminRoleCache;
    
  } catch (err: any) {
    console.error('Error checking admin:', err);
    adminRoleCache = { isAdmin: false, role: null };
    adminRoleCacheTime = Date.now();
    return adminRoleCache;
  }
}

/**
 * Invalida o cache de role (chamar após logout ou mudanças)
 */
export function invalidateAdminRoleCache(): void {
  adminRoleCache = null;
  adminRoleCacheTime = 0;
}

/**
 * Verifica e mostra botão admin se for admin
 */
export async function checkAndShowAdminButton(): Promise<void> {
  const { isAdmin } = await checkIsAdmin();
  const adminBtn: HTMLElement | null = document.getElementById('admin-btn');
  
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
export async function renderAdminPanel(): Promise<void> {
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
async function renderAdminPurchasesTab(): Promise<void> {
  try {
    // Show purchases section, hide support if present
    document.getElementById('admin-purchases-section')?.classList.remove('hidden');
    document.getElementById('admin-support-section')?.classList.add('hidden');

    const stats: any = await fetchAdminStats();
    
    const pendingCountEl: HTMLElement | null = document.getElementById('admin-pending-count');
    const approvedCountEl: HTMLElement | null = document.getElementById('admin-approved-count');
    const totalUsdEl: HTMLElement | null = document.getElementById('admin-total-usd');
    const totalBrlEl: HTMLElement | null = document.getElementById('admin-total-brl');
    const totalLtcEl: HTMLElement | null = document.getElementById('admin-total-ltc');
    
    if (pendingCountEl) pendingCountEl.textContent = stats.pendingCount;
    if (approvedCountEl) approvedCountEl.textContent = stats.approvedCount;
    if (totalUsdEl) totalUsdEl.textContent = `$ ${stats.totalUSD.toFixed(2)}`;
    if (totalBrlEl) totalBrlEl.textContent = `R$ ${stats.totalBRL.toFixed(2)}`;
    if (totalLtcEl) totalLtcEl.textContent = `${stats.totalLTC.toFixed(4)} LTC`;
    
    await renderAdminPendingOrders();
    await renderAdminHistoryOrders();
  } catch (err: any) {
    console.error('Error rendering purchases tab:', err);
  }
}

/**
 * Renderiza aba de Suporte
 */
async function renderAdminSupportTab(): Promise<void> {
  try {
    const container: HTMLElement | null = document.getElementById('admin-content');
    if (!container) return;

    // Hide purchases section while viewing support
    document.getElementById('admin-purchases-section')?.classList.add('hidden');

    let supportSection: HTMLElement | null = document.getElementById('admin-support-section');
    if (!supportSection) {
      supportSection = document.createElement('div');
      supportSection.id = 'admin-support-section';
      supportSection.classList.add('admin-section');
      container.appendChild(supportSection);
    }

    supportSection.classList.remove('hidden');

    // Renderizar as seções de suporte
    const tickets: any = await fetchSupportTickets();
    
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
    
  } catch (err: any) {
    console.error('Error rendering support tab:', err);
  }
}

/**
 * Busca tickets de suporte
 */
async function fetchSupportTickets(): Promise<any[]> {
  try {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    
    return data || [];
  } catch (err: any) {
    console.error('Error fetching tickets:', err);
    return [];
  }
}

/**
 * Atualiza ticket de suporte
 */
async function updateSupportTicket(ticketId: string, updates: any): Promise<any> {
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
  } catch (err: any) {
    console.error('Error updating ticket:', err);
    return null;
  }
}

/**
 * Renderiza histórico de tickets
 */
function renderSupportTicketsHistory(tickets: any[]): string {
  if (!tickets || tickets.length === 0) {
    return '<p class="no-data">No support tickets yet</p>';
  }
  
  return `
    <div class="admin-tickets-list">
      ${tickets.map((ticket: any) => {
        const normalizedStatus: string = normalizeTicketStatus(ticket.status);
        const pending: boolean = normalizedStatus === 'pending';
        const resolved: boolean = normalizedStatus === 'resolved';
        const escalation: boolean = normalizedStatus === 'escalation';
        const statusColor: string = pending ? '#f59e0b' : resolved ? '#10b981' : escalation ? '#f97316' : '#6b7280';
        const statusIcon: string = pending ? '⏳' : resolved ? '✅' : escalation ? '⚠️' : '❓';
        const ticketCode: string = ticket.ticket_code || ticket.id || 'N/A';
        
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
function renderSupportReplyForm(): string {
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
          <textarea id="reply-message" placeholder="Type your response here..." rows={6}></textarea>
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
function renderSupportInbox(tickets: any[]): string {
  const pending: any[] = tickets.filter((t: any) => normalizeTicketStatus(t.status) === 'pending');
  
  if (pending.length === 0) {
    return '<p class="no-data">No pending support tickets</p>';
  }
  
  return `
    <div class="admin-inbox-container">
      <div class="inbox-stats">
        <span>📬 ${pending.length} pending message(s)</span>
      </div>
      
      <div class="inbox-list">
        ${pending.map((ticket: any) => {
          const ticketCode: string = ticket.ticket_code || ticket.id;
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
async function fetchAdminStats(): Promise<any> {
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
    
    const totalUSD: number = usdOrders?.reduce((sum: number, o: any) => sum + (o.amount_paid || 0), 0) || 0;
    
    const { data: brlOrders } = await supabase
      .from('purchase_orders')
      .select('amount_paid')
      .eq('status', 'approved')
      .eq('currency', 'BRL');
    
    const totalBRL: number = brlOrders?.reduce((sum: number, o: any) => sum + (o.amount_paid || 0), 0) || 0;
    
    const { data: ltcOrders } = await supabase
      .from('purchase_orders')
      .select('amount_paid')
      .eq('status', 'approved')
      .eq('currency', 'LTC');
    
    const totalLTC: number = ltcOrders?.reduce((sum: number, o: any) => sum + (o.amount_paid || 0), 0) || 0;
    
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
    
  } catch (err: any) {
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
async function fetchPendingOrders(): Promise<any[]> {
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
  } catch (err: any) {
    console.error('Error fetching pending orders:', err);
    return [];
  }
}

/**
 * Renderiza pedidos pendentes (COM SANITIZAÇÃO)
 */
async function renderAdminPendingOrders(): Promise<void> {
  const wasUpdating: boolean = isUpdatingAdmin;
  isUpdatingAdmin = false;
  
  try {
    const orders: any[] = await fetchPendingOrders();
    const list: HTMLElement | null = document.getElementById('admin-pending-list');
    
    if (!list) {
      return;
    }
    
    if (!orders || orders.length === 0) {
      list.innerHTML = '<p class="no-orders">No pending orders</p>';
      return;
    }
    
    // SANITIZAR DADOS
    list.innerHTML = orders.map((order: any) => {
      const date: string = new Date(order.created_at).toLocaleString('en-US');
      const totalDiamonds: number = (order.diamonds_base || 0) + (order.diamonds_bonus || 0);
      const orderId: string = String(order.id || '').slice(0, 8);
      const userEmail: string = sanitizeHTML(order.user_email || 'N/A');
      const amountPaid: string = parseFloat(order.amount_paid || 0).toFixed(2);
      const currency: string = sanitizeHTML(String(order.currency || 'N/A').toUpperCase());
      const paymentMethod: string = sanitizeHTML(String(order.payment_method || 'N/A').toUpperCase());
      
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
    
  } catch (err: any) {
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
function sanitizeHTML(str: string): string {
  const div: HTMLElement = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Adiciona event listeners de forma segura
 */
function attachOrderEventListeners(): void {
  // Mantido por compatibilidade: agora usamos delegação.
  bindAdminOrderDelegationOnce();
}

/**
 * Renderiza histórico de pedidos
 */
async function renderAdminHistoryOrders(): Promise<void> {
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
    
    const list: HTMLElement | null = document.getElementById('admin-history-list');
    
    if (!list) return;
    
    if (error || !orders || orders.length === 0) {
      list.innerHTML = '<p class="no-orders">No requests in the history.</p>';
      return;
    }
    
    list.innerHTML = orders.map((order: any) => {
      const date: string = new Date(order.reviewed_at || order.created_at).toLocaleString('en-US');
      const totalDiamonds: number = (order.diamonds_base || 0) + (order.diamonds_bonus || 0);
      const orderId: string = String(order.id || '').slice(0, 8);
      const userEmail: string = sanitizeHTML(order.user_email || 'N/A');
      const amountPaid: string = parseFloat(order.amount_paid || 0).toFixed(2);
      const currency: string = sanitizeHTML(String(order.currency || 'N/A').toUpperCase());
      
      const statusColors: any = {
        approved: '#22c55e',
        rejected: '#ef4444'
      };
      
      const statusText: any = {
        approved: '✅ Approved',
        rejected: '❌ Rejected'
      };
      
      const status: string = order.status || 'unknown';
      
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
    
  } catch (err: any) {
    console.error('Error rendering history:', err);
  }
}

// ============================================================
// 🔐 ORDER HANDLERS SEGUROS (CHAMAM BACKEND)
// ============================================================

/**
 * Handler seguro para aprovar pedido
 */
export async function handleApproveOrder(orderId: string): Promise<void> {
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
    const confirmar: boolean = confirm('✅ Confirm approval of this order?');
    if (!confirmar) return;
    
    // 4. BUSCAR BOTÃO
    const btn: HTMLElement | null = document.querySelector(`.approve-btn[data-order-id="${orderId}"]`);
    const card: HTMLElement | null = btn?.closest('.admin-order-card') || null;
    
    if (!btn || !card) {
      alert('❌ Button not found');
      return;
    }
    
    const originalText: string = btn.textContent || '';
    const approveBtn: HTMLElement | null = card.querySelector('.approve-btn');
    const rejectBtn: HTMLElement | null = card.querySelector('.reject-btn');
    
    if (approveBtn) (approveBtn as HTMLButtonElement).disabled = true;
    if (rejectBtn) (rejectBtn as HTMLButtonElement).disabled = true;
    btn.textContent = '⏳ Approving...';
    (btn as HTMLElement).style.opacity = '0.6';
    
    // 5. BUSCAR SESSÃO
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
      alert('❌ Not authenticated!');
      throw new Error('Not authenticated');
    }
    
    // 6. CHAMAR BACKEND SEGURO
    const response: Response = await fetch('/api/_admin', {
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
    
    const result: any = await response.json();
    
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
      
      const stats: any = await fetchAdminStats();
      const pendingCountEl: HTMLElement | null = document.getElementById('admin-pending-count');
      const approvedCountEl: HTMLElement | null = document.getElementById('admin-approved-count');
      const totalBrlEl: HTMLElement | null = document.getElementById('admin-total-brl');
      
      if (pendingCountEl) pendingCountEl.textContent = stats.pendingCount;
      if (approvedCountEl) approvedCountEl.textContent = stats.approvedCount;
      if (totalBrlEl) totalBrlEl.textContent = `R$ ${stats.totalBRL.toFixed(2)}`;
      
      alert(result.message || '✅ Order approved successfully!');
    }
    
  } catch (err: any) {
    console.error('❌ Error in handler:', err);
    alert('❌ Error: ' + err.message);
    
    // Restaurar botões
    const btn: HTMLElement | null = document.querySelector(`.approve-btn[data-order-id="${orderId}"]`);
    const card: HTMLElement | null = btn?.closest('.admin-order-card') || null;
    
    if (card) {
      const approveBtn: HTMLElement | null = card.querySelector('.approve-btn');
      const rejectBtn: HTMLElement | null = card.querySelector('.reject-btn');
      
      if (approveBtn) {
        (approveBtn as HTMLButtonElement).disabled = false;
        approveBtn.textContent = '✅ Approve';
        (approveBtn as HTMLElement).style.opacity = '1';
      }
      
      if (rejectBtn) {
        (rejectBtn as HTMLButtonElement).disabled = false;
      }
    }
    
    isUpdatingAdmin = false;
  }
}

/**
 * Handler seguro para rejeitar pedido
 */
export async function handleRejectOrder(orderId: string): Promise<void> {
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
    const confirmar: boolean = confirm('❌ Confirm rejection of this order?');
    if (!confirmar) return;
    
    // 4. BUSCAR BOTÃO
    const btn: HTMLElement | null = document.querySelector(`.reject-btn[data-order-id="${orderId}"]`);
    const card: HTMLElement | null = btn?.closest('.admin-order-card') || null;
    
    if (!btn || !card) {
      alert('❌ Button not found');
      return;
    }
    
    const originalText: string = btn.textContent || '';
    const approveBtn: HTMLElement | null = card.querySelector('.approve-btn');
    const rejectBtn: HTMLElement | null = card.querySelector('.reject-btn');
    
    if (approveBtn) (approveBtn as HTMLButtonElement).disabled = true;
    if (rejectBtn) (rejectBtn as HTMLButtonElement).disabled = true;
    btn.textContent = '⏳ Rejecting...';
    (btn as HTMLElement).style.opacity = '0.6';
    
    // 5. BUSCAR SESSÃO
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
      alert('❌ Not authenticated!');
      throw new Error('Not authenticated');
    }
    
    // 6. CHAMAR BACKEND SEGURO
    const response: Response = await fetch('/api/_admin', {
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
    
    const result: any = await response.json();
    
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
      
      const stats: any = await fetchAdminStats();
      const pendingCountEl: HTMLElement | null = document.getElementById('admin-pending-count');
      if (pendingCountEl) pendingCountEl.textContent = stats.pendingCount;
      
      alert('✅ Order rejected!');
    }
    
  } catch (err: any) {
    console.error('❌ Handler error:', err);
    alert('❌ Error: ' + err.message);
    
    // Restaurar botões
    const btn: HTMLElement | null = document.querySelector(`.reject-btn[data-order-id="${orderId}"]`);
    const card: HTMLElement | null = btn?.closest('.admin-order-card') || null;
    
    if (card) {
      const approveBtn: HTMLElement | null = card.querySelector('.approve-btn');
      const rejectBtn: HTMLElement | null = card.querySelector('.reject-btn');
      
      if (rejectBtn) {
        (rejectBtn as HTMLButtonElement).disabled = false;
        rejectBtn.textContent = '❌ Reject';
        (rejectBtn as HTMLElement).style.opacity = '1';
      }
      
      if (approveBtn) {
        (approveBtn as HTMLButtonElement).disabled = false;
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
export function switchMainAdminTab(tab: string): void {
  activeAdminTab = tab;
  
  // Atualizar botões
  document.querySelectorAll('.admin-main-tab-btn').forEach((btn: Element) => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  
  // Renderizar conteúdo
  renderAdminPanel();
}

/**
 * Troca entre abas internas de suporte
 */
export function switchSupportSubTab(subtab: string): void {
  document.querySelectorAll('.admin-support-section').forEach((s: Element) => s.classList.add('hidden'));
  document.querySelectorAll('.admin-support-tab-btn').forEach((b: Element) => b.classList.remove('active'));
  
  document.getElementById(`admin-support-${subtab}`)?.classList.remove('hidden');
  (event as any)?.target?.classList.add('active');
}

/**
 * Marca ticket como resolvido
 */
export async function markTicketResolved(ticketId: string): Promise<void> {
  if (!confirm('Mark this ticket as resolved?')) return;
  
  try {
    const updates: any = { status: 'resolved', updated_at: new Date().toISOString() };

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
  } catch (err: any) {
    alert('Error: ' + err.message);
  }
}

/**
 * Abre formulário de resposta
 */
export function openReplyForm(ticketId: string, email: string): void {
  switchSupportSubTab('reply');
  
  const ticketIdInput: HTMLInputElement | null = document.getElementById('reply-ticket-id') as HTMLInputElement;
  const emailInput: HTMLInputElement | null = document.getElementById('reply-to-email') as HTMLInputElement;
  const resolutionInput: HTMLInputElement | null = document.getElementById('reply-resolution') as HTMLInputElement;
  const messageInput: HTMLTextAreaElement | null = document.getElementById('reply-message') as HTMLTextAreaElement;
  
  if (ticketIdInput) ticketIdInput.value = ticketId;
  if (emailInput) emailInput.value = email;
  if (resolutionInput) resolutionInput.value = '';
  if (messageInput) messageInput.value = '';
  
  // Remover seleção anterior
  document.querySelectorAll('.resolution-btn').forEach((btn: Element) => btn.classList.remove('selected'));
}

/**
 * Define categoria de resolução
 */
export function setResolution(value: string): void {
  const resolutionInput: HTMLInputElement | null = document.getElementById('reply-resolution') as HTMLInputElement;
  if (resolutionInput) resolutionInput.value = value;
  
  document.querySelectorAll('.resolution-btn').forEach((btn: Element) => {
    btn.classList.remove('selected');
  });
  document.querySelector(`[data-value="${value}"]`)?.classList.add('selected');
}

/**
 * Seleciona email no inbox
 */
export function selectInboxEmail(ticketId: string): void {
  // TODO: Abrir preview do email
  console.log('Selected ticket:', ticketId);
}

/**
 * Envia resposta por email e atualiza ticket
 */
export async function sendSupportReply(): Promise<void> {
  try {
    const ticketIdInput: HTMLInputElement | null = document.getElementById('reply-ticket-id') as HTMLInputElement;
    const emailInput: HTMLInputElement | null = document.getElementById('reply-to-email') as HTMLInputElement;
    const resolutionInput: HTMLInputElement | null = document.getElementById('reply-resolution') as HTMLInputElement;
    const messageInput: HTMLTextAreaElement | null = document.getElementById('reply-message') as HTMLTextAreaElement;
    
    const ticketId: string = ticketIdInput?.value || '';
    const toEmail: string = emailInput?.value || '';
    const resolutionRaw: string = resolutionInput?.value || '';
    const message: string = messageInput?.value || '';
    const resolution: string = resolutionRaw || 'resolvable';
    
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
    const response: Response = await fetch('/api/_support', {
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
    
    const data: any = await response.json();
    
    if (!response.ok) throw new Error(data.error);
    
    alert('✅ Response sent successfully!');
    
    // Limpar form
    if (ticketIdInput) ticketIdInput.value = '';
    if (emailInput) emailInput.value = '';
    if (resolutionInput) resolutionInput.value = '';
    if (messageInput) messageInput.value = '';
    
    // Recarregar tickets
    await renderAdminPanel();
    
  } catch (err: any) {
    alert('❌ Error: ' + err.message);
  }
}

function normalizeTicketStatus(status: string): string {
  const value: string = (status || '').toLowerCase();
  if (value === 'pending' || value === 'pendente') return 'pending';
  if (value === 'resolved' || value === 'resolvido') return 'resolved';
  if (value === 'escalation' || value === 'needs_escalation') return 'escalation';
  if (value === 'spam' || value === 'invalid') return 'spam';
  return 'unknown';
}

/**
 * Troca entre abas do admin (OLD VERSION - MANTIDO POR COMPATIBILIDADE)
 */
export function switchAdminTab(tab: string): void {
  const currentTab: Element | null = (typeof event !== 'undefined') ? (event as any)?.currentTarget : null;
  
  document.querySelectorAll('.admin-tab').forEach((t: Element) => t.classList.remove('active'));
  if (currentTab) currentTab.classList.add('active');
  
  const pendingList: HTMLElement | null = document.getElementById('admin-pending-list');
  const historyList: HTMLElement | null = document.getElementById('admin-history-list');
  
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
export async function goToAdmin(): Promise<void> {
  const { isAdmin } = await checkIsAdmin();
  
  if (!isAdmin) {
    alert('❌ Access denied!');
    return;
  }
  
  const dropdown: HTMLElement | null = document.getElementById('profile-dropdown');
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
export async function startAdminPolling(): Promise<void> {
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
      async (payload: any) => {
        
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
    .subscribe((status: string) => {
    });
}

/**
 * Para subscription do admin
 */
export function stopAdminPolling(): void {
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

(window as any).checkIsAdmin = checkIsAdmin;
(window as any).checkAndShowAdminButton = checkAndShowAdminButton;
(window as any).renderAdminPanel = renderAdminPanel;
(window as any).handleApproveOrder = handleApproveOrder;
(window as any).handleRejectOrder = handleRejectOrder;
(window as any).switchAdminTab = switchAdminTab;
(window as any).switchMainAdminTab = switchMainAdminTab;
(window as any).switchSupportSubTab = switchSupportSubTab;
(window as any).markTicketResolved = markTicketResolved;
(window as any).openReplyForm = openReplyForm;
(window as any).setResolution = setResolution;
(window as any).selectInboxEmail = selectInboxEmail;
(window as any).sendSupportReply = sendSupportReply;
(window as any).goToAdmin = goToAdmin;
(window as any).startAdminPolling = startAdminPolling;
(window as any).stopAdminPolling = stopAdminPolling;
(window as any).invalidateAdminRoleCache = invalidateAdminRoleCache;
