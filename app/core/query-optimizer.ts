// ============================================================
// QUERY-OPTIMIZER.TS - Helpers para Otimização de Queries
// ============================================================

import { supabase } from '../features/auth';
import { createLogger } from './logger';

const logger = createLogger('QueryOptimizer');

// ============================================================
// TYPES
// ============================================================

interface AggregatedUserData {
  stats: any;
  profile: any;
  inventory?: any[];
}

interface QueryOptions {
  includeInventory?: boolean;
  cacheTimeout?: number;
}

// Cache para evitar múltiplas queries simultâneas
const queryCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// ============================================================
// QUERY AGGREGATION
// ============================================================

/**
 * ⚡ Busca todos os dados do usuário em uma única operação otimizada
 * 
 * @param userId - ID do usuário
 * @param options - Opções de query
 * @returns Dados agregados do usuário
 * 
 * @example
 * const data = await fetchAggregatedUserData(userId, { includeInventory: true });
 * console.log(data.stats, data.profile, data.inventory);
 */
export async function fetchAggregatedUserData(
  userId: string,
  options: QueryOptions = {}
): Promise<AggregatedUserData | null> {
  const cacheKey = `user-data-${userId}`;
  const now = Date.now();
  
  // Verificar cache
  if (queryCache.has(cacheKey)) {
    const cached = queryCache.get(cacheKey)!;
    if (now - cached.timestamp < (options.cacheTimeout || CACHE_DURATION)) {
      logger.info(`[Cache Hit] ${cacheKey}`);
      return cached.data;
    }
  }
  
  try {
    const startTime = performance.now();
    
    const [statsResult, profileResult, inventoryResult] = await Promise.all([
      supabase.from('player_stats').select('*').eq('user_id', userId).single(),
      supabase.from('player_profiles').select('*').eq('user_id', userId).single(),
      options.includeInventory 
        ? supabase.from('player_inventory').select('*').eq('user_id', userId)
        : Promise.resolve({ data: null, error: null })
    ]);
    
    const duration = performance.now() - startTime;
    logger.info(`[Query] fetchAggregatedUserData completed in ${duration.toFixed(2)}ms`);
    
    // Verificar erros
    if (statsResult.error || profileResult.error || inventoryResult.error) {
      logger.error('[Query Error]', {
        stats: statsResult.error,
        profile: profileResult.error,
        inventory: inventoryResult.error
      });
      return null;
    }
    
    const aggregated: AggregatedUserData = {
      stats: statsResult.data,
      profile: profileResult.data,
      inventory: options.includeInventory ? (inventoryResult.data || undefined) : undefined
    };
    
    // Armazenar no cache
    queryCache.set(cacheKey, { data: aggregated, timestamp: now });
    
    return aggregated;
    
  } catch (error) {
    logger.error('[Query Exception]', error);
    return null;
  }
}

/**
 * ⚡ Busca dados essenciais para o header (stats + profile essenciais)
 * Query otimizada que busca apenas campos necessários
 * 
 * @param userId - ID do usuário
 * @returns Dados essenciais
 */
export async function fetchHeaderData(userId: string): Promise<any> {
  const cacheKey = `header-${userId}`;
  const now = Date.now();
  
  if (queryCache.has(cacheKey)) {
    const cached = queryCache.get(cacheKey)!;
    if (now - cached.timestamp < 30_000) { // Cache de 30s para header
      return cached.data;
    }
  }
  
  try {
    // ⚡ Query única com campos específicos
    const { data, error } = await supabase
      .from('player_stats')
      .select('username, level, money, diamonds, xp, avatar_url, role')
      .eq('user_id', userId)
      .single();
    
    if (error) {
      logger.error('[Header Query Error]', error);
      return null;
    }
    
    queryCache.set(cacheKey, { data, timestamp: now });
    return data;
    
  } catch (error) {
    logger.error('[Header Query Exception]', error);
    return null;
  }
}

/**
 * Invalida cache de usuário específico
 * Chamar após mudanças importantes (compras, level up, etc)
 */
export function invalidateUserCache(userId: string): void {
  queryCache.delete(`user-data-${userId}`);
  queryCache.delete(`header-${userId}`);
  logger.info(`[Cache Invalidated] user ${userId}`);
}

/**
 * Limpa todo o cache (chamar ao fazer logout)
 */
export function clearQueryCache(): void {
  queryCache.clear();
  logger.info('[Cache Cleared] All query cache cleared');
}

// ============================================================
// BATCH OPERATIONS
// ============================================================

/**
 * ⚡ Executa múltiplas queries em lote
 * Útil para operações admin ou dashboards
 * 
 * @param queries - Array de promessas de query
 * @returns Array de resultados
 */
export async function batchQueries<T>(
  queries: Promise<T>[],
  options: { logPerformance?: boolean } = {}
): Promise<T[]> {
  const start = performance.now();
  
  try {
    const results = await Promise.all(queries);
    
    if (options.logPerformance) {
      const duration = performance.now() - start;
      logger.info(`[Batch Query] ${queries.length} queries in ${duration.toFixed(2)}ms`);
    }
    
    return results;
    
  } catch (error) {
    logger.error('[Batch Query Error]', error);
    throw error;
  }
}

// ============================================================
// PERFORMANCE MONITORING
// ============================================================

/**
 * Wrapper para medir performance de queries
 */
export async function measureQuery<T>(
  name: string,
  queryFn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  
  try {
    const result = await queryFn();
    const duration = performance.now() - start;
    
    logger.info(`[Query Performance] ${name}: ${duration.toFixed(2)}ms`);
    
    // Alertar se query muito lenta
    if (duration > 1000) {
      logger.warn(`⚠️ Slow query detected: ${name} took ${duration}ms`);
    }
    
    return result;
    
  } catch (error) {
    const duration = performance.now() - start;
    logger.error(`[Query Error] ${name} failed after ${duration.toFixed(2)}ms`, error);
    throw error;
  }
}

// ============================================================
// EXPORTS
// ============================================================

export const QueryOptimizer = {
  fetchAggregatedUserData,
  fetchHeaderData,
  invalidateUserCache,
  clearQueryCache,
  batchQueries,
  measureQuery
};

export default QueryOptimizer;
