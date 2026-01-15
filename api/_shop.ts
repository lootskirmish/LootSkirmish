// ============================================================
// API/_SHOP.TS - Shop & Payments Management
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import {
  applyCors,
  validateSessionAndFetchPlayerStats,
  logAudit,
  getIdentifier,
  checkRateLimit,
  cleanupOldEntries,
  ValidationSchemas,
  verifyStripeSignature,
  verifyMercadoPagoSignature,
  createSecureLog,
  maskUserId,
  maskEmail
} from './_utils.js';

import { 
  applyReferralDiamondBonus 
} from './_referrals.js';

dotenv.config();

// ============================================================
// TYPES
// ============================================================

interface ApiRequest {
  method?: string;
  body?: any;
  rawBody?: Buffer | string;
  readable?: boolean;
  headers?: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
  query?: Record<string, string | string[] | undefined>;
  path?: string;
  url?: string;
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (data: any) => void;
  end: (data?: any) => void;
  setHeader: (key: string, value: string) => void;
}

interface Package {
  id: string;
  name: string;
  diamonds: number;
  price: number;
  priceBRL: number;
  priceId: string;
  firstPurchaseBonus?: {
    type: string;
    value: number;
  };
  timedBonus?: {
    percentage: number;
    endsAt: string;
  };
}

interface Subscription {
  id: string;
  name: string;
  price: number;
  priceBRL: number;
  priceId: string;
  duration: number;
  diamonds: number;
  dailyDiamonds: number;
}

// Vercel webhook endpoints (Stripe) need raw body to validate signatures.
export const config = {
  api: {
    bodyParser: false
  }
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================

const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16'
});

// ============================================================
// CLASSES (shop-only implementations - must be before instantiation)
// ============================================================

interface ProgressiveRateLimitEntry {
  count: number;
  resetAt: number;
  lastSeenAt: number;
  violations: number;
  blockedUntil?: number;
}

class ProgressiveRateLimiter {
  private map = new Map<string, ProgressiveRateLimitEntry>();
  private ipBlacklist = new Set<string>();

  isIPBlacklisted(ip: string): boolean {
    return this.ipBlacklist.has(ip);
  }

  blacklistIP(ip: string): void {
    this.ipBlacklist.add(ip);
    console.warn(`⚠️ IP ${ip} added to blacklist`);
  }

  removeIPFromBlacklist(ip: string): void {
    this.ipBlacklist.delete(ip);
  }

  checkProgressiveLimit(
    identifier: string,
    { maxRequests = 30, windowMs = 60_000, actionType = 'default' }: { maxRequests?: number; windowMs?: number; actionType?: string } = {}
  ): { allowed: boolean; remainingTime?: number } {
    const now = Date.now();
    let entry = this.map.get(identifier);

    if (entry?.blockedUntil && now < entry.blockedUntil) {
      return { allowed: false, remainingTime: entry.blockedUntil - now };
    }

    if (!entry || now >= entry.resetAt) {
      entry = { count: 1, resetAt: now + windowMs, lastSeenAt: now, violations: 0 };
      this.map.set(identifier, entry);
      return { allowed: true };
    }

    entry.lastSeenAt = now;

    if (entry.count < maxRequests) {
      entry.count += 1;
      return { allowed: true };
    }

    entry.violations += 1;
    const blockDuration = this.getProgressiveBlockDuration(entry.violations);
    entry.blockedUntil = now + blockDuration;

    console.warn(`⚠️ Rate limit exceeded for ${identifier} (violation #${entry.violations}, action: ${actionType})`);

    if (entry.violations > 5) {
      this.blacklistIP(identifier);
    }

    return { allowed: false, remainingTime: blockDuration };
  }

  private getProgressiveBlockDuration(violations: number): number {
    const durations = [5 * 60_000, 15 * 60_000, 60 * 60_000, 24 * 60 * 60_000];
    return durations[Math.min(violations - 1, durations.length - 1)];
  }

  cleanup(): void {
    const now = Date.now();
    let deleted = 0;
    for (const [key, entry] of this.map.entries()) {
      if (now - entry.lastSeenAt > 24 * 60 * 60_000) {
        this.map.delete(key);
        deleted += 1;
        if (deleted > 500) break;
      }
    }
  }
}

interface PendingOrder {
  id: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
}

class PendingOrderManager {
  private pendingOrders = new Map<string, PendingOrder>();
  private readonly orderTimeout = 30 * 60 * 1000;

  addOrder(order: Omit<PendingOrder, 'expiresAt' | 'createdAt'>): void {
    const now = Date.now();
    this.pendingOrders.set(order.id, { ...order, createdAt: now, expiresAt: now + this.orderTimeout });
  }

  getExpiredOrders(): PendingOrder[] {
    const now = Date.now();
    const expired: PendingOrder[] = [];
    for (const order of this.pendingOrders.values()) {
      if (now > order.expiresAt) expired.push(order);
    }
    return expired;
  }

  markAsCompleted(orderId: string): void {
    this.pendingOrders.delete(orderId);
  }

  cleanup(): void {
    for (const order of this.getExpiredOrders()) {
      this.pendingOrders.delete(order.id);
    }
  }
}

class WebhookReplayProtection {
  private processedWebhooks = new Map<string, number>();

  hasBeenProcessed(webhookId: string): boolean {
    return this.processedWebhooks.has(webhookId);
  }

  markAsProcessed(webhookId: string): void {
    this.processedWebhooks.set(webhookId, Date.now());
  }

  cleanup(): void {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    for (const [id, timestamp] of this.processedWebhooks.entries()) {
      if (now - timestamp > oneDay) {
        this.processedWebhooks.delete(id);
      }
    }
  }
}

class SecurityMonitor {
  private metrics = {
    rateLimitViolations: 0,
    authFailures: 0,
    webhookFailures: 0,
    fraudAttempts: 0
  };

  recordRateLimitViolation(): void {
    this.metrics.rateLimitViolations += 1;
  }

