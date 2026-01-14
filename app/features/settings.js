// ============================================================
// SETTINGS.JS - Sistema de Configurações
// ============================================================

import { supabase } from './auth.js';
import { getActiveUser } from '../core/session.js';
import { playSound, setMasterVolume, setSoundEnabled, setSoundPreference, setAllSoundPreferences } from '../shared/sfx.js';
import { showToast, showAlert } from '../shared/effects.js';

// ============================================================
// SETTINGS DATA LOADING
// ============================================================

/**
 * Carrega os dados de configurações do usuário
 */
export async function loadSettingsData() {
  try {
    const user = getActiveUser({ sync: true, allowStored: true }) || window.currentUser;
    if (!user?.id) return;
    
    const { data: stats, error } = await supabase
      .from('player_stats')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    if (error || !stats) {
      console.error('Error loading settings:', error);
      return;
    }
    
    // Preencher dados
    const emailInput = document.getElementById('settings-email');
    const usernameInput = document.getElementById('settings-username');
    
    if (emailInput) emailInput.value = user.email || '';
    if (usernameInput) usernameInput.value = stats.username || '';
    usernameChangeCount = Number(stats.username_change_count) || 0;
    updateUsernameUI();
    
    // Garantir que listeners sejam ligados uma única vez e refletir preferências no UI
    bindSettingsUIOnce();
    applySavedPreferencesToUI();
    
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

/**
 * Carrega preferências salvas do localStorage
 */
const checkboxBindings = [
  { id: 'sound-effects', storageKey: 'soundEffects', defaultChecked: true },
  { id: 'background-music', storageKey: 'backgroundMusic', defaultChecked: false },
  { id: 'public-profile', storageKey: 'publicProfile', defaultChecked: true },
  { id: 'show-stats', storageKey: 'showStats', defaultChecked: true },
  { id: 'event-notifications', storageKey: 'eventNotifications', defaultChecked: true },
  { id: 'daily-notifications', storageKey: 'dailyNotifications', defaultChecked: true }
];

let settingsUIBound = false;
let usernameChangeCount = 0;

function applySavedPreferencesToUI() {
  for (const { id, storageKey, defaultChecked } of checkboxBindings) {
    const checkbox = document.getElementById(id);
    if (!checkbox) continue;

    const saved = localStorage.getItem(storageKey);
    const checked = saved == null ? defaultChecked : saved === 'true';
    checkbox.checked = checked;

    if (storageKey === 'soundEffects') {
      setSoundEnabled(checked);
    }
  }

  const volumeSlider = document.getElementById('volume-slider');
  if (volumeSlider) {
    const savedVolume = localStorage.getItem('volume') || '50';
    volumeSlider.value = savedVolume;
    setMasterVolume(savedVolume);
  }

  const languageSelect = document.getElementById('language-select');
  if (languageSelect) {
    const savedLanguage = localStorage.getItem('language') || 'en';
    languageSelect.value = savedLanguage;
  }

  syncSoundModalCheckboxes();
  updateSoundChannelEnabledState();
}

function bindSettingsUIOnce() {
  if (settingsUIBound) return;
  settingsUIBound = true;

  for (const { id, storageKey } of checkboxBindings) {
    const checkbox = document.getElementById(id);
    if (!checkbox) continue;
    if (checkbox.dataset.bound === '1') continue;
    checkbox.dataset.bound = '1';

    checkbox.addEventListener('change', function() {
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

  const volumeSlider = document.getElementById('volume-slider');
  if (volumeSlider && volumeSlider.dataset.bound !== '1') {
    volumeSlider.dataset.bound = '1';
    volumeSlider.addEventListener('input', function() {
      localStorage.setItem('volume', String(this.value));
      setMasterVolume(this.value);
    });
  }

  const languageSelect = document.getElementById('language-select');
  if (languageSelect && languageSelect.dataset.bound !== '1') {
    languageSelect.dataset.bound = '1';
    languageSelect.addEventListener('change', async function() {
      const newLang = this.value;
      localStorage.setItem('language', newLang);

      this.disabled = true;
      this.style.opacity = '0.5';

      // Notificar o app (app.js escuta isso pra sincronizar idioma)
      document.dispatchEvent(new Event('languageChanged'));

      if (window.applyTranslations) {
        await window.applyTranslations();
      }

      // Se o profile estiver aberto, recarregar com os argumentos esperados
      const profileScreen = document.getElementById('profile');
      if (profileScreen && profileScreen.classList.contains('active')) {
        if (window.loadProfileData) {
          const user = getActiveUser({ sync: true, allowStored: true }) || window.currentUser;
          await window.loadProfileData(user, window.calculateLevel, window.applyTranslations);
        }
      }

      this.disabled = false;
      this.style.opacity = '1';

      alert('Language changed!');
    });
  }

  bindSoundModal();
}

function updateUsernameUI() {
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
    helper.textContent = '3-16 chars • letters/numbers/._- • case-insensitive unique';
  }

  if (button) {
    if (input?.disabled) {
      button.textContent = window.t ? window.t('edit') : 'Edit';
      button.style.background = 'var(--button-primary)';
      if (cancelBtn) cancelBtn.style.display = 'none';
    } else {
      button.textContent = cost === 0
        ? (window.t ? window.t('save') : 'Save (Free)')
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

function syncSoundModalCheckboxes() {
  for (const { id, key } of SOUND_TOGGLE_IDS) {
    const el = document.getElementById(id);
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

function updateSoundChannelEnabledState() {
  const master = document.getElementById('sound-effects');
  const masterOn = master ? master.checked : true;
  for (const { id } of SOUND_TOGGLE_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.disabled = !masterOn;
  }
}

function bindSoundModal() {
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
    const el = document.getElementById(id);
    if (!el || el.dataset.bound === '1') continue;
    el.dataset.bound = '1';
    el.addEventListener('change', function() {
      setSoundPreference(key, this.checked);
      playSound('switch', { volume: 0.3 });
    });
  }

  const masterSound = document.getElementById('sound-effects');
  if (masterSound && masterSound.dataset.bound !== '1') {
    masterSound.dataset.bound = '1';
    masterSound.addEventListener('change', function() {
      localStorage.setItem('soundEffects', String(this.checked));
      setSoundEnabled(this.checked);
      updateSoundChannelEnabledState();
      playSound('switch', { volume: 0.3 });
    });
  }

  const masterMusic = document.getElementById('background-music');
  if (masterMusic && masterMusic.dataset.bound !== '1') {
    masterMusic.dataset.bound = '1';
    masterMusic.addEventListener('change', function() {
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
export async function enableUsernameEdit() {
  const input = document.getElementById('settings-username');
  const button = document.getElementById('edit-username-btn');
  const cancelBtn = document.getElementById('cancel-username-btn');
  
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
    const pattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,15}$/;

    if (!newUsername) {
      showAlert('error', 'Invalid username', 'Username cannot be empty.');
      return;
    }

    if (!pattern.test(newUsername)) {
      showAlert('error', 'Invalid username', 'Use 3-16 chars: letters, numbers, dot, underscore or hyphen.');
      return;
    }

    try {
      const user = getActiveUser({ sync: true, allowStored: true }) || window.currentUser;
      if (!user?.id) {
        showAlert('error', 'Not logged in', 'Sign in to change your username.');
        return;
      }

      const { data: { session } = {} } = await supabase.auth.getSession();
      if (!session?.access_token) {
        showAlert('error', 'Auth error', 'Could not validate your session. Please re-login.');
        return;
      }

      button.disabled = true;

      const response = await fetch('/api/_profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        button.disabled = false;
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

      if (window.playerDiamonds && typeof result.diamonds === 'number') {
        window.playerDiamonds.value = result.diamonds;
        window.cachedDiamonds = result.diamonds;
      }

      showToast('success', 'Username updated ✨', usernameChangeCount === 1 ? 'First change was free.' : '100 💎 deducted.');

      input.disabled = true;
      button.disabled = false;
      if (cancelBtn) {
        cancelBtn.style.display = 'none';
        delete input.dataset.originalUsername;
      }
      updateUsernameUI();

    } catch (err) {
      console.error('Username change error:', err);
      showAlert('error', 'Connection error', 'Could not reach the server. Please try again.');
      button.disabled = false;
      updateUsernameUI();
    }
  }
}

export function cancelUsernameEdit() {
  const input = document.getElementById('settings-username');
  const button = document.getElementById('edit-username-btn');
  const cancelBtn = document.getElementById('cancel-username-btn');

  if (!input || !button) return;

  if (!input.disabled) {
    if (input.dataset.originalUsername) {
      input.value = input.dataset.originalUsername;
      delete input.dataset.originalUsername;
    }
    input.disabled = true;
  }

  if (button.disabled) button.disabled = false;
  if (cancelBtn) cancelBtn.style.display = 'none';
  updateUsernameUI();
}

// ============================================================
// PASSWORD MANAGEMENT
// ============================================================

/**
 * Muda a senha do usuário
 */
export async function changePassword() {
  const newPassword = prompt('Enter your new password (minimum 6 characters):');
  
  if (!newPassword) return;
  
  if (newPassword.length < 6) {
    alert('❌ The password must be at least 6 characters long!');
    return;
  }
  
  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });
    
    if (error) {
      alert('❌ Error changing password: ' + error.message);
      return;
    }
    
    alert('✅ Password changed successfully!');
    
  } catch (err) {
    alert('❌ Unexpected error: ' + err.message);
  }
}

// ============================================================
// NAVIGATION
// ============================================================

/**
 * Navega para a tela de configurações
 */
export function goToSettings() {
  const dropdown = document.getElementById('profile-dropdown');
  if (dropdown) dropdown.classList.remove('active');
  
  if (window.goTo) {
    window.goTo('settings');
  }
}

// ============================================================
// EXPOR FUNÇÕES GLOBALMENTE
// ============================================================

window.loadSettingsData = loadSettingsData;
window.enableUsernameEdit = enableUsernameEdit;
window.cancelUsernameEdit = cancelUsernameEdit;
window.changePassword = changePassword;
window.goToSettings = goToSettings;
