// ============================================================
// EFFECTS.TS - Sistema de Popups, Efeitos e Utilitários
// ============================================================

import { playSound } from './sfx';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from './error-handler';

// ============ TYPE DEFINITIONS ============

type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface RGB {
  r: number;
  g: number;
  b: number;
}

// ============ MONEY POPUP ============
/**
 * Exibe popup animado quando o usuário ganha ou perde dinheiro
 * @param amount - Quantidade de dinheiro (positivo = ganho, negativo = perda)
 */
export function showMoneyPopup(amount: number): void {
  const isPositive = amount > 0;
  const absAmount = Math.abs(amount);

  if (isPositive) {
    playSound('payout', { volume: 0.6 });
  }
  
  const popup = document.createElement('div');
  popup.className = `money-popup-simple ${isPositive ? 'gain' : 'loss'}`;
  
  popup.innerHTML = `
    <div class="money-simple-value">${isPositive ? '+' : '-'}$${absAmount.toFixed(2)}</div>
  `;
  
  document.body.appendChild(popup);
  
  const moneyBox = document.querySelector('.money-box');
  const rect = moneyBox ? moneyBox.getBoundingClientRect() : null;

  if (rect) {
    popup.style.left = `${rect.left + rect.width / 2}px`;
    popup.style.top = `${rect.bottom + 8}px`;
    popup.style.transform = 'translateX(-50%) translateY(0) scale(0)';
  } else {
    popup.style.left = '50%';
    popup.style.top = '35%';
    popup.style.transform = 'translate(-50%, -50%) scale(0)';
  }

  popup.style.transition = 'all 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)';

  setTimeout(() => {
    if (rect) {
      popup.style.transform = 'translateX(-50%) translateY(0) scale(1)';
    } else {
      popup.style.transform = 'translate(-50%, -50%) scale(1)';
    }
  }, 50);
  
  const particleCount = isPositive && absAmount >= 1000 ? 30 : 15;
  for (let i = 0; i < particleCount; i++) {
    setTimeout(() => {
      const particle = document.createElement('div');
      particle.className = `money-particle-simple ${isPositive ? 'gain' : 'loss'}`;
      particle.textContent = isPositive ? '+' : '-';
      
      const angle = (Math.PI * 2 * i) / particleCount;
      const distance = 80 + Math.random() * 100;
      const tx = Math.cos(angle) * distance;
      const ty = Math.sin(angle) * distance;
      const rot = Math.random() * 720 - 360;
      
      particle.style.setProperty('--tx', `${tx}px`);
      particle.style.setProperty('--ty', `${ty}px`);
      particle.style.setProperty('--rot', `${rot}deg`);
      particle.style.left = rect ? `${rect.left + rect.width / 2}px` : '50%';
      particle.style.top = rect ? `${rect.bottom + 8}px` : '35%';
      
      document.body.appendChild(particle);
      
      setTimeout(() => particle.remove(), 1000);
    }, i * 15);
  }
  
  setTimeout(() => {
    popup.style.opacity = '0';
    if (rect) {
      popup.style.transform = 'translateX(-50%) translateY(-30px) scale(0.8)';
    } else {
      popup.style.transform = 'translate(-50%, -70%) scale(0.8)';
    }
  }, 2300);
  
  setTimeout(() => popup.remove(), 2800);
}

/**
 * Exibe popup animado quando o usuário ganha ou perde diamantes
 * @param amount - Quantidade de diamantes (positivo = ganho, negativo = perda)
 */
