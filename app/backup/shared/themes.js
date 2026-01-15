// ============================================================
// THEMES.JS - Sistema de Temas Premium
// ============================================================

import { supabase } from '../features/auth.js';
import { hexToRgb, showToast, showAlert } from './effects.js';

export const AVAILABLE_THEMES = [
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
      // ============ BASE ============
      primary: '#5e14a3ff',
      secondary: '#ac18b9ff',
      accent: '#4715faff',
      
      // ============ HEADER ============
      headerBackground: 'rgba(94, 20, 163, 0.35)',
      headerBorder: 'rgba(94, 20, 163, 0.2)',
      
      // ============ CARDS ============
      cardBackground: 'rgba(20, 20, 30, 0.8)',
      cardBorder: 'rgba(60, 60, 80, 0.6)',
      cardBorderHover: 'rgba(168, 85, 247, 0.8)',
      cardBorderActive: '#facc15',
      cardShadow: 'rgba(0, 0, 0, 0.4)',
      
      // ============ INPUTS ============
      inputBackground: 'rgba(30, 30, 40, 0.6)',
      inputBorder: 'rgba(100, 100, 120, 0.3)',
      inputBorderFocus: '#a855f7',
      
      // ============ PROGRESS ============
      progressBackground: 'rgba(20, 20, 30, 0.9)',
      progressGlow: 'rgba(34, 197, 94, 0.6)',
      
      // ============ MODAIS ============
      modalOverlay: 'rgba(0, 0, 0, 0.85)',
      modalBackground: '#1a1a24',
      modalBorder: 'rgba(168, 85, 247, 0.3)',
      modalShadow: 'rgba(0, 0, 0, 0.5)',
      
      // ============ BOTÕES ============
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
      {
        image: 'city.png', // Símbolo cyber
        position: 'top-right',
        size: 'large',
        effects: ['glow']
      },
      {
        image: 'eye.png', // Grid cyber
        position: 'bottom-left',
        size: 'large',
        effects: ['pulse']
      },
      {
        image: 'sword.png',
        position: 'center-right',
        size: 'medium',
        effects: ['rotate']
      },
      {
        image: 'cyberpunk.png',
        position: 'top-left',
        size: 'medium',
        effects: ['glow']
      }
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
    id: 'ocean',
    name: 'Deep Ocean',
    description: 'Dive into the blue depths',
    gradient: 'linear-gradient(135deg, #051429, #0a2540, #0d1f3c)',
    price: 100,
    isNew: false,
    defaultUnlocked: false,
    stickers: [],
    colors: {
      primary: '#0ea5e9',
      secondary: '#06b6d4',
      accent: '#22d3ee',
      
      headerBackground: 'rgba(14, 165, 233, 0.35)',
      headerBorder: 'rgba(14, 165, 233, 0.2)',
      
      cardBackground: 'rgba(10, 37, 64, 0.7)',
      cardBorder: 'rgba(14, 165, 233, 0.35)',
      cardBorderHover: 'rgba(6, 182, 212, 0.6)',
      cardBorderActive: '#0ea5e9',
      cardShadow: 'rgba(14, 165, 233, 0.3)',
      
      inputBackground: 'rgba(5, 20, 41, 0.6)',
      inputBorder: 'rgba(14, 165, 233, 0.3)',
      inputBorderFocus: '#06b6d4',
      
      progressBackground: 'rgba(5, 20, 41, 0.9)',
      progressGlow: 'rgba(14, 165, 233, 0.8)',
      
      modalOverlay: 'rgba(5, 20, 41, 0.85)',
      modalBackground: '#051429',
      modalBorder: 'rgba(14, 165, 233, 0.4)',
      modalShadow: 'rgba(14, 165, 233, 0.3)',
      
      buttonPrimary: 'linear-gradient(135deg, #0ea5e9, #06b6d4)',
      buttonPrimaryHover: 'linear-gradient(135deg, #0284c7, #0891b2)'
    }
  },
  
  {
    id: 'forest',
    name: 'Dark Forest',
    description: 'Mysterious green tones',
    gradient: 'linear-gradient(135deg, #0a1f0a, #142814, #0f1f0f)',
    price: 100,
    isNew: false,
    defaultUnlocked: false,
    stickers: [
      {
        image: 'https://i.imgur.com/leaf-icon.png',
        position: 'top-left',
        size: 'medium'
      }
    ],
    colors: {
      primary: '#22c55e',
      secondary: '#10b981',
      accent: '#84cc16',
      
      headerBackground: 'rgba(34, 197, 94, 0.35)',
      headerBorder: 'rgba(34, 197, 94, 0.2)',
      
      cardBackground: 'rgba(20, 40, 20, 0.7)',
      cardBorder: 'rgba(34, 197, 94, 0.35)',
      cardBorderHover: 'rgba(16, 185, 129, 0.6)',
      cardBorderActive: '#22c55e',
      cardShadow: 'rgba(34, 197, 94, 0.3)',
      
      inputBackground: 'rgba(10, 31, 10, 0.6)',
      inputBorder: 'rgba(34, 197, 94, 0.3)',
      inputBorderFocus: '#10b981',
      
      progressBackground: 'rgba(10, 31, 10, 0.9)',
      progressGlow: 'rgba(34, 197, 94, 0.8)',
      
      modalOverlay: 'rgba(10, 31, 10, 0.85)',
      modalBackground: '#0a1f0a',
      modalBorder: 'rgba(34, 197, 94, 0.4)',
      modalShadow: 'rgba(34, 197, 94, 0.3)',
      
      buttonPrimary: 'linear-gradient(135deg, #22c55e, #10b981)',
      buttonPrimaryHover: 'linear-gradient(135deg, #16a34a, #059669)'
    }
  },
  
  {
    id: 'royal',
    name: 'Royal Purple',
    description: 'Elegant and luxurious',
    gradient: 'linear-gradient(135deg, #1a0a2e, #2d1b4e, #1f0f3d)',
    price: 100,
    isNew: false,
    defaultUnlocked: false,
    stickers: [
      {
        image: 'https://i.imgur.com/crown-icon.png',
        position: 'top-right',
        size: 'medium',
        effects: ['pulse', 'glow']
      }
    ],
    colors: {
      primary: '#9333ea',
      secondary: '#a855f7',
      accent: '#c084fc',
      
      headerBackground: 'rgba(147, 51, 234, 0.35)',
      headerBorder: 'rgba(147, 51, 234, 0.2)',
      
      cardBackground: 'rgba(45, 27, 78, 0.7)',
      cardBorder: 'rgba(147, 51, 234, 0.35)',
      cardBorderHover: 'rgba(168, 85, 247, 0.6)',
      cardBorderActive: '#9333ea',
      cardShadow: 'rgba(147, 51, 234, 0.3)',
      
      inputBackground: 'rgba(26, 10, 46, 0.6)',
      inputBorder: 'rgba(147, 51, 234, 0.3)',
      inputBorderFocus: '#a855f7',
      
      progressBackground: 'rgba(26, 10, 46, 0.9)',
      progressGlow: 'rgba(147, 51, 234, 0.8)',
      
      modalOverlay: 'rgba(26, 10, 46, 0.85)',
      modalBackground: '#1a0a2e',
      modalBorder: 'rgba(147, 51, 234, 0.4)',
      modalShadow: 'rgba(147, 51, 234, 0.3)',
      
      buttonPrimary: 'linear-gradient(135deg, #9333ea, #a855f7)',
      buttonPrimaryHover: 'linear-gradient(135deg, #7e22ce, #9333ea)'
    }
  },
  
  {
    id: 'blood-moon',
    name: 'Blood Moon',
    description: 'Dark red and crimson',
    gradient: 'linear-gradient(135deg, #1a0505, #2d0a0a, #1f0808)',
    price: 100,
    isNew: false,
    defaultUnlocked: false,
    stickers: [
      {
        image: 'https://i.imgur.com/red-moon.png',
        position: 'top-right',
        size: 'large',
        effects: ['glow']
      }
    ],
    colors: {
      primary: '#dc2626',
      secondary: '#ef4444',
      accent: '#f87171',
      
      headerBackground: 'rgba(220, 38, 38, 0.35)',
      headerBorder: 'rgba(220, 38, 38, 0.2)',
      
      cardBackground: 'rgba(45, 10, 10, 0.7)',
      cardBorder: 'rgba(220, 38, 38, 0.35)',
      cardBorderHover: 'rgba(239, 68, 68, 0.6)',
      cardBorderActive: '#dc2626',
      cardShadow: 'rgba(220, 38, 38, 0.3)',
      
      inputBackground: 'rgba(26, 5, 5, 0.6)',
      inputBorder: 'rgba(220, 38, 38, 0.3)',
      inputBorderFocus: '#ef4444',
      
      progressBackground: 'rgba(26, 5, 5, 0.9)',
      progressGlow: 'rgba(220, 38, 38, 0.8)',
      
      modalOverlay: 'rgba(26, 5, 5, 0.85)',
      modalBackground: '#1a0505',
      modalBorder: 'rgba(220, 38, 38, 0.4)',
      modalShadow: 'rgba(220, 38, 38, 0.3)',
      
      buttonPrimary: 'linear-gradient(135deg, #dc2626, #ef4444)',
      buttonPrimaryHover: 'linear-gradient(135deg, #b91c1c, #dc2626)'
    }
  },
  
  {
    id: 'aurora',
    name: 'Aurora Borealis',
    description: 'Northern lights magic',
    gradient: 'linear-gradient(135deg, #0a1a1f, #1a2a3f, #0f1f2f)',
    price: 150,
    isNew: true,
    defaultUnlocked: false,
    stickers: [],
    colors: {
      primary: '#06b6d4',
      secondary: '#8b5cf6',
      accent: '#10b981',
      
      headerBackground: 'rgba(6, 182, 212, 0.35)',
      headerBorder: 'rgba(6, 182, 212, 0.2)',
      
      cardBackground: 'rgba(26, 42, 63, 0.7)',
      cardBorder: 'rgba(6, 182, 212, 0.35)',
      cardBorderHover: 'rgba(139, 92, 246, 0.6)',
      cardBorderActive: '#06b6d4',
      cardShadow: 'rgba(6, 182, 212, 0.3)',
      
      inputBackground: 'rgba(10, 26, 31, 0.6)',
      inputBorder: 'rgba(6, 182, 212, 0.3)',
      inputBorderFocus: '#8b5cf6',
      
      progressBackground: 'rgba(10, 26, 31, 0.9)',
      progressGlow: 'rgba(6, 182, 212, 0.8)',
      
      modalOverlay: 'rgba(10, 26, 31, 0.85)',
      modalBackground: '#0a1a1f',
      modalBorder: 'rgba(6, 182, 212, 0.4)',
      modalShadow: 'rgba(6, 182, 212, 0.3)',
      
      buttonPrimary: 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
      buttonPrimaryHover: 'linear-gradient(135deg, #0891b2, #7c3aed)'
    }
  },
  
  {
    id: 'galaxy',
    name: 'Deep Galaxy',
    description: 'Stars and cosmic dust',
    gradient: 'linear-gradient(135deg, #0f0520, #1a0a35, #120828)',
    price: 150,
    isNew: true,
    defaultUnlocked: false,
    stickers: [
      {
        image: 'https://i.imgur.com/star-icon.png',
        position: 'top-right',
        size: 'small',
        effects: ['pulse']
      },
      {
        image: 'https://i.imgur.com/planet-icon.png',
        position: 'bottom-left',
        size: 'medium',
        effects: ['rotate']
      }
    ],
    colors: {
      primary: '#8b5cf6',
      secondary: '#a855f7',
      accent: '#ec4899',
      
      headerBackground: 'rgba(139, 92, 246, 0.35)',
      headerBorder: 'rgba(139, 92, 246, 0.2)',
      
      cardBackground: 'rgba(26, 10, 53, 0.7)',
      cardBorder: 'rgba(139, 92, 246, 0.35)',
      cardBorderHover: 'rgba(168, 85, 247, 0.6)',
      cardBorderActive: '#8b5cf6',
      cardShadow: 'rgba(139, 92, 246, 0.3)',
      
      inputBackground: 'rgba(15, 5, 32, 0.6)',
      inputBorder: 'rgba(139, 92, 246, 0.3)',
      inputBorderFocus: '#a855f7',
      
      progressBackground: 'rgba(15, 5, 32, 0.9)',
      progressGlow: 'rgba(139, 92, 246, 0.8)',
      
      modalOverlay: 'rgba(15, 5, 32, 0.85)',
      modalBackground: '#0f0520',
      modalBorder: 'rgba(139, 92, 246, 0.4)',
      modalShadow: 'rgba(139, 92, 246, 0.3)',
      
      buttonPrimary: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
      buttonPrimaryHover: 'linear-gradient(135deg, #7c3aed, #db2777)'
    }
  },
  
  {
    id: 'sakura',
    name: 'Cherry Blossom',
    description: 'Soft pink Japanese spring',
    gradient: 'linear-gradient(135deg, #1f0a1a, #2d1520, #1f0f1a)',
    price: 150,
    isNew: true,
    defaultUnlocked: false,
    stickers: [
      {
        image: 'https://i.imgur.com/sakura-flower.png',
        position: 'top-right',
        size: 'medium'
      },
      {
        image: 'https://i.imgur.com/sakura-petals.png',
        position: 'bottom-left',
        size: 'small'
      }
    ],
    colors: {
      primary: '#ec4899',
      secondary: '#f472b6',
      accent: '#fda4af',
      
      headerBackground: 'rgba(236, 72, 153, 0.35)',
      headerBorder: 'rgba(236, 72, 153, 0.2)',
      
      cardBackground: 'rgba(45, 21, 32, 0.7)',
      cardBorder: 'rgba(236, 72, 153, 0.35)',
      cardBorderHover: 'rgba(244, 114, 182, 0.6)',
      cardBorderActive: '#ec4899',
      cardShadow: 'rgba(236, 72, 153, 0.3)',
      
      inputBackground: 'rgba(31, 10, 26, 0.6)',
      inputBorder: 'rgba(236, 72, 153, 0.3)',
      inputBorderFocus: '#f472b6',
      
      progressBackground: 'rgba(31, 10, 26, 0.9)',
      progressGlow: 'rgba(236, 72, 153, 0.8)',
      
      modalOverlay: 'rgba(31, 10, 26, 0.85)',
      modalBackground: '#1f0a1a',
      modalBorder: 'rgba(236, 72, 153, 0.4)',
      modalShadow: 'rgba(236, 72, 153, 0.3)',
      
      buttonPrimary: 'linear-gradient(135deg, #ec4899, #f472b6)',
      buttonPrimaryHover: 'linear-gradient(135deg, #db2777, #ec4899)'
    }
  },

  {
    id: 'miku',
    name: 'Hatsune Miku',
    description: 'Inspired by the virtual diva 🎤',
    gradient: 'linear-gradient(135deg, #4bb4ffff, #003557ff, #007dc5ff)',
    price: 500,
    isNew: true,
    defaultUnlocked: false,
    stickers: [
      {
        image: 'kind.png',
        position: 'top-right',
        size: 'large',
        effects: ['glow']
      },
      {
        image: 'mikucutting.gif',
        position: 'bottom-center',
        size: 'medium',
        effects: ['glow', 'pulse', 'rotate']
      },
      {
        image: 'drawingmiku.png',
        position: 'bottom-right',
        size: 'medium',
        effects: ['pulse']
      },
      {
        image: 'downmiku.png',
        position: 'top-left',
        size: 'large',
        effects: ['pulse']
      },
      {
        image: 'catupmiku.png',
        position: 'bottom-left',
        size: 'medium',
        effects: ['glow']
      },
      {
        image: 'attackmiku.png',
        position: 'center-right',
        size: 'small',
        effects: ['pulse', 'rotate']
      }
    ],
    colors: {
      primary: '#21948cff',
      secondary: '#005763ff',
      accent: '#2a93a3ff',
      
      headerBackground: 'rgba(49, 190, 181, 0.6)',
      headerBorder: 'rgba(49, 190, 181, 0.4)',
      
      cardBackground: 'rgba(0, 87, 99, 0.6)',
      cardBorder: 'rgba(33, 148, 140, 0.3)',
      cardBorderHover: 'rgba(49, 190, 181, 0.4)',
      cardBorderActive: 'rgba(57, 197, 187, 0.6)',
      cardShadow: 'rgba(33, 148, 140, 0.2)',
      
      inputBackground: 'rgba(0, 53, 87, 0.8)',
      inputBorder: 'rgba(49, 190, 181, 0.5)',
      inputBorderFocus: '#2a93a3',
      
      progressBackground: 'rgba(0, 53, 87, 0.9)',
      progressGlow: 'rgba(49, 190, 181, 0.8)',
      
      modalOverlay: 'rgba(25, 89, 129, 0.85)',
      modalBackground: 'rgba(0, 85, 138, 0.9)',
      modalBorder: 'rgba(49, 190, 181, 0.8)',
      modalShadow: 'rgba(49, 190, 181, 0.5)',
      
      buttonPrimary: 'linear-gradient(135deg, #2cc7bdff, #0099b1ff)',
      buttonPrimaryHover: 'linear-gradient(135deg, #05b3a7ff, #009b90ff)'
    }
  },
];

