// ============================================================
// CORE-UTILS.TS - Tipos, Error Handling & Window Management
// ============================================================
// Consolidação de types.ts + error-handler.ts + window-manager.ts
// Evita fragmentação desnecessária do código

import { createLogger } from './logger';
import { SECURITY } from '../shared/constants';

const logger = createLogger('CoreUtils');

// ============================================================
// SECTION 1: TYPES & INTERFACES
// ============================================================

export interface User {
  id: string;
  username?: string;
  email?: string;
  [key: string]: unknown;
}

export interface ReactiveValue<T> {
  value: T;
}

export interface RouteLoaderFunctions {
  renderInventory?: (userId: string) => Promise<void>;
  initLeaderboard?: (user: User | undefined) => Promise<void>;
  renderLeaderboard?: () => Promise<void>;
  initCaseOpening?: (
    user: User | undefined,
    money: number,
    diamonds: number,
    passes: string[],
    discountLevel: number
  ) => Promise<void>;
  loadPublicProfile?: (
    username: string,
    calculateLevel?: (points: number) => number,
    applyTranslations?: () => Promise<void>
  ) => Promise<void>;
  loadProfileData?: (
    user: User | undefined,
    calculateLevel?: (points: number) => number,
    applyTranslations?: () => Promise<void>
  ) => Promise<void>;
  loadUserThemes?: () => Promise<void>;
  initShop?: () => Promise<void>;
  loadSettingsData?: () => Promise<void>;
  applyTranslations?: () => Promise<void>;
  initSkillTree?: () => void;
  loadReferralsPanel?: () => Promise<void>;
  startAdminPolling?: () => void;
  showToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
  checkRouteAuth?: () => void;
  calculateLevel?: (points: number) => number;
  loadRouteData?: (screenName: string) => Promise<void>;
  invalidateRouteData?: (dataType: string) => void;
}

export interface GameStateGlobals {
  playerMoney?: ReactiveValue<number>;
  playerDiamonds?: ReactiveValue<number>;
  cachedDiamonds?: number;
  cachedUnlockedPasses?: string[];
  cachedCaseDiscountLevel?: number;
  publicProfileUsername?: string | null;
  handleLogout?: () => void;
  goTo?: (screen: string) => void;
}

export interface LootSkirmishWindow extends RouteLoaderFunctions, GameStateGlobals {
  currentUser?: User;
  __featureState?: Record<string, unknown>;
}

export interface LootSkirmishNamespace {
  store?: unknown;
  actions?: Record<string, unknown>;
  loadRouteData?: (screenName: string) => Promise<void>;
  invalidateRouteData?: (dataType: string) => void;
}

export enum ErrorType {
  STORAGE_FULL = 'STORAGE_FULL',
  PARSE_ERROR = 'PARSE_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN = 'UNKNOWN',
}

export interface AppError {
  type: ErrorType;
  message: string;
  originalError?: Error | unknown;
  context?: Record<string, unknown>;
  timestamp: number;
  shouldRetry: boolean;
}

// ============================================================
// SECTION 2: TYPE GUARDS & VALIDATORS
// ============================================================

export function isValidUser(user: unknown): user is User {
  if (!user || typeof user !== 'object') return false;
  const u = user as any;
  if (!u.id || typeof u.id !== 'string' || u.id.length < 10) return false;
  if (u.username && !isValidUsername(u.username)) return false;
  return true;
}

export function isValidUsername(username: unknown): boolean {
  if (typeof username !== 'string') return false;
  if (username.length < 3 || username.length > 20) return false;
  return /^[a-zA-Z0-9_-]+$/.test(username);
}

export function isReactiveValue<T>(value: unknown): value is ReactiveValue<T> {
  if (!value || typeof value !== 'object') return false;
  return 'value' in value;
}

export function getReactiveNumberValue(reactiveValue: unknown, defaultValue: number = 0): number {
  if (isReactiveValue<number>(reactiveValue) && typeof reactiveValue.value === 'number') {
    return reactiveValue.value;
  }
  return defaultValue;
}

export function isNumberInRange(
  value: unknown,
  min: number = 0,
  max: number = Number.MAX_SAFE_INTEGER
): boolean {
  return typeof value === 'number' && !isNaN(value) && value >= min && value <= max;
}

