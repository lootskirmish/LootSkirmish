// ============================================================
// ERROR-HANDLER.TS - Sistema Centralizado de Tratamento de Erros
// ============================================================

/**
 * 🛡️ Error Handler robusto sem dependências externas
 * Substitui múltiplos console.error() por sistema estruturado
 */

import { createLogger } from '../core/logger';
import { showAlert, showToast } from './effects';

const logger = createLogger('ErrorHandler');

// ============================================================
// TYPES
// ============================================================

export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export enum ErrorCategory {
  AUTH = 'auth',
  NETWORK = 'network',
  VALIDATION = 'validation',
  DATABASE = 'database',
  PAYMENT = 'payment',
  PERMISSION = 'permission',
  UNKNOWN = 'unknown'
}

export interface AppError {
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  code?: string;
  details?: any;
  userMessage?: string;
  timestamp: Date;
  stack?: string;
  context?: Record<string, any>;
}

export interface ErrorLogEntry extends AppError {
  id: string;
  userId?: string;
  userAgent?: string;
  url?: string;
}

// ============================================================
// ERROR STORAGE
// ============================================================

const ERROR_LOG_KEY = 'ls-error-log';
const MAX_STORED_ERRORS = 50;

class ErrorStorage {
  private errors: ErrorLogEntry[] = [];
  
  constructor() {
    this.loadFromStorage();
  }
  
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(ERROR_LOG_KEY);
      if (stored) {
        this.errors = JSON.parse(stored);
      }
    } catch {
      this.errors = [];
    }
  }
  
  private saveToStorage(): void {
    try {
      // Manter apenas últimos MAX_STORED_ERRORS
      const toStore = this.errors.slice(-MAX_STORED_ERRORS);
      localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(toStore));
    } catch {
      // Ignorar erro de storage
    }
  }
  
  add(error: ErrorLogEntry): void {
    this.errors.push(error);
    this.saveToStorage();
  }
  
  getAll(): ErrorLogEntry[] {
    return [...this.errors];
  }
  
  getRecent(count: number = 10): ErrorLogEntry[] {
    return this.errors.slice(-count);
  }
  
  getBySeverity(severity: ErrorSeverity): ErrorLogEntry[] {
    return this.errors.filter(e => e.severity === severity);
  }
  
  getByCategory(category: ErrorCategory): ErrorLogEntry[] {
    return this.errors.filter(e => e.category === category);
  }
  
  clear(): void {
    this.errors = [];
    localStorage.removeItem(ERROR_LOG_KEY);
  }
}

const errorStorage = new ErrorStorage();

// ============================================================
// ERROR HANDLER
// ============================================================

class AppErrorHandler {
  private notificationShown = false;
  private lastErrorTime = 0;
  private errorCount = 0;
  