// ============================================================
// STATE MANAGEMENT
// ============================================================

let selectedThemeForPurchase = null;

// ============================================================
// HELPER PARA STICKERS - Cole no themes.js
// ============================================================

/**
 * Retorna o caminho completo da imagem do sticker
 * @param {string} themeId - ID do tema (ex: 'cyberpunk')
 * @param {string} imageName - Nome da imagem (ex: 'cyber-symbol.png')
 * @returns {string} Caminho completo
 */
function getThemeImagePath(themeId, imageName) {
  return `/images/themes/${themeId}/${imageName}`;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Remove todos os stickers da tela
 */
function removeAllStickers() {
  if (activeStickers.length) {
    for (const sticker of activeStickers) {
      try { sticker.remove(); } catch (_) {}
    }
    activeStickers = [];
    return;
  }

  // Fallback defensivo (caso stickers existam fora do controle do array)
  document.querySelectorAll('.theme-sticker').forEach(sticker => sticker.remove());
}

/**
 * Cria um sticker na tela
 * @param {Object} config - Configuração do sticker
 */
function createSticker(config, themeId) {
  const img = document.createElement('img');
  img.className = 'theme-sticker';
  img.src = getThemeImagePath(themeId, config.image); // ✅ Usa a função
  
  img.classList.add(config.position);
  
  if (config.size) {
    img.classList.add(config.size);
  }
  
  if (config.effects && Array.isArray(config.effects)) {
    config.effects.forEach(effect => {
      img.classList.add(effect);
    });
  }
  
  img.onload = function() {
    setTimeout(() => {
      img.classList.add('loaded');
    }, 100);
  };
  
  document.body.appendChild(img);
  activeStickers.push(img);
}

let activeStickers = [];
let themeByIdCache = null;
let lastAppliedThemeId = null;
let lastSavedThemeId = null;
let loadInitialThemePromise = null;
let initialThemeLoaded = false;

const domByIdCache = Object.create(null);
function getElById(id) {
  const cached = domByIdCache[id];
  if (cached && cached.isConnected) return cached;
  const el = document.getElementById(id);
  if (el) domByIdCache[id] = el;
  return el;
}

function getThemeById(themeId) {
  if (!themeByIdCache) {
    themeByIdCache = new Map(AVAILABLE_THEMES.map(t => [t.id, t]));
  }
  return themeByIdCache.get(themeId);
}

// ============================================================
// THEME APPLICATION
// ============================================================

/**
 * Aplica um tema ao sistema
 * @param {string} themeId - ID do tema
 */
export function applyTheme(themeId) {
  if (!themeId) themeId = 'default';

  if (themeId === lastAppliedThemeId) {
    // Evita reprocessar o mesmo tema repetidamente
    return;
  }

  const theme = getThemeById(themeId);
  if (!theme) {
    console.warn(`⚠️ Tema "${themeId}" não encontrado, aplicando default`);
    applyTheme('default');
    return;
  }
  
  // Aplicar gradient
  document.body.style.background = theme.gradient;
  
  // ✨ CSS VARIABLES
  if (theme.colors) {
    const root = document.documentElement;
    
    // Aplicar cores principais
    root.style.setProperty('--primary-color', theme.colors.primary);
    root.style.setProperty('--secondary-color', theme.colors.secondary);
    root.style.setProperty('--accent-color', theme.colors.accent);
    
    // Converter HEX → RGB para variações com opacity
    const primaryRGB = hexToRgb(theme.colors.primary);
    const secondaryRGB = hexToRgb(theme.colors.secondary);
    const accentRGB = hexToRgb(theme.colors.accent);
    
    root.style.setProperty('--primary-rgb', `${primaryRGB.r}, ${primaryRGB.g}, ${primaryRGB.b}`);
    root.style.setProperty('--secondary-rgb', `${secondaryRGB.r}, ${secondaryRGB.g}, ${secondaryRGB.b}`);
    root.style.setProperty('--accent-rgb', `${accentRGB.r}, ${accentRGB.g}, ${accentRGB.b}`);
    
    // 🎨 APLICAR CORES ESTENDIDAS
    // Header
    if (theme.colors.headerBackground) root.style.setProperty('--header-background', theme.colors.headerBackground);
    if (theme.colors.headerBorder) root.style.setProperty('--header-border', theme.colors.headerBorder);
    
    // Cards
    if (theme.colors.cardBackground) root.style.setProperty('--card-background', theme.colors.cardBackground);
    if (theme.colors.cardBorder) root.style.setProperty('--card-border', theme.colors.cardBorder);
    if (theme.colors.cardBorderHover) root.style.setProperty('--card-border-hover', theme.colors.cardBorderHover);
    if (theme.colors.cardBorderActive) root.style.setProperty('--card-border-active', theme.colors.cardBorderActive);
    if (theme.colors.cardShadow) root.style.setProperty('--card-shadow', theme.colors.cardShadow);
    
    // Inputs
    if (theme.colors.inputBackground) root.style.setProperty('--input-background', theme.colors.inputBackground);
    if (theme.colors.inputBorder) root.style.setProperty('--input-border', theme.colors.inputBorder);
    if (theme.colors.inputBorderFocus) root.style.setProperty('--input-border-focus', theme.colors.inputBorderFocus);
    
    // Progress
    if (theme.colors.progressBackground) root.style.setProperty('--progress-background', theme.colors.progressBackground);
    if (theme.colors.progressGlow) root.style.setProperty('--progress-glow', theme.colors.progressGlow);
    
    // Modals
    if (theme.colors.modalOverlay) root.style.setProperty('--modal-overlay', theme.colors.modalOverlay);
    if (theme.colors.modalBackground) root.style.setProperty('--modal-background', theme.colors.modalBackground);
    if (theme.colors.modalBorder) root.style.setProperty('--modal-border', theme.colors.modalBorder);
    if (theme.colors.modalShadow) root.style.setProperty('--modal-shadow', theme.colors.modalShadow);
    
    // Buttons
    if (theme.colors.buttonPrimary) root.style.setProperty('--button-primary', theme.colors.buttonPrimary);
    if (theme.colors.buttonPrimaryHover) root.style.setProperty('--button-primary-hover', theme.colors.buttonPrimaryHover);
  }
  
  // Remover adesivos antigos
  removeAllStickers();
  
  // Criar novos adesivos (se houver)
  if (theme.stickers && theme.stickers.length > 0) {
    theme.stickers.forEach(stickerConfig => {
      createSticker(stickerConfig, theme.id); // ✅ Passa o themeId
    });
  }
  
  // Salvar no localStorage também
  if (lastSavedThemeId === null) {
    try { lastSavedThemeId = localStorage.getItem('activeTheme'); } catch (_) { lastSavedThemeId = ''; }
  }
  if (lastSavedThemeId !== themeId) {
    try {
      localStorage.setItem('activeTheme', themeId);
      lastSavedThemeId = themeId;
    } catch (_) {
      // ignore
    }
  }

  lastAppliedThemeId = themeId;
}

/**
 * Carrega o tema inicial (localStorage ou banco)
 */
export async function loadInitialTheme() {
  if (initialThemeLoaded) return;
  if (loadInitialThemePromise) return loadInitialThemePromise;

  loadInitialThemePromise = (async () => {
    // 1. Verificar localStorage primeiro (mais rápido)
    let localTheme = null;
    try { localTheme = localStorage.getItem('activeTheme'); } catch (_) { localTheme = null; }
    if (localTheme) {
      applyTheme(localTheme);
      initialThemeLoaded = true;
      return;
    }

    // 2. Se estiver logado, buscar do banco
    if (window.currentUser?.id) {
      try {
        const { data: userData, error } = await supabase
          .from('player_stats')
          .select('active_theme, unlocked_themes')
          .eq('user_id', window.currentUser.id)
          .single();

        if (!error && userData) {
          const activeTheme = userData.active_theme;
          const unlockedThemes = userData.unlocked_themes || ['default'];

          // Verificar se o tema ainda está desbloqueado
          if (activeTheme && unlockedThemes.includes(activeTheme)) {
            applyTheme(activeTheme);
            initialThemeLoaded = true;
            return;
          }

          console.warn('⚠️ Tema não desbloqueado, aplicando default');
          applyTheme('default');

          // Atualizar banco para default
          await supabase
            .from('player_stats')
            .update({ active_theme: 'default' })
            .eq('user_id', window.currentUser.id);

          initialThemeLoaded = true;
          return;
        }
      } catch (err) {
        console.error('❌ Erro ao buscar tema do banco:', err);
      }
    }

    // 3. Fallback: aplicar tema default
    applyTheme('default');
    initialThemeLoaded = true;
  })().finally(() => {
    loadInitialThemePromise = null;
  });

  return loadInitialThemePromise;
}

// ============================================================
// USER THEMES MANAGEMENT
// ============================================================

/**
 * Carrega os temas do usuário
 */
export async function loadUserThemes() {
  try {
    if (!window.currentUser?.id) {
      console.warn('⚠️ User not authenticated');
      return;
    }
    
    // Buscar themes desbloqueados e theme ativo
    const { data: userData, error } = await supabase
      .from('player_stats')
      .select('unlocked_themes, active_theme')
      .eq('user_id', window.currentUser.id)
      .single();
    
if (error) {
      console.error('Error to load themes:', error);
      showAlert('error', 'Loading Failed! 🎨', 'Unable to load themes. Please refresh the page.');
      return;
    }
    
    const unlockedThemes = userData?.unlocked_themes || ['default'];
    const activeTheme = userData?.active_theme || 'default';
    
    // Renderizar grid
    renderThemesGrid(unlockedThemes, activeTheme);
    
    // Aplicar theme ativo
    applyTheme(activeTheme);
    
  } catch (err) {
    console.error('Erro:', err);
  }
}

/**
 * Renderiza o grid de temas
 * @param {Array} unlockedThemes - Temas desbloqueados
 * @param {string} activeTheme - Tema ativo
 */
function renderThemesGrid(unlockedThemes, activeTheme) {
  const grid = getElById('themes-grid');
  if (!grid) return;

  const unlockedSet = new Set(Array.isArray(unlockedThemes) ? unlockedThemes : []);
  
  // Atualizar contador
  const ownedCount = unlockedSet.size;
  const totalCount = AVAILABLE_THEMES.length;
  const ownedCountElement = getElById('themes-owned-count');
  if (ownedCountElement) {
    ownedCountElement.textContent = `${ownedCount}/${totalCount} owned`;
  }
  
  // Atualizar display de diamantes
  const diamondsDisplay = getElById('player-diamonds-display');
  if (diamondsDisplay) {
    const diamondsValue = window.playerDiamonds?.value;
    if (diamondsValue !== undefined) diamondsDisplay.textContent = diamondsValue;
  }
  
  grid.innerHTML = AVAILABLE_THEMES.map(theme => {
    const isUnlocked = unlockedSet.has(theme.id);
    const isActive = activeTheme === theme.id;
    
    return `
      <div class="theme-card ${!isUnlocked ? 'locked' : ''} ${isActive ? 'active' : ''}" 
           onclick="${isUnlocked ? `activateTheme('${theme.id}')` : `openThemePurchaseModal('${theme.id}')`}">
        
        ${theme.isNew ? '<div class="theme-new-badge">NEW</div>' : ''}
        
        ${isActive ? '<div class="theme-status-badge active">✓ ACTIVE</div>' : ''}
        ${isUnlocked && !isActive ? '<div class="theme-status-badge owned">OWNED</div>' : ''}
        
        <div class="theme-preview" style="background: ${theme.gradient}"></div>
        
        ${!isUnlocked ? `
          <div class="theme-lock-overlay">
            <div class="theme-lock-icon">🔒</div>
            <div class="theme-price">
              <span>${theme.price}</span>
              <span>💎</span>
            </div>
          </div>
        ` : ''}
        
        <div class="theme-info">
          <div class="theme-name">${theme.name}</div>
          <div class="theme-description">${theme.description}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// THEME PURCHASE MODAL
// ============================================================

/**
 * Abre modal de compra de tema
 * @param {string} themeId - ID do tema
 */
export function openThemePurchaseModal(themeId) {
  const theme = getThemeById(themeId);
  if (!theme) return;
  
  selectedThemeForPurchase = theme;
  
  // Preencher modal
  const preview = getElById('modal-theme-preview');
  const nameEl = getElById('modal-theme-name');
  const descEl = getElById('modal-theme-desc');
  const priceEl = getElById('modal-theme-price');
  const diamondsEl = getElById('modal-player-diamonds');

  if (preview) preview.style.background = theme.gradient;
  if (nameEl) nameEl.textContent = theme.name;
  if (descEl) descEl.textContent = theme.description;
  if (priceEl) priceEl.textContent = theme.price;

  const diamonds = Number(window.playerDiamonds?.value ?? 0);
  if (diamondsEl) diamondsEl.textContent = diamonds;

  const balanceCheck = getElById('modal-balance-check');
  const confirmBtn = getElById('confirm-purchase-btn');
  const canAfford = diamonds >= Number(theme.price ?? 0);
  if (balanceCheck) balanceCheck.classList.toggle('insufficient', !canAfford);
  if (confirmBtn) confirmBtn.disabled = !canAfford;
  
  // Mostrar modal
  const modal = getElById('theme-purchase-modal');
  if (modal) modal.classList.add('active');
}

/**
 * Fecha modal de compra de tema
 */
export function closeThemePurchaseModal() {
  const modal = getElById('theme-purchase-modal');
  if (modal) modal.classList.remove('active');
  selectedThemeForPurchase = null;
}

/**
 * Confirma compra de tema
 */
export async function confirmThemePurchase() {
  if (!selectedThemeForPurchase || !window.currentUser?.id) return;
  
  try {
    const theme = selectedThemeForPurchase;
    const currentDiamonds = Number(window.playerDiamonds?.value ?? 0);
    
    // Verificar diamantes novamente
    if (currentDiamonds < theme.price) {
      showAlert('error', 'Insufficient Diamonds! 💎', `You need ${theme.price - currentDiamonds} more diamonds to buy this theme.`);
      return;
    }
    
    // Buscar dados atuais
    const { data: userData, error: fetchError } = await supabase
      .from('player_stats')
      .select('unlocked_themes, diamonds')
      .eq('user_id', window.currentUser.id)
      .single();
    
    if (fetchError) {
      showAlert('error', 'Loading Failed! ❌', 'Unable to fetch user data. Please try again.');
      return;
    }
    
    const unlockedThemes = userData.unlocked_themes || ['default'];
    const unlockedSet = new Set(unlockedThemes);
    
    // Verificar se já tem
    if (unlockedSet.has(theme.id)) {
      showAlert('info', 'Already Owned! ✅', 'You already own this theme. Click on it to activate.');
      closeThemePurchaseModal();
      return;
    }
    
    // Descontar diamantes
    const newDiamonds = userData.diamonds - theme.price;
    const newUnlockedThemes = [...unlockedThemes, theme.id];
    
    // Atualizar banco
    const { error: updateError } = await supabase
      .from('player_stats')
      .update({
        diamonds: newDiamonds,
        unlocked_themes: newUnlockedThemes,
        active_theme: theme.id // Ativar automaticamente
      })
      .eq('user_id', window.currentUser.id);
    
    if (updateError) {
      showAlert('error', 'Purchase Failed! ❌', 'Unable to complete purchase. Please try again.');
      return;
    }
    
    // Atualizar localmente
    window.playerDiamonds.value = newDiamonds;
    if (window.updateMoneyDisplay) {
      window.updateMoneyDisplay();
    }
    
    // Aplicar theme
    applyTheme(theme.id);
    
    // Recarregar grid
    loadUserThemes();
    
    // Fechar modal
    closeThemePurchaseModal();
    
    // 🔥 Notificações de sucesso
    showAlert('success', 'Theme Purchased! 🎉', `"${theme.name}" has been unlocked and activated!`);
    showToast('success', 'Theme Active! 🎨', `Now using "${theme.name}" theme.`);
    
  } catch (err) {
    console.error('Erro:', err);
    showAlert('error', 'Transaction Error! 🌐', 'Unable to process purchase. Check your connection.');
  }
}

/**
 * Ativa um tema já desbloqueado
 * @param {string} themeId - ID do tema
 */
export async function activateTheme(themeId) {
  try {
    if (!window.currentUser?.id) {
      showAlert('error', 'Not Authenticated! ⚠️', 'Please login to change themes.');
      return;
    }
    
    // Atualizar banco
    const { error } = await supabase
      .from('player_stats')
      .update({ active_theme: themeId })
      .eq('user_id', window.currentUser.id);
    
    if (error) {
      console.error('Erro ao ativar theme:', error);
      showAlert('error', 'Activation Failed! ❌', 'Unable to activate theme. Please try again.');
      return;
    }
    
    // Aplicar theme
    applyTheme(themeId);
    
    // 🔥 Toast de ativação
    const theme = getThemeById(themeId);
    if (theme) {
      showToast('success', 'Theme Changed! 🎨', `Now using "${theme.name}" theme.`);
    }
    
    // Recarregar grid
    loadUserThemes();
    
  } catch (err) {
    console.error('Erro:', err);
  }
}

// ============================================================
// SAVED COLORS (Legacy - pode ser removido se não usar mais)
// ============================================================

/**
 * Carrega cores salvas (fallback para sistema antigo)
 */
export function loadSavedColors() {
  // ✅ Carregar tema do localStorage (backup)
  let savedTheme = null;
  try { savedTheme = localStorage.getItem('activeTheme'); } catch (_) { savedTheme = null; }
  
  if (savedTheme) {
    applyTheme(savedTheme);
  }
}

// ============================================================
// EXPOR FUNÇÕES GLOBALMENTE
// ============================================================

window.applyTheme = applyTheme;
window.loadInitialTheme = loadInitialTheme;
window.loadUserThemes = loadUserThemes;
window.openThemePurchaseModal = openThemePurchaseModal;
window.closeThemePurchaseModal = closeThemePurchaseModal;
window.confirmThemePurchase = confirmThemePurchase;
window.activateTheme = activateTheme;
window.loadSavedColors = loadSavedColors;