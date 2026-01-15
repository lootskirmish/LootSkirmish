// ============================================================
// PROFILE.JS - Sistema de Perfil e Customização
// ============================================================

import { supabase } from './auth';
import { 
  showUploadNotification, 
  showDiamondPopup, 
  showXPPopup,
  showToast,
  showAlert
} from '../shared/effects';
import { syncPublicProfileFriendButton } from './friends';
import { getActiveUser } from '../core/session';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

interface User {
  id: string;
  username?: string;
  email?: string;
  avatar_url?: string;
}

interface PlayerStats {
  user_id: string;
  username: string;
  avatar_url?: string;
  banner_url?: string;
  level: number;
  xp: number;
  money: number;
  diamonds: number;
  total_wins: number;
  total_battles: number;
  total_cases_opened?: number;
  best_drop?: number;
  total_spent?: number;
  total_gains?: number;
  [key: string]: any;
}

interface LevelInfo {
  level: number;
  currentXP: number;
  nextLevelXP: number;
}

declare global {
  interface Window {
    goTo?: (screen: string) => void;
    loadProfileData: typeof loadProfileData;
    updateAvatar: typeof updateAvatar;
    updateBanner: typeof updateBanner;
    loadUserImages: typeof loadUserImages;
    loadPublicProfile: typeof loadPublicProfile;
    toggleProfilePanel: typeof toggleProfilePanel;
    toggleProfileDropdown: typeof toggleProfileDropdown;
    goToProfile: typeof goToProfile;
  }
}

// Cache leve de DOM para reduzir query repetida (sem depender de telas sempre montadas)
const _elCache: Map<string, HTMLElement | null> = new Map();

/**
 * Helper to show contextual error messages
 */
function showProfileError(context: string, message: string, details: Record<string, any> = {}): void {
  console.error(`[PROFILE_ERROR] ${context}:`, { message, details });
  // Don't show popup immediately - let toast show first
  setTimeout(() => {
    showToast(message, 'error');
  }, 100);
}

function $(id: string): HTMLElement | null {
  if (_elCache.has(id)) return _elCache.get(id);
  const el = document.getElementById(id);
  _elCache.set(id, el);
  return el;
}

function setText(id: string, value: string | number): void {
  const el = $(id);
  if (el) el.textContent = value;
}

