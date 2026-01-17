// ============================================================
// COMPLIANCE-MANAGER.TS - LGPD/GDPR Compliance Features
// ============================================================

import { supabase } from '../features/auth';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../shared/error-handler';
import { showToast, showAlert } from '../shared/effects';
import { getActiveUser } from './session';

// ============================================================
// TYPES
// ============================================================

export interface UserDataExport {
  profile: any;
  stats: any;
  transactions: any;
  auditLog: any;
  settings: any;
  friends: any;
  inventory: any;
}

// ============================================================
// DATA EXPORT (LGPD/GDPR Right to Data Portability)
// ============================================================

/**
 * Prepara exportação completa dos dados do usuário
 */
export async function exportUserData(): Promise<UserDataExport | null> {
  try {
    const user = getActiveUser({ sync: true, allowStored: true });
    if (!user?.id) {
      showAlert('error', '❌ Error', 'User not found');
      return null;
    }
    
    // Buscar todos os dados do usuário
    const [profile, stats, transactions, auditLog, settings, friends, inventory] = await Promise.all([
      // Profile
      supabase
        .from('player_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single(),
      
      // Stats
      supabase
        .from('player_stats')
        .select('*')
        .eq('user_id', user.id)
        .single(),
      
      // Transações
      supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      
      // Audit Log
      supabase
        .from('audit_log')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      
      // Settings
      supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single(),
      
      // Amigos
      supabase
        .from('friends')
        .select('*')
        .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`),
      
      // Inventário
      supabase
        .from('inventory')
        .select('*')
        .eq('user_id', user.id)
    ]);
    
    return {
      profile: profile.data,
      stats: stats.data,
      transactions: transactions.data,
      auditLog: auditLog.data,
      settings: settings.data,
      friends: friends.data,
      inventory: inventory.data
    };
  } catch (err) {
    ErrorHandler.handleError('Error exporting user data', {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.ERROR,
      details: err,
      userMessage: 'Failed to export your data',
      showToUser: true
    });
    return null;
  }
}

/**
 * Faz download dos dados exportados em formato JSON
 */
export async function downloadUserData(): Promise<void> {
  try {
    const data = await exportUserData();
    if (!data) return;
    
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.href = url;
    link.download = `lootskirmish-data-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showToast('success', '📥 Downloaded', 'Your data has been downloaded as JSON');
  } catch (err) {
    ErrorHandler.handleError('Error downloading user data', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      details: err,
      userMessage: 'Failed to download your data',
      showToUser: true
    });
  }
}

// ============================================================
// ACCOUNT DELETION (LGPD/GDPR Right to be Forgotten)
// ============================================================

/**
 * Valida credenciais antes de deletar conta
 */
async function validateCredentialsForDeletion(
  email: string,
  password: string,
  tfaCode?: string
): Promise<boolean> {
  try {
    // Tenta fazer login com as credenciais
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      showAlert('error', '❌ Invalid Credentials', 'Email or password is incorrect');
      return false;
    }
    
    // Se 2FA está ativado, validar código
    const user = getActiveUser({ sync: true, allowStored: true });
    if (user?.id) {
      const { data: profile } = await supabase
        .from('player_profiles')
        .select('two_factor_enabled')
        .eq('user_id', user.id)
        .single();
      
      if (profile?.two_factor_enabled && !tfaCode) {
        showAlert('error', '🔐 2FA Required', 'Please enter your 2FA code');
        return false;
      }
    }
    
    return true;
  } catch (err) {
    ErrorHandler.handleError('Error validating credentials', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: err,
      showToUser: false
    });
    return false;
  }
}

/**
 * Abre modal de confirmação para deleção de conta
 */