export function showDiamondPopup(amount: number): void {
  const isPositive = amount > 0;
  const absAmount = Math.abs(amount);
  
  const popup = document.createElement('div');
  popup.className = `diamond-popup-simple ${isPositive ? 'gain' : 'loss'}`;
  
  popup.innerHTML = `
    <div class="diamond-simple-value">${isPositive ? '+' : '-'}${absAmount}</div>
  `;
  
  document.body.appendChild(popup);
  
  const diamondBox = document.querySelector('.diamond-box');
  const rect = diamondBox ? diamondBox.getBoundingClientRect() : null;

  if (rect) {
    popup.style.left = `${rect.left + rect.width / 2}px`;
    popup.style.top = `${rect.bottom + 8}px`;
    popup.style.transform = 'translateX(-50%) translateY(0) scale(0)';
  } else {
    popup.style.left = '50%';
    popup.style.top = '35%';
    popup.style.transform = 'translate(-50%, -50%) scale(0)';
  }

  popup.style.transition = 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';

  setTimeout(() => {
    if (rect) {
      popup.style.transform = 'translateX(-50%) translateY(0) scale(1)';
    } else {
      popup.style.transform = 'translate(-50%, -50%) scale(1)';
    }
  }, 50);
  
  const particleCount = isPositive && absAmount >= 50 ? 20 : 12;
  for (let i = 0; i < particleCount; i++) {
    setTimeout(() => {
      const particle = document.createElement('div');
      particle.className = `diamond-particle-simple ${isPositive ? 'gain' : 'loss'}`;
      particle.textContent = isPositive ? '+' : '-';
      particle.style.cssText = `
        position: fixed;
        left: ${rect ? `${rect.left + rect.width / 2}px` : '50%'};
        top: ${rect ? `${rect.bottom + 8}px` : '35%'};
        pointer-events: none;
        z-index: 999998;
        animation: diamondParticleFloatSimple 1.2s ease-out forwards;
      `;
      
      const angle = (Math.PI * 2 * i) / particleCount;
      const distance = 80 + Math.random() * 60;
      const tx = Math.cos(angle) * distance;
      const ty = Math.sin(angle) * distance;
      const rot = Math.random() * 360;
      
      particle.style.setProperty('--tx', `${tx}px`);
      particle.style.setProperty('--ty', `${ty}px`);
      particle.style.setProperty('--rot', `${rot}deg`);
      
      document.body.appendChild(particle);
      setTimeout(() => particle.remove(), 1200);
    }, i * 30);
  }

  setTimeout(() => {
    popup.style.opacity = '0';
    if (rect) {
      popup.style.transform = 'translateX(-50%) translateY(-30px) scale(0.8)';
    } else {
      popup.style.transform = 'translate(-50%, -70%) scale(0.8)';
    }
  }, 2300);
  
  setTimeout(() => popup.remove(), 2800);
}

// ============ XP POPUP ============
/**
 * Exibe popup de ganho de XP ou Level Up
 * @param xpGained - XP ganho
 * @param currentXP - XP atual no nível
 * @param nextLevelXP - XP necessário para próximo nível
 * @param oldLevel - Nível anterior (opcional)
 * @param newLevel - Nível atual (opcional)
 */