function formatNumber(value: number | string, decimals: number = 2): string {
  const num = Number(value) || 0;
  
  // Números negativos (improvável mas seguro)
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  
  // Abaixo de 1 milhão: formata com separador de milhar e decimais
  if (absNum < 1000000) {
    const formatted = absNum.toLocaleString('pt-BR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    return isNegative ? `-${formatted}` : formatted;
  }
  
  // Acima de 1 milhão: usa sufixos M, B, T, Q
  const suffixes = [
    { value: 1e15, symbol: 'Q' },  // Quadrilhão
    { value: 1e12, symbol: 'T' },  // Trilhão
    { value: 1e9, symbol: 'B' },   // Bilhão
    { value: 1e6, symbol: 'M' }    // Milhão
  ];
  
  for (const { value, symbol } of suffixes) {
    if (absNum >= value) {
      const result = (absNum / value).toFixed(2);
      return isNegative ? `-${result}${symbol}` : `${result}${symbol}`;
    }
  }
  
  return absNum.toFixed(decimals);
}

// ============================================================
// PROFILE DATA LOADING
// ============================================================

/**
 * Carrega todos os dados do perfil do usuário
 * @param {Object} user - Objeto do usuário
 * @param {Function} calculateLevel - Função para calcular level
 * @param {Function} applyTranslations - Função para aplicar traduções
 */
export async function loadProfileData(user: User, calculateLevel?: (xp: number) => LevelInfo, applyTranslations?: () => void): Promise<void> {
  try {
    if (!user?.id) return;
    
    // CRÍTICO: Limpar contexto de perfil público ao carregar próprio perfil
    if ((window as any).publicProfileUsername) {
      (window as any).publicProfileUsername = null;
    }
    setProfileViewMode(false); // Garantir modo privado
    syncPublicProfileFriendButton(null);
    
    const { data: stats, error } = await supabase
      .from('player_stats')
      .select('*')
      .eq('user_id', user.id)
      .single();
    
    if (error || !stats) {
      console.error('Error loading profile:', error);
      showAlert('error', 'Loading Failed! 💤', 'Unable to load profile data. Please refresh the page.');
      return;
    }
    
    // Atualizar informações básicas
    setText('profile-username', stats.username ?? '');
    setText('profile-level', stats.level ?? '');
    
    // XP Progress
    if (calculateLevel) {
      const levelInfo = calculateLevel(stats.xp || 0);
      const xpProgress = levelInfo.nextLevelXP ? (levelInfo.currentXP / levelInfo.nextLevelXP) * 100 : 0;

      setText('profile-xp-text', `${levelInfo.currentXP}/${levelInfo.nextLevelXP} XP`);
      const xpBar = $('profile-xp-bar');
      if (xpBar) xpBar.style.width = xpProgress + '%';
      setText('profile-level', levelInfo.level);
    }
    
    // Buscar apenas best drop (cases já vem do stats)
    const { data: bestDrop } = await supabase
      .from('drop_history')
      .select('value')
      .eq('user_id', user.id)
      .order('value', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    // Garantir que os valores numéricos sejam tratados corretamente
    const totalWins = Number(stats.total_wins) || 0;
    const totalBattles = Number(stats.total_battles) || 0;
    const totalSpent = Number(stats.total_spent) || 0;
    const totalGains = Number(stats.total_gains) || 0;
    const totalCases = Number(stats.total_cases_opened) || 0;
    const bestDropValue = bestDrop?.value != null ? Number(bestDrop.value) : 0;
    
    // Atualizar stats com formatação
    setText('stat-cases-opened', formatNumber(totalCases, 0));
    setText('stat-battles', formatNumber(totalBattles, 0));
    setText('stat-wins', formatNumber(totalWins, 0));
    setText('stat-best-drop', formatNumber(bestDropValue, 2));
    setText('stat-total-spent', formatNumber(totalSpent, 2));
    setText('stat-total-gains', formatNumber(totalGains, 2));
    
    // Avatar
    const cacheBust = Date.now();
    if (stats.avatar_url) {
      const headerAvatar = $('header-avatar');
      const profileAvatar = $('profile-avatar');
      const menuAvatar = $('menu-avatar');
      if (headerAvatar) headerAvatar.src = stats.avatar_url + '?t=' + cacheBust;
      if (profileAvatar) profileAvatar.src = stats.avatar_url + '?t=' + cacheBust;
      if (menuAvatar) menuAvatar.src = stats.avatar_url + '?t=' + cacheBust;
    } else {
      const dice = `https://api.dicebear.com/7.x/avataaars/svg?seed=${stats.username}`;
      const headerAvatar = $('header-avatar');
      const profileAvatar = $('profile-avatar');
      const menuAvatar = $('menu-avatar');
      if (headerAvatar) headerAvatar.src = dice;
      if (profileAvatar) profileAvatar.src = dice;
      if (menuAvatar) menuAvatar.src = dice;
    }
    
    // Aplicar traduções
    if (applyTranslations) {
      await applyTranslations();
    }
    await loadUserImages(user.id);
    setProfileViewMode(false);
    
  } catch (err) {
    console.error('Error loading profile:', err);
  }
}

export async function loadPublicProfile(username: string, calculateLevel?: (xp: number) => LevelInfo, applyTranslations?: () => void): Promise<void> {
  try {
    if (!username || typeof username !== 'string') {
      console.error('Invalid username provided');
      showToast('Invalid profile URL.', 'error');
      // Return to safe state via router
      window.history.replaceState({}, '', '/');
      if (window.checkRouteAuth) window.checkRouteAuth();
      return;
    }

    // First, perform a STRICT server-side validation using the checkPublicProfile endpoint
    let profileCheckResponse;
    try {
      profileCheckResponse = await fetch('/api/_profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'checkPublicProfile',
          username: username.trim()
        })
      });

      if (!profileCheckResponse.ok) {
        console.error(`[LOAD_PUBLIC_PROFILE] Check failed - Status: ${profileCheckResponse.status}, Username: "${username}"`);
        const errorData = await profileCheckResponse.json().catch(() => ({}));
        console.error(`[LOAD_PUBLIC_PROFILE] Error response:`, errorData);
        showToast('error', 'Profile could not be accessed.');
        // Return to safe state via router
        window.history.replaceState({}, '', '/');
        if (window.checkRouteAuth) window.checkRouteAuth();
        return;
      }

      const checkData = await profileCheckResponse.json();
      console.log(`[LOAD_PUBLIC_PROFILE] Check passed for "${username}":`, checkData);

      if (!checkData.success || !checkData.isPublic) {
        console.warn(`[LOAD_PUBLIC_PROFILE] Profile is private (success=${checkData.success}, isPublic=${checkData.isPublic})`);
        showToast('info', 'This profile is private.');
        // Return to safe state via router
        window.history.replaceState({}, '', '/');
        if (window.checkRouteAuth) window.checkRouteAuth();
        return;
      }
    } catch (err) {
      console.error(`[LOAD_PUBLIC_PROFILE] Fetch error for "${username}":`, err.message || err);
      showToast('error', 'Could not access profile. Please try again.');
      // Return to safe state via router
      window.history.replaceState({}, '', '/');
      if (window.checkRouteAuth) window.checkRouteAuth();
      return;
    }

    // Now load the profile data
    const { data: stats, error } = await supabase
      .from('player_stats')
      .select('*')
      .ilike('username', username)
      .single();

    if (error || !stats) {
      console.error(`[LOAD_PUBLIC_PROFILE] DB fetch failed for "${username}":`, error?.message || error);
      showToast('error', 'Profile could not be loaded. Please try again.');
      // Return to safe state via router
      window.history.replaceState({}, '', '/');
      if (window.checkRouteAuth) window.checkRouteAuth();
      return;
    }

    // CRITICAL: Double-check privacy setting locally (defense in depth)
    // Must be explicitly true, not null/undefined
    const isPublic = stats.public === true || stats.public === 'true';
    if (!isPublic) {
      console.warn(`[LOAD_PUBLIC_PROFILE] LOCAL verification failed: public field is "${stats.public}" (type: ${typeof stats.public})`);
      showToast('info', 'This profile is private.');
      // Return to safe state via router
      window.history.replaceState({}, '', '/');
      if (window.checkRouteAuth) window.checkRouteAuth();
      return;
    }

    // CRITICAL: Verify it's not the current user's own profile being loaded in public mode
    const currentUser = getActiveUser({ sync: true, allowStored: true });
    if (currentUser && stats.user_id === currentUser.id) {
      // Should load own profile, not public profile
      console.warn('Redirecting to own profile');
      window.history.replaceState({}, '', '/profile');
      if (window.checkRouteAuth) window.checkRouteAuth();
      return;
    }

    const user = { id: stats.user_id, email: stats.email, username: stats.username };
    syncPublicProfileFriendButton({ user_id: user.id, username: stats.username });

    setText('profile-username', stats.username ?? '');
    setText('profile-level', stats.level ?? '');

    if (calculateLevel) {
      const levelInfo = calculateLevel(stats.xp || 0);
      const xpProgress = levelInfo.nextLevelXP ? (levelInfo.currentXP / levelInfo.nextLevelXP) * 100 : 0;
      setText('profile-xp-text', `${levelInfo.currentXP}/${levelInfo.nextLevelXP} XP`);
      const xpBar = $('profile-xp-bar');
      if (xpBar) xpBar.style.width = xpProgress + '%';
      setText('profile-level', levelInfo.level);
    }

    // Garantir que os valores numéricos sejam tratados corretamente
    const totalWins = Number(stats.total_wins) || 0;
    const totalBattles = Number(stats.total_battles) || 0;
    const totalSpent = Number(stats.total_spent) || 0;
    const totalGains = Number(stats.total_gains) || 0;
    const totalCases = Number(stats.total_cases_opened) || 0;
    const bestDropValue = Number(stats.best_drop) || 0;

    setText('stat-cases-opened', formatNumber(totalCases, 0));
    setText('stat-battles', formatNumber(totalBattles, 0));
    setText('stat-wins', formatNumber(totalWins, 0));
    setText('stat-best-drop', formatNumber(bestDropValue, 2));
    setText('stat-total-spent', formatNumber(totalSpent, 2));
    setText('stat-total-gains', formatNumber(totalGains, 2));

    const cacheBust = Date.now();
    if (stats.avatar_url) {
      const profileAvatar = $('profile-avatar');
      if (profileAvatar) profileAvatar.src = stats.avatar_url + '?t=' + cacheBust;
    } else {
      const dice = `https://api.dicebear.com/7.x/avataaars/svg?seed=${stats.username}`;
      const profileAvatar = $('profile-avatar');
      if (profileAvatar) profileAvatar.src = dice;
    }

    if (stats.banner_url) {
      const bannerElement = document.querySelector('.profile-banner');
      if (bannerElement) {
        bannerElement.style.backgroundImage = `url(${stats.banner_url}?t=${Date.now()})`;
        bannerElement.style.backgroundSize = 'cover';
        bannerElement.style.backgroundPosition = 'center';
      }
    }

    setProfileViewMode(true);
    if (applyTranslations) {
      await applyTranslations();
    }
  } catch (err) {
    console.error('Error loading public profile:', err);
    showToast('error', 'Could not load profile. Please try again.');
    // Return to safe state via router
    window.history.replaceState({}, '', '/');
    if (window.checkRouteAuth) window.checkRouteAuth();
  }
}

