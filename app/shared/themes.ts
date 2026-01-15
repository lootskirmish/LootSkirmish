// @ts-nocheck
// ============================================================
// THEMES.TS - Sistema de Temas Premium
// ============================================================

import { supabase } from '../features/auth.js';
import { hexToRgb, showToast, showAlert } from './effects';

export const AVAILABLE_THEMES: any[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Classic dark theme',
    gradient: 'linear-gradient(135deg, #0a0a0f, #1a0a2e, #0f1629)',
    price: 0,
    isNew: false,
    defaultUnlocked: true,
    stickers: [],
    colors: {
      primary: '#5e14a3ff',
      secondary: '#ac18b9ff',
      accent: '#4715faff',
      headerBackground: 'rgba(94, 20, 163, 0.35)',
      headerBorder: 'rgba(94, 20, 163, 0.2)',
      cardBackground: 'rgba(20, 20, 30, 0.8)',
      cardBorder: 'rgba(60, 60, 80, 0.6)',
      cardBorderHover: 'rgba(168, 85, 247, 0.8)',
      cardBorderActive: '#facc15',
      cardShadow: 'rgba(0, 0, 0, 0.4)',
      inputBackground: 'rgba(30, 30, 40, 0.6)',
      inputBorder: 'rgba(100, 100, 120, 0.3)',
      inputBorderFocus: '#a855f7',
      progressBackground: 'rgba(20, 20, 30, 0.9)',
      progressGlow: 'rgba(34, 197, 94, 0.6)',
      modalOverlay: 'rgba(0, 0, 0, 0.85)',
      modalBackground: '#1a1a24',
      modalBorder: 'rgba(168, 85, 247, 0.3)',
      modalShadow: 'rgba(0, 0, 0, 0.5)',
      buttonPrimary: 'linear-gradient(135deg, #a855f7, #ec4899)',
      buttonPrimaryHover: 'linear-gradient(135deg, #9333ea, #db2777)'
    }
  },
  {
    id: 'gold',
    name: 'Golden Luxury',
    description: 'Premium gold theme',
    gradient: 'linear-gradient(135deg, #2d2210, #4a3515, #3d2a12)',
    price: 100,
    isNew: false,
    defaultUnlocked: false,
    stickers: [
      {
        image: 'https://i.imgur.com/gold-coin.png',
        position: 'top-right',
        size: 'medium',
        effects: ['pulse', 'glow']
      },
      {
        image: 'https://i.imgur.com/diamond-icon.png',
        position: 'bottom-right',
        size: 'small',
        effects: ['rotate']
      }
    ],
    colors: {
      primary: '#eab308',
      secondary: '#facc15',
      accent: '#fbbf24',
      headerBackground: 'rgba(234, 179, 8, 0.35)',
      headerBorder: 'rgba(234, 179, 8, 0.2)',
      cardBackground: 'rgba(74, 53, 21, 0.7)',
      cardBorder: 'rgba(234, 179, 8, 0.35)',
      cardBorderHover: 'rgba(250, 204, 21, 0.6)',
      cardBorderActive: '#eab308',
      cardShadow: 'rgba(234, 179, 8, 0.3)',
      inputBackground: 'rgba(45, 34, 16, 0.6)',
      inputBorder: 'rgba(234, 179, 8, 0.3)',
      inputBorderFocus: '#facc15',
      progressBackground: 'rgba(45, 34, 16, 0.9)',
      progressGlow: 'rgba(234, 179, 8, 0.8)',
      modalOverlay: 'rgba(45, 34, 16, 0.85)',
      modalBackground: '#2d2210',
      modalBorder: 'rgba(234, 179, 8, 0.4)',
      modalShadow: 'rgba(234, 179, 8, 0.3)',
      buttonPrimary: 'linear-gradient(135deg, #eab308, #facc15)',
      buttonPrimaryHover: 'linear-gradient(135deg, #ca8a04, #eab308)'
    }
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Neon lights and futuristic vibes',
    gradient: 'linear-gradient(135deg, #0f0f23, #1a0a2e, #2d1b4e)',
    price: 100,
    isNew: true,
    defaultUnlocked: false,
    stickers: [
      { image: 'city.png', position: 'top-right', size: 'large', effects: ['glow'] },
      { image: 'eye.png', position: 'bottom-left', size: 'large', effects: ['pulse'] },
      { image: 'sword.png', position: 'center-right', size: 'medium', effects: ['rotate'] },
      { image: 'cyberpunk.png', position: 'top-left', size: 'medium', effects: ['glow'] }
    ],
    colors: {
      primary: '#a855f7',
      secondary: '#ec4899',
      accent: '#06b6d4',
      headerBackground: 'rgba(168, 85, 247, 0.4)',
      headerBorder: 'rgba(168, 85, 247, 0.3)',
      cardBackground: 'rgba(15, 15, 35, 0.8)',
      cardBorder: 'rgba(168, 85, 247, 0.4)',
      cardBorderHover: 'rgba(236, 72, 153, 0.6)',
      cardBorderActive: '#06b6d4',
      cardShadow: 'rgba(168, 85, 247, 0.3)',
      inputBackground: 'rgba(15, 15, 35, 0.7)',
      inputBorder: 'rgba(168, 85, 247, 0.3)',
      inputBorderFocus: '#ec4899',
      progressBackground: 'rgba(15, 15, 35, 0.9)',
      progressGlow: 'rgba(6, 182, 212, 0.8)',
      modalOverlay: 'rgba(15, 15, 35, 0.9)',
      modalBackground: '#0f0f23',
      modalBorder: 'rgba(168, 85, 247, 0.5)',
      modalShadow: 'rgba(168, 85, 247, 0.4)',
      buttonPrimary: 'linear-gradient(135deg, #ec4899, #a855f7)',
      buttonPrimaryHover: 'linear-gradient(135deg, #db2777, #9333ea)'
    }
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm orange and pink tones',
    gradient: 'linear-gradient(135deg, #2d1810, #4a1f1a, #3d1a25)',
    price: 100,
    isNew: false,
    defaultUnlocked: false,
    stickers: [],
    colors: {
      primary: '#f97316',
      secondary: '#ec4899',
      accent: '#facc15',
      headerBackground: 'rgba(249, 115, 22, 0.35)',
      headerBorder: 'rgba(249, 115, 22, 0.2)',
      cardBackground: 'rgba(74, 31, 26, 0.7)',
      cardBorder: 'rgba(249, 115, 22, 0.35)',
      cardBorderHover: 'rgba(236, 72, 153, 0.6)',
      cardBorderActive: '#f97316',
      cardShadow: 'rgba(249, 115, 22, 0.3)',
      inputBackground: 'rgba(45, 24, 16, 0.6)',
      inputBorder: 'rgba(249, 115, 22, 0.3)',
      inputBorderFocus: '#ec4899',
      progressBackground: 'rgba(45, 24, 16, 0.9)',
      progressGlow: 'rgba(249, 115, 22, 0.8)',
      modalOverlay: 'rgba(45, 24, 16, 0.85)',
      modalBackground: '#2d1810',
      modalBorder: 'rgba(249, 115, 22, 0.4)',
      modalShadow: 'rgba(249, 115, 22, 0.3)',
      buttonPrimary: 'linear-gradient(135deg, #f97316, #ec4899)',
      buttonPrimaryHover: 'linear-gradient(135deg, #ea580c, #db2777)'
    }
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Cool green and nature tones',
    gradient: 'linear-gradient(135deg, #1a2d1a, #1f3f1f, #2d4a2d)',
    price: 100,
    isNew: false,
    defaultUnlocked: false,
    stickers: [],
    colors: {
      primary: '#22c55e',
      secondary: '#16a34a',
      accent: '#4ade80',
      headerBackground: 'rgba(34, 197, 94, 0.35)',
      headerBorder: 'rgba(34, 197, 94, 0.2)',
      cardBackground: 'rgba(31, 63, 31, 0.7)',
      cardBorder: 'rgba(34, 197, 94, 0.35)',
      cardBorderHover: 'rgba(74, 222, 128, 0.6)',
      cardBorderActive: '#22c55e',
      cardShadow: 'rgba(34, 197, 94, 0.3)',
      inputBackground: 'rgba(26, 45, 26, 0.6)',
      inputBorder: 'rgba(34, 197, 94, 0.3)',
      inputBorderFocus: '#4ade80',
      progressBackground: 'rgba(26, 45, 26, 0.9)',
      progressGlow: 'rgba(34, 197, 94, 0.8)',
      modalOverlay: 'rgba(26, 45, 26, 0.85)',
      modalBackground: '#1a2d1a',
      modalBorder: 'rgba(34, 197, 94, 0.4)',
      modalShadow: 'rgba(34, 197, 94, 0.3)',
      buttonPrimary: 'linear-gradient(135deg, #22c55e, #4ade80)',
      buttonPrimaryHover: 'linear-gradient(135deg, #16a34a, #22c55e)'
    }
  },
  {
    id: 'miku',
    name: 'Miku',
    description: 'Inspired by vocaloid aesthetics',
    gradient: 'linear-gradient(135deg, #0f1a1f, #1a2e3f, #2d3a4f)',
    price: 150,
    isNew: true,
    defaultUnlocked: false,
    stickers: [
      { image: 'miku1.png', position: 'top-right', size: 'large', effects: ['bounce'] },
      { image: 'miku2.png', position: 'bottom-left', size: 'medium', effects: ['rotate'] }
    ],
    colors: {
      primary: '#00d4ff',
      secondary: '#0099cc',
      accent: '#00ffff',
      headerBackground: 'rgba(0, 212, 255, 0.35)',
      headerBorder: 'rgba(0, 212, 255, 0.2)',
      cardBackground: 'rgba(26, 46, 63, 0.7)',
      cardBorder: 'rgba(0, 212, 255, 0.35)',
      cardBorderHover: 'rgba(0, 255, 255, 0.6)',
      cardBorderActive: '#00d4ff',
      cardShadow: 'rgba(0, 212, 255, 0.3)',
      inputBackground: 'rgba(15, 26, 31, 0.6)',
      inputBorder: 'rgba(0, 212, 255, 0.3)',
      inputBorderFocus: '#00ffff',
      progressBackground: 'rgba(15, 26, 31, 0.9)',
      progressGlow: 'rgba(0, 212, 255, 0.8)',
      modalOverlay: 'rgba(15, 26, 31, 0.85)',
      modalBackground: '#0f1a1f',
      modalBorder: 'rgba(0, 212, 255, 0.4)',
      modalShadow: 'rgba(0, 212, 255, 0.3)',
      buttonPrimary: 'linear-gradient(135deg, #00d4ff, #0099cc)',
      buttonPrimaryHover: 'linear-gradient(135deg, #00b3e6, #007acc)'
    }
  }
];

