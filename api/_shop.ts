// @ts-nocheck
// ============================================================
// API/_SHOP.JS - Shop & Payments Management
// ============================================================

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import {
  applyCors,
  validateSessionAndFetchPlayerStats,
  logAudit,
  getIdentifier,
  checkRateLimit,
  cleanupOldEntries
} from './_utils.js';

import { 
  applyReferralDiamondBonus 
} from './_referrals.js';

dotenv.config();

// Vercel webhook endpoints (Stripe) need raw body to validate signatures.
export const config = {
  api: {
    bodyParser: false
  }
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16'
});

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

const PACKAGES = [
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

const SUBSCRIPTIONS = [
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
let lastShopCleanupAt = 0;

function getShopRateLimitConfig() {
  const maxRequests = parseInt(process.env.SHOP_RATE_LIMIT_MAX || '2');
  const windowMs = parseInt(process.env.SHOP_RATE_LIMIT_WINDOW || '60000');
  return { maxRequests, windowMs };
}

// ============================================================
// HELPERS
// ============================================================

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

async function getRawBody(req) {
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
      console.warn('⚠️ Failed to stringify parsed body:', err.message);
    }
  }

  if (!req.readable) return null;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks);
  req.rawBody = raw;
  return raw;
}

async function getJsonBody(req, rawBody) {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
    return req.body;
  }

  const source = rawBody || (await getRawBody(req));
  if (!source || !source.length) return {};

  try {
    return JSON.parse(source.toString('utf8'));
  } catch (err) {
    console.warn('⚠️ Failed to parse JSON body:', err.message);
    return {};
  }
}

function calculateBonus(product, isFirstPurchase) {
  let bonus = 0;
  let bonusType = null;

  // Bônus de primeira compra
  if (isFirstPurchase && product.firstPurchaseBonus) {
    if (product.firstPurchaseBonus.type === 'percentage') {
      bonus = Math.floor(product.diamonds * (product.firstPurchaseBonus.value / 100));
    } else {
      bonus = product.firstPurchaseBonus.value;
    }
    bonusType = 'first_purchase';
  }

  // Bônus temporário (substitui o de primeira compra se maior)
  if (product.timedBonus && new Date(product.timedBonus.endsAt) > new Date()) {
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

function getProduct(productId, productType) {
  if (productType === 'package') {
    return PACKAGES.find(p => p.id === productId);
  } else if (productType === 'subscription') {
    return SUBSCRIPTIONS.find(s => s.id === productId);
  }
  return null;
}

// ============================================================
// STRIPE CHECKOUT
// ============================================================

async function createStripeCheckout(order, product, userId) {
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
    console.error('❌ [Stripe] Erro:', error);
    throw new Error(`Stripe error: ${error.message}`);
  }
}

// ============================================================
// MERCADOPAGO CHECKOUT
// ============================================================

async function createMercadoPagoCheckout(order, product, userId) {
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
            : `${product.duration} days subscription`,
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

    const data = await response.json();
    console.log('✅ [MercadoPago] Preferência criada:', data.id);

    await supabase
      .from('shop_orders')
      .update({ payment_id: data.id })
      .eq('id', order.id);

    console.log('✅ [MercadoPago] Order atualizada com payment_id');

    return data.init_point;
  } catch (error) {
    console.error('❌ [MercadoPago] Erro:', error);
    throw new Error(`MercadoPago error: ${error.message}`);
  }
}

// ============================================================
// NOWPAYMENTS CHECKOUT
// ============================================================

async function createNOWPaymentsCheckout(order, product, userId) {
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
      order_description: `${product.name} - ${order.order_type === 'package' ? `${order.quantity} Diamonds` : `${product.duration} days`}`,
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

    const data = await response.json();
    console.log('✅ [NOWPayments] Pagamento criado:', data.payment_id);

    // Atualizar order com payment_id
    await supabase
      .from('shop_orders')
      .update({ payment_id: data.payment_id })
      .eq('id', order.id);

    console.log('✅ [NOWPayments] Order atualizada com payment_id');

    return data.payment_url;
  } catch (error) {
    console.error('❌ [NOWPayments] Erro:', error);
    throw new Error(`NOWPayments error: ${error.message}`);
  }
}

// ============================================================
// PROCESSAR PAGAMENTO APROVADO
// ============================================================