export function isStringSizeValid(value: unknown, minLength: number = 0, maxLength: number = 10000): boolean {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
}

export function isArrayValid<T>(
  value: unknown,
  minLength: number = 0,
  maxLength: number = 10000,
  itemValidator?: (item: unknown) => boolean
): value is T[] {
  if (!Array.isArray(value)) return false;
  if (value.length < minLength || value.length > maxLength) return false;
  if (itemValidator) {
    return value.every(itemValidator);
  }
  return true;
}

// ============================================================
// SECTION 3: ERROR HANDLER
// ============================================================

interface ErrorHandlerConfig {
  shouldLog?: boolean;
  shouldThrow?: boolean;
  shouldRetry?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  userFacingMessage?: string;
}

const errorHandlerDefaults: Record<ErrorType, ErrorHandlerConfig> = {
  [ErrorType.STORAGE_FULL]: {
    shouldLog: true,
    shouldThrow: false,
    shouldRetry: true,
    maxRetries: 2,
    userFacingMessage: 'Storage is full. Some data may not be saved.',
  },
  [ErrorType.PARSE_ERROR]: {
    shouldLog: true,
    shouldThrow: false,
    shouldRetry: false,
    userFacingMessage: 'Failed to process data. Please refresh.',
  },
  [ErrorType.NETWORK_ERROR]: {
    shouldLog: true,
    shouldThrow: false,
    shouldRetry: true,
    maxRetries: 3,
    userFacingMessage: 'Network error. Please check your connection.',
  },
  [ErrorType.VALIDATION_ERROR]: {
    shouldLog: true,
    shouldThrow: false,
    shouldRetry: false,
    userFacingMessage: 'Invalid data received.',
  },
  [ErrorType.AUTHORIZATION_ERROR]: {
    shouldLog: true,
    shouldThrow: true,
    shouldRetry: false,
    userFacingMessage: 'Access denied. Please log in again.',
  },
  [ErrorType.NOT_FOUND]: {
    shouldLog: true,
    shouldThrow: false,
    shouldRetry: false,
    userFacingMessage: 'Resource not found.',
  },
  [ErrorType.TIMEOUT]: {
    shouldLog: true,
    shouldThrow: false,
    shouldRetry: true,
    maxRetries: 2,
    userFacingMessage: 'Request timed out. Please try again.',
  },
  [ErrorType.UNKNOWN]: {
    shouldLog: true,
    shouldThrow: false,
    shouldRetry: false,
    userFacingMessage: 'An unexpected error occurred.',
  },
};

function classifyError(error: unknown): ErrorType {
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') return ErrorType.STORAGE_FULL;
    if (error.name === 'SyntaxError') return ErrorType.PARSE_ERROR;
    if (error.message.includes('Network') || error.message.includes('timeout')) {
      return ErrorType.NETWORK_ERROR;
    }
  }

  if (typeof error === 'string') {
    if (error.includes('quota')) return ErrorType.STORAGE_FULL;
    if (error.includes('parse') || error.includes('json')) return ErrorType.PARSE_ERROR;
    if (error.includes('network') || error.includes('timeout')) return ErrorType.NETWORK_ERROR;
  }

  return ErrorType.UNKNOWN;
}

function createAppError(
  type: ErrorType,
  message: string,
  originalError?: unknown,
  context?: Record<string, unknown>
): AppError {
  return {
    type,
    message,
    originalError,
    context,
    timestamp: Date.now(),
    shouldRetry: errorHandlerDefaults[type].shouldRetry ?? false,
  };
}

export class ErrorHandler {
  private static readonly userFacingCallbacks: Array<(message: string, errorType: ErrorType) => void> = [];

  static onUserFacingError(callback: (message: string, errorType: ErrorType) => void): void {
    this.userFacingCallbacks.push(callback);
  }

  private static notifyUser(message: string, errorType: ErrorType): void {
    for (const callback of this.userFacingCallbacks) {
      try {
        callback(message, errorType);
      } catch (e) {
        logger.error('Error in user notification callback', { error: e });
      }
    }
  }

  static handle(
    error: unknown,
    context: {
      operation?: string;
      errorType?: ErrorType;
      config?: Partial<ErrorHandlerConfig>;
    } = {}
  ): AppError {
    const { operation, errorType, config = {} } = context;
    const type = errorType || classifyError(error);
    const finalConfig: ErrorHandlerConfig = {
      ...errorHandlerDefaults[type],
      ...config,
    };

    let message = 'Unknown error occurred';
    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
      message = String((error as any).message);
    }

