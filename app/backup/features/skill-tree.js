// ============================================================
// SKILL-TREE.JS - Sistema de Badges e Skill Tree
// ============================================================

import { supabase } from './auth.js';
import { 
  SKILL_TREE_BADGES, 
  SKILL_TREE_CATEGORIES, 
  HUB,
  BADGE_DEFINITIONS 
} from '../shared/constants.js';
import { 
  showDiamondPopup, 
  showXPPopup 
} from '../shared/effects.js';

// ============================================================
// STATE MANAGEMENT
// ============================================================

let currentSkillTreeZoom = 0.5;
let isSkillTreePanning = false;
let skillTreeStartX = 0;
let skillTreeStartY = 0;
let skillTreeScrollLeftStart = 0;
let skillTreeScrollTopStart = 0;

let skillTreePanningBound = false;
let skillTreeKeyboardBound = false;
let skillTreeModalCloseBound = false;

// ============================================================
// SKILL TREE INITIALIZATION
// ============================================================

/**
 * Inicializa o Skill Tree
 */
export function initSkillTree() {
  createSkillTreeBadges();
  drawSkillTreeLines();
  centerSkillTreeViewport();
  setupSkillTreePanning();
  
  // Zoom inicial
  const canvas = document.getElementById('st-canvas');
  if (canvas) {
    canvas.style.transform = `scale(${currentSkillTreeZoom})`;
  }
}

/**
 * Cria os badges no canvas
 */
function createSkillTreeBadges() {
  const canvas = document.getElementById('st-canvas');
  if (!canvas) return;

  // Remover badges antigos sem destruir SVG/hub
  canvas.querySelectorAll('.st-badge').forEach((el) => el.remove());
  
  Object.keys(SKILL_TREE_BADGES).forEach(id => {
    const badge = SKILL_TREE_BADGES[id];
    const cat = getSkillTreeCategoryByBadge(id);
    
    const div = document.createElement('div');
    div.id = id;
    div.className = 'st-badge locked';
    div.style.left = (badge.x - 80) + 'px';
    div.style.top = (badge.y - 80) + 'px';
    div.style.borderColor = cat.color;
    div.onclick = () => openSkillTreeModal(id);
    
    const progress = Math.round((badge.current / badge.max) * 100);
    
    div.innerHTML = `
      <div class="st-badge-icon">${badge.icon}</div>
      <div class="st-badge-name">${badge.name}</div>
      <div class="st-badge-progress">
        <div class="st-progress-bar">
          <div class="st-progress-fill" style="width: ${progress}%"></div>
        </div>
        <span class="st-progress-text">${badge.current}/${badge.max}</span>
      </div>
      <div class="st-badge-rewards">
        <span>💎 ${badge.diamonds}</span>
        <span>⭐ ${badge.xp} XP</span>
      </div>
    `;
    
    canvas.appendChild(div);
  });
}

/**
 * Desenha as linhas conectando os badges
 */
function drawSkillTreeLines() {
  const svg = document.getElementById('st-lines');
  if (!svg) return;
  
  svg.innerHTML = '';
  
  Object.keys(SKILL_TREE_CATEGORIES).forEach(catKey => {
    const cat = SKILL_TREE_CATEGORIES[catKey];
    
    cat.badges.forEach((badgeId, index) => {
      const badge = SKILL_TREE_BADGES[badgeId];
      
      // Hub to first
      if (index === 0) {
        createSkillTreeLine(svg, HUB.x, HUB.y, badge.x, badge.y, cat.color, 3);
      }
      
      // Between badges
      if (index > 0) {
        const prevBadge = SKILL_TREE_BADGES[cat.badges[index - 1]];
        createSkillTreeLine(svg, prevBadge.x, prevBadge.y, badge.x, badge.y, cat.color, 2);
      }
    });
  });
}

/**
 * Cria uma linha SVG entre dois pontos
 */
function createSkillTreeLine(svg, x1, y1, x2, y2, color, width) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  
  const offset = distance * 0.25;
  const perpX = -dy / distance * offset;
  const perpY = dx / distance * offset;
  
  const controlX = midX + perpX;
  const controlY = midY + perpY;
  
  const d = `M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`;
  
  path.setAttribute('d', d);
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', width);
  path.setAttribute('fill', 'none');
  path.setAttribute('opacity', '0.6');
  path.setAttribute('stroke-linecap', 'round');
  
  svg.appendChild(path);
}

/**
 * Obtém a categoria de um badge
 */
function getSkillTreeCategoryByBadge(badgeId) {
  for (const catKey in SKILL_TREE_CATEGORIES) {
    if (SKILL_TREE_CATEGORIES[catKey].badges.includes(badgeId)) {
      return SKILL_TREE_CATEGORIES[catKey];
    }
  }
  return null;
}

// ============================================================
// SKILL TREE MODAL
// ============================================================

/**
 * Abre modal de detalhes do badge
 */