export function showXPPopup(
  xpGained: number, 
  currentXP: number, 
  nextLevelXP: number, 
  oldLevel?: number, 
  newLevel?: number
): void {
  const leveledUp = oldLevel !== undefined && newLevel !== undefined && oldLevel < newLevel;
  
  if (leveledUp) {
    showLevelUpExplosion(oldLevel, newLevel);
    return;
  }
  
  const progress = (currentXP / nextLevelXP) * 100;
  
  const popup = document.createElement('div');
  popup.className = 'xp-popup-epic';
  
  popup.innerHTML = `
    <div class="xp-rings">
      <div class="xp-ring"></div>
      <div class="xp-ring"></div>
      <div class="xp-ring"></div>
    </div>
    <div class="xp-main">
      <div class="xp-stars-container">
        <span class="xp-star-icon">⭐</span>
        <div class="xp-amount-big">+${xpGained} XP</div>
        <span class="xp-star-icon">⭐</span>
      </div>
      <div class="xp-bar-wrapper">
        <div class="xp-bar-container">
          <div class="xp-bar-fill" style="width: ${progress}%"></div>
        </div>
        <div class="xp-bar-text">${currentXP} / ${nextLevelXP} XP</div>
      </div>
    </div>
  `;
  
  document.body.appendChild(popup);
  
  const levelBox = document.getElementById('user-level');
  const rect = levelBox ? levelBox.getBoundingClientRect() : null;

  if (levelBox && rect) {
    popup.style.left = `${rect.left + rect.width / 2}px`;
    popup.style.top = `${rect.bottom + 8}px`;
    popup.style.transform = 'translateX(-50%) translateY(0) scale(0.5)';
  } else {
    popup.style.left = '50%';
    popup.style.top = '35%';
    popup.style.transform = 'translate(-50%, -50%) scale(0.5)';
  }

  popup.style.opacity = '0';
  popup.style.transition = 'all 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)';

  setTimeout(() => {
    popup.style.opacity = '1';
    if (rect) {
      popup.style.transform = 'translateX(-50%) translateY(0) scale(1)';
    } else {
      popup.style.transform = 'translate(-50%, -50%) scale(1)';
    }
  }, 50);

  for (let i = 0; i < 15; i++) {
    setTimeout(() => {
      const particle = document.createElement('div');
      particle.textContent = ['⭐', '✨', '💫'][Math.floor(Math.random() * 3)];
      particle.style.cssText = `
        position: fixed;
        font-size: 1.8rem;
        left: ${rect ? rect.left + rect.width / 2 : 50}${rect ? 'px' : '%'};
        top: ${rect ? rect.bottom + 8 : 35}${rect ? 'px' : '%'};
        pointer-events: none;
        z-index: 999998;
        animation: xpParticleFloat 2s ease-out forwards;
        filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.8));
      `;
      
      const angle = (Math.PI * 2 * i) / 15;
      const distance = 80 + Math.random() * 60;
      const tx = Math.cos(angle) * distance;
      const ty = Math.sin(angle) * distance;
      const rot = Math.random() * 360;
      
      particle.style.setProperty('--tx', `${tx}px`);
      particle.style.setProperty('--ty', `${ty}px`);
      particle.style.setProperty('--rot', `${rot}deg`);
      
      document.body.appendChild(particle);
      setTimeout(() => particle.remove(), 2000);
    }, i * 40);
  }

  setTimeout(() => {
    popup.style.opacity = '0';
    popup.style.transform = popup.style.transform.replace('scale(1)', 'scale(0.5)');
  }, 2500);

  setTimeout(() => popup.remove(), 3000);
}

// ============ LEVEL UP EXPLOSION ============
/**
 * Exibe explosão de tela cheia quando o usuário sobe de nível
 * @param oldLevel - Nível anterior
 * @param newLevel - Nível novo
 */
export function showLevelUpExplosion(oldLevel: number, newLevel: number): void {
  const popup = document.createElement('div');
  popup.className = 'levelup-explosion';
  
  popup.innerHTML = `
    <div class="levelup-waves"></div>
    <div class="levelup-content">
      <div class="levelup-title">LEVEL UP!</div>
      <div class="levelup-levels">
        <span class="levelup-old">${oldLevel}</span>
        <span class="levelup-arrow">→</span>
        <span class="levelup-new">${newLevel}</span>
      </div>
    </div>
  `;
  
  document.body.appendChild(popup);
  
  const confettiEmojis = ['🎊', '🎉', '✨', '⭐', '💫', '🌟', '🎆', '🎇'];
  for (let i = 0; i < 60; i++) {
    setTimeout(() => {
      const confetti = document.createElement('div');
      confetti.className = 'levelup-confetti';
      confetti.textContent = confettiEmojis[Math.floor(Math.random() * confettiEmojis.length)];
      confetti.style.left = `${Math.random() * 100}%`;
      confetti.style.setProperty('--rot', `${Math.random() * 1440 - 720}deg`);
      confetti.style.animationDelay = `${Math.random() * 0.3}s`;
      confetti.style.animationDuration = `${2.5 + Math.random() * 1.5}s`;
      
      popup.appendChild(confetti);
      
      setTimeout(() => confetti.remove(), 4500);
    }, i * 25);
  }
  
  setTimeout(() => {
    popup.style.opacity = '0';
    popup.style.transition = 'opacity 0.5s ease';
  }, 3500);
  
  setTimeout(() => popup.remove(), 4000);
}

