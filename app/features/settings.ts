// ============================================================
// SETTINGS.JS - Sistema de Configurações
// ============================================================

import { supabase } from './auth';
import { addCsrfHeader } from '../core/session';
import { getActiveUser } from '../core/session';
import { playSound, setMasterVolume, setSoundEnabled, setSoundPreference, setAllSoundPreferences } from '../shared/sfx';
import { showToast, showAlert } from '../shared/effects';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../shared/error-handler';
import { validateUsername, validatePasswordStrength } from '../shared/validation';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

interface CheckboxBinding {
  id: string;
  storageKey: string;
  defaultChecked: boolean;
}

declare global {
  interface Window {
    currentUser?: any;
  }
}

// ============================================================
// SETTINGS DATA LOADING
// ============================================================

/**
 * Formata email para exibir mascarado (a******r@gmail.com)
 */
function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${'*'.repeat(Math.max(3, local.length - 2))}${local[local.length - 1]}@${domain}`;
}

/**
 * Verifica se 2FA está habilitado para o usuário
 */
async function check2FAStatus(): Promise<boolean> {
  try {
    const user = getActiveUser({ sync: true, allowStored: true });
    if (!user?.id) return false;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return false;

    const response = await fetch('/api/_profile', {
      method: 'POST',
      headers: await addCsrfHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'get2FAStatus',
        userId: user.id,
        authToken: session.access_token
      })
    });

    if (!response.ok) return false;
    const result = await response.json().catch(() => ({}));
    return result?.enabled === true;
  } catch (err) {
    ErrorHandler.handleDatabaseError('Error checking 2FA status', err);
    return false;
  }
}

/**
 * Atualiza UI de 2FA
 */
async function updateTwoFactorUI(): Promise<void> {
  try {
    const is2FAEnabled = await check2FAStatus();
    const twoFactorToggle = document.getElementById('twofa-toggle') as HTMLInputElement | null;
    const recoveryCodesBtn = document.getElementById('view-recovery-codes-btn') as HTMLButtonElement | null;
    
    if (twoFactorToggle) {
      twoFactorToggle.checked = is2FAEnabled;
    }
    
    if (recoveryCodesBtn) {
      recoveryCodesBtn.style.display = is2FAEnabled ? 'inline-flex' : 'none';
    }
  } catch (err) {
    ErrorHandler.handleError('Error updating 2FA UI', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      details: err,
      showToUser: false
    });
  }
}

/**
 * Habilita/desabilita 2FA
 */
export async function toggle2FA(): Promise<void> {
  try {
    const is2FAEnabled = await check2FAStatus();
    
    if (is2FAEnabled) {
      // Desabilitar 2FA
      const code = prompt('🔏 Enter your 2FA code to disable 2FA:');
      if (!code) return;
      
      const user = getActiveUser({ sync: true, allowStored: true });
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!user?.id || !session?.access_token) {
        showAlert('error', 'Not authenticated', 'Please log in again.');
        return;
      }
      
      const response = await fetch('/api/_profile', {
        method: 'POST',
        headers: await addCsrfHeader({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'disable2FA',
          userId: user.id,
          authToken: session.access_token,
          code
        })
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        showAlert('error', '❌ Failed', result.error || 'Could not disable 2FA');
        return;
      }
      
      showToast('success', '✅ 2FA Disabled', '2FA has been disabled on your account.');
      await updateTwoFactorUI();
    } else {
      // Habilitar 2FA
      showAlert('info', '🔐 Setup 2FA', 'We will generate your 2FA secret. Then enter the 6-digit code from your authenticator.');
      
      // Abrir modal/página de setup (pode ser um modal novo ou redirecionar)
      // Por enquanto, vamos usar um prompt simplificado
      const user = getActiveUser({ sync: true, allowStored: true });
      if (!user?.id) {
        showAlert('error', 'Not authenticated', 'Please log in again.');
        return;
      }
      
      // Chamar a função de setup do auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        showAlert('error', 'Not authenticated', 'Please log in again.');
        return;
      }

      if ((window as any).requestSetup2FA) {
        await openTwoFactorSetupModal(user.id, session.access_token);
      }
    }
  } catch (err) {
    ErrorHandler.handleError('Error toggling 2FA', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: err,
      showToUser: false
    });
    showAlert('error', '❌ Error', 'Failed to toggle 2FA');
  }
}

/**
 * Beautiful in-app modal to guide through 2FA setup
 */
async function openTwoFactorSetupModal(userId: string, authToken: string): Promise<void> {
  // Fetch setup data (secret + otpauth URL)
  const setup = await (window as any).requestSetup2FA?.(userId, authToken);
  if (!setup || !setup.secret || !setup.qrCode) {
    showAlert('error', '❌ Setup failed', 'Could not generate your 2FA secret.');
    return;
  }

  // Build modal DOM
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  const box = document.createElement('div');
  box.className = 'modal-box';
  overlay.appendChild(box);

  const top = document.createElement('div');
  top.className = 'modal-top';
  const title = document.createElement('h3');
  title.textContent = '🔐 Enable Two-Factor Authentication';
  const closeBtn = document.createElement('button');
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => document.body.removeChild(overlay);
  top.appendChild(title);
  top.appendChild(closeBtn);
  box.appendChild(top);

  // QR code (top)
  const qrWrap = document.createElement('div');
  qrWrap.style.padding = '16px';
  qrWrap.style.display = 'flex';
  qrWrap.style.justifyContent = 'center';
  const qrImg = document.createElement('img');
  qrImg.alt = 'Scan this QR with your authenticator';
  qrImg.width = 220;
  qrImg.height = 220;
  qrImg.style.borderRadius = '12px';
  qrImg.style.border = '1px solid var(--card-border)';
  qrImg.style.background = '#fff';
  qrWrap.appendChild(qrImg);
  box.appendChild(qrWrap);

  // Render QR using external service (fast, no backend changes needed)
  const externalQrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(setup.qrCode);
  qrImg.src = externalQrUrl;

  // Secret display (manual entry)
  const secretLabel = document.createElement('label');
  secretLabel.textContent = 'Manual secret (if you cannot scan QR):';
  const secretBox = document.createElement('div');
  secretBox.style.padding = '0 16px 8px';
  const secretEl = document.createElement('div');
  secretEl.style.background = 'rgba(255,255,255,0.05)';
  secretEl.style.border = '1px solid var(--card-border)';
  secretEl.style.borderRadius = '12px';
  secretEl.style.padding = '12px';
  secretEl.style.wordBreak = 'break-all';
  secretEl.textContent = setup.secret;
  secretBox.appendChild(secretEl);
  box.appendChild(secretLabel);
  box.appendChild(secretBox);

  // Code input
  const codeLabel = document.createElement('label');
  codeLabel.textContent = 'Enter 6-digit code:';
  const inputWrap = document.createElement('div');
  inputWrap.style.padding = '0 16px 8px';
  const codeInput = document.createElement('input');
  codeInput.type = 'text';
  codeInput.inputMode = 'numeric';
  codeInput.placeholder = '123456';
  codeInput.maxLength = 7; // allow space input but sanitize
  codeInput.style.width = '100%';
  codeInput.style.padding = '12px';
  codeInput.style.borderRadius = '12px';
  codeInput.style.border = '1px solid var(--card-border)';
  codeInput.oninput = () => {
    // Strip spaces and non-digits live
    codeInput.value = codeInput.value.replace(/\s+/g, '').replace(/[^0-9]/g, '').slice(0, 6);
  };
  inputWrap.appendChild(codeInput);
  box.appendChild(codeLabel);
  box.appendChild(inputWrap);

  // Feedback area
  const feedback = document.createElement('div');
  feedback.style.padding = '0 16px 8px';
  feedback.style.color = 'var(--accent)';
  box.appendChild(feedback);

  // Verify button
  const verifyBtn = document.createElement('button');
  verifyBtn.className = 'modal-create-btn';
  verifyBtn.textContent = 'Verify & Enable 2FA';
  box.appendChild(verifyBtn);

  let attempts = 0;
  verifyBtn.onclick = async () => {
    const code = (codeInput.value || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      feedback.style.color = 'var(--error)';
      feedback.textContent = 'Please enter a valid 6-digit code.';
      return;
    }
    feedback.style.color = 'var(--accent)';
    feedback.textContent = 'Verifying…';
    attempts++;
    const ok = await (window as any).verifyAndEnable2FA?.(userId, authToken, setup.secret, code);
    if (ok) {
      feedback.style.color = 'var(--success)';
      feedback.textContent = '2FA enabled successfully!';
      await updateTwoFactorUI();
      setTimeout(() => closeBtn.click(), 750);
    } else {
      feedback.style.color = 'var(--error)';
      feedback.textContent = `Invalid code. Attempts: ${attempts}. You can try again.`;
    }
  };

  document.body.appendChild(overlay);
}

/**
 * Visualizar Recovery Codes (só com 2FA ativado)
 */
export async function viewRecoveryCodes(): Promise<void> {
  try {
    const code = prompt('🔏 Enter your 2FA code to view recovery codes:');
    if (!code) return;
    
    const user = getActiveUser({ sync: true, allowStored: true });
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!user?.id || !session?.access_token) {
      showAlert('error', 'Not authenticated', 'Please log in again.');
      return;
    }
    
    const response = await fetch('/api/_profile', {
      method: 'POST',
      headers: await addCsrfHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'viewRecoveryCodes',
        userId: user.id,
        authToken: session.access_token,
        code
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      showAlert('error', '❌ Invalid Code', result.error || 'Could not retrieve recovery codes');
      return;
    }
    
    // Show recovery codes in a persistent modal
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    const box = document.createElement('div');
    box.className = 'modal-box';
    overlay.appendChild(box);

    const top = document.createElement('div');
    top.className = 'modal-top';
    const title = document.createElement('h3');
    title.textContent = '🗐️ Recovery Codes - KEEP THESE SAFE';
    const closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => document.body.removeChild(overlay);
    top.appendChild(title);
    top.appendChild(closeBtn);
    box.appendChild(top);

    const codesContainer = document.createElement('div');
    codesContainer.style.padding = '16px';
    codesContainer.style.maxHeight = '400px';
    codesContainer.style.overflowY = 'auto';
    
    const warningText = document.createElement('p');
    warningText.style.color = 'var(--error)';
    warningText.style.marginBottom = '12px';
    warningText.style.fontWeight = 'bold';
    warningText.textContent = '⚠️ Each code can only be used ONCE. Store these in a secure location!';
    codesContainer.appendChild(warningText);

    const codesList = document.createElement('div');
    codesList.style.background = 'rgba(255,255,255,0.05)';
    codesList.style.border = '1px solid var(--card-border)';
    codesList.style.borderRadius = '12px';
    codesList.style.padding = '12px';
    codesList.style.fontFamily = 'monospace';
    codesList.style.fontSize = '14px';
    
    const codes = result.recoveryCodes || [];
    codes.forEach((code: string, i: number) => {
      const codeLine = document.createElement('div');
      codeLine.style.marginBottom = '8px';
      codeLine.textContent = `${i + 1}. ${code}`;
      codesList.appendChild(codeLine);
    });
    
    codesContainer.appendChild(codesList);
    box.appendChild(codesContainer);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'modal-create-btn';
    copyBtn.textContent = '📋 Copy All Codes';
    copyBtn.onclick = () => {
      const allCodes = codes.join('\n');
      navigator.clipboard.writeText(allCodes).then(() => {
        showToast('success', '✅ Copied', 'All recovery codes copied to clipboard');
      });
    };
    box.appendChild(copyBtn);

    document.body.appendChild(overlay);
  } catch (err) {
    ErrorHandler.handleError('Error viewing recovery codes', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: err,
      showToUser: false
    });
    showAlert('error', '❌ Error', 'Failed to retrieve recovery codes');
  }
}

/**
 * Visualizar email completo (só com 2FA ativado)
 */
export async function viewFullEmail(): Promise<void> {
  try {
    const emailInput = document.getElementById('settings-email') as HTMLInputElement | null;
    if (!emailInput) return;

    const user = getActiveUser({ sync: true, allowStored: true });
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!user?.id || !session?.access_token) {
      showAlert('error', 'Not authenticated', 'Please log in again.');
      return;
    }

    // Check if 2FA is enabled
    const is2FAEnabled = await check2FAStatus();
    
    if (is2FAEnabled) {
      // 2FA Enabled: Request 2FA code
      const code = prompt('🔏 Enter your 2FA code to reveal your email:');
      if (!code) return;

      const response = await fetch('/api/_profile', {
        method: 'POST',
        headers: await addCsrfHeader({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'viewFullEmail',
          userId: user.id,
          authToken: session.access_token,
          code
        })
      });

      const result = await response.json();

      if (!response.ok) {
        showAlert('error', '❌ Invalid Code', result.error || 'Could not retrieve email');
        return;
      }

      // Reveal email in input
      if (result.email) {
        emailInput.value = result.email;
        showToast('success', 'Email Revealed', 'Your email is now visible. It will be hidden on page refresh.');
      }
    } else {
      // 2FA Disabled: Request password
      const password = prompt('🔒 Enter your password to reveal your email:');
      if (!password) return;

      const response = await fetch('/api/_profile', {
        method: 'POST',
        headers: await addCsrfHeader({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'viewFullEmail',
          userId: user.id,
          authToken: session.access_token,
          password
        })
      });

      const result = await response.json();

      if (!response.ok) {
        showAlert('error', '❌ Invalid Password', result.error || 'Could not retrieve email');
        return;
      }

      // Reveal email in input
      if (result.email) {
        emailInput.value = result.email;
        showToast('success', 'Email Revealed', 'Your email is now visible. It will be hidden on page refresh.');
      }
    }
  } catch (err) {
    ErrorHandler.handleError('Error viewing email', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: err,
      showToUser: false
    });
    showAlert('error', '❌ Error', 'Failed to retrieve email');
  }
}


export async function loadSettingsData(): Promise<void> {
  try {
    const user = getActiveUser({ sync: true, allowStored: true }) || window.currentUser;
    if (!user?.id) return;
    
    const { data: stats, error } = await supabase
      .from('player_stats')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    if (error || !stats) {
      ErrorHandler.handleDatabaseError('Error loading settings', error);
      return;
    }
    
    // Preencher dados - Email mascarado
    const emailInput = document.getElementById('settings-email') as HTMLInputElement | null;
    const usernameInput = document.getElementById('settings-username') as HTMLInputElement | null;
    
    if (emailInput) {
      emailInput.value = maskEmail(user.email || '');
      emailInput.title = 'Email is hidden for security. Enable 2FA to view full email.';
    }
    if (usernameInput) usernameInput.value = stats.username || '';
    usernameChangeCount = Number(stats.username_change_count) || 0;
    updateUsernameUI();
    
    // Sync public profile from DB to localStorage
    if (stats.public != null) {
      localStorage.setItem('publicProfile', String(stats.public));
    }
    
    // Garantir que listeners sejam ligados uma única vez e refletir preferências no UI
    bindSettingsUIOnce();
    applySavedPreferencesToUI();
    
    // Atualizar UI de 2FA
    await updateTwoFactorUI();
    
  } catch (err) {
    ErrorHandler.handleError('Error loading settings', {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.ERROR,
      details: err,
      showToUser: false
    });
  }
}

/**
 * Carrega preferências salvas do localStorage
 */
const checkboxBindings: CheckboxBinding[] = [
  { id: 'sound-effects', storageKey: 'soundEffects', defaultChecked: true },
  { id: 'background-music', storageKey: 'backgroundMusic', defaultChecked: false },
  { id: 'public-profile', storageKey: 'publicProfile', defaultChecked: true },
  { id: 'show-stats', storageKey: 'showStats', defaultChecked: true },
  { id: 'event-notifications', storageKey: 'eventNotifications', defaultChecked: true },
  { id: 'daily-notifications', storageKey: 'dailyNotifications', defaultChecked: true }
];

let settingsUIBound: boolean = false;
let usernameChangeCount: number = 0;

function applySavedPreferencesToUI(): void {
  for (const { id, storageKey, defaultChecked } of checkboxBindings) {
    const checkbox = document.getElementById(id) as HTMLInputElement | null;
    if (!checkbox) continue;

    const saved = localStorage.getItem(storageKey);
    const checked = saved == null ? defaultChecked : saved === 'true';
    checkbox.checked = checked;

    if (storageKey === 'soundEffects') {
      setSoundEnabled(checked);
    }
  }

  const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement | null;
  if (volumeSlider) {
    const savedVolume = localStorage.getItem('volume') || '50';
    volumeSlider.value = savedVolume;
    setMasterVolume(Number(savedVolume));
  }

  const languageSelect = document.getElementById('language-select') as HTMLSelectElement | null;
  if (languageSelect) {
    const savedLanguage = localStorage.getItem('language') || 'en';
    languageSelect.value = savedLanguage;
  }

  syncSoundModalCheckboxes();
  updateSoundChannelEnabledState();
}

function bindSettingsUIOnce(): void {
  if (settingsUIBound) return;
  settingsUIBound = true;

  for (const { id, storageKey } of checkboxBindings) {
    const checkbox = document.getElementById(id) as HTMLInputElement | null;
    if (!checkbox) continue;
    if (checkbox.dataset.bound === '1') continue;
    checkbox.dataset.bound = '1';

    checkbox.addEventListener('change', async function(this: HTMLInputElement) {
      // For publicProfile, handle specially with rigorous validation
      if (storageKey === 'publicProfile') {
        const wasChecked = this.checked;
        const previousState = localStorage.getItem(storageKey) === 'true';
        
        try {
          const user = getActiveUser({ sync: true, allowStored: true }) || (window as any).currentUser;
          const session = await supabase.auth.getSession();
          
          if (!user?.id) {
            ErrorHandler.handleError('No user found for public profile update', {
              category: ErrorCategory.AUTH,
              severity: ErrorSeverity.WARNING,
              showToUser: false
            });
            this.checked = previousState;
            showToast('error', 'Error: User not found');
            return;
          }

          if (!session?.data?.session?.access_token) {
            ErrorHandler.handleError('No valid session for public profile update', {
              category: ErrorCategory.AUTH,
              severity: ErrorSeverity.WARNING,
              showToUser: false
            });
            this.checked = previousState;
            showToast('error', 'Error: Session expired. Please refresh.');
            return;
          }

          // Show loading state
          const originalText = this.nextElementSibling?.textContent || '';
          if (this.nextElementSibling) {
            (this.nextElementSibling as HTMLElement).textContent = 'Saving...';
          }

          const response = await fetch('/api/_profile', {
            method: 'POST',
            headers: await addCsrfHeader({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              action: 'updatePublicProfile',
              userId: user.id,
              authToken: session.data.session.access_token,
              publicProfile: wasChecked
            })
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            ErrorHandler.handleError('Failed to update public profile setting', {
              category: ErrorCategory.DATABASE,
              severity: ErrorSeverity.ERROR,
              details: { status: response.status, errorData },
              showToUser: false
            });
            
            // Revert all changes
            this.checked = previousState;
            localStorage.setItem(storageKey, String(previousState));
            
            if (this.nextElementSibling) {
              this.nextElementSibling.textContent = originalText;
            }
            
            const errorMsg = wasChecked 
              ? 'Failed to make profile public'
              : 'Failed to make profile private';
            showToast('error', errorMsg);
            return;
          }

          const data = await response.json();
          if (!data.success) {
            // Revert all changes
            this.checked = previousState;
            localStorage.setItem(storageKey, String(previousState));
            
            if (this.nextElementSibling) {
              (this.nextElementSibling as HTMLElement).textContent = originalText || '';
            }
            
            showToast('error', 'Failed to update profile privacy setting');
            return;
          }

          // Success! Update localStorage
          localStorage.setItem(storageKey, String(wasChecked));
          
          if (this.nextElementSibling) {
            (this.nextElementSibling as HTMLElement).textContent = originalText || '';
          }

          // Show success message
          const successMsg = wasChecked 
            ? '✓ Your profile is now public' 
            : '✓ Your profile is now private';
          showToast('success', successMsg);

          // Play feedback sound
          playSound('switch', { volume: 0.3 });

        } catch (err) {
          ErrorHandler.handleError('Error updating public profile', {
            category: ErrorCategory.DATABASE,
            severity: ErrorSeverity.ERROR,
            details: err,
            showToUser: false
          });
          
          // Revert all changes
          this.checked = previousState;
          localStorage.setItem(storageKey, String(previousState));
          
          showToast('error', 'Error updating profile privacy setting');
        }
        return; // Exit early, don't do the general localStorage update below
      }

      // For other settings, do the regular update
      localStorage.setItem(storageKey, String(this.checked));

      if (storageKey === 'soundEffects') {
        setSoundEnabled(this.checked);
        updateSoundChannelEnabledState();
      }

      if (storageKey === 'soundEffects' || storageKey === 'backgroundMusic') {
        playSound('switch', { volume: 0.3 });
      }
    });
  }

  const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement | null;
  if (volumeSlider && volumeSlider.dataset.bound !== '1') {
    volumeSlider.dataset.bound = '1';
    volumeSlider.addEventListener('input', function(this: HTMLInputElement) {
      localStorage.setItem('volume', String(this.value));
      setMasterVolume(Number(this.value));
    });
  }

  const languageSelect = document.getElementById('language-select') as HTMLSelectElement | null;
  if (languageSelect && languageSelect.dataset.bound !== '1') {
    languageSelect.dataset.bound = '1';
    languageSelect.addEventListener('change', async function(this: HTMLSelectElement) {
      const newLang = this.value;
      localStorage.setItem('language', newLang);

      this.disabled = true;
      this.style.opacity = '0.5';

      // Notificar o app (app.js escuta isso pra sincronizar idioma)
      document.dispatchEvent(new Event('languageChanged'));

      if ((window as any).applyTranslations) {
        await (window as any).applyTranslations();
      }

      // Se o profile estiver aberto, recarregar com os argumentos esperados
      const profileScreen = document.getElementById('profile');
      if (profileScreen && profileScreen.classList.contains('active')) {
        if ((window as any).loadProfileData) {
          const user = getActiveUser({ sync: true, allowStored: true }) || (window as any).currentUser;
          await ((window as any).loadProfileData)(user, (window as any).calculateLevel, (window as any).applyTranslations);
        }
      }

      this.disabled = false;
      this.style.opacity = '1';

      alert('Language changed!');
    });
  }

  bindSoundModal();
}

function updateUsernameUI(): void {
  const input = document.getElementById('settings-username');
  const button = document.getElementById('edit-username-btn');
  const cancelBtn = document.getElementById('cancel-username-btn');
  const costBadge = document.getElementById('username-cost-badge');
  const helper = document.getElementById('username-helper');

  const cost = usernameChangeCount === 0 ? 0 : 100;

  if (costBadge) {
    costBadge.textContent = cost === 0 ? 'First change is free' : `Next change costs ${cost} 💎`;
    costBadge.classList.toggle('free', cost === 0);
    costBadge.classList.toggle('paid', cost > 0);
  }

  if (helper) {
    helper.textContent = '3-16 chars • letters and numbers only';
  }

  if (button) {
    const inputEl = input as HTMLInputElement | null;
    if (inputEl?.disabled) {
      button.textContent = ((window as any).t ? ((window as any).t('edit')) : 'Edit');
      button.style.background = 'var(--button-primary)';
      if (cancelBtn) cancelBtn.style.display = 'none';
    } else {
      button.textContent = cost === 0
        ? (((window as any).t ? ((window as any).t('save')) : 'Save (Free)'))
        : `Save · ${cost} 💎`;
      button.style.background = cost === 0 ? '#22c55e' : '#f59e0b';
      if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    }
  }
}

// ============================================================
// SOUND MODAL (per-sound toggles)
// ============================================================

const SOUND_TOGGLE_IDS = [
  { id: 'sound-toggle-click', key: 'click' },
  { id: 'sound-toggle-hover', key: 'hover' },
  { id: 'sound-toggle-open', key: 'open_case' },
  { id: 'sound-toggle-reel', key: 'reel_spin' },
  { id: 'sound-toggle-payout', key: 'payout' },
  { id: 'sound-toggle-switch', key: 'switch' },
  { id: 'sound-toggle-notify', key: 'notify' },
  { id: 'sound-toggle-error', key: 'error' },
  { id: 'sound-toggle-win', key: 'win' }
];

function syncSoundModalCheckboxes(): void {
  for (const { id, key } of SOUND_TOGGLE_IDS) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) continue;
    const prefs = localStorage.getItem('soundPrefs');
    let enabled = true;
    if (prefs) {
      try {
        const parsed = JSON.parse(prefs);
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
          enabled = !!parsed[key];
        }
      } catch {
        enabled = true;
      }
    }
    el.checked = enabled;
  }
}

function updateSoundChannelEnabledState(): void {
  const master = document.getElementById('sound-effects') as HTMLInputElement | null;
  const masterOn = master ? master.checked : true;
  for (const { id } of SOUND_TOGGLE_IDS) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) continue;
    el.disabled = !masterOn;
  }
}

function bindSoundModal(): void {
  const openBtn = document.getElementById('sound-config-btn');
  const modal = document.getElementById('sound-config-modal');
  const closeBtn = document.getElementById('sound-config-close');
  const allowAllBtn = document.getElementById('sound-allow-all');
  const muteAllBtn = document.getElementById('sound-mute-all');

  if (openBtn && !openBtn.dataset.bound) {
    openBtn.dataset.bound = '1';
    openBtn.addEventListener('click', () => {
      modal?.classList.add('active');
      updateSoundChannelEnabledState();
    });
  }

  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', () => modal?.classList.remove('active'));
  }

  if (modal && !modal.dataset.bound) {
    modal.dataset.bound = '1';
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  for (const { id, key } of SOUND_TOGGLE_IDS) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el || el.dataset.bound === '1') continue;
    el.dataset.bound = '1';
    el.addEventListener('change', function(this: HTMLInputElement) {
      setSoundPreference(key as any, this.checked);
      playSound('switch', { volume: 0.3 });
    });
  }

  const masterSound = document.getElementById('sound-effects') as HTMLInputElement | null;
  if (masterSound && masterSound.dataset.bound !== '1') {
    masterSound.dataset.bound = '1';
    masterSound.addEventListener('change', function(this: HTMLInputElement) {
      localStorage.setItem('soundEffects', String(this.checked));
      setSoundEnabled(this.checked);
      updateSoundChannelEnabledState();
      playSound('switch', { volume: 0.3 });
    });
  }

  const masterMusic = document.getElementById('background-music') as HTMLInputElement | null;
  if (masterMusic && masterMusic.dataset.bound !== '1') {
    masterMusic.dataset.bound = '1';
    masterMusic.addEventListener('change', function(this: HTMLInputElement) {
      localStorage.setItem('backgroundMusic', String(this.checked));
      playSound('switch', { volume: 0.3 });
    });
  }

  if (allowAllBtn && !allowAllBtn.dataset.bound) {
    allowAllBtn.dataset.bound = '1';
    allowAllBtn.addEventListener('click', () => {
      setAllSoundPreferences(true);
      syncSoundModalCheckboxes();
      playSound('switch', { volume: 0.35 });
    });
  }

  if (muteAllBtn && !muteAllBtn.dataset.bound) {
    muteAllBtn.dataset.bound = '1';
    muteAllBtn.addEventListener('click', () => {
      setAllSoundPreferences(false);
      syncSoundModalCheckboxes();
      playSound('switch', { volume: 0.35 });
    });
  }
}

// ============================================================
// USERNAME MANAGEMENT
// ============================================================

/**
 * Habilita/salva edição do username
 */
export async function enableUsernameEdit(): Promise<void> {
  const input = document.getElementById('settings-username') as HTMLInputElement | null;
  const button = document.getElementById('edit-username-btn') as HTMLButtonElement | null;
  const cancelBtn = document.getElementById('cancel-username-btn') as HTMLButtonElement | null;
  
  if (!input || !button) return;
  
  if (input.disabled) {
    // Habilitar edição
    input.disabled = false;
    input.dataset.originalUsername = input.value;
    input.focus();
    input.select();
    updateUsernameUI();
  } else {
    // Salvar
    const newUsername = input.value.trim();
    
    // Validar usando sistema robusto
    const usernameValidation = validateUsername(newUsername);
    if (!usernameValidation.valid) {
      showAlert('error', 'Invalid username', usernameValidation.error || 'Username validation failed.');
      return;
    }

    try {
      const user = getActiveUser({ sync: true, allowStored: true }) || (window as any).currentUser;
      if (!user?.id) {
        showAlert('error', 'Not logged in', 'Sign in to change your username.');
        return;
      }

      const { data: { session } = {} } = await supabase.auth.getSession();
      if (!session?.access_token) {
        showAlert('error', 'Auth error', 'Could not validate your session. Please re-login.');
        return;
      }

      if (button) button.disabled = true;

      const response = await fetch('/api/_profile', {
        method: 'POST',
        headers: await addCsrfHeader({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'changeUsername',
          userId: user.id,
          authToken: session.access_token,
          newUsername
        })
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.error === 'USERNAME_TAKEN') {
          showAlert('error', 'Username taken', 'Choose another username.');
        } else if (result.error === 'INVALID_USERNAME') {
          showAlert('error', 'Invalid username', 'Use 3-16 chars: letters, numbers, dot, underscore or hyphen.');
        } else if (result.error === 'INSUFFICIENT_DIAMONDS') {
          const missing = typeof result.needed === 'number' ? result.needed : 100;
          showAlert('error', 'Insufficient diamonds', `You need ${missing} more diamonds to rename.`);
        } else if (result.error === 'SAME_USERNAME') {
          showAlert('info', 'Same username', 'You already have this username.');
        } else {
          showAlert('error', 'Rename failed', result.error || 'Could not change username now.');
        }
        if (button) button.disabled = false;
        updateUsernameUI();
        return;
      }

      usernameChangeCount = typeof result.changeCount === 'number' ? result.changeCount : usernameChangeCount + 1;

      // Update displays and cached values
      const usernameDisplay = document.getElementById('username-display');
      const profileUsername = document.getElementById('profile-username');
      if (usernameDisplay) usernameDisplay.textContent = result.username || newUsername;
      if (profileUsername) profileUsername.textContent = result.username || newUsername;
      input.value = result.username || newUsername;

      if ((window as any).playerDiamonds && typeof result.diamonds === 'number') {
        (window as any).playerDiamonds.value = result.diamonds;
        (window as any).cachedDiamonds = result.diamonds;
      }

      showToast('success', 'Username updated ✨', usernameChangeCount === 1 ? 'First change was free.' : '100 💎 deducted.');

      input.disabled = true;
      if (button) button.disabled = false;
      if (cancelBtn) {
        cancelBtn.style.display = 'none';
        delete input.dataset.originalUsername;
      }
      updateUsernameUI();

    } catch (err) {
      ErrorHandler.handleError('Username change error', {
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.ERROR,
        details: err,
        showToUser: false
      });
      showAlert('error', 'Connection error', 'Could not reach the server. Please try again.');
      if (button) button.disabled = false;
      updateUsernameUI();
    }
  }
}

export function cancelUsernameEdit(): void {
  const input = document.getElementById('settings-username') as HTMLInputElement | null;
  const button = document.getElementById('edit-username-btn') as HTMLButtonElement | null;
  const cancelBtn = document.getElementById('cancel-username-btn') as HTMLButtonElement | null;

  if (!input || !button) return;

  if (!input.disabled) {
    if (input.dataset.originalUsername) {
      input.value = input.dataset.originalUsername;
      delete input.dataset.originalUsername;
    }
    input.disabled = true;
  }

  if (button && button.disabled) button.disabled = false;
  if (cancelBtn) cancelBtn.style.display = 'none';
  updateUsernameUI();
}

// ============================================================
// PASSWORD MANAGEMENT
// ============================================================

/**
 * Muda a senha do usuário (com verificação 2FA se ativado)
 */
export async function changePassword(): Promise<void> {
  try {
    const is2FAEnabled = await check2FAStatus();

    const validatePassword = (password: string, currentPassword?: string): { isValid: boolean; error?: string } => {
      if (!password || password.length < 8) {
        return { isValid: false, error: 'Password must be at least 8 characters' };
      }
      if (currentPassword && password === currentPassword) {
        return { isValid: false, error: 'New password must be different from current password' };
      }
      const strength = validatePasswordStrength(password);
      if (strength.score < 3 || !strength.hasUppercase || !strength.hasLowercase || !strength.hasNumber) {
        return { isValid: false, error: 'Use uppercase, lowercase, numbers and minimum 8 characters' };
      }
      return { isValid: true };
    };
    
    // Create modal HTML
    const modalHTML = `
      <div class="password-change-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h2>🔐 Change Password</h2>
            <button class="modal-close" data-action="close">&times;</button>
          </div>
          
          <form id="changePasswordForm">
            <div class="form-group">
              <label for="currentPassword">Current Password</label>
              <input type="password" id="currentPassword" placeholder="Enter current password" required />
              <small>Required for security verification</small>
            </div>
            
            <div class="form-group">
              <label for="newPassword">New Password</label>
              <input type="password" id="newPassword" placeholder="Enter new password (minimum 6 characters)" required />
              <small>Must contain uppercase, lowercase, numbers, and special characters</small>
            </div>
            
            <div class="form-group">
              <label for="confirmPassword">Confirm Password</label>
              <input type="password" id="confirmPassword" placeholder="Confirm new password" required />
              <small>Passwords must match</small>
            </div>
            
            ${is2FAEnabled ? `
            <div class="form-group">
              <label for="twoFactorCode">2FA Code (6 digits)</label>
              <input type="text" id="twoFactorCode" placeholder="000000" maxlength="6" pattern="[0-9]{6}" required />
              <small>Enter your authenticator code</small>
            </div>
            ` : ''}
            
            <div id="changePasswordError" class="error-message" style="display: none;"></div>
            
            <div class="modal-actions">
              <button type="button" class="btn-cancel" data-action="close">Cancel</button>
              <button type="submit" class="btn-save">Change Password</button>
            </div>
          </form>
        </div>
      </div>
    `;
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = modalHTML;
    document.body.appendChild(overlay);
    
    const modal = overlay.querySelector('.password-change-modal') as HTMLElement;
    const form = overlay.querySelector('#changePasswordForm') as HTMLFormElement;
    const errorDiv = overlay.querySelector('#changePasswordError') as HTMLElement;
    const closeButtons = overlay.querySelectorAll('[data-action="close"]');
    
    // Close handlers
    const closeModal = () => {
      overlay.remove();
    };
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    
    closeButtons.forEach(btn => {
      btn.addEventListener('click', closeModal);
    });
    
    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      try {
        const currentPassword = (form.querySelector('#currentPassword') as HTMLInputElement).value;
        const newPassword = (form.querySelector('#newPassword') as HTMLInputElement).value;
        const confirmPassword = (form.querySelector('#confirmPassword') as HTMLInputElement).value;
        const twoFactorCode = (form.querySelector('#twoFactorCode') as HTMLInputElement)?.value || '';
        
        // Validate passwords match
        if (newPassword !== confirmPassword) {
          errorDiv.textContent = 'Passwords do not match';
          errorDiv.style.display = 'block';
          return;
        }
        
        // Validate password strength and difference from current
        const passwordValidation = validatePassword(newPassword, currentPassword);
        if (!passwordValidation.isValid) {
          errorDiv.textContent = passwordValidation.error || 'Password does not meet requirements';
          errorDiv.style.display = 'block';
          return;
        }
        
        // Validate current password by attempting sign in
        const user = getActiveUser({ sync: true, allowStored: true });
        if (!user?.email) {
          errorDiv.textContent = 'Session error. Please log in again.';
          errorDiv.style.display = 'block';
          return;
        }
        
        // Verify current password
        // Get fresh user data to ensure we have correct email
        const freshUser = getActiveUser({ sync: true, allowStored: false });
        if (!freshUser?.email) {
          errorDiv.textContent = 'Session expired. Please log in again.';
          errorDiv.style.display = 'block';
          return;
        }
        
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: freshUser.email,
          password: currentPassword
        });
        
        if (signInError) {
          console.error('Password verification failed:', signInError.message);
          errorDiv.textContent = 'Current password is incorrect';
          errorDiv.style.display = 'block';
          return;
        }
        
        // Validate 2FA if enabled
        if (is2FAEnabled && twoFactorCode) {
          const sanitizedTwoFactorCode = twoFactorCode.replace(/\s+/g, '');
          const validateResponse = await fetch('/api/_profile', {
            method: 'POST',
            headers: await addCsrfHeader({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              action: 'validate2FA',
              userId: user.id,
              authToken: (await supabase.auth.getSession()).data.session?.access_token,
              code: sanitizedTwoFactorCode
            })
          });
          
          if (!validateResponse.ok) {
            errorDiv.textContent = 'Invalid 2FA code';
            errorDiv.style.display = 'block';
            return;
          }
        }
        
        // Update password
        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword
        });
        
        if (updateError) {
          errorDiv.textContent = 'Error updating password: ' + updateError.message;
          errorDiv.style.display = 'block';
          return;
        }
        
        // Success
        showToast('success', 'Password changed successfully!');
        closeModal();
        
      } catch (err: any) {
        errorDiv.textContent = err?.message || 'Error changing password';
        errorDiv.style.display = 'block';
      }
    });
    
  } catch (err) {
    ErrorHandler.handleError('Error opening password modal', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: err,
      showToUser: false
    });
    showAlert('error', '❌ Error', 'Could not open password change modal');
  }
}

// ============================================================
// PASSWORD MANAGEMENT - DUPLICATE (REMOVED)
// ============================================================

/**
 * Modal para trocar senha com validação de senha atual e 2FA
 */
export async function openChangePasswordModal(): Promise<void> {
  try {
    const is2FAEnabled = await check2FAStatus();

    const validatePassword = (password: string, currentPassword?: string): { isValid: boolean; error?: string } => {
      if (!password || password.length < 8) {
        return { isValid: false, error: 'Password must be at least 8 characters' };
      }
      if (currentPassword && password === currentPassword) {
        return { isValid: false, error: 'New password must be different from current password' };
      }
      const strength = validatePasswordStrength(password);
      if (strength.score < 3 || !strength.hasUppercase || !strength.hasLowercase || !strength.hasNumber) {
        return { isValid: false, error: 'Use uppercase, lowercase, numbers and minimum 8 characters' };
      }
      return { isValid: true };
    };
    
    const modalHTML = `
      <div class="password-change-modal">
        <div class="modal-header">
          <h2>🔐 Change Password</h2>
          <button class="close-modal-btn">&times;</button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label for="current-password">Current Password</label>
            <input type="password" id="current-password" placeholder="Enter your current password" />
          </div>
          
          <div class="form-group">
            <label for="new-password">New Password</label>
            <input type="password" id="new-password" placeholder="Enter new password (min 6 chars)" />
            <small>Use a strong password with letters, numbers and symbols</small>
          </div>
          
          <div class="form-group">
            <label for="confirm-password">Confirm Password</label>
            <input type="password" id="confirm-password" placeholder="Confirm your new password" />
          </div>
          
          ${is2FAEnabled ? `
            <div class="form-group">
              <label for="password-2fa-code">2FA Code</label>
              <input type="text" id="password-2fa-code" placeholder="Enter 6-digit code" maxlength="6" />
              <small>2FA is enabled, please verify with your authenticator</small>
            </div>
          ` : ''}
          
          <div id="password-error" class="error-message" style="display: none;"></div>
          
          <div class="modal-actions">
            <button class="btn-cancel">Cancel</button>
            <button class="btn-save" id="save-password-btn">Change Password</button>
          </div>
        </div>
      </div>
    `;
    
    const container = document.createElement('div');
    container.innerHTML = modalHTML;
    container.className = 'modal-overlay';
    document.body.appendChild(container);
    
    const currentPwdInput = container.querySelector('#current-password') as HTMLInputElement;
    const newPwdInput = container.querySelector('#new-password') as HTMLInputElement;
    const confirmPwdInput = container.querySelector('#confirm-password') as HTMLInputElement;
    const tfaInput = container.querySelector('#password-2fa-code') as HTMLInputElement;
    const errorEl = container.querySelector('#password-error') as HTMLElement;
    const saveBtn = container.querySelector('#save-password-btn') as HTMLButtonElement;
    const cancelBtn = container.querySelector('.btn-cancel') as HTMLButtonElement;
    const closeBtn = container.querySelector('.close-modal-btn') as HTMLButtonElement;
    
    const closeModal = () => container.remove();
    
    cancelBtn.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);
    container.addEventListener('click', (e) => {
      if (e.target === container) closeModal();
    });
    
    saveBtn.addEventListener('click', async () => {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
      
      // Validações
      if (!currentPwdInput.value) {
        errorEl.textContent = 'Please enter your current password';
        errorEl.style.display = 'block';
        return;
      }
      
      if (!newPwdInput.value) {
        errorEl.textContent = 'Please enter a new password';
        errorEl.style.display = 'block';
        return;
      }
      
      if (newPwdInput.value !== confirmPwdInput.value) {
        errorEl.textContent = 'Passwords do not match';
        errorEl.style.display = 'block';
        return;
      }
      
      if (newPwdInput.value.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters';
        errorEl.style.display = 'block';
        return;
      }
      
      if (currentPwdInput.value === newPwdInput.value) {
        errorEl.textContent = 'New password must be different from current';
        errorEl.style.display = 'block';
        return;
      }
      
      if (is2FAEnabled && !tfaInput.value) {
        errorEl.textContent = '2FA is enabled - please enter your code';
        errorEl.style.display = 'block';
        return;
      }
      
      try {
        const user = getActiveUser({ sync: true, allowStored: true });
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!user?.email || !session?.access_token) {
          errorEl.textContent = 'Session expired - please log in again';
          errorEl.style.display = 'block';
          return;
        }
        
        // Primeiro: validar senha atual (fazer login)
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPwdInput.value
        });
        
        if (signInError) {
          errorEl.textContent = 'Current password is incorrect';
          errorEl.style.display = 'block';
          return;
        }
        
        // Se 2FA ativado, validar código
        if (is2FAEnabled) {
          const sanitizedTfaCode = (tfaInput.value || '').replace(/\s+/g, '');
          const validateResponse = await fetch('/api/_profile', {
            method: 'POST',
            headers: await addCsrfHeader({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              action: 'validate2FA',
              userId: user.id,
              authToken: session.access_token,
              code: sanitizedTfaCode
            })
          });
          
          if (!validateResponse.ok) {
            errorEl.textContent = '2FA code is invalid';
            errorEl.style.display = 'block';
            return;
          }
        }
        
        // Atualizar senha
        const { error: updateError } = await supabase.auth.updateUser({
          password: newPwdInput.value
        });
        
        if (updateError) {
          errorEl.textContent = 'Failed to change password: ' + updateError.message;
          errorEl.style.display = 'block';
          return;
        }
        
        closeModal();
        showToast('success', '✅ Password Changed', 'Your password has been updated successfully');
      } catch (err) {
        errorEl.textContent = 'An error occurred. Please try again.';
        errorEl.style.display = 'block';
        console.error('Password change error:', err);
      }
    });
  } catch (err) {
    ErrorHandler.handleError('Error opening password change modal', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      details: err,
      showToUser: false
    });
  }
}

// ============================================================
// ACCOUNT RECOVERY - SECONDARY EMAIL
// ============================================================

/**
 * Gerencia email secundário para recuperação de conta
 */
export async function manageSecondaryEmail(): Promise<void> {
  try {
    const user = getActiveUser({ sync: true, allowStored: true });
    if (!user?.id) {
      showAlert('error', 'Not authenticated', 'Please log in again.');
      return;
    }
    
    const { data: profile } = await supabase
      .from('player_profiles')
      .select('secondary_email')
      .eq('user_id', user.id)
      .single();
    
    const currentSecondaryEmail = profile?.secondary_email;
    
    // Modal para adicionar/alterar email secundário
    const newEmail = prompt(
      `Current recovery email: ${currentSecondaryEmail ? maskEmail(currentSecondaryEmail) : 'Not set'}\n\nEnter new recovery email (or leave empty to remove):`,
      currentSecondaryEmail || ''
    );
    
    if (newEmail === null) return;
    
    // Validação simples de email
    if (newEmail && !newEmail.includes('@')) {
      showAlert('error', 'Invalid email', 'Please enter a valid email address');
      return;
    }
    
    const { data: { session } } = await supabase.auth.getSession();
    
    const response = await fetch('/api/_profile', {
      method: 'POST',
      headers: await addCsrfHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'updateSecondaryEmail',
        userId: user.id,
        authToken: session?.access_token,
        secondaryEmail: newEmail || null
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      showAlert('error', '❌ Failed', result.error || 'Could not update recovery email');
      return;
    }
    
    showToast('success', '✅ Updated', newEmail ? `${newEmail} set as recovery email` : 'Recovery email removed');
  } catch (err) {
    ErrorHandler.handleError('Error managing secondary email', {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.ERROR,
      details: err,
      showToUser: false
    });
  }
}

// ============================================================
// SECURITY & SESSIONS MANAGEMENT
// ============================================================

/**
 * Mostra painel de dispositivos ativos
 */
export async function manageActiveSessions(): Promise<void> {
  try {
    const { getActiveDevices, logoutDevice, logoutAllOtherDevices } = await import('../core/security-manager');
    
    const devices = await getActiveDevices();
    
    if (!devices || devices.length === 0) {
      showAlert('info', 'No Active Sessions', 'No active sessions found on this account.');
      return;
    }
    
    // Criar tabela de dispositivos
    let devicesHTML = `
      <div class="security-panel">
        <h3>📱 Active Sessions</h3>
        <table class="devices-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Browser</th>
              <th>IP Address</th>
              <th>Last Activity</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    for (const device of devices) {
      const lastActivity = new Date(device.last_activity).toLocaleDateString();
      const deviceLabel = device.is_current ? '📍 This Device' : device.device_name;
      
      devicesHTML += `
        <tr>
          <td>${deviceLabel}</td>
          <td>${device.browser}</td>
          <td>${device.ip_address}</td>
          <td>${lastActivity}</td>
          <td>
            ${!device.is_current ? `<button class="btn-small logout-device" data-device-id="${device.id}">Logout</button>` : 'Current'}
          </td>
        </tr>
      `;
    }
    
    devicesHTML += `
          </tbody>
        </table>
        <button class="btn-danger" id="logout-all-other-devices">Logout All Other Devices</button>
      </div>
    `;
    
    showAlert('info', 'Active Sessions', devicesHTML);
    
    // Adicionar event listeners
    document.querySelectorAll('.logout-device').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const deviceId = (e.target as HTMLElement).getAttribute('data-device-id');
        if (deviceId) {
          await logoutDevice(deviceId);
          // Recarregar sessões
          setTimeout(() => manageActiveSessions(), 500);
        }
      });
    });
    
    const logoutAllBtn = document.getElementById('logout-all-other-devices');
    if (logoutAllBtn) {
      logoutAllBtn.addEventListener('click', async () => {
        if (confirm('Are you sure? This will logout all other devices.')) {
          await logoutAllOtherDevices();
        }
      });
    }
  } catch (err) {
    ErrorHandler.handleError('Error managing sessions', {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.ERROR,
      details: err,
      showToUser: false
    });
  }
}