async function processSuccessfulPayment(orderId, { gateway = 'unknown', paymentDetails = null } = {}) {
  let order = null;
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
        paidAmount = normalizeNumber(paymentDetails.amount_total, 0) / 100;
        paidCurrency = (paymentDetails.currency || 'USD').toUpperCase();
      } else if (gateway === 'mercadopago') {
        paidAmount = normalizeNumber(paymentDetails.transaction_amount, 0);
        paidCurrency = (paymentDetails.currency_id || '').toUpperCase();
      } else if (gateway === 'nowpayments') {
        paidAmount = normalizeNumber(paymentDetails.amount, 0);
        paidCurrency = (paymentDetails.pay_currency || '').toUpperCase();
      }

      if (paidAmount > 0 && expectedAmount > 0 && Math.abs(paidAmount - expectedAmount) > 1) {
        console.error('❌ Payment amount mismatch for order', orderId, { expectedAmount, paidAmount, gateway, rawAmount: paymentDetails.amount_total || paymentDetails.transaction_amount });
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
        console.warn('⚠️ Referral bonus failed (non-blocking):', refError.message);
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
    console.error('❌ Process payment error:', error?.message || error);
    
    // Marcar ordem como erro para investigação manual
    if (order?.id) {
      await supabase
        .from('shop_orders')
        .update({ 
          status: 'error',
          metadata: { 
            ...(order?.metadata || {}),
            error: error?.message || String(error),
            error_timestamp: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', order.id)
        .catch(e => console.error('Failed to update order status to error:', e?.message || e));
    }
    
    return { success: false, error: error?.message || String(error) };
  }
}

// ============================================================
// HANDLERS
// ============================================================

async function handleCreateOrder(req, res, body) {
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
    let finalQuantity = product.diamonds || product.duration;
    let metadata = {
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

      const errorMessage = checkoutError?.message || checkoutError?.error || 'Unknown error';
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

async function handleWebhook(req, res, { rawBody, parsedBody } = {}) {
  try {
    const gateway = req.query?.gateway || 'stripe';

    console.log('🔔 Webhook received from:', gateway);
    console.log('🔔 Headers:', req.headers);
    console.log('🔔 Body (parsed):', parsedBody);

    // ============================================================
    // STRIPE WEBHOOK
    // ============================================================
    if (gateway === 'stripe') {
      const sig = req.headers['stripe-signature'];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.error('❌ Stripe webhook secret not configured');
        return res.status(500).json({ error: 'Webhook secret not configured' });
      }

      let event;
      try {
        const payload = rawBody || (await getRawBody(req));

        if (!payload || !payload.length) {
          console.error('❌ Missing raw body for Stripe webhook');
          return res.status(400).json({ error: 'Missing payload' });
        }

        event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
      } catch (err) {
        console.error('❌ Webhook signature verification failed:', err.message);
        return res.status(400).json({ error: 'Invalid signature' });
      }

      console.log('✅ Stripe webhook verified:', event.type);

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const orderId = session.metadata?.order_id || session.client_reference_id;

        console.log('💳 Stripe session completed:', {
          sessionId: session.id,
          orderId: orderId,
          paymentStatus: session.payment_status,
          amount: session.amount_total,
          currency: session.currency,
          customerEmail: session.customer_email
        });

        if (orderId) {
          console.log('🔄 Processing payment with Stripe session details');
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
      
      console.log('📦 MercadoPago notification:', JSON.stringify(notification, null, 2));
      console.log('📦 MercadoPago query params:', req.query);

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
          return res.status(500).json({ error: 'Failed to fetch payment' });
        }

        const payment = await paymentResponse.json();
        
        console.log('💳 Payment details:', {
          id: payment.id,
          status: payment.status,
          status_detail: payment.status_detail,
          external_reference: payment.external_reference
        });

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
                const { data: emailLookup, error: emailErr } = await supabase.auth.admin.getUserByEmail(payerEmail);
                if (!emailErr && emailLookup?.user?.id) {
                  const emailUserId = emailLookup.user.id;
                  matched = candidates.find(c => c.user_id === emailUserId) || matched;
                }
              } catch (e) {
                console.warn('⚠️ Falha ao consultar usuário por email:', e?.message || e);
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

        const merchantOrder = await merchantOrderResponse.json();

        const orderId = merchantOrder.external_reference;
        const approvedPayment = merchantOrder.payments?.find(p => p.status === 'approved');

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
      error: error.message 
    });
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================

export default async function handler(req, res) {
  applyCors(req, res);

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

  // Rate limiting
  const identifier = getIdentifier(req, userId);
  const { maxRequests, windowMs } = getShopRateLimitConfig();

  const now = Date.now();
  if (!lastShopCleanupAt || now - lastShopCleanupAt > windowMs) {
    cleanupOldEntries(shopRateLimits, { maxIdleMs: windowMs * 2 });
    lastShopCleanupAt = now;
  }

  const allowed = checkRateLimit(shopRateLimits, identifier, { maxRequests, windowMs });
  if (!allowed) {
    res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
    logAudit(supabase, userId, 'SHOP_RATE_LIMIT', { action }, req).catch(() => {});
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
    console.error('❌ Shop API error:', error);
    logAudit(supabase, userId, 'SHOP_ERROR', { action, error: error.message }, req).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
}