  recordAuthFailure(): void {
    this.metrics.authFailures += 1;
  }

  recordWebhookFailure(): void {
    this.metrics.webhookFailures += 1;
  }

  recordFraudAttempt(): void {
    this.metrics.fraudAttempts += 1;
  }

  getMetrics() {
    return { ...this.metrics, timestamp: new Date().toISOString() };
  }

  reset(): void {
    this.metrics = {
      rateLimitViolations: 0,
      authFailures: 0,
      webhookFailures: 0,
      fraudAttempts: 0
    };
  }
}

// ============================================================
// SECURITY INITIALIZATION
// ============================================================

const progressiveRateLimiter = new ProgressiveRateLimiter();
const webhookReplayProtection = new WebhookReplayProtection();
const pendingOrderManager = new PendingOrderManager();
const securityMonitor = new SecurityMonitor();

let lastSecurityCleanupAt = 0;
function maybeCleanupSecurity(): void {
  const now = Date.now();
  if (now - lastSecurityCleanupAt < 15 * 60_000) return; // 15 min
  lastSecurityCleanupAt = now;
  webhookReplayProtection.cleanup();
  pendingOrderManager.cleanup();
  progressiveRateLimiter.cleanup();
}

// ============================================================
// CONFIGURAÇÃO DE PACOTES E ASSINATURAS
// ============================================================

const STRIPE_PRICE_IDS = {
  STARTER: 'price_1Sov9SC4sph1j0MSJggz6zvH',
  BRONZE: 'price_1SovAjC4sph1j0MSdwo9fdRM',
  SILVER: 'price_1SovCBC4sph1j0MS3ydPa7rP',
  GOLD: 'price_1SovD8C4sph1j0MSslCHqV8J',
  PREMIUM_SUB: 'price_1SpERfC4sph1j0MSbo6OCl7J'
};

const PACKAGES: Package[] = [
  {
    id: 'pkg_150',
    name: 'STARTER PACK',
    diamonds: 150,
    price: 1.99, // USD
    priceBRL: 14.99, // ← Adicione o preço em BRL
    priceId: STRIPE_PRICE_IDS.STARTER,
    firstPurchaseBonus: {
      type: 'percentage',
      value: 50
    }
  },
  {
    id: 'pkg_400',
    name: 'BRONZE PACK',
    diamonds: 400,
    price: 4.49,
    priceBRL: 27.49,
    priceId: STRIPE_PRICE_IDS.BRONZE
  },
  {
    id: 'pkg_1000',
    name: 'SILVER PACK',
    diamonds: 1000,
    price: 11.99,
    priceBRL: 69.99,
    priceId: STRIPE_PRICE_IDS.SILVER,
    timedBonus: {
      percentage: 25,
      endsAt: '2026-01-20T23:59:59Z'
    }
  },
  {
    id: 'pkg_1800',
    name: 'GOLD PACK',
    diamonds: 1800,
    price: 19.99,
    priceBRL: 119.99,
    priceId: STRIPE_PRICE_IDS.GOLD
  }
];

const SUBSCRIPTIONS: Subscription[] = [
  {
    id: 'sub_premium',
    name: 'PREMIUM SUBSCRIPTION',
    price: 4.99,
    priceBRL: 29.99,
    priceId: STRIPE_PRICE_IDS.PREMIUM_SUB,
    duration: 30,
    diamonds: 250,
    dailyDiamonds: 12
  }
];

// ============================================================
// RATE LIMITING
// ============================================================

const shopRateLimits = new Map();
let lastShopCleanupAt: number = 0;

function getShopRateLimitConfig(): { maxRequests: number; windowMs: number } {
  const maxRequests = parseInt(process.env.SHOP_RATE_LIMIT_MAX || '2');
  const windowMs = parseInt(process.env.SHOP_RATE_LIMIT_WINDOW || '60000');
  return { maxRequests, windowMs };
}

// ============================================================
// HELPERS
// ============================================================

function normalizeNumber(value: any, fallback: number = 0): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

async function getRawBody(req: ApiRequest): Promise<Buffer | null> {
  if (req.rawBody) {
    return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody);
  }

  if (typeof req.body === 'string') {
    return Buffer.from(req.body);
  }

  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && !req.readable) {
    try {
      return Buffer.from(JSON.stringify(req.body));
    } catch (err) {
      const error = err as any;
      console.warn('⚠️ Failed to stringify parsed body:', error.message);
    }
  }

  if (!req.readable) return null;

  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks);
  req.rawBody = raw;
  return raw;
}

async function getJsonBody(req: ApiRequest, rawBody?: Buffer | null): Promise<any> {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
    return req.body;
  }

  const source = rawBody || (await getRawBody(req));
  if (!source || !source.length) return {};

  try {
    return JSON.parse(source.toString('utf8'));
  } catch (err) {
    const error = err as any;
    console.warn('⚠️ Failed to parse JSON body:', error.message);
    return {};
  }
}

function calculateBonus(product: Package | Subscription, isFirstPurchase: boolean): { bonus: number; type: string | null; total: number } {
  let bonus = 0;
  let bonusType: string | null = null;

  // Bônus de primeira compra
  if (isFirstPurchase && 'firstPurchaseBonus' in product && product.firstPurchaseBonus) {
    if (product.firstPurchaseBonus.type === 'percentage') {
      bonus = Math.floor(product.diamonds * (product.firstPurchaseBonus.value / 100));
    } else {
      bonus = product.firstPurchaseBonus.value;
    }
    bonusType = 'first_purchase';
  }

  // Bônus temporário (substitui o de primeira compra se maior)
  if ('timedBonus' in product && product.timedBonus && new Date(product.timedBonus.endsAt) > new Date()) {
    const timedBonus = Math.floor(product.diamonds * (product.timedBonus.percentage / 100));
    if (timedBonus > bonus) {
      bonus = timedBonus;
      bonusType = 'timed';
    }
  }

  return {
    bonus,
    type: bonusType,
    total: product.diamonds + bonus
  };
}

