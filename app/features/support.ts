// ============================================================
// SUPPORT MODAL - CONTACT/SUPPORT SYSTEM
// ============================================================

import { addCsrfHeader } from '../core/session';

// ============================================================
// TIPOS E INTERFACES
// ============================================================

interface SupportFormData {
  nome: string;
  email: string;
  assunto: string;
  mensagem: string;
}

interface FormValidationResult {
  valid: boolean;
  errors: string[];
  data: SupportFormData;
}

interface TicketSubmitResponse {
  success: boolean;
  ticketId: string;
  sent: 'immediately' | 'delayed';
  error?: string;
}

interface CurrentUser {
  id: string;
  session?: {
    access_token: string;
  };
  [key: string]: any;
}

declare global {
  interface Window {
    currentUser?: any;
    openSupport?: typeof openSupportModal;
    closeSupport?: typeof closeModal;
    initSupport?: typeof initSupport;
  }
}

// ============================================================
// MODAL STATE
// ============================================================

let isOpen: boolean = false;

// ============================================================
// EMAIL VALIDATION
// ============================================================

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ============================================================
// FORM VALIDATION
// ============================================================

function validateForm(): FormValidationResult {
  const nome = (document.getElementById('support-name') as HTMLInputElement)?.value || '';
  const email = (document.getElementById('support-email') as HTMLInputElement)?.value || '';
  const assunto = (document.getElementById('support-subject') as HTMLInputElement)?.value || '';
  const mensagem = (document.getElementById('support-message') as HTMLTextAreaElement)?.value || '';
  
  const errors = [];
  
  if (nome.trim().length < 2) {
    errors.push('Name must have at least 2 characters');
  }
  
  if (!isValidEmail(email)) {
    errors.push('Invalid email');
  }
  
  if (assunto.trim().length < 3) {
    errors.push('Subject must have at least 3 characters');
  }
  
  if (mensagem.trim().length < 20) {
    errors.push('Message must have at least 20 characters');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    data: { nome: nome.trim(), email: email.trim(), assunto: assunto.trim(), mensagem: mensagem.trim() }
  };
}

// ============================================================
// SHOW ERROR
// ============================================================

function showError(message: string): void {
  const errorEl = document.getElementById('support-error');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    
    // Hide error after 5 seconds
    setTimeout(() => {
      errorEl.style.display = 'none';
    }, 5000);
  }
}

// ============================================================
// SHOW SUCCESS
// ============================================================

function showSuccess(ticketId: string, sent: 'immediately' | 'delayed'): void {
  const successEl = document.getElementById('support-success');
  const ticketIdEl = document.getElementById('support-ticket-id');
  const statusEl = document.getElementById('support-status');
  
  if (successEl && ticketIdEl && statusEl) {
    ticketIdEl.textContent = ticketId;
    
    if (sent === 'immediately') {
      statusEl.textContent = 'Ticket sent successfully! We will respond soon.';
    } else {
      statusEl.textContent = 'Ticket received! Will be processed soon due to high volume.';
    }
    
    successEl.style.display = 'flex';
    
    // Close modal after 3 seconds
    setTimeout(() => {
      closeModal();
    }, 3000);
  }
}

// ============================================================
// SUBMIT TICKET
// ============================================================