  /**
   * Trata erro capturado
   */
  handle(error: AppError): void {
    // Criar log entry
    const logEntry: ErrorLogEntry = {
      ...error,
      id: this.generateId(),
      userId: this.getUserId(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };
    
    // Armazenar
    errorStorage.add(logEntry);
    
    // Log no console
    this.logToConsole(logEntry);
    
    // Mostrar notificação ao usuário (com debounce)
    this.notifyUser(logEntry);
    
    // Ações específicas por severidade
    this.handleBySeverity(logEntry);
  }
  
  /**
   * Cria erro estruturado e trata
   */
  handleError(
    message: string,
    options: {
      category?: ErrorCategory;
      severity?: ErrorSeverity;
      code?: string;
      details?: any;
      userMessage?: string;
      context?: Record<string, any>;
      error?: Error;
      showToUser?: boolean;
    } = {}
  ): void {
    const appError: AppError = {
      message,
      category: options.category || ErrorCategory.UNKNOWN,
      severity: options.severity || ErrorSeverity.ERROR,
      code: options.code,
      details: options.details,
      userMessage: options.userMessage,
      timestamp: new Date(),
      stack: options.error?.stack,
      context: options.context
    };
    
    this.handle(appError);
    
    // Mostrar ao usuário se solicitado
    if (options.showToUser !== false) {
      this.showUserMessage(appError);
    }
  }
  
  /**
   * Wrapper para erros de auth
   */
  handleAuthError(message: string, details?: any, userMessage?: string): void {
    this.handleError(message, {
      category: ErrorCategory.AUTH,
      severity: ErrorSeverity.WARNING,
      details,
      userMessage: userMessage || 'Authentication failed. Please try again.',
      showToUser: true
    });
  }
  
  /**
   * Wrapper para erros de network
   */
  handleNetworkError(message: string, details?: any): void {
    this.handleError(message, {
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.ERROR,
      details,
      userMessage: 'Network error. Please check your connection.',
      showToUser: true
    });
  }
  
  /**
   * Wrapper para erros de validação
   */
  handleValidationError(message: string, details?: any, userMessage?: string): void {
    this.handleError(message, {
      category: ErrorCategory.VALIDATION,
      severity: ErrorSeverity.WARNING,
      details,
      userMessage: userMessage || message,
      showToUser: true
    });
  }
  
  /**
   * Wrapper para erros de database
   */
  handleDatabaseError(message: string, details?: any): void {
    this.handleError(message, {
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.ERROR,
      details,
      userMessage: 'Database error. Please try again later.',
      showToUser: true
    });
  }
  
  /**
   * Wrapper para erros de payment
   */
  handlePaymentError(message: string, details?: any, userMessage?: string): void {
    this.handleError(message, {
      category: ErrorCategory.PAYMENT,
      severity: ErrorSeverity.CRITICAL,
      details,
      userMessage: userMessage || 'Payment error. Please contact support.',
      showToUser: true
    });
  }
  
  private logToConsole(error: ErrorLogEntry): void {
    const prefix = `[${error.severity.toUpperCase()}] [${error.category}]`;
    
    switch (error.severity) {
      case ErrorSeverity.INFO:
        console.info(prefix, error.message, error.details);
        break;
      case ErrorSeverity.WARNING:
        console.warn(prefix, error.message, error.details);
        break;
      case ErrorSeverity.ERROR:
      case ErrorSeverity.CRITICAL:
        console.error(prefix, error.message, error.details);
        if (error.stack) console.error('Stack:', error.stack);
        break;
    }
  }
  
  private notifyUser(error: ErrorLogEntry): void {
    const now = Date.now();
    
    // Debounce: evitar spam de notificações
    if (now - this.lastErrorTime < 2000) {
      this.errorCount++;
      return;
    }
    
    this.lastErrorTime = now;
    
    if (this.errorCount > 1) {
      showToast('error', '⚠️ Multiple Errors', `${this.errorCount} errors occurred`);
      this.errorCount = 0;
    }
  }
  
  private showUserMessage(error: AppError): void {
    const message = error.userMessage || error.message;
    
    switch (error.severity) {
      case ErrorSeverity.INFO:
        showToast('info', 'Info', message);
        break;
      case ErrorSeverity.WARNING:
        showToast('warning', 'Warning', message);
        break;
      case ErrorSeverity.ERROR:
        showAlert('error', 'Error', message);
        break;
      case ErrorSeverity.CRITICAL:
        showAlert('error', '⚠️ Critical Error', message + '\n\nPlease contact support if this persists.');
        break;
    }
  }
  
  private handleBySeverity(error: ErrorLogEntry): void {
    if (error.severity === ErrorSeverity.CRITICAL) {
      // Erros críticos: pode desabilitar funcionalidades
      logger.error('[CRITICAL ERROR]', error);
      
      // Opcional: enviar para admin via API
      this.reportToAdmin(error);
    }
  }
  
  private async reportToAdmin(error: ErrorLogEntry): Promise<void> {
    // Enviar erro crítico para backend (opcional)
    try {
      // await fetch('/api/error-report', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(error)
      // });
    } catch {
      // Ignorar falha de report
    }
  }
  
  private generateId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private getUserId(): string | undefined {
    try {
      return (window as any).currentUser?.id;
    } catch {
      return undefined;
    }
  }
  
  /**
   * Obtém estatísticas de erros
   */
  getStats(): {
    total: number;
    bySeverity: Record<ErrorSeverity, number>;
    byCategory: Record<ErrorCategory, number>;
    recent: ErrorLogEntry[];
  } {
    const all = errorStorage.getAll();
    
    const bySeverity = {
      [ErrorSeverity.INFO]: 0,
      [ErrorSeverity.WARNING]: 0,
      [ErrorSeverity.ERROR]: 0,
      [ErrorSeverity.CRITICAL]: 0
    };
    
    const byCategory = {
      [ErrorCategory.AUTH]: 0,
      [ErrorCategory.NETWORK]: 0,
      [ErrorCategory.VALIDATION]: 0,
      [ErrorCategory.DATABASE]: 0,
      [ErrorCategory.PAYMENT]: 0,
      [ErrorCategory.PERMISSION]: 0,
      [ErrorCategory.UNKNOWN]: 0
    };
    
    all.forEach(err => {
      bySeverity[err.severity]++;
      byCategory[err.category]++;
    });
    
    return {
      total: all.length,
      bySeverity,
      byCategory,
      recent: errorStorage.getRecent(5)
    };
  }
  
  /**
   * Limpa log de erros
   */
  clearLog(): void {
    errorStorage.clear();
  }
}

// ============================================================
// SINGLETON
// ============================================================

export const ErrorHandler = new AppErrorHandler();

// ============================================================
// GLOBAL ERROR HANDLERS
// ============================================================

/**
 * Captura erros não tratados
 */
window.addEventListener('error', (event) => {
  ErrorHandler.handleError(event.message, {
    category: ErrorCategory.UNKNOWN,
    severity: ErrorSeverity.ERROR,
    details: {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    },
    error: event.error,
    showToUser: false // Não mostrar erros JS genéricos ao usuário
  });
});

/**
 * Captura promises rejeitadas não tratadas
 */
window.addEventListener('unhandledrejection', (event) => {
  ErrorHandler.handleError('Unhandled promise rejection', {
    category: ErrorCategory.UNKNOWN,
    severity: ErrorSeverity.ERROR,
    details: event.reason,
    showToUser: false
  });
});

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Wrapper para try-catch com error handling automático
 */
export async function tryCatch<T>(
  fn: () => Promise<T>,
  options: {
    errorMessage?: string;
    category?: ErrorCategory;
    userMessage?: string;
    showToUser?: boolean;
  } = {}
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    ErrorHandler.handleError(
      options.errorMessage || 'Operation failed',
      {
        category: options.category || ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.ERROR,
        error: error as Error,
        userMessage: options.userMessage,
        showToUser: options.showToUser !== false
      }
    );
    return null;
  }
}

/**
 * Retry com exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delay?: number;
    backoff?: number;
    onRetry?: (attempt: number) => void;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts || 3;
  const initialDelay = options.delay || 1000;
  const backoffFactor = options.backoff || 2;
  
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxAttempts) {
        const delay = initialDelay * Math.pow(backoffFactor, attempt - 1);
        if (options.onRetry) options.onRetry(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// ============================================================
// EXPORTS
// ============================================================

export default ErrorHandler;

// Expor globalmente para debug
if (typeof window !== 'undefined') {
  (window as any).__errorHandler = ErrorHandler;
}
