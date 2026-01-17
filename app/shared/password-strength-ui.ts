// ============================================================
// PASSWORD-STRENGTH-UI.TS - UI Component for Password Strength
// ============================================================

import { validatePasswordStrength, PasswordStrength } from './validation';

/**
 * Cria e anexa indicador visual de força de senha
 */
export function attachPasswordStrengthIndicator(
  passwordInputId: string,
  containerId?: string
): void {
  const passwordInput = document.getElementById(passwordInputId) as HTMLInputElement;
  if (!passwordInput) {
    console.warn(`Password input ${passwordInputId} not found`);
    return;
  }
  
  // Criar container se não especificado
  let container: HTMLElement;
  if (containerId) {
    container = document.getElementById(containerId)!;
  } else {
    container = document.createElement('div');
    container.className = 'password-strength-container';
    passwordInput.parentElement?.insertBefore(container, passwordInput.nextSibling);
  }
  
  // Criar elementos de UI
  const strengthBar = document.createElement('div');
  strengthBar.className = 'password-strength-bar';
  strengthBar.innerHTML = `
    <div class="strength-bar-fill"></div>
  `;
  
  const strengthLabel = document.createElement('div');
  strengthLabel.className = 'password-strength-label';
  
  const strengthFeedback = document.createElement('div');
  strengthFeedback.className = 'password-strength-feedback';
  
  container.appendChild(strengthBar);
  container.appendChild(strengthLabel);
  container.appendChild(strengthFeedback);
  
  // Listener para atualizar força
  passwordInput.addEventListener('input', () => {
    const password = passwordInput.value;
    
    if (!password) {
      // Esconder indicador se campo vazio
      container.style.display = 'none';
      return;
    }
    
    container.style.display = 'block';
    const strength = validatePasswordStrength(password);
    updateStrengthUI(strengthBar, strengthLabel, strengthFeedback, strength);
  });
}

/**
 * Atualiza UI de força de senha
 */
function updateStrengthUI(
  barElement: HTMLElement,
  labelElement: HTMLElement,
  feedbackElement: HTMLElement,
  strength: PasswordStrength
): void {
  const fill = barElement.querySelector('.strength-bar-fill') as HTMLElement;
  
  // Atualizar barra de progresso
  const widthPercent = (strength.score / 4) * 100;
  fill.style.width = `${widthPercent}%`;
  
  // Cores baseadas em score
  const colors = ['#ff4444', '#ff8800', '#ffcc00', '#88cc00', '#00cc44'];
  fill.style.backgroundColor = colors[strength.score];
  
  // Label
  labelElement.textContent = strength.label;
  labelElement.style.color = colors[strength.score];
  
  // Feedback
  if (strength.feedback.length > 0) {
    feedbackElement.innerHTML = `
      <ul class="strength-feedback-list">
        ${strength.feedback.map(f => `<li>${f}</li>`).join('')}
      </ul>
    `;
    feedbackElement.style.display = 'block';
  } else {
    feedbackElement.style.display = 'none';
  }
}

/**
 * Adiciona CSS inline se não existir
 */
export function injectPasswordStrengthStyles(): void {
  if (document.getElementById('password-strength-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'password-strength-styles';
  style.textContent = `
    .password-strength-container {
      margin-top: 8px;
      display: none;
    }
    
    .password-strength-bar {
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    
    .strength-bar-fill {
      height: 100%;
      width: 0%;
      transition: width 0.3s ease, background-color 0.3s ease;
      border-radius: 2px;
    }
    
    .password-strength-label {
      font-size: 0.85em;
      font-weight: 600;
      margin-bottom: 4px;
    }
    
    .password-strength-feedback {
      font-size: 0.8em;
      color: rgba(255, 255, 255, 0.7);
      display: none;
    }
    
    .strength-feedback-list {
      margin: 4px 0;
      padding-left: 20px;
      list-style: disc;
    }
    
    .strength-feedback-list li {
      margin: 2px 0;
    }
  `;
  
  document.head.appendChild(style);
}

/**
 * Inicializa indicadores de senha em formulários de registro
 */
export function initPasswordStrengthIndicators(): void {
  injectPasswordStrengthStyles();
  
  // Register form
  const registerPassword = document.getElementById('register-password');
  if (registerPassword) {
    attachPasswordStrengthIndicator('register-password');
  }
}

export default {
  attach: attachPasswordStrengthIndicator,
  injectStyles: injectPasswordStrengthStyles,
  init: initPasswordStrengthIndicators
};