function getProduct(productId: string, productType: string): Package | Subscription | null {
  if (productType === 'package') {
    return PACKAGES.find(p => p.id === productId) || null;
  } else if (productType === 'subscription') {
    return SUBSCRIPTIONS.find(s => s.id === productId) || null;
  }
  return null;
}

// ============================================================
// STRIPE CHECKOUT
// ============================================================

async function createStripeCheckout(order: any, product: Package | Subscription, userId: string): Promise<string | null> {
  try {
    console.log('🔄 [Stripe] Iniciando checkout para pedido:', order.id);
    
    const successUrl = `${process.env.WEBHOOK_BASE_URL}/shop?payment=success&order_id=${order.id}`;
    const cancelUrl = `${process.env.WEBHOOK_BASE_URL}/shop?payment=cancelled`;

    console.log('🔄 [Stripe] URLs:', { successUrl, cancelUrl });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: product.priceId, // Usa o Price ID da Stripe
          quantity: 1,
        },
      ],
      mode: order.order_type === 'subscription' ? 'subscription' : 'payment', // ← MUDANÇA AQUI
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: order.id,
      metadata: {
        order_id: order.id,
        user_id: userId,
        product_type: order.order_type
      }
    });

    console.log('✅ [Stripe] Sessão criada:', session.id);

    await supabase
      .from('shop_orders')
      .update({ payment_id: session.id })
      .eq('id', order.id);

    console.log('✅ [Stripe] Order atualizada com payment_id');

    return session.url;
  } catch (error) {
    const err = error as any;
    console.error('❌ [Stripe] Erro:', err);
    throw new Error(`Stripe error: ${err.message}`);
  }
}

// ============================================================
// MERCADOPAGO CHECKOUT
// ============================================================