// ============ SELL PARTICLES ============
/**
 * Cria partículas verdes quando um item é vendido
 * @param element - Elemento do card vendido
 */
export function createSellParticles(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  const particleCount = Math.floor(Math.random() * 5) + 8;
  
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'sell-particle';
    
    particle.style.left = centerX + 'px';
    particle.style.top = centerY + 'px';
    
    const angle = (Math.PI * 2 * i) / particleCount;
    const distance = 50 + Math.random() * 30;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance;
    
    particle.style.setProperty('--tx', `${tx}px`);
    particle.style.setProperty('--ty', `${ty}px`);
    
    document.body.appendChild(particle);
    
    setTimeout(() => particle.remove(), 800);
  }
}

// ============ HISTORY PARTICLES ============
/**
 * Cria partículas ao fazer hover em drops raros no histórico
 * @param element - Elemento do card
 * @param color - Cor das partículas
 */
export function createHistoryParticles(element: HTMLElement, color: string): void {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  const particleCount = 8;
  
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'history-particle';
    particle.style.background = color;
    particle.style.left = centerX + 'px';
    particle.style.top = centerY + 'px';
    
    const angle = (Math.PI * 2 * i) / particleCount;
    const distance = 40 + Math.random() * 20;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance;
    
    particle.style.setProperty('--tx', `${tx}px`);
    particle.style.setProperty('--ty', `${ty}px`);
    
    document.body.appendChild(particle);
    
    setTimeout(() => {
      particle.remove();
    }, 1000);
  }
}

// ============ UPLOAD NOTIFICATION ============
/**
 * Mostra notificação de upload de avatar/banner
 * @param message - Mensagem a ser exibida
 * @param isError - Se é erro (true) ou sucesso (false)
 */
export function showUploadNotification(message: string, isError: boolean = false): void {
  const notification = document.getElementById('upload-notification');
  if (!notification) return;
  
  const text = notification.querySelector('.upload-text');
  const icon = notification.querySelector('.upload-icon');
  
  if (text) text.textContent = message;
  if (icon) icon.textContent = isError ? '❌' : '✅';
  
  if (isError) {
    notification.classList.add('error');
  } else {
    notification.classList.remove('error');
  }
  
  notification.classList.add('show');
  
  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}

// ============ SELL CONFIRMATION MODAL ============
/**
 * Mostra modal de confirmação de venda
 * @param count - Quantidade de itens vendidos
 * @param total - Valor total recebido
 */
export function showSellConfirmation(count: number, total: number): void {
  const modal = document.getElementById('sell-confirm-modal');
  if (!modal) return;
  
  const soldCount = document.getElementById('sold-count');
  const soldTotal = document.getElementById('sold-total');
  
  if (soldCount) soldCount.textContent = String(count);
  if (soldTotal) {
    soldTotal.textContent = 
      total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 💰';
  }
  
  modal.classList.add('active');
  
  setTimeout(() => {
    closeSellConfirmModal();
  }, 3000);
}

/**
 * Fecha o modal de confirmação de venda
 */
export function closeSellConfirmModal(): void {
  const modal = document.getElementById('sell-confirm-modal');
  if (modal) modal.classList.remove('active');
}

// ============ UTILIDADES GERAIS ============

/**
 * Formata data e hora para exibição
 * @param isoString - String de data em formato ISO
 * @returns Data formatada
 */
export function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  };
  return date.toLocaleString('en-US', options);
}

/**
 * Converte HEX para RGB
 * @param hex - Cor em formato HEX
 * @returns Objeto com r, g, b
 */
export function hexToRgb(hex: string): RGB {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return { r, g, b };
}

/**
 * Gera um número aleatório com seed (determinístico)
 * @param seed - Seed para geração
 * @returns Número entre 0 e 1
 */
export function seededRandom(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }
  const x = Math.sin(hash) * 10000;
  return x - Math.floor(x);
}

