// ============================================================
// VALIDATION.TS - Sistema Centralizado de Validação
// ============================================================

/**
 * 🛡️ Sistema de validação robusto sem dependências externas
 * Valida: email, username, password, códigos 2FA, etc.
 */

// ============================================================
// EMAIL VALIDATION
// ============================================================

/**
 * Valida formato de email
 * Regex robusto baseado em RFC 5322
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  
  // Regex mais rigoroso que cobre 99% dos casos
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  // Verificações adicionais
  if (email.length > 254) return false; // Limite RFC
  if (email.startsWith('.') || email.endsWith('.')) return false;
  if (email.includes('..')) return false; // Pontos consecutivos
  
  return emailRegex.test(email);
}

/**
 * Normaliza email (lowercase, trim)
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ============================================================
// USERNAME VALIDATION
// ============================================================

/**
 * Valida username
 * Regras: 3-16 chars, apenas letras e números
 */
export function isValidUsername(username: string): boolean {
  if (!username || typeof username !== 'string') return false;
  
  // 3-16 caracteres, apenas letras e números
  const usernameRegex = /^[a-zA-Z0-9]{3,16}$/;
  return usernameRegex.test(username);
}

/**
 * Valida username com regras customizadas
 */
export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username) {
    return { valid: false, error: 'Username is required' };
  }
  
  if (username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  
  if (username.length > 16) {
    return { valid: false, error: 'Username must be at most 16 characters' };
  }
  
  if (!/^[a-zA-Z0-9]+$/.test(username)) {
    return { valid: false, error: 'Username can only contain letters and numbers' };
  }
  
  return { valid: true };
}

/**
 * Normaliza username (trim, case-insensitive)
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

// ============================================================
// PASSWORD VALIDATION
// ============================================================

export interface PasswordStrength {
  score: number; // 0-4
  label: 'Very Weak' | 'Weak' | 'Fair' | 'Strong' | 'Very Strong';
  feedback: string[];
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
}

/**
 * Valida força da senha
 * Retorna score de 0-4 e feedback detalhado
 */
export function validatePasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];
  
  // Critérios
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  
  // Score
  let score = 0;
  if (hasMinLength) score++;
  if (hasUppercase) score++;
  if (hasLowercase) score++;
  if (hasNumber) score++;
  if (hasSpecialChar) score++;
  
  // Penalidades
  if (password.length < 6) {
    score = 0;
    feedback.push('⚠️ Password is too short (minimum 8 characters recommended)');
  }
  
  // Feedback
  if (!hasMinLength) feedback.push('Use at least 8 characters');
  if (!hasUppercase) feedback.push('Add uppercase letters (A-Z)');
  if (!hasLowercase) feedback.push('Add lowercase letters (a-z)');
  if (!hasNumber) feedback.push('Add numbers (0-9)');
  if (!hasSpecialChar) feedback.push('Add special characters (!@#$%...)');
  
  // Verificar padrões comuns fracos
  const commonPatterns = ['123456', 'password', 'qwerty', 'abc123', '111111'];
  if (commonPatterns.some(pattern => password.toLowerCase().includes(pattern))) {
    score = Math.max(0, score - 2);
    feedback.push('⚠️ Avoid common patterns like "123456" or "password"');
  }
  
  // Label
  const labels: PasswordStrength['label'][] = [
    'Very Weak',
    'Weak',
    'Fair',
    'Strong',
    'Very Strong'
  ];
  
  return {
    score,
    label: labels[score],
    feedback,
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecialChar
  };
}

/**
 * Valida senha mínima (apenas comprimento)
 * Para login e situações menos rigorosas
 */
export function isValidPassword(password: string, minLength: number = 6): boolean {
  return !!(password && password.length >= minLength);
}

// ============================================================
// 2FA CODE VALIDATION
// ============================================================

/**
 * Valida código 2FA (6 dígitos)
 */
export function isValid2FACode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/**
 * Valida recovery code (formato XXXX-XXXX)
 */
export function isValidRecoveryCode(code: string): boolean {
  return /^[A-F0-9]{4}-[A-F0-9]{4}$/i.test(code);
}

// ============================================================
// GENERAL VALIDATORS
// ============================================================

/**
 * Valida string não vazia
 */
export function isNotEmpty(value: string): boolean {
  return value != null && value.trim().length > 0;
}

/**
 * Valida comprimento
 */
export function isValidLength(value: string, min: number, max: number): boolean {
  const len = value ? value.length : 0;
  return len >= min && len <= max;
}

/**
 * Valida número dentro de range
 */
export function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Valida URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitiza HTML (previne XSS)
 */
export function sanitizeHtml(html: string): string {
  const div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML;
}

/**
 * Escapa caracteres especiais SQL (básico)
 */
export function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

// ============================================================
// RATE LIMITING (Client-Side)
// ============================================================

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Rate limiting simples no client
 * @param key - Identificador único (ex: 'login', 'register')
 * @param maxAttempts - Máximo de tentativas
 * @param windowMs - Janela de tempo em ms
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): { allowed: boolean; remainingAttempts: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  
  if (!entry || now > entry.resetAt) {
    // Nova janela
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remainingAttempts: maxAttempts - 1, resetIn: windowMs };
  }
  
  if (entry.count >= maxAttempts) {
    // Limite excedido
    return {
      allowed: false,
      remainingAttempts: 0,
      resetIn: entry.resetAt - now
    };
  }
  
  // Incrementar contador
  entry.count++;
  return {
    allowed: true,
    remainingAttempts: maxAttempts - entry.count,
    resetIn: entry.resetAt - now
  };
}

/**
 * Reseta rate limit
 */
export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

// ============================================================
// BATCH VALIDATION
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Valida múltiplos campos de uma vez
 */
export function validateForm(fields: {
  email?: string;
  username?: string;
  password?: string;
  confirmPassword?: string;
}): ValidationResult {
  const errors: string[] = [];
  
  if (fields.email !== undefined) {
    if (!isValidEmail(fields.email)) {
      errors.push('Invalid email format');
    }
  }
  
  if (fields.username !== undefined) {
    const usernameResult = validateUsername(fields.username);
    if (!usernameResult.valid) {
      errors.push(usernameResult.error!);
    }
  }
  
  if (fields.password !== undefined) {
    if (!isValidPassword(fields.password, 6)) {
      errors.push('Password must be at least 6 characters');
    }
  }
  
  if (fields.confirmPassword !== undefined && fields.password !== undefined) {
    if (fields.password !== fields.confirmPassword) {
      errors.push('Passwords do not match');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================
// EXPORTS
// ============================================================

export const Validation = {
  email: {
    isValid: isValidEmail,
    normalize: normalizeEmail
  },
  username: {
    isValid: isValidUsername,
    validate: validateUsername,
    normalize: normalizeUsername
  },
  password: {
    isValid: isValidPassword,
    checkStrength: validatePasswordStrength
  },
  twoFactor: {
    isValidCode: isValid2FACode,
    isValidRecoveryCode
  },
  rateLimit: {
    check: checkRateLimit,
    reset: resetRateLimit
  },
  form: validateForm,
  sanitize: sanitizeHtml,
  isNotEmpty,
  isValidLength,
  isInRange,
  isValidUrl
};

export default Validation;