let currentTheme = AVAILABLE_THEMES[0];
let themeModal = null;
let purchaseModal = null;

export function applyTheme(themeId: string): void {
  const theme = AVAILABLE_THEMES.find(t => t.id === themeId);
  if (!theme) return;
  
  currentTheme = theme;
  
  const root = document.documentElement;
  const colors = theme.colors;
  
  Object.keys(colors).forEach(key => {
    root.style.setProperty(`--color-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, colors[key]);
  });
  
  document.body.style.background = theme.gradient;
  localStorage.setItem('selectedTheme', themeId);
}

export async function loadInitialTheme(): Promise<void> {
  const saved = localStorage.getItem('selectedTheme') || 'default';
  const theme = AVAILABLE_THEMES.find(t => t.id === saved);
  
  if (theme) {
    applyTheme(theme.id);
  }
}

export async function loadUserThemes(): Promise<void> {
  if (!supabase) return;
  
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { data, error } = await supabase
      .from('user_themes')
      .select('theme_id')
      .eq('user_id', user.id);
    
    if (!error && data) {
      const unlockedIds = data.map(d => d.theme_id);
      AVAILABLE_THEMES.forEach(theme => {
        if (theme.defaultUnlocked || unlockedIds.includes(theme.id)) {
          theme.defaultUnlocked = true;
        }
      });
    }
  } catch (err) {
    console.error('Erro ao carregar temas do usuário:', err);
  }
}

export function openThemePurchaseModal(themeId: string): void {
  const theme = AVAILABLE_THEMES.find(t => t.id === themeId);
  if (!theme) return;
  
  purchaseModal = document.getElementById('theme-purchase-modal') || createPurchaseModal();
  
  const title = purchaseModal.querySelector('.modal-title');
  const desc = purchaseModal.querySelector('.theme-description');
  const price = purchaseModal.querySelector('.theme-price');
  
  if (title) title.textContent = `Unlock: ${theme.name}`;
  if (desc) desc.textContent = theme.description;
  if (price) price.textContent = `💎 ${theme.price} diamonds`;
  
  purchaseModal.dataset.themeId = themeId;
  purchaseModal.classList.add('active');
}

export function closeThemePurchaseModal(): void {
  if (purchaseModal) {
    purchaseModal.classList.remove('active');
  }
}

export async function confirmThemePurchase(): Promise<void> {
  if (!purchaseModal) return;
  
  const themeId = purchaseModal.dataset.themeId;
  if (!themeId) return;
  
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const theme = AVAILABLE_THEMES.find(t => t.id === themeId);
    if (!theme) return;
    
    const { data, error } = await supabase
      .from('profiles')
      .select('diamonds')
      .eq('id', user.id)
      .single();
    
    if (error || !data || data.diamonds < theme.price) {
      showAlert('error', 'Insufficient diamonds', 'You need more diamonds to purchase this theme.');
      return;
    }
    
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ diamonds: data.diamonds - theme.price })
      .eq('id', user.id);
    
    if (updateError) throw updateError;
    
    const { error: insertError } = await supabase
      .from('user_themes')
      .insert([{ user_id: user.id, theme_id: themeId }]);
    
    if (insertError) throw insertError;
    
    theme.defaultUnlocked = true;
    showToast('success', 'Theme Unlocked!', `You've unlocked the ${theme.name} theme!`);
    closeThemePurchaseModal();
  } catch (err) {
    console.error('Erro ao comprar tema:', err);
    showAlert('error', 'Purchase Failed', 'An error occurred while unlocking the theme.');
  }
}

export async function activateTheme(themeId: string): Promise<void> {
  const theme = AVAILABLE_THEMES.find(t => t.id === themeId);
  if (!theme) return;
  
  if (!theme.defaultUnlocked) {
    openThemePurchaseModal(themeId);
    return;
  }
  
  applyTheme(themeId);
  showToast('success', 'Theme Activated', `${theme.name} theme is now active!`);
}

export function loadSavedColors(): void {
  const saved = localStorage.getItem('selectedTheme') || 'default';
  applyTheme(saved);
}

function createPurchaseModal(): HTMLElement {
  const modal = document.createElement('div');
  modal.id = 'theme-purchase-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <button class="modal-close" onclick="window.closeThemePurchaseModal()">×</button>
      <div class="modal-title">Unlock Theme</div>
      <div class="theme-description"></div>
      <div class="theme-price"></div>
      <button class="btn btn-primary" onclick="window.confirmThemePurchase()">Confirm Purchase</button>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}