function setProfileViewMode(isPublic: boolean): void {
  const profileScreen = document.getElementById('profile');
  if (profileScreen) {
    profileScreen.classList.toggle('profile-public', !!isPublic);
  }
  const uploadInputs = ['avatar-upload', 'banner-upload'];
  uploadInputs.forEach(id => {
    const el = $(id);
    if (el) {
      el.classList.add('upload-hidden');
      el.disabled = !!isPublic;
    }
  });

  const uploadNotice = $('upload-notification');
  if (uploadNotice) uploadNotice.style.display = isPublic ? 'none' : 'flex';
  const quickActions = document.querySelector('.profile-actions-grid');
  if (quickActions) {
    quickActions.style.display = isPublic ? 'none' : '';
    const actionsSection = quickActions.closest('.profile-section');
    if (actionsSection) actionsSection.style.display = isPublic ? 'none' : '';
  }
  const themesSection = document.querySelector('.themes-shop-container');
  if (themesSection) themesSection.style.display = isPublic ? 'none' : '';

  const publicActions = document.getElementById('profile-public-actions');
  if (publicActions) {
    publicActions.style.display = isPublic ? 'flex' : 'none';
  }
}

// ============================================================
// AVATAR & BANNER SYSTEM
// ============================================================

/**
 * Redimensiona uma imagem
 * @param {File} file - Arquivo de imagem
 * @param {number} maxWidth - Largura máxima
 * @param {number} maxHeight - Altura máxima
 * @param {boolean} isCircle - Se deve criar máscara circular
 * @returns {Promise<Blob>} Blob da imagem redimensionada
 */