export async function initiateAccountDeletion(): Promise<void> {
  const user = getActiveUser({ sync: true, allowStored: true });
  if (!user?.email) {
    showAlert('error', '❌ Error', 'User not found');
    return;
  }
  
  // Primeiro modal: Coletar credenciais
  const modalHTML = `
    <div class="compliance-modal account-deletion-confirmation">
      <div class="modal-header">
        <h2>🗑️ Delete Account</h2>
        <button class="close-modal-btn">&times;</button>
      </div>
      
      <div class="modal-body">
        <div class="warning-box">
          <strong>⚠️ Warning:</strong> This action is <strong>permanent</strong> and cannot be undone.
        </div>
        
        <p class="modal-text">To delete your account, please confirm your identity:</p>
        
        <div class="form-group">
          <label for="deletion-email">Email Address</label>
          <input type="email" id="deletion-email" value="${user.email}" disabled readonly />
        </div>
        
        <div class="form-group">
          <label for="deletion-password">Password</label>
          <input type="password" id="deletion-password" placeholder="Enter your password" />
          <small>Your password is required to verify your identity</small>
        </div>
        
        <div id="deletion-2fa-group" class="form-group" style="display: none;">
          <label for="deletion-2fa-code">2FA Code</label>
          <input type="text" id="deletion-2fa-code" placeholder="Enter 6-digit code" maxlength="6" />
        </div>
        
        <div class="form-group">
          <label>
            <input type="checkbox" id="deletion-acknowledge" />
            I understand that all my data will be permanently deleted
          </label>
        </div>
        
        <div class="modal-actions">
          <button class="btn-cancel">Cancel</button>
          <button class="btn-delete" id="confirm-deletion-btn" disabled>Delete Account</button>
        </div>
      </div>
    </div>
  `;
  
  const container = document.createElement('div');
  container.innerHTML = modalHTML;
  container.className = 'modal-overlay';
  document.body.appendChild(container);
  
  // Setup event listeners
  const emailInput = container.querySelector('#deletion-email') as HTMLInputElement;
  const passwordInput = container.querySelector('#deletion-password') as HTMLInputElement;
  const tfaInput = container.querySelector('#deletion-2fa-code') as HTMLInputElement;
  const acknowledgeCheckbox = container.querySelector('#deletion-acknowledge') as HTMLInputElement;
  const confirmBtn = container.querySelector('#confirm-deletion-btn') as HTMLButtonElement;
  const cancelBtn = container.querySelector('.btn-cancel') as HTMLButtonElement;
  const closeBtn = container.querySelector('.close-modal-btn') as HTMLButtonElement;
  const tfa2Group = container.querySelector('#deletion-2fa-group') as HTMLDivElement;
  
  // Habilitar botão apenas se checkbox foi marcado
  acknowledgeCheckbox.addEventListener('change', () => {
    confirmBtn.disabled = !acknowledgeCheckbox.checked || !passwordInput.value;
  });
  
  passwordInput.addEventListener('input', () => {
    confirmBtn.disabled = !acknowledgeCheckbox.checked || !passwordInput.value;
  });
  
  // Verificar se 2FA está ativado
  const { data: profile } = await supabase
    .from('player_profiles')
    .select('two_factor_enabled')
    .eq('user_id', user.id)
    .single();
  
  if (profile?.two_factor_enabled) {
    tfa2Group.style.display = 'block';
  }
  
  // Confirmar deleção
  confirmBtn.addEventListener('click', async () => {
    const email = user.email;
    const password = passwordInput.value;
    const tfaCode = tfaInput.value || undefined;
    
    if (!password) {
      showAlert('error', '❌ Error', 'Please enter your password');
      return;
    }
    
    // Validar credenciais
    const isValid = await validateCredentialsForDeletion(email, password, tfaCode);
    if (!isValid) return;
    
    // Segunda confirmação: modal definitivo
    container.remove();
    await showFinalDeleteConfirmation(email, password, tfaCode);
  });
  
  // Cancelar
  const closeModal = () => {
    container.remove();
  };
  
  cancelBtn.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  container.addEventListener('click', (e) => {
    if (e.target === container) closeModal();
  });
}

/**
 * Segunda confirmação para deleção de conta
 */
async function showFinalDeleteConfirmation(
  email: string,
  password: string,
  tfaCode?: string
): Promise<void> {
  const modalHTML = `
    <div class="compliance-modal final-deletion-confirmation">
      <div class="modal-header">
        <h2>⚠️ Final Confirmation</h2>
      </div>
      
      <div class="modal-body">
        <div class="error-box">
          <strong>This is your final chance to cancel!</strong>
        </div>
        
        <p class="modal-text">
          Clicking <strong>"Permanently Delete"</strong> will:
        </p>
        
        <ul class="deletion-consequences">
          <li>🗑️ Permanently delete all your account data</li>
          <li>💎 Delete all your inventory and items</li>
          <li>💰 Cancel any pending transactions</li>
          <li>📊 Remove all game statistics and achievements</li>
          <li>🛡️ Remove all security settings and 2FA</li>
          <li>✋ Be non-recoverable - contact support for recovery requests</li>
        </ul>
        
        <p class="modal-text">
          To confirm, click the button below:
        </p>
        
        <div class="modal-actions">
          <button class="btn-cancel">Nevermind, Keep My Account</button>
          <button class="btn-delete-final" id="final-delete-btn">Permanently Delete Everything</button>
        </div>
      </div>
    </div>
  `;
  
  const container = document.createElement('div');
  container.innerHTML = modalHTML;
  container.className = 'modal-overlay';
  document.body.appendChild(container);
  
  const finalDeleteBtn = container.querySelector('#final-delete-btn') as HTMLButtonElement;
  const cancelBtn = container.querySelector('.btn-cancel') as HTMLButtonElement;
  
  const closeModal = () => container.remove();
  
  cancelBtn.addEventListener('click', closeModal);
  
  finalDeleteBtn.addEventListener('click', async () => {
    container.remove();
    await performAccountDeletion(email, password, tfaCode);
  });
  
  container.addEventListener('click', (e) => {
    if (e.target === container) closeModal();
  });
}