async function submitTicket(formData: SupportFormData): Promise<TicketSubmitResponse> {
  try {
    const response = await fetch('/api/_support', {
      method: 'POST',
      headers: await addCsrfHeader({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({
        action: 'submitTicket',
        name: formData.nome,
        email: formData.email,
        subject: formData.assunto,
        message: formData.mensagem,
        userId: window.currentUser?.id || null,
        authToken: window.currentUser?.session?.access_token || null
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Erro ao enviar ticket');
    }
    
    return data;
    
  } catch (error) {
    console.error('❌ Error submitting ticket:', error);
    throw error;
  }
}

// ============================================================
// FORM HANDLER
// ============================================================

async function handleSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  
  // Validate form
  const validation = validateForm();
  
  if (!validation.valid) {
    showError(validation.errors[0]);
    return;
  }
  
  // Disable button and show loading
  const submitBtn = document.getElementById('support-submit-btn');
  const loadingEl = document.getElementById('support-loading');
  const formEl = document.getElementById('support-form-content');
  
  if (submitBtn) (submitBtn as HTMLButtonElement).disabled = true;
  if (loadingEl) loadingEl.style.display = 'flex';
  if (formEl) formEl.style.opacity = '0.5';
  
  try {
    // Send ticket
    const result = await submitTicket(validation.data);
    
    if (result.success) {
      // Show success
      showSuccess(result.ticketId, result.sent);
      
      // Clear form
      const nameEl = document.getElementById('support-name') as HTMLInputElement | null;
      const emailEl = document.getElementById('support-email') as HTMLInputElement | null;
      const subjectEl = document.getElementById('support-subject') as HTMLInputElement | null;
      const messageEl = document.getElementById('support-message') as HTMLTextAreaElement | null;
      
      if (nameEl) nameEl.value = '';
      if (emailEl) emailEl.value = '';
      if (subjectEl) subjectEl.value = '';
      if (messageEl) messageEl.value = '';
    } else {
      showError(result.error || 'Error sending ticket');
    }
    
  } catch (error) {
    showError(((error as any)?.message || 'Error sending ticket. Please try again.'));
  } finally {
    // Re-enable button and hide loading
    if (submitBtn) (submitBtn as HTMLButtonElement).disabled = false;
    if (loadingEl) loadingEl.style.display = 'none';
    if (formEl) formEl.style.opacity = '1';
  }
}

// ============================================================
// OPEN MODAL
// ============================================================

export function openSupportModal(): void {
  if (isOpen) return;
  
  const modal = document.getElementById('support-modal');
  if (modal) {
    modal.style.display = 'flex';
    isOpen = true;
    
    // Focus on first field
    setTimeout(() => {
      document.getElementById('support-name')?.focus();
    }, 100);
  }
}

// ============================================================
// CLOSE MODAL
// ============================================================

export function closeModal(): void {
  const modal = document.getElementById('support-modal');
  const successEl = document.getElementById('support-success');
  const errorEl = document.getElementById('support-error');
  
  if (modal) {
    modal.style.display = 'none';
    isOpen = false;
    
    // Clear messages
    if (successEl) successEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
  }
}

// ============================================================
// RENDER MODAL
// ============================================================

export function renderSupportModal(): string {
  return `
    <!-- Support Modal -->
    <div id="support-modal" class="support-modal">
      <div class="support-modal-overlay" onclick="window.closeSupport()"></div>
      
      <div class="support-modal-content">
        
        <!-- Header -->
        <div class="support-modal-header">
          <h2>
            <span class="support-icon">💬</span>
            Contact & Support
          </h2>
          <button class="support-close-btn" onclick="window.closeSupport()" aria-label="Close">
            ✕
          </button>
        </div>
        
        <!-- Body -->
        <div class="support-modal-body">
          
          <!-- Form -->
          <form id="support-form" class="support-form">
            <div id="support-form-content">
              
              <!-- Name -->
              <div class="support-form-group">
                <label for="support-name">
                  <span class="required">*</span> Name
                </label>
                <input 
                  type="text" 
                  id="support-name" 
                  name="nome"
                  placeholder="Your full name"
                  required
                  minlength="2"
                  maxlength="100"
                />
              </div>
              
              <!-- Email -->
              <div class="support-form-group">
                <label for="support-email">
                  <span class="required">*</span> Email
                </label>
                <input 
                  type="email" 
                  id="support-email" 
                  name="email"
                  placeholder="your@email.com"
                  required
                />
              </div>
              
              <!-- Subject -->
              <div class="support-form-group">
                <label for="support-subject">
                  <span class="required">*</span> Subject
                </label>
                <input 
                  type="text" 
                  id="support-subject" 
                  name="assunto"
                  placeholder="Subject of your message"
                  required
                  minlength="3"
                  maxlength="200"
                />
              </div>
              
              <!-- Message -->
              <div class="support-form-group">
                <label for="support-message">
                  <span class="required">*</span> Message
                </label>
                <textarea 
                  id="support-message" 
                  name="mensagem"
                  placeholder="Describe your question or problem in detail..."
                  required
                  minlength="20"
                  maxlength="5000"
                  rows="6"
                ></textarea>
                <small class="support-hint">Minimum 20 characters</small>
              </div>
              
              <!-- Error -->
              <div id="support-error" class="support-error" style="display: none;"></div>
              
              <!-- Button -->
              <button type="submit" id="support-submit-btn" class="support-submit-btn">
                <span class="btn-icon">📧</span>
                Send Ticket
              </button>
              
            </div>
            
            <!-- Loading -->
            <div id="support-loading" class="support-loading" style="display: none;">
              <div class="spinner"></div>
              <p>Sending ticket...</p>
            </div>
            
            <!-- Success -->
            <div id="support-success" class="support-success" style="display: none;">
              <div class="success-icon">✅</div>
              <h3>Ticket Sent!</h3>
              <p id="support-status"></p>
              <div class="ticket-id-box">
                <strong>Ticket ID:</strong>
                <code id="support-ticket-id"></code>
              </div>
              <small>This modal will close automatically...</small>
            </div>
            
          </form>
          
        </div>
        
      </div>
    </div>
  `;
}

// ============================================================
// INITIALIZATION
// ============================================================

export function initSupport(): void {
  // Add modal to DOM
  const existingModal = document.getElementById('support-modal');
  if (!existingModal) {
    const modalHTML = renderSupportModal();
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }
  
  // Add event listener to form
  const form = document.getElementById('support-form');
  if (form) {
    form.addEventListener('submit', handleSubmit);
  }
  
  // Expose functions globally for onclick
  window.openSupport = openSupportModal;
  window.closeSupport = closeModal;
}

// ============================================================
// EXPORTS
// ============================================================

export default {
  init: initSupport,
  open: openSupportModal,
  close: closeModal
};

// Expose initSupport globally for app.js
window.initSupport = initSupport;