/**
 * Mostra histórico de tentativas de login
 */
export async function viewLoginAttempts(): Promise<void> {
  try {
    const { getLoginAttempts } = await import('../core/security-manager');
    
    const attempts = await getLoginAttempts(30);
    
    if (!attempts || attempts.length === 0) {
      showAlert('info', 'No Login Attempts', 'No login attempts in the last 30 days.');
      return;
    }
    
    let html = `
      <div class="security-panel">
        <h3>🔐 Recent Login Attempts (Last 30 Days)</h3>
        <table class="attempts-table" style="max-height: 400px; overflow-y: auto;">
          <thead>
            <tr>
              <th>Date & Time</th>
              <th>Status</th>
              <th>IP Address</th>
              <th>Browser</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    for (const attempt of attempts) {
      const date = new Date(attempt.created_at).toLocaleString();
      const status = attempt.success ? '✅ Success' : '❌ Failed';
      const browserInfo = attempt.user_agent.substring(0, 50) + '...';
      
      html += `
        <tr class="${attempt.success ? 'success-row' : 'failed-row'}">
          <td>${date}</td>
          <td>${status}</td>
          <td>${attempt.ip_address}</td>
          <td title="${attempt.user_agent}">${browserInfo}</td>
        </tr>
      `;
    }
    
    html += `
          </tbody>
        </table>
      </div>
    `;
    
    showAlert('info', 'Login Attempts', html);
  } catch (err) {
    ErrorHandler.handleError('Error viewing login attempts', {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.ERROR,
      details: err,
      showToUser: false
    });
  }
}

// ============================================================
// COMPLIANCE & DATA MANAGEMENT (LGPD/GDPR)
// ============================================================

/**
 * Abre painel de conformidade e gerenciamento de dados
 */
export async function openCompliancePanel(): Promise<void> {
  const complianceHTML = `
    <div class="compliance-panel">
      <h3>🛡️ Privacy & Compliance</h3>
      <div class="compliance-options">
        <button class="compliance-btn" id="export-data-btn">
          📥 Download My Data
          <small>LGPD/GDPR Right to Data Portability</small>
        </button>
        
        <button class="compliance-btn danger" id="delete-account-btn">
          🗑️ Delete Account
          <small>Permanently delete all data (non-recoverable)</small>
        </button>
        
        <button class="compliance-btn" id="reset-cookies-btn">
          🍪 Cookie Settings
          <small>Manage cookie preferences</small>
        </button>
      </div>
    </div>
  `;
  
  showAlert('info', 'Data & Privacy', complianceHTML);
  
  // Event listeners
  const exportBtn = document.getElementById('export-data-btn');
  const deleteBtn = document.getElementById('delete-account-btn');
  const cookiesBtn = document.getElementById('reset-cookies-btn');
  
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      const { downloadUserData } = await import('../core/compliance-manager');
      await downloadUserData();
    });
  }
  
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const { initiateAccountDeletion } = await import('../core/compliance-manager');
      await initiateAccountDeletion();
    });
  }
  
  if (cookiesBtn) {
    cookiesBtn.addEventListener('click', async () => {
      const { resetCookieConsent, showCookieConsentBanner } = await import('../core/compliance-manager');
      resetCookieConsent();
      setTimeout(() => showCookieConsentBanner(), 500);
    });
  }
}

// ============================================================
// NAVIGATION
// ============================================================

/**
 * Navega para a tela de configurações
 */
export function goToSettings(): void {
  const dropdown = document.getElementById('profile-dropdown');
  if (dropdown) dropdown.classList.remove('active');
  
  if (window.goTo) {
    window.goTo('settings');
  }
}

// ============================================================
// EXPOR FUNÇÕES GLOBALMENTE
// ============================================================

(window as any).loadSettingsData = loadSettingsData;
(window as any).enableUsernameEdit = enableUsernameEdit;
(window as any).cancelUsernameEdit = cancelUsernameEdit;
(window as any).changePassword = changePassword;
(window as any).openChangePasswordModal = openChangePasswordModal;
(window as any).toggle2FA = toggle2FA;
(window as any).viewRecoveryCodes = viewRecoveryCodes;
(window as any).viewFullEmail = viewFullEmail;
(window as any).manageSecondaryEmail = manageSecondaryEmail;
(window as any).manageActiveSessions = manageActiveSessions;
(window as any).viewLoginAttempts = viewLoginAttempts;
(window as any).openCompliancePanel = openCompliancePanel;
(window as any).goToSettings = goToSettings;