export function openSkillTreeModal(badgeId) {
  const badge = SKILL_TREE_BADGES[badgeId];
  const cat = getSkillTreeCategoryByBadge(badgeId);

  if (!badge || !cat) return;

  const iconEl = document.getElementById('st-modal-icon');
  const titleEl = document.getElementById('st-modal-title');
  const descEl = document.getElementById('st-modal-desc');
  const rewardsEl = document.getElementById('st-modal-rewards');
  const modalBox = document.getElementById('st-modal-box');
  const modal = document.getElementById('st-modal');

  if (iconEl) iconEl.textContent = badge.icon;
  if (titleEl) titleEl.textContent = badge.name;
  if (descEl) descEl.textContent = badge.desc + '\n\nRequirement: ' + badge.requirement;
  if (rewardsEl) rewardsEl.innerHTML = `
    <span>💎 ${badge.diamonds}</span>
    <span>⭐ ${badge.xp} XP</span>
  `;

  if (modalBox) modalBox.style.borderColor = cat.color;

  if (modal) modal.classList.add('active');
}

/**
 * Fecha modal do skill tree
 */
export function closeSkillTreeModal() {
  const modal = document.getElementById('st-modal');
  if (modal) modal.classList.remove('active');
}

// ============================================================
// ZOOM CONTROLS
// ============================================================

/**
 * Ajusta o zoom do skill tree
 */
export function zoomSkillTree(delta) {
  currentSkillTreeZoom += delta;
  currentSkillTreeZoom = Math.max(0.3, Math.min(1.5, currentSkillTreeZoom));
  const canvas = document.getElementById('st-canvas');
  if (canvas) {
    canvas.style.transform = `scale(${currentSkillTreeZoom})`;
  }
}

/**
 * Reseta o zoom para 1
 */
export function resetSkillTreeZoom() {
  currentSkillTreeZoom = 1;
  const canvas = document.getElementById('st-canvas');
  if (canvas) {
    canvas.style.transform = 'scale(1)';
  }
}

// ============================================================
// PANNING (ARRASTAR CANVAS)
// ============================================================

/**
 * Configura o sistema de panning
 */
function setupSkillTreePanning() {
  const viewport = document.getElementById('st-viewport');
  if (!viewport) return;

  if (skillTreePanningBound) return;
  
  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.st-badge') || e.target.closest('.st-hub')) return;
    isSkillTreePanning = true;
    skillTreeStartX = e.clientX;
    skillTreeStartY = e.clientY;
    skillTreeScrollLeftStart = viewport.scrollLeft;
    skillTreeScrollTopStart = viewport.scrollTop;
  });
  
  viewport.addEventListener('mousemove', (e) => {
    if (!isSkillTreePanning) return;
    const deltaX = e.clientX - skillTreeStartX;
    const deltaY = e.clientY - skillTreeStartY;
    viewport.scrollLeft = skillTreeScrollLeftStart - deltaX;
    viewport.scrollTop = skillTreeScrollTopStart - deltaY;
  });
  
  viewport.addEventListener('mouseup', () => isSkillTreePanning = false);
  viewport.addEventListener('mouseleave', () => isSkillTreePanning = false);

  skillTreePanningBound = true;
}

/**
 * Centraliza o viewport no hub
 */
function centerSkillTreeViewport() {
  const viewport = document.getElementById('st-viewport');
  if (!viewport) return;
  
  const centerX = 1200 - (viewport.clientWidth / 2);
  const centerY = 1200 - (viewport.clientHeight / 2);
  viewport.scrollLeft = centerX;
  viewport.scrollTop = centerY;
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

/**
 * Configura atalhos de teclado
 */
// NO SKILL-TREE.JS
export function setupSkillTreeKeyboardShortcuts() {
  if (skillTreeKeyboardBound) return;
  document.addEventListener('keydown', (e) => {
    const skillTree = document.getElementById('skill-tree');
    if (!skillTree || !skillTree.classList.contains('active')) return;
    
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomSkillTree(0.1);
    } else if (e.key === '-') {
      e.preventDefault();
      zoomSkillTree(-0.1);
    } else if (e.key === '0') {
      e.preventDefault();
      resetSkillTreeZoom();
    } else if (e.key === 'Escape') {
      closeSkillTreeModal();
    }
  });

  skillTreeKeyboardBound = true;
}

/**
 * Configura click fora do modal
 */
export function setupSkillTreeModalClose() {
  if (skillTreeModalCloseBound) return;
  const skillTreeModal = document.getElementById('st-modal');
  if (skillTreeModal) {
    skillTreeModal.addEventListener('click', (e) => {
      if (e.target.id === 'st-modal') closeSkillTreeModal();
    });

    skillTreeModalCloseBound = true;
  }
}

// ============================================================
// EXPOR FUNÇÕES GLOBALMENTE
// ============================================================

window.initSkillTree = initSkillTree;
window.openSkillTreeModal = openSkillTreeModal;
window.closeSkillTreeModal = closeSkillTreeModal;
window.zoomSkillTree = zoomSkillTree;
window.resetSkillTreeZoom = resetSkillTreeZoom;

// ============================================================
// INICIALIZAÇÃO
// ============================================================

// Inicializar ao carregar
document.addEventListener('DOMContentLoaded', () => {
  setupSkillTreeKeyboardShortcuts();
  setupSkillTreeModalClose();
});