async function createMercadoPagoCheckout(order: any, product: Package | Subscription, userId: string): Promise<string | null> {
  try {
    console.log('🔄 [MercadoPago] Iniciando checkout para pedido:', order.id);
    
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    
    if (!accessToken) {
      console.error('❌ [MercadoPago] Access token não configurado');
      throw new Error('MercadoPago access token not configured');
    }

    const preference = {
      items: [
        {
          id: product.id, // ID do seu produto
          title: product.name,
          description: order.order_type === 'package' 
            ? `${order.quantity} 💎 Diamonds` 
            : `${'duration' in product ? product.duration : 30} days subscription`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: product.priceBRL, // ← Agora você define o preço em BRL direto no produto
        }
      ],
      back_urls: {
        success: `${process.env.WEBHOOK_BASE_URL}/shop?payment=success&order_id=${order.id}`,
        failure: `${process.env.WEBHOOK_BASE_URL}/shop?payment=failed`,
        pending: `${process.env.WEBHOOK_BASE_URL}/shop?payment=pending`
      },
      auto_return: 'approved',
      binary_mode: true, // Força retorno imediato (approved ou rejected, sem pending)
      statement_descriptor: 'LOOTSKIRMISH', // Nome que aparece na fatura
      external_reference: order.id,
      notification_url: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/shop?gateway=mercadopago`,
      metadata: {
        order_id: order.id,
        user_id: userId
      },
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString() // Expira em 30 minutos
    };

    console.log('🔄 [MercadoPago] Enviando preferência...');

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(preference)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ [MercadoPago] Erro na API:', errorData);
      throw new Error(`MercadoPago error: ${JSON.stringify(errorData)}`);
    }

    const data: any = await response.json();
    console.log('✅ [MercadoPago] Preferência criada:', data.id);

    await supabase
      .from('shop_orders')
      .update({ payment_id: data.id })
      .eq('id', order.id);

    console.log('✅ [MercadoPago] Order atualizada com payment_id');

    return data.init_point;
  } catch (error) {
    const err = error as any;
    console.error('❌ [MercadoPago] Erro:', err);
    throw new Error(`MercadoPago error: ${err.message}`);
  }
}

// ============================================================
// NOWPAYMENTS CHECKOUT
// ============================================================

async function createNOWPaymentsCheckout(order: any, product: Package | Subscription, userId: string): Promise<string | null> {
  try {
    console.log('🔄 [NOWPayments] Iniciando checkout para pedido:', order.id);
    
    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    
    if (!apiKey) {
      console.error('❌ [NOWPayments] API key não configurada');
      throw new Error('NOWPayments API key not configured');
    }

    const payment = {
      price_amount: product.price,
      price_currency: 'usd',
      pay_currency: 'ltc', // Litecoin recomendado
      ipn_callback_url: `${process.env.WEBHOOK_BASE_URL}/api/webhooks/shop?gateway=nowpayments`,
      order_id: order.id,
      order_description: `${product.name} - ${order.order_type === 'package' ? `${order.quantity} Diamonds` : `${'duration' in product ? product.duration : 30} days`}`,
      success_url: `${process.env.WEBHOOK_BASE_URL}/shop?payment=success&order_id=${order.id}`,
      cancel_url: `${process.env.WEBHOOK_BASE_URL}/shop?payment=cancelled`
    };

    console.log('🔄 [NOWPayments] Enviando pagamento...');

    const response = await fetch('https://api.nowpayments.io/v1/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(payment)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ [NOWPayments] Erro na API:', errorData);
      throw new Error(`NOWPayments error: ${JSON.stringify(errorData)}`);
    }

    const data: any = await response.json();
    console.log('✅ [NOWPayments] Pagamento criado:', data.payment_id);

    // Atualizar order com payment_id
    await supabase
      .from('shop_orders')
      .update({ payment_id: data.payment_id })
      .eq('id', order.id);

    console.log('✅ [NOWPayments] Order atualizada com payment_id');

    return data.payment_url;
  } catch (error) {
    const err = error as any;
    console.error('❌ [NOWPayments] Erro:', err);
    throw new Error(`NOWPayments error: ${err.message}`);
  }
}

// ============================================================
// PROCESSAR PAGAMENTO APROVADO
// ============================================================

async function processSuccessfulPayment(orderId: string, { gateway = 'unknown', paymentDetails = null }: { gateway?: string; paymentDetails?: any } = {}): Promise<any> {
  let order: any = null;
  try {
    console.log('🔄 Processing payment for order:', orderId);

    const nowIso = new Date().toISOString();

    // Buscar ordem
    const { data: fetchedOrder, error: orderError } = await supabase
      .from('shop_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !fetchedOrder) {
      console.error('❌ Order not found:', orderId, orderError?.message);
      return { success: false, error: 'Order not found' };
    }

    order = fetchedOrder;

    const baseMetadata = { ...(order.metadata || {}) };

    // Se já foi processado, ignorar (idempotência)
    if (order.status === 'success') {
      console.log('⚠️ Order already processed:', orderId);
      return { success: true, alreadyProcessed: true };
    }

    if (order.status === 'cancelled') {
      console.warn('⚠️ Order is cancelled, ignoring webhook:', orderId);
      return { success: false, error: 'Order cancelled' };
    }

    if (order.status === 'processing') {
      console.warn('⚠️ Order already being processed by another worker:', orderId);
      return { success: false, error: 'Already processing' };
    }

    if (gateway !== 'unknown' && order.payment_method && order.payment_method !== gateway) {
      console.warn('⚠️ Gateway mismatch for order', orderId, { orderGateway: order.payment_method, webhookGateway: gateway });
    }

    // Tenta "lock" via atualização condicional para evitar processamento duplo
    const { data: claimRows, error: claimError } = await supabase
      .from('shop_orders')
      .update({
        status: 'processing',
        metadata: {
          ...baseMetadata,
          processing_gateway: gateway,
          processing_started_at: nowIso
        },
        updated_at: nowIso
      })
      .eq('id', orderId)
      .eq('status', 'pending')
      .select('id');

    if (claimError) {
      console.error('❌ Failed to claim order for processing:', claimError.message);
      return { success: false, error: 'Failed to claim order' };
    }

    if (!claimRows || claimRows.length === 0) {
      // Recarrega status para informar motivo
      const { data: freshOrder } = await supabase
        .from('shop_orders')
        .select('status, metadata')
        .eq('id', orderId)
        .single();

      if (freshOrder?.status === 'success') {
        console.log('⚠️ Order already processed (post-claim):', orderId);
        return { success: true, alreadyProcessed: true };
      }

      console.warn('⚠️ Order not pending; skipping processing:', { orderId, status: freshOrder?.status });
      return { success: false, error: 'Order not pending' };
    }

    // Validação básica de gateway/valor para evitar creditamentos indevidos
    const expectedAmount = normalizeNumber(baseMetadata?.expected_amount ?? order.amount, 0);
    const expectedCurrency = (baseMetadata?.payment_currency || (order.payment_method === 'mercadopago' ? 'BRL' : 'USD')).toUpperCase();

    if (paymentDetails) {
      let paidAmount = 0;
      let paidCurrency = '';

      if (gateway === 'stripe') {
        // Stripe retorna amount_total em centavos
        paidAmount = normalizeNumber((paymentDetails as any).amount_total, 0) / 100;
        paidCurrency = ((paymentDetails as any).currency || 'USD').toUpperCase();
      } else if (gateway === 'mercadopago') {
        paidAmount = normalizeNumber((paymentDetails as any).transaction_amount, 0);
        paidCurrency = ((paymentDetails as any).currency_id || '').toUpperCase();
      } else if (gateway === 'nowpayments') {
        paidAmount = normalizeNumber((paymentDetails as any).amount, 0);
        paidCurrency = ((paymentDetails as any).pay_currency || '').toUpperCase();
      }

      if (paidAmount > 0 && expectedAmount > 0 && Math.abs(paidAmount - expectedAmount) > 1) {
        console.error('❌ Payment amount mismatch for order', orderId, { expectedAmount, paidAmount, gateway, rawAmount: (paymentDetails as any).amount_total || (paymentDetails as any).transaction_amount });
        await supabase
          .from('shop_orders')
          .update({
            status: 'error',
            metadata: {
              ...(order.metadata || {}),
              validation_error: 'amount_mismatch',
              paid_amount: paidAmount,
              expected_amount: expectedAmount
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', orderId);
        return { success: false, error: 'Amount mismatch' };
      }

      if (paidCurrency && expectedCurrency && paidCurrency !== expectedCurrency) {
        console.error('❌ Payment currency mismatch for order', orderId, { expectedCurrency, paidCurrency });
        await supabase
          .from('shop_orders')
          .update({
            status: 'error',
            metadata: {
              ...(order.metadata || {}),
              validation_error: 'currency_mismatch',
              paid_currency: paidCurrency,
              expected_currency: expectedCurrency
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', orderId);
        return { success: false, error: 'Currency mismatch' };
      }
    }

    const userId = order.user_id;
    const productType = order.order_type;

    console.log('📦 Order details:', {
      id: orderId,
      userId,
      type: productType,
      quantity: order.quantity,
      product: order.product_name
    });

    // Processar baseado no tipo
    if (productType === 'package') {
      console.log('💎 Processing package purchase with RPC:', {
        p_user_id: userId,
        p_amount: order.quantity,
        p_order_id: orderId
      });

      // Creditar diamantes
      const { data: creditResult, error: creditError } = await supabase
        .rpc('credit_diamonds_from_shop', {
          p_user_id: userId,
          p_amount: order.quantity,
          p_order_id: orderId,
          p_reason: `Shop purchase: ${order.product_name}`
        });

      if (creditError) {
        console.error('❌ Failed to credit diamonds - RPC Error:', creditError?.message || creditError);
        throw new Error(`Failed to credit diamonds: ${creditError?.message || 'Unknown error'}`);
      }

      console.log('✅ Diamonds credited successfully. RPC Result:', creditResult);

      // Validar que o RPC retornou dados válidos
      if (!creditResult) {
        console.warn('⚠️ RPC returned null/undefined - possible constraint issue');
        throw new Error('Diamond credit validation failed');
      }

      // Aplicar bônus de referral (se aplicável)
      try {
        await applyReferralDiamondBonus({
          supabase,
          buyerId: userId,
          diamondsBought: order.quantity,
          source: 'diamond_purchase'
        });
      } catch (refError) {
        console.warn('⚠️ Referral bonus failed (non-blocking):', refError instanceof Error ? refError.message : refError);
      }

    } else if (productType === 'subscription') {
      console.log('🔄 Processing subscription activation with RPC:', {
        p_user_id: userId,
        p_subscription_name: order.product_name
      });

      // Buscar produto para pegar quantidade de diamonds
      const product = SUBSCRIPTIONS.find(s => s.name === order.product_name);
      const duration = product?.duration || 30;
      const instantDiamonds = product?.diamonds || 0;

      // Creditar diamonds imediatos (se houver)
      if (instantDiamonds > 0) {
        console.log('💎 Crediting instant subscription diamonds:', {
          p_user_id: userId,
          p_amount: instantDiamonds,
          p_order_id: orderId
        });

        const { data: diamondResult, error: diamondError } = await supabase
          .rpc('credit_diamonds_from_shop', {
            p_user_id: userId,
            p_amount: instantDiamonds,
            p_order_id: orderId,
            p_reason: `Subscription instant bonus: ${order.product_name}`
          });

        if (diamondError) {
          console.error('❌ Failed to credit subscription diamonds - RPC Error:', diamondError?.message || diamondError);
          throw new Error(`Failed to credit subscription diamonds: ${diamondError?.message || 'Unknown error'}`);
        }

        console.log('✅ Subscription diamonds credited successfully. RPC Result:', diamondResult);

        if (!diamondResult) {
          console.warn('⚠️ Diamond credit RPC returned null/undefined');
          throw new Error('Subscription diamond credit validation failed');
        }
      }

      // Ativar assinatura
      const { data: subResult, error: subError } = await supabase
        .rpc('activate_subscription', {
          p_user_id: userId,
          p_subscription_name: order.product_name,
          p_duration_days: duration
        });

      if (subError) {
        console.error('❌ Failed to activate subscription - RPC Error:', subError?.message || subError);
        throw new Error(`Failed to activate subscription: ${subError?.message || 'Unknown error'}`);
      }

      console.log('✅ Subscription activated successfully. RPC Result:', subResult);

      // Validar que o RPC retornou dados válidos
      if (!subResult) {
        console.warn('⚠️ Subscription RPC returned null/undefined - possible constraint issue');
        throw new Error('Subscription activation validation failed');
      }
    }

    // Incrementar contador de compras
    console.log('📊 Incrementing total purchases counter for user:', userId);
    const { error: incrementError } = await supabase.rpc('increment_total_purchases', { p_user_id: userId });
    
    if (incrementError) {
      console.warn('⚠️ Failed to increment total purchases (non-blocking):', incrementError?.message);
    }

    const successMetadata = {
      ...baseMetadata,
      processing_gateway: gateway,
      processing_started_at: baseMetadata.processing_started_at || nowIso,
      processed_gateway: gateway,
      processed_at: nowIso,
      processed_payment_id: paymentDetails?.id || paymentDetails?.payment_id || paymentDetails?.collection_id || paymentDetails?.session_id,
      paid_amount: gateway === 'stripe' 
        ? (paymentDetails?.amount_total ? paymentDetails.amount_total / 100 : order.amount)
        : (paymentDetails?.transaction_amount ?? paymentDetails?.amount ?? paymentDetails?.total_paid_amount ?? order.amount),
      paid_currency: (paymentDetails?.currency || paymentDetails?.currency_id || paymentDetails?.pay_currency || expectedCurrency).toUpperCase()
    };

    // Atualizar status da ordem
    const { error: updateError } = await supabase
      .from('shop_orders')
      .update({ 
        status: 'success',
        metadata: successMetadata,
        updated_at: nowIso
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('❌ Failed to update order status to success:', updateError?.message);
      throw new Error(`Failed to update order status: ${updateError?.message}`);
    }

    console.log('✅ Payment processed successfully:', orderId);

    return { success: true };

  } catch (error) {
    console.error('❌ Process payment error:', error instanceof Error ? error.message : error);
    
    // Marcar ordem como erro para investigação manual
    if (order?.id) {
      await supabase
        .from('shop_orders')
        .update({ 
          status: 'error',
          metadata: { 
            ...(order?.metadata || {}),
            error: error instanceof Error ? error.message : String(error),
            error_timestamp: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', order.id);
      // Note: Supabase doesn't have .catch, errors handled by try-catch block
    }
    
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ============================================================
// HANDLERS
// ============================================================

async function handleCreateOrder(req: ApiRequest, res: ApiResponse, body: any): Promise<void> {
  try {
    const { userId, authToken, productId, productType, paymentMethod } = body || {};

    // Validações
    if (!userId || !authToken || !productId || !productType || !paymentMethod) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validar sessão
    const session = await validateSessionAndFetchPlayerStats(
      supabase,
      authToken,
      userId,
      { select: 'total_purchases, active_subscription, subscription_expires_at' }
    );

    if (!session.valid) {
      return res.status(401).json({ error: session.error || 'Invalid session' });
    }

    // Buscar produto
    const product = getProduct(productId, productType);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const stats = session.stats || {};
    const isFirstPurchase = (stats.total_purchases || 0) === 0;

    const paymentCurrency = paymentMethod === 'mercadopago' ? 'BRL' : 'USD';
    const expectedAmount = paymentCurrency === 'BRL'
      ? normalizeNumber(product.priceBRL, product.price)
      : normalizeNumber(product.price, 0);

    // Calcular quantidade final (com bônus se for pacote)
    let finalQuantity = product.diamonds || ('duration' in product ? product.duration : 30);
    let metadata: Record<string, any> = {
      payment_currency: paymentCurrency,
      expected_amount: expectedAmount,
      price_usd: product.price,
      price_brl: product.priceBRL,
      use_direct_link: false
    };

    if (productType === 'package') {
      const bonus = calculateBonus(product, isFirstPurchase);
      finalQuantity = bonus.total;
      metadata = {
        ...metadata,
        base_diamonds: product.diamonds,
        bonus_diamonds: bonus.bonus,
        bonus_type: bonus.type
      };
    }

    // Validar assinatura (se for subscription)
    if (productType === 'subscription' && stats.active_subscription) {
      if (stats.active_subscription === product.name) {
        return res.status(400).json({ error: 'You already have this subscription active' });
      }
      // Avisar sobre substituição (já validado no frontend, mas check de segurança)
      metadata.replaced_subscription = stats.active_subscription;
    }

    // Criar pedido
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 horas

    const { data: order, error: orderError } = await supabase
      .from('shop_orders')
      .insert({
        user_id: userId,
        order_type: productType,
        product_name: product.name,
        amount: expectedAmount,
        quantity: finalQuantity,
        payment_method: paymentMethod,
        status: 'pending',
        metadata,
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single();

    if (orderError) {
      console.error('❌ Failed to create order:', orderError);
      return res.status(500).json({ error: 'Failed to create order' });
    }

    console.log('✅ Order created:', order.id);

    // Criar checkout URL baseado no método de pagamento
    let checkoutUrl = null;

    try {
      console.log('🔄 Criando checkout para método:', paymentMethod);
      
      switch (paymentMethod) {
        case 'stripe':
          console.log('🔄 Criando Stripe checkout...');
          checkoutUrl = await createStripeCheckout(order, product, userId);
          console.log('✅ Stripe checkout criado:', checkoutUrl ? 'URL gerada' : 'sem URL');
          break;
        case 'mercadopago':
          console.log('🔄 Criando MercadoPago checkout...');
          checkoutUrl = await createMercadoPagoCheckout(order, product, userId);
          console.log('✅ MercadoPago checkout criado:', checkoutUrl ? 'URL gerada' : 'sem URL');
          break;
        case 'nowpayments':
          console.log('🔄 Criando NOWPayments checkout...');
          checkoutUrl = await createNOWPaymentsCheckout(order, product, userId);
          console.log('✅ NOWPayments checkout criado:', checkoutUrl ? 'URL gerada' : 'sem URL');
          break;
        default:
          console.error('❌ Método de pagamento inválido:', paymentMethod);
          return res.status(400).json({ error: 'Invalid payment method' });
      }
    } catch (checkoutError) {
      console.error('❌ Erro ao criar checkout:', checkoutError);
      
      // Se falhar ao criar checkout, cancelar pedido
      await supabase
        .from('shop_orders')
        .update({ status: 'cancelled' })
        .eq('id', order.id);

      const errorMessage = (checkoutError as any)?.message || (checkoutError as any)?.error || 'Unknown error';
      console.error('❌ Erro final de checkout:', errorMessage);
      return res.status(500).json({ error: `Checkout error: ${errorMessage}` });
    }

    // Audit log
    logAudit(supabase, userId, 'SHOP_ORDER_CREATED', { 
      orderId: order.id, 
      productId, 
      productType, 
      paymentMethod 
    }, req).catch(() => {});

    return res.status(200).json({
      success: true,
      orderId: order.id,
      checkoutUrl,
      expiresAt: expiresAt.toISOString()
    });

  } catch (error) {
    console.error('❌ Create order error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// WEBHOOK HANDLER
// ============================================================

// ============================================================
// WEBHOOK HANDLER - VERSÃO CORRIGIDA
// ============================================================

async function handleWebhook(req: ApiRequest, res: ApiResponse, { rawBody, parsedBody }: { rawBody?: Buffer | null; parsedBody?: any } = {}): Promise<void> {
  try {
    const gateway = req.query?.gateway || 'stripe';
    const ip = getIdentifier(req);

    console.log('🔔 Webhook received from:', gateway, '| IP:', ip);

    // ============================================================
    // STRIPE WEBHOOK
    // ============================================================
    if (gateway === 'stripe') {
      const sig = req.headers?.['stripe-signature'];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.error('❌ Stripe webhook secret not configured');
        return res.status(500).json({ error: 'Webhook secret not configured' });
      }

      if (!sig) {
        console.error('❌ [Stripe] Missing signature header');
        securityMonitor.recordWebhookFailure();
        return res.status(400).json({ error: 'Missing signature header' });
      }

      let event;
      try {
        const payload = rawBody || (await getRawBody(req));

        if (!payload || !payload.length) {
          console.error('❌ Missing raw body for Stripe webhook');
          securityMonitor.recordWebhookFailure();
          return res.status(400).json({ error: 'Missing payload' });
        }

        event = stripe.webhooks.constructEvent(payload, sig as string, webhookSecret);
      } catch (err) {
        const error = err as any;
        console.error('❌ Webhook signature verification failed:', error.message);
        securityMonitor.recordWebhookFailure();
        const log = createSecureLog({
          action: 'STRIPE_WEBHOOK_INVALID_SIGNATURE',
          ip,
          statusCode: 400,
          isSecurityEvent: true
        });
        console.log('🚨', JSON.stringify(log));
        return res.status(400).json({ error: 'Invalid signature' });
      }

      // Replay attack protection
      if (webhookReplayProtection.hasBeenProcessed(event.id)) {
        console.warn('⚠️ Stripe webhook already processed:', event.id);
        securityMonitor.recordWebhookFailure();
        return res.status(200).json({ received: true, duplicate: true });
      }

      console.log('✅ Stripe webhook verified:', event.type);
      webhookReplayProtection.markAsProcessed(event.id);

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const orderId = session.metadata?.order_id || session.client_reference_id;

        const log = createSecureLog({
          action: 'STRIPE_PAYMENT_COMPLETED',
          userId: session.metadata?.user_id,
          ip,
          statusCode: 200,
          details: {
            sessionId: session.id,
            orderId,
            amount: session.amount_total,
            currency: session.currency
          }
        });
        console.log('✅', JSON.stringify(log));

        if (orderId) {
          await processSuccessfulPayment(orderId, { gateway: 'stripe', paymentDetails: session });
        } else {
          console.warn('⚠️ Order ID not found in Stripe session metadata');
        }
      } else {
        console.log('ℹ️ Ignoring Stripe webhook event type:', event.type);
      }

      return res.status(200).json({ received: true });
    }

    // ============================================================
    // MERCADOPAGO WEBHOOK - CORRIGIDO
    // ============================================================
    else if (gateway === 'mercadopago') {
      const notification = parsedBody && Object.keys(parsedBody).length ? parsedBody : {};
      const topic = (req.query?.topic || req.query?.type || notification.type || '').toLowerCase();
      const notificationId = req.query?.id || notification.id;
      
      // Signature verification (optional but recommended)
      const xSignature = req.headers?.['x-signature'] as string;
      const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
      
      if (webhookSecret && xSignature && notification.id && notification.topic) {
        const isValid = verifyMercadoPagoSignature(notification, xSignature, webhookSecret);
        if (!isValid) {
          console.error('❌ MercadoPago signature verification failed');
          securityMonitor.recordWebhookFailure();
          const log = createSecureLog({
            action: 'MERCADOPAGO_WEBHOOK_INVALID_SIGNATURE',
            ip,
            statusCode: 400,
            isSecurityEvent: true
          });
          console.log('🚨', JSON.stringify(log));
          return res.status(400).json({ error: 'Invalid signature' });
        }
      }

      // Replay attack protection
      const webhookUniqueId = `mp_${notification.id}_${notificationId}`;
      if (webhookReplayProtection.hasBeenProcessed(webhookUniqueId)) {
        console.warn('⚠️ MercadoPago notification already processed:', webhookUniqueId);
        return res.status(200).json({ received: true, duplicate: true });
      }
      webhookReplayProtection.markAsProcessed(webhookUniqueId);

      // MercadoPago envia diferentes tipos de notificação
      // Tipo 'payment' é o que nos interessa
      if (topic === 'payment' || notification.type === 'payment') {
        const paymentId = notification.data?.id || notificationId;
        
        if (!paymentId) {
          console.warn('⚠️ Payment ID não encontrado na notificação');
          return res.status(200).json({ received: true });
        }

        console.log('🔍 Buscando detalhes do pagamento:', paymentId);

        // Buscar detalhes completos do pagamento
        const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
        
        if (!accessToken) {
          console.error('❌ MercadoPago access token not configured');
          securityMonitor.recordWebhookFailure();
          return res.status(500).json({ error: 'Access token not configured' });
        }

        const paymentResponse = await fetch(
          `https://api.mercadopago.com/v1/payments/${paymentId}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );

        if (!paymentResponse.ok) {
          console.error('❌ Erro ao buscar pagamento:', paymentResponse.status);
          securityMonitor.recordWebhookFailure();
          return res.status(500).json({ error: 'Failed to fetch payment' });
        }

        const payment: any = await paymentResponse.json();
        
        const log = createSecureLog({
          action: 'MERCADOPAGO_PAYMENT_RECEIVED',
          ip,
          statusCode: 200,
          details: {
            paymentId: payment.id,
            status: payment.status,
            amount: payment.transaction_amount
          }
        });
        console.log('✅', JSON.stringify(log));

        let orderId = payment.external_reference;

        if (!orderId) {
          console.warn('⚠️ Order ID (external_reference) não encontrado; tentando correspondência por valor...');

          const amountPaid = normalizeNumber(payment.transaction_amount, 0);

          const { data: candidates, error: findError } = await supabase
            .from('shop_orders')
            .select('id, user_id, amount, payment_method, status, metadata, expires_at, updated_at')
            .eq('payment_method', 'mercadopago')
            .eq('status', 'pending')
            .eq('amount', amountPaid)
            .gte('expires_at', new Date().toISOString())
            .order('updated_at', { ascending: false })
            .limit(5);

          if (findError) {
            console.error('❌ Erro ao buscar ordens candidatas:', findError.message);
          }

          if (Array.isArray(candidates) && candidates.length) {
            let matched = candidates[0];
            const payerEmail = payment.payer?.email || payment.additional_info?.payer?.email;

            if (payerEmail && candidates.length > 1) {
              try {
                const { data: emailUsers, error: emailErr } = await supabase.auth.admin.listUsers();
                if (!emailErr && emailUsers?.users) {
                  const emailUser = emailUsers.users.find(u => u.email === payerEmail);
                  if (emailUser?.id) {
                    const emailUserId = emailUser.id;
                    matched = candidates.find(c => c.user_id === emailUserId) || matched;
                  }
                }
              } catch (e) {
                console.warn('⚠️ Falha ao consultar usuário por email:', e instanceof Error ? e.message : e);
              }
            }

            orderId = matched.id;
            console.log('✅ Ordem correspondente encontrada por valor/email:', orderId);
          } else {
            console.warn('⚠️ Nenhuma ordem pendente correspondente ao valor foi encontrada');
            return res.status(200).json({ received: true });
          }
        }

        // Processar baseado no status
        if (payment.status === 'approved') {
          console.log('✅ Pagamento aprovado, processando ordem:', orderId);
          await processSuccessfulPayment(orderId, { gateway: 'mercadopago', paymentDetails: payment });
        } 
        else if (payment.status === 'rejected') {
          console.log('❌ Pagamento rejeitado:', orderId);
          await supabase
            .from('shop_orders')
            .update({ 
              status: 'failed',
              metadata: { 
                rejection_reason: payment.status_detail 
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', orderId);
        }
        else if (payment.status === 'pending' || payment.status === 'in_process') {
          console.log('⏳ Pagamento pendente:', orderId);
          await supabase
            .from('shop_orders')
            .update({ 
              status: 'pending',
              metadata: { 
                payment_status: payment.status,
                status_detail: payment.status_detail
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', orderId);
        }
        else if (payment.status === 'cancelled' || payment.status === 'refunded') {
          console.log('🔄 Pagamento cancelado/reembolsado:', orderId);
          await supabase
            .from('shop_orders')
            .update({ 
              status: 'cancelled',
              metadata: { 
                payment_status: payment.status 
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', orderId);
        }
      }

      // Algumas integrações do MercadoPago enviam merchant_order em vez de payment
      else if (topic === 'merchant_order') {
        if (!notificationId) {
          console.warn('⚠️ Merchant order id não informado');
          return res.status(200).json({ received: true });
        }

        const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
        if (!accessToken) {
          console.error('❌ MercadoPago access token not configured');
          return res.status(500).json({ error: 'Access token not configured' });
        }

        const merchantOrderResponse = await fetch(
          `https://api.mercadopago.com/merchant_orders/${notificationId}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        );

        if (!merchantOrderResponse.ok) {
          console.error('❌ Erro ao buscar merchant_order:', merchantOrderResponse.status);
          return res.status(200).json({ received: true });
        }

        const merchantOrder: any = await merchantOrderResponse.json();

        const orderId = merchantOrder.external_reference;
        const approvedPayment = merchantOrder.payments?.find((p: any) => p.status === 'approved');

        if (orderId && approvedPayment?.id) {
          console.log('✅ Merchant order aprovado, processando ordem:', orderId);
          await processSuccessfulPayment(orderId, { gateway: 'mercadopago', paymentDetails: approvedPayment });
        } else {
          console.log('ℹ️ Merchant order sem pagamento aprovado ainda:', { orderId, payments: merchantOrder.payments?.length });
        }
      }

      // IMPORTANTE: Sempre retornar 200 para o MercadoPago
      // Caso contrário ele vai ficar reenviando o webhook
      return res.status(200).json({ received: true });
    }

    // ============================================================
    // NOWPAYMENTS WEBHOOK
    // ============================================================
    else if (gateway === 'nowpayments') {
      const data = parsedBody && Object.keys(parsedBody).length ? parsedBody : {};
      
      console.log('🪙 NOWPayments webhook data:', data);

      if (data.payment_status === 'finished') {
        const orderId = data.order_id;
        if (orderId) {
          await processSuccessfulPayment(orderId, { gateway: 'nowpayments', paymentDetails: data });
        }
      }

      return res.status(200).json({ received: true });
    }

    // Gateway inválido
    return res.status(400).json({ error: 'Invalid gateway' });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    
    // IMPORTANTE: Mesmo com erro, retornar 200 para evitar retentativas infinitas
    // O erro já foi logado, então podemos investigar depois
    return res.status(200).json({ 
      received: true, 
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req as any, res as any);
  maybeCleanupSecurity();

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const isWebhookPath = req.path?.includes('/webhooks/shop') || req.url?.includes('/api/webhooks/shop');

  // Read raw body once for both normal requests (when body parser is disabled) and webhooks.
  const rawBody = await getRawBody(req);
  const parsedBody = await getJsonBody(req, rawBody);

  // Webhooks usam POST mas não precisam de rate limit normal
  if (isWebhookPath) {
    req.body = parsedBody;
    return handleWebhook(req, res, { rawBody, parsedBody });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, userId } = parsedBody || {};

  // Progressive rate limiting
  const identifier = getIdentifier(req, userId);
  
  // Verificar se IP está blacklistado
  if (progressiveRateLimiter.isIPBlacklisted(identifier)) {
    securityMonitor.recordRateLimitViolation();
    const log = createSecureLog({
      action: 'BLACKLISTED_IP_ATTEMPT',
      ip: identifier,
      statusCode: 403,
      isSecurityEvent: true
    });
    console.log('🚨', JSON.stringify(log));
    return res.status(403).json({ error: 'Access denied' });
  }

  // Check progressive rate limit
  const rateLimitCheck = progressiveRateLimiter.checkProgressiveLimit(identifier, {
    maxRequests: 10,
    windowMs: 60_000,
    actionType: action
  });

  if (!rateLimitCheck.allowed) {
    securityMonitor.recordRateLimitViolation();
    const log = createSecureLog({
      action: 'RATE_LIMIT_EXCEEDED',
      userId,
      ip: identifier,
      statusCode: 429,
      isSecurityEvent: true
    });
    console.log('⚠️', JSON.stringify(log));
    return res.status(429).json({ 
      error: 'Too many requests',
      retryAfter: Math.ceil((rateLimitCheck.remainingTime || 60000) / 1000)
    });
  }
  const { maxRequests, windowMs } = getShopRateLimitConfig();

  const now = Date.now();
  if (!lastShopCleanupAt || now - lastShopCleanupAt > windowMs) {
    cleanupOldEntries(shopRateLimits, { maxIdleMs: windowMs * 2 });
    lastShopCleanupAt = now;
  }

  const allowed = checkRateLimit(shopRateLimits, identifier, { maxRequests, windowMs });
  if (!allowed) {
    res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
    logAudit(supabase, userId, 'SHOP_RATE_LIMIT', { action }, req as any).catch(() => {});
    return res.status(429).json({ error: 'Too many requests. Please wait.' });
  }

  try {
    switch (action) {
      case 'createOrder':
        return await handleCreateOrder(req, res, parsedBody);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    const err = error as Error;
    console.error('❌ Shop API error:', err);
    logAudit(supabase, userId, 'SHOP_ERROR', { action, error: err.message }, req as any).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
}