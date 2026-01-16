// ============================================================
// LOGGER.TS - Structured Logging System
// ============================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  timestamp: number;
  message: string;
  context?: string;
  data?: any;
}

class Logger {
  private isDev: boolean;
  private minLevel: LogLevel;
  private context: string;
  private sensitivePatterns: RegExp[];

  constructor(context: string = 'App') {
    this.context = context;
    this.isDev = typeof window !== 'undefined';
    this.minLevel = this.isDev ? 'debug' : 'warn';
    this.sensitivePatterns = [
      /token/i,
      /password/i,
      /secret/i,
      /api[_-]?key/i,
      /auth/i,
      /csrf/i,
    ];
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    return levels[level] >= levels[this.minLevel];
  }

  private sanitize(data: any): any {
    if (!data || typeof data !== 'object') return data;

    const sanitized: any = Array.isArray(data) ? [] : {};
    
    for (const [key, value] of Object.entries(data)) {
      const isSensitive = this.sensitivePatterns.some(pattern => pattern.test(key));
      
      if (isSensitive) {
        sanitized[key] = typeof value === 'string' 
          ? `${value.slice(0, 4)}...${value.slice(-4)}`
          : '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  private formatEntry(entry: LogEntry): string {
    const time = new Date(entry.timestamp).toISOString();
    const ctx = entry.context || this.context;
    return `[${time}] [${entry.level.toUpperCase()}] [${ctx}] ${entry.message}`;
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      timestamp: Date.now(),
      message,
      context: this.context,
      data: data ? this.sanitize(data) : undefined,
    };

    const formatted = this.formatEntry(entry);
    const consoleMethod = level === 'debug' ? 'log' : level;

    if (entry.data) {
      console[consoleMethod](formatted, entry.data);
    } else {
      console[consoleMethod](formatted);
    }
  }

  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: any): void {
    this.log('error', message, data);
  }

  // Performance measurement
  mark(label: string): void {
    if (this.isDev && typeof performance !== 'undefined') {
      performance.mark(`${this.context}:${label}`);
    }
  }

  measure(label: string, startMark: string, endMark?: string): number | null {
    if (!this.isDev || typeof performance === 'undefined') return null;

    try {
      const start = `${this.context}:${startMark}`;
      const end = endMark ? `${this.context}:${endMark}` : undefined;
      
      if (!end) {
        performance.mark(start + ':end');
      }
      
      const measureName = `${this.context}:${label}`;
      performance.measure(measureName, start, end || start + ':end');
      
      const measure = performance.getEntriesByName(measureName)[0];
      this.debug(`Performance: ${label} took ${measure.duration.toFixed(2)}ms`);
      
      return measure.duration;
    } catch (error) {
      this.warn('Failed to measure performance', { label, error });
      return null;
    }
  }

  createChild(childContext: string): Logger {
    const child = new Logger(`${this.context}:${childContext}`);
    child.minLevel = this.minLevel;
    return child;
  }
}

// Export singleton and factory
export const logger = new Logger('Core');
export function createLogger(context: string): Logger {
  return new Logger(context);
}