export async function resizeImage(file: File, maxWidth: number, maxHeight: number, isCircle: boolean = false): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        if (isCircle) {
          ctx.beginPath();
          ctx.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to convert image'));
          }
        }, 'image/jpeg', 0.9);
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Faz upload de imagem para Supabase Storage
 * @param {File} file - Arquivo de imagem
 * @param {string} folder - Pasta (avatar ou banner)
 * @param {string} userId - ID do usuário
 * @returns {Promise<string>} URL pública da imagem
 */
export async function uploadToSupabase(file: File, folder: string, userId: string): Promise<string> {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/${folder}-${Date.now()}.${fileExt}`;
    
    const { data, error } = await supabase.storage
      .from('avatars')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true
      });
    
    if (error) throw error;
    
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(fileName);
    
    return publicUrl;
    
  } catch (err) {
    console.error('Upload error:', err);
    throw err;
  }
}

/**
 * Atualiza o avatar do usuário
 * @param {File} file - Arquivo de imagem
 * @param {string} userId - ID do usuário
 */
export async function updateAvatar(file: File, userId: string): Promise<void> {
  try {
    if (!userId) {
      showUploadNotification('Error: User not authenticated', true);
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      showUploadNotification('Image too large! Max 5MB', true);
      showAlert('error', 'File Too Large! 📦', 'Maximum file size is 5MB. Please choose a smaller image.');
      return;
    }
    
    if (!file.type.startsWith('image/')) {
      showUploadNotification('Invalid file type!', true);
      showAlert('error', 'Invalid Format! ❌', 'Please upload an image file (JPG, PNG, GIF).');
      return;
    }
    
    const avatarContainer = document.querySelector('.profile-avatar-container');
    if (!avatarContainer) return;
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'upload-loading active';
    loadingDiv.innerHTML = '<div class="upload-spinner"></div>';
    avatarContainer.appendChild(loadingDiv);
    
    const resizedBlob = await resizeImage(file, 120, 120, true);
    const resizedFile = new File([resizedBlob], file.name, { type: 'image/jpeg' });
    
    const avatarUrl = await uploadToSupabase(resizedFile, 'avatar', userId);
    
    const { error: dbError } = await supabase
      .from('player_stats')
      .update({ avatar_url: avatarUrl })
      .eq('user_id', userId);
    
    if (dbError) throw dbError;
    
    const cacheBust = Date.now();
    const profileAvatar = $('profile-avatar');
    const headerAvatar = $('header-avatar');
    const menuAvatar = $('menu-avatar');
    if (profileAvatar) profileAvatar.src = avatarUrl + '?t=' + cacheBust;
    if (headerAvatar) headerAvatar.src = avatarUrl + '?t=' + cacheBust;
    if (menuAvatar) menuAvatar.src = avatarUrl + '?t=' + cacheBust;
    
    loadingDiv.remove();
    showUploadNotification('Avatar updated successfully!');
    showToast('success', 'Avatar Updated! 🎨', 'Your profile picture has been changed.');
    
  } catch (err) {
    console.error('Error updating avatar:', err);
    showUploadNotification('Error updating avatar!', true);
    showAlert('error', 'Upload Failed! 🌐', 'Unable to upload avatar. Check your connection and try again.');
    
    const loadingDiv = document.querySelector('.upload-loading');
    if (loadingDiv) loadingDiv.remove();
  }
}

/**
 * Atualiza o banner do usuário
 * @param {File} file - Arquivo de imagem
 * @param {string} userId - ID do usuário
 */
export async function updateBanner(file: File, userId: string): Promise<void> {
  try {
    if (!userId) {
      showUploadNotification('Error: User not authenticated', true);
      return;
    }
    
    if (file.size > 10 * 1024 * 1024) {
      showUploadNotification('Image too large! Max 10MB', true);
      showAlert('error', 'File Too Large! 📦', 'Maximum file size is 10MB for banners. Please choose a smaller image.');
      return;
    }
    
    if (!file.type.startsWith('image/')) {
      showUploadNotification('Invalid file type!', true);
      showAlert('error', 'Invalid Format! ❌', 'Please upload an image file (JPG, PNG, GIF).');
      return;
    }
    
    const bannerElement = document.querySelector('.profile-banner');
    if (!bannerElement) return;
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'upload-loading active';
    loadingDiv.innerHTML = '<div class="upload-spinner"></div>';
    bannerElement.appendChild(loadingDiv);
    
    const resizedBlob = await resizeImage(file, 800, 180, false);
    const resizedFile = new File([resizedBlob], file.name, { type: 'image/jpeg' });
    
    const bannerUrl = await uploadToSupabase(resizedFile, 'banner', userId);
    
    const { error: dbError } = await supabase
      .from('player_stats')
      .update({ banner_url: bannerUrl })
      .eq('user_id', userId);
    
    if (dbError) throw dbError;
    
    bannerElement.style.backgroundImage = `url(${bannerUrl}?t=${Date.now()})`;
    bannerElement.style.backgroundSize = 'cover';
    bannerElement.style.backgroundPosition = 'center';
    
    loadingDiv.remove();
    showUploadNotification('Banner updated successfully!');
    showToast('success', 'Banner Updated! 🎨', 'Your profile banner has been changed.');
    
  } catch (err) {
    console.error('Error updating banner:', err);
    showUploadNotification('Error updating banner!', true);
    showAlert('error', 'Upload Failed! 🌐', 'Unable to upload banner. Check your connection and try again.');
    
    const loadingDiv = document.querySelector('.upload-loading');
    if (loadingDiv) loadingDiv.remove();
  }
}

/**
 * Carrega imagens salvas (avatar e banner)
 * @param {string} userId - ID do usuário
 */
export async function loadUserImages(userId: string): Promise<void> {
  try {
    if (!userId) return;
    
    const { data, error } = await supabase
      .from('player_stats')
      .select('avatar_url, banner_url')
      .eq('user_id', userId)
      .single();
    
    if (error) {
      console.error('Error loading user images:', error);
      return;
    }
    
    if (data.avatar_url) {
      const avatarImg = $('profile-avatar');
      const headerAvatar = $('header-avatar');
      const menuAvatar = $('menu-avatar');
      const cacheBust = Date.now();
      
      if (avatarImg) avatarImg.src = data.avatar_url + '?t=' + cacheBust;
      if (headerAvatar) headerAvatar.src = data.avatar_url + '?t=' + cacheBust;
      if (menuAvatar) menuAvatar.src = data.avatar_url + '?t=' + cacheBust;
    }
    
    if (data.banner_url) {
      const bannerElement = document.querySelector('.profile-banner');
      if (bannerElement) {
        bannerElement.style.backgroundImage = `url(${data.banner_url}?t=${Date.now()})`;
        bannerElement.style.backgroundSize = 'cover';
        bannerElement.style.backgroundPosition = 'center';
      }
    }
    
  } catch (err) {
    console.error('Error loading user images:', err);
  }
}

// ============================================================
// PROFILE PANELS
// ============================================================

/**
 * Alterna visibilidade de painéis do profile
 * @param {string} panelType - Tipo do painel ('history', etc)
 * @param {Function} loadDebitHistory - Callback para carregar histórico
 */
export function toggleProfilePanel(panelType: string, loadDebitHistory?: () => void): void {
  const historyPanel = document.getElementById('history-panel');
  
  if (!historyPanel) {
    console.error('Painel de histórico não encontrado');
    return;
  }
  
  if (panelType === 'history') {
    const isHidden = historyPanel.classList.contains('hidden');
    historyPanel.classList.toggle('hidden');
    
    if (isHidden && typeof loadDebitHistory === 'function') {
      loadDebitHistory();
    }
  }
}

/**
 * Alterna dropdown do profile no header
 */
export function toggleProfileDropdown(): void {
  const dropdown = document.getElementById('profile-dropdown');
  if (!dropdown) return;
  
  const isActive = dropdown.classList.contains('active');
  
  if (isActive) {
    // Fechar
    dropdown.classList.remove('active');
    // Garantir que pointer-events está desabilitado
    dropdown.style.pointerEvents = 'none';
  } else {
    // Abrir
    dropdown.classList.add('active');
    // Garantir que pointer-events está habilitado
    dropdown.style.pointerEvents = 'auto';
  }
}

/**
 * Fecha dropdown ao clicar fora
 */
export function setupProfileDropdownClose(): void {
  if (setupProfileDropdownClose._bound) return;
  setupProfileDropdownClose._bound = true;

  document.addEventListener('click', function(e) {
    const container = document.querySelector('.profile-dropdown-container');
    const dropdown = document.getElementById('profile-dropdown');
    
    if (container && dropdown && !container.contains(e.target)) {
      // Garantir que está fechado e não clicável
      dropdown.classList.remove('active');
      dropdown.style.pointerEvents = 'none';
    }
  });
  
  // Adicionar listener de ESC para fechar dropdown
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const dropdown = document.getElementById('profile-dropdown');
      if (dropdown && dropdown.classList.contains('active')) {
        dropdown.classList.remove('active');
        dropdown.style.pointerEvents = 'none';
      }
    }
  });
}
setupProfileDropdownClose._bound = false;

// ============================================================
// EVENT LISTENERS SETUP
// ============================================================

/**
 * Configura event listeners para upload de avatar e banner
 * @param {string} userId - ID do usuário
 */
export function setupProfileUploadListeners(userId: string): void {
  const avatarUploadInput = document.getElementById('avatar-upload');
  const bannerUploadInput = document.getElementById('banner-upload');
  const avatarContainer = document.querySelector('.profile-avatar-container');
  const bannerElement = document.querySelector('.profile-banner');

  // Evitar duplicação de listeners (chamado no login e pode ser chamado mais de uma vez)
  if (avatarContainer && avatarContainer.dataset.bound === '1') return;
  
  // Click no avatar
  if (avatarContainer) {
    avatarContainer.dataset.bound = '1';
    avatarContainer.addEventListener('click', () => {
      if (avatarUploadInput && !avatarUploadInput.disabled) {
        avatarUploadInput.click();
      }
    });
  }
  
  // Click no banner
  if (bannerElement) {
    bannerElement.addEventListener('click', () => {
      if (bannerUploadInput && !bannerUploadInput.disabled) {
        bannerUploadInput.click();
      }
    });
  }
  
  // Upload avatar
  if (avatarUploadInput) {
    avatarUploadInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        updateAvatar(file, userId);
      }
      e.target.value = '';
    });
  }
  
  // Upload banner
  if (bannerUploadInput) {
    bannerUploadInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        updateBanner(file, userId);
      }
      e.target.value = '';
    });
  }
}

// ============================================================
// NAVIGATION
// ============================================================

/**
 * Navega para a tela de perfil
 */
export function goToProfile(): void {
  const dropdown = document.getElementById('profile-dropdown');
  if (dropdown) dropdown.classList.remove('active');
  
  if (window.goTo) {
    window.goTo('profile');
  }
}

// ============================================================
// EXPOR FUNÇÕES GLOBALMENTE
// ============================================================

window.loadProfileData = loadProfileData;
window.updateAvatar = updateAvatar;
window.updateBanner = updateBanner;
window.loadUserImages = loadUserImages;
window.loadPublicProfile = loadPublicProfile;
window.toggleProfilePanel = toggleProfilePanel;
window.toggleProfileDropdown = toggleProfileDropdown;
window.goToProfile = goToProfile;