/**
 * Executa a deleção real da conta
 */
async function performAccountDeletion(
  email: string,
  password: string,
  tfaCode?: string
): Promise<void> {
  try {
    const user = getActiveUser({ sync: true, allowStored: true });
    if (!user?.id) return;
    
    // Chamar endpoint de deleção de conta
    const response = await fetch('/api/_profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'deleteAccount',
        email,
        password,
        tfaCode,
        userId: user.id
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete account');
    }
    
    showAlert('success', '👋 Account Deleted', 
      'Your account and all associated data have been permanently deleted. We hope to see you again!');
    
    // Logout e redirecionar
    setTimeout(async () => {
      await supabase.auth.signOut();
      window.location.href = '/';
    }, 2000);
  } catch (err) {
    ErrorHandler.handleError('Error deleting account', {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.CRITICAL,
      details: err,
      userMessage: 'Failed to delete account. Please try again or contact support.',
      showToUser: true
    });
  }
}

// ============================================================
// COOKIE CONSENT BANNER
// ============================================================

export interface CookieConsent {
  analytics: boolean;
  marketing: boolean;
  functional: boolean;
  necessary: boolean; // Sempre true
}

/**
 * Mostra banner de cookies se o usuário não consentiu ainda
 */
export function showCookieConsentBanner(): void {
  // Verificar se já consentiu
  const existingConsent = localStorage.getItem('cookie-consent');
  if (existingConsent) return;
  
  const bannerHTML = `
    <div class="cookie-consent-banner">
      <div class="cookie-content">
        <h3>🍪 Cookie Settings</h3>
        <p>We use cookies to improve your experience. Some are necessary for the site to function, others help us understand how you use the site.</p>
        
        <div class="cookie-options">
          <label>
            <input type="checkbox" name="necessary" checked disabled />
            <strong>Necessary Cookies</strong> - Required for the site to function
          </label>
          
          <label>
            <input type="checkbox" name="functional" checked />
            <strong>Functional Cookies</strong> - Remember your preferences
          </label>
          
          <label>
            <input type="checkbox" name="analytics" />
            <strong>Analytics Cookies</strong> - Help us improve the site
          </label>
          
          <label>
            <input type="checkbox" name="marketing" />
            <strong>Marketing Cookies</strong> - Show you relevant content
          </label>
        </div>
        
        <div class="cookie-actions">
          <button class="btn-minimal" id="cookie-accept-all">Accept All</button>
          <button class="btn-minimal" id="cookie-accept-necessary">Only Necessary</button>
          <button class="btn-minimal" id="cookie-customize">Customize</button>
        </div>
        
        <a href="/privacy-policy" class="cookie-link" target="_blank">Privacy Policy</a>
      </div>
    </div>
  `;
  
  const container = document.createElement('div');
  container.innerHTML = bannerHTML;
  container.className = 'cookie-banner-container';
  document.body.appendChild(container);
  
  // Event listeners
  const acceptAllBtn = container.querySelector('#cookie-accept-all') as HTMLButtonElement;
  const acceptNecessaryBtn = container.querySelector('#cookie-accept-necessary') as HTMLButtonElement;
  const customizeBtn = container.querySelector('#cookie-customize') as HTMLButtonElement;
  
  const saveCookieConsent = (consent: CookieConsent) => {
    localStorage.setItem('cookie-consent', JSON.stringify(consent));
    container.remove();
    showToast('success', '🍪 Preferences Saved', 'Your cookie preferences have been saved');
  };
  
  acceptAllBtn.addEventListener('click', () => {
    saveCookieConsent({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true
    });
  });
  
  acceptNecessaryBtn.addEventListener('click', () => {
    saveCookieConsent({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false
    });
  });
  
  customizeBtn.addEventListener('click', () => {
    const functional = (container.querySelector('input[name="functional"]') as HTMLInputElement)?.checked;
    const analytics = (container.querySelector('input[name="analytics"]') as HTMLInputElement)?.checked;
    const marketing = (container.querySelector('input[name="marketing"]') as HTMLInputElement)?.checked;
    
    saveCookieConsent({
      necessary: true,
      functional: functional || false,
      analytics: analytics || false,
      marketing: marketing || false
    });
  });
}

/**
 * Retorna consentimento de cookies armazenado
 */
export function getCookieConsent(): CookieConsent | null {
  try {
    const consent = localStorage.getItem('cookie-consent');
    return consent ? JSON.parse(consent) : null;
  } catch {
    return null;
  }
}

/**
 * Reseta consentimento de cookies
 */
export function resetCookieConsent(): void {
  localStorage.removeItem('cookie-consent');
  showToast('success', '🍪 Reset', 'Cookie preferences have been reset');
}