    const appError = createAppError(type, message, error, { operation, ...finalConfig });

    if (finalConfig.shouldLog) {
      const logLevel = type === ErrorType.AUTHORIZATION_ERROR ? 'warn' : 'error';
      logger[logLevel as 'error' | 'warn'](`[${operation || 'Unknown'}] ${message}`, {
        errorType: type,
        originalError: error,
      });
    }

    if (finalConfig.userFacingMessage) {
      this.notifyUser(finalConfig.userFacingMessage, type);
    }

    if (finalConfig.shouldThrow) {
      throw appError;
    }

    return appError;
  }

  static async withRetry<T>(
    operation: () => Promise<T>,
    context: {
      operation?: string;
      maxRetries?: number;
      retryDelayMs?: number;
      backoffMultiplier?: number;
    } = {}
  ): Promise<T> {
    const {
      operation: operationName = 'retry-operation',
      maxRetries = 3,
      retryDelayMs = 1000,
      backoffMultiplier = 2,
    } = context;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const errorType = classifyError(error);
        const shouldRetry = errorHandlerDefaults[errorType].shouldRetry ?? false;

        if (!shouldRetry || attempt === maxRetries) {
          this.handle(error, { operation: operationName, errorType });
          throw error;
        }

        const delayMs = retryDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        logger.warn(`[${operationName}] Retry ${attempt}/${maxRetries} after ${delayMs}ms`, { error });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    this.handle(lastError, { operation: operationName });
    throw lastError;
  }

  static async safe<T>(
    operation: () => Promise<T>,
    fallback: T,
    context: { operation?: string } = {}
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.handle(error, { operation: context.operation, config: { shouldThrow: false } });
      return fallback;
    }
  }

  static validate(condition: boolean, message: string, context?: Record<string, unknown>): void {
    if (!condition) {
      const error = createAppError(ErrorType.VALIDATION_ERROR, message, undefined, context);
      logger.error(message, { context });
      throw error;
    }
  }
}

export async function safeTry<T>(
  operation: () => Promise<T>,
  operationName: string,
  fallback?: T
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    ErrorHandler.handle(error, {
      operation: operationName,
      config: { shouldThrow: false },
    });
    return fallback;
  }
}

// ============================================================
// SECTION 4: WINDOW MANAGER
// ============================================================

declare global {
  interface Window {
    __LOOTSKIRMISH__?: LootSkirmishNamespace;
  }
}

export class WindowManager {
  static init(initialData?: Partial<LootSkirmishNamespace>): void {
    if (typeof window === 'undefined') return;

    if (!window.__LOOTSKIRMISH__) {
      window.__LOOTSKIRMISH__ = {
        ...initialData,
      };
      logger.info('Initialized LootSkirmish window namespace');
    }
  }

  static getNamespace(): LootSkirmishNamespace {
    if (typeof window === 'undefined') {
      return {};
    }

    if (!window.__LOOTSKIRMISH__) {
      this.init();
    }

    return window.__LOOTSKIRMISH__ || {};
  }

  static registerRouteLoaders(functions: {
    loadRouteData: (screenName: string) => Promise<void>;
    invalidateRouteData: (dataType: string) => void;
  }): void {
    const ns = this.getNamespace();
    ns.loadRouteData = functions.loadRouteData;
    ns.invalidateRouteData = functions.invalidateRouteData;
    logger.debug('Route loaders registered in namespace');
  }

  static getRouteLoaders(): {
    loadRouteData?: (screenName: string) => Promise<void>;
    invalidateRouteData?: (dataType: string) => void;
  } {
    const ns = this.getNamespace();
    return {
      loadRouteData: ns.loadRouteData,
      invalidateRouteData: ns.invalidateRouteData,
    };
  }

  static getWindowFunction<T extends (...args: any[]) => any>(
    functionName: keyof LootSkirmishWindow
  ): T | undefined {
    if (typeof window === 'undefined') return undefined;

    const fn = (window as any)[functionName];
    if (typeof fn !== 'function') {
      return undefined;
    }

    return fn as T;
  }