/**
 * Debounce - limita execução de função
 * @param func - Função a ser executada
 * @param wait - Tempo de espera em ms
 * @returns Função com debounce
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T, 
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle - limita taxa de execução
 * @param func - Função a ser executada
 * @param limit - Tempo mínimo entre execuções em ms
 * @returns Função com throttle
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T, 
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return function(...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(null, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Copia texto para clipboard
 * @param text - Texto a ser copiado
 * @returns Sucesso da operação
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    ErrorHandler.handleError('Erro ao copiar', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.WARNING,
      details: err,
      showToUser: false
    });
    return false;
  }
}

/**
 * Aguarda um tempo específico (helper para async/await)
 * @param ms - Milissegundos para aguardar
 * @returns Promise que resolve após o tempo
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitiza string para uso seguro em HTML
 * @param str - String a ser sanitizada
 * @returns String sanitizada
 */
export function sanitizeHTML(str: string): string {
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

/**
 * Formata número como moeda
 * @param value - Valor numérico
 * @param currency - Código da moeda (USD, BRL, etc)
 * @returns Valor formatado
 */
export function formatCurrency(value: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Calcula tempo relativo (ex: "5 minutos atrás")
 * @param date - Data para calcular
 * @returns Tempo relativo
 */
export function getRelativeTime(date: Date | string): string {
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'agora mesmo';
  if (diffMins < 60) return `${diffMins} min atrás`;
  if (diffHours < 24) return `${diffHours}h atrás`;
  return `${diffDays}d atrás`;
}

const TOAST_ICONS: Record<NotificationType, string> = Object.freeze({
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️'
});

const ALERT_ICONS: Record<NotificationType, string> = Object.freeze({
  success: '🎉',
  error: '🚫',
  warning: '⚡',
  info: '💡'
});

let toastContainerCache: HTMLElement | null = null;
let alertContainerCache: HTMLElement | null = null;

function getOrCreateNotificationContainer(id: string): HTMLElement {
  const existing = document.getElementById(id);
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = id;
  document.body.appendChild(el);
  return el;
}

// ============================================================
// NOTIFICATION SYSTEM - TOAST & ALERT
// ============================================================

/**
 * Exibe notificação Toast (canto superior direito)
 * @param type - Tipo: 'success', 'error', 'warning', 'info'
 * @param title - Título da notificação
 * @param message - Mensagem opcional
 * @param duration - Duração em ms (padrão: 5000)
 */
export function showToast(
  type: NotificationType = 'info', 
  title: string = 'Notification', 
  message: string = '', 
  duration: number = 5000
): void {
  const container = toastContainerCache || (toastContainerCache = getOrCreateNotificationContainer('toast-container'));

  if (type === 'error') {
    playSound('error', { volume: 0.45 });
  } else {
    playSound('notify', { volume: 0.35 });
  }
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  toast.innerHTML = `
    <div class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-message">${message}</div>` : ''}
    </div>
    <button class="toast-close" onclick="window.removeToast(this)">✕</button>
    <div class="toast-progress"></div>
  `;
  
  container.appendChild(toast);

  const closeButton = toast.querySelector('.toast-close') as HTMLElement;
  
  const timeoutId = setTimeout(() => {
    removeToast(closeButton || toast);
  }, duration);
  
  toast.dataset.timeoutId = String(timeoutId);
}

/**
 * Remove uma notificação Toast
 * @param button - Botão de fechar ou elemento toast
 */
export function removeToast(button: HTMLElement): void {
  const toast = button.closest ? button.closest('.toast') as HTMLElement : button;
  if (!toast) return;
  
  if (toast.dataset.timeoutId) {
    clearTimeout(parseInt(toast.dataset.timeoutId));
  }
  
  toast.classList.add('removing');
  setTimeout(() => {
    toast.remove();
  }, 300);
}

/**
 * Exibe notificação Alert (centro superior)
 * @param type - Tipo: 'success', 'error', 'warning', 'info'
 * @param title - Título da notificação
 * @param message - Mensagem opcional
 * @param duration - Duração em ms (padrão: 5000)
 */
export function showAlert(
  type: NotificationType = 'info', 
  title: string = 'Alert', 
  message: string = '', 
  duration: number = 5000
): void {
  const container = alertContainerCache || (alertContainerCache = getOrCreateNotificationContainer('alert-container'));

  if (type === 'error') {
    playSound('error', { volume: 0.5 });
  } else {
    playSound('notify', { volume: 0.35 });
  }
  
  const alert = document.createElement('div');
  alert.className = `alert ${type}`;
  
  alert.innerHTML = `
    <div class="alert-icon">${ALERT_ICONS[type] || ALERT_ICONS.info}</div>
    <div class="alert-content">
      <div class="alert-title">${title}</div>
      ${message ? `<div class="alert-message">${message}</div>` : ''}
    </div>
    <button class="alert-close" onclick="window.removeAlert(this)">✕</button>
  `;
  
  container.appendChild(alert);

  const closeButton = alert.querySelector('.alert-close') as HTMLElement;
  
  const timeoutId = setTimeout(() => {
    removeAlert(closeButton || alert);
  }, duration);
  
  alert.dataset.timeoutId = String(timeoutId);
}

/**
 * Remove uma notificação Alert
 * @param button - Botão de fechar ou elemento alert
 */
export function removeAlert(button: HTMLElement): void {
  const alert = button.closest ? button.closest('.alert') as HTMLElement : button;
  if (!alert) return;
  
  if (alert.dataset.timeoutId) {
    clearTimeout(parseInt(alert.dataset.timeoutId));
  }
  
  alert.classList.add('removing');
  setTimeout(() => {
    alert.remove();
  }, 300);
}

// ============================================================
// EXPOR FUNÇÕES GLOBALMENTE
// ============================================================

declare global {
  interface Window {
    showMoneyPopup: typeof showMoneyPopup;
    showDiamondPopup: typeof showDiamondPopup;
    showXPPopup: typeof showXPPopup;
    showLevelUpExplosion: typeof showLevelUpExplosion;
    createSellParticles: typeof createSellParticles;
    createHistoryParticles: typeof createHistoryParticles;
    showUploadNotification: typeof showUploadNotification;
    showSellConfirmation: typeof showSellConfirmation;
    closeSellConfirmModal: typeof closeSellConfirmModal;
    seededRandom: typeof seededRandom;
    hexToRgb: typeof hexToRgb;
    formatDateTime: typeof formatDateTime;
    debounce: typeof debounce;
    throttle: typeof throttle;
    copyToClipboard: typeof copyToClipboard;
    sleep: typeof sleep;
    sanitizeHTML: typeof sanitizeHTML;
    formatCurrency: typeof formatCurrency;
    getRelativeTime: typeof getRelativeTime;
    showToast: typeof showToast;
    showAlert: typeof showAlert;
    removeToast: typeof removeToast;
    removeAlert: typeof removeAlert;
  }
}

if (typeof window !== 'undefined') {
  window.showMoneyPopup = showMoneyPopup;
  window.showDiamondPopup = showDiamondPopup;
  window.showXPPopup = showXPPopup;
  window.showLevelUpExplosion = showLevelUpExplosion;
  window.createSellParticles = createSellParticles;
  window.createHistoryParticles = createHistoryParticles;
  window.showUploadNotification = showUploadNotification;
  window.showSellConfirmation = showSellConfirmation;
  window.closeSellConfirmModal = closeSellConfirmModal;
  window.seededRandom = seededRandom;
  window.hexToRgb = hexToRgb;
  window.formatDateTime = formatDateTime;
  window.debounce = debounce;
  window.throttle = throttle;
  window.copyToClipboard = copyToClipboard;
  window.sleep = sleep;
  window.sanitizeHTML = sanitizeHTML;
  window.formatCurrency = formatCurrency;
  window.getRelativeTime = getRelativeTime;
  window.showToast = showToast;
  window.showAlert = showAlert;
  window.removeToast = removeToast;
  window.removeAlert = removeAlert;
}