  static getReactiveValue<T>(
    propertyName: string,
    defaultValue?: T
  ): T | undefined {
    if (typeof window === 'undefined') return defaultValue;

    const prop = (window as any)[propertyName];

    if (prop && typeof prop === 'object' && 'value' in prop) {
      return (prop as ReactiveValue<T>).value;
    }

    if (prop !== undefined) {
      return prop as T;
    }

    return defaultValue;
  }

  static getPlayerMoney(): number {
    if (typeof window === 'undefined') return 0;

    const playerMoney = (window as any).playerMoney;
    if (playerMoney && typeof playerMoney === 'object' && 'value' in playerMoney) {
      const value = playerMoney.value;
      return typeof value === 'number' && value >= 0 ? value : 0;
    }

    return 0;
  }

  static getPlayerDiamonds(): number {
    if (typeof window === 'undefined') return 0;

    const cached = (window as any).cachedDiamonds;
    if (typeof cached === 'number' && cached >= 0) {
      return cached;
    }

    const playerDiamonds = (window as any).playerDiamonds;
    if (playerDiamonds && typeof playerDiamonds === 'object' && 'value' in playerDiamonds) {
      const value = playerDiamonds.value;
      return typeof value === 'number' && value >= 0 ? value : 0;
    }

    return 0;
  }

  static getUnlockedPasses(): string[] {
    if (typeof window === 'undefined') return [];

    const passes = (window as any).cachedUnlockedPasses;
    if (Array.isArray(passes)) {
      return passes.filter((p): p is string => typeof p === 'string');
    }

    return [];
  }

  static getCaseDiscountLevel(): number {
    if (typeof window === 'undefined') return 0;

    const level = (window as any).cachedCaseDiscountLevel;
    return typeof level === 'number' && level >= 0 ? level : 0;
  }

  static getCurrentUser(): User | undefined {
    if (typeof window === 'undefined') return undefined;

    const user = (window as any).currentUser;
    if (user && typeof user === 'object' && 'id' in user && typeof user.id === 'string') {
      return user as User;
    }

    return undefined;
  }

  static getPublicProfileUsername(): string | null {
    if (typeof window === 'undefined') return null;

    const username = (window as any).publicProfileUsername;
    if (typeof username === 'string') {
      return username;
    }

    return null;
  }

  static getFeatureState(): Record<string, unknown> {
    if (typeof window === 'undefined') return {};

    const state = (window as any).__featureState;
    if (typeof state === 'object' && state !== null) {
      return state as Record<string, unknown>;
    }

    return {};
  }

  static setFeatureState(key: string, value: unknown): void {
    if (typeof window === 'undefined') return;

    if (!(window as any).__featureState) {
      (window as any).__featureState = {};
    }

    (window as any).__featureState[key] = value;
    logger.debug(`Feature state updated: ${key}`);
  }

  static clearFeatureState(): void {
    if (typeof window === 'undefined') return;

    (window as any).__featureState = {};
    logger.debug('Feature state cleared');
  }

  private static listeners: Array<{
    target: EventTarget;
    event: string;
    handler: EventListener;
  }> = [];

  static addListener(
    target: EventTarget,
    event: string,
    handler: EventListener
  ): () => void {
    target.addEventListener(event, handler);
    this.listeners.push({ target, event, handler });

    return () => this.removeListener(target, event, handler);
  }

  static removeListener(target: EventTarget, event: string, handler: EventListener): void {
    target.removeEventListener(event, handler);
    this.listeners = this.listeners.filter(
      l => !(l.target === target && l.event === event && l.handler === handler)
    );
  }

  static removeAllListeners(): void {
    for (const { target, event, handler } of this.listeners) {
      target.removeEventListener(event, handler);
    }
    this.listeners = [];
    logger.info('All window listeners cleaned up');
  }

  static hasFunction(functionName: keyof LootSkirmishWindow): boolean {
    if (typeof window === 'undefined') return false;
    return typeof (window as any)[functionName] === 'function';
  }

  static hasValue(propertyName: string): boolean {
    if (typeof window === 'undefined') return false;
    return (window as any)[propertyName] !== undefined;
  }
}

export function initWindowManager(): void {
  if (typeof window !== 'undefined') {
    WindowManager.init();
    logger.info('Window manager initialized');
  }
}
