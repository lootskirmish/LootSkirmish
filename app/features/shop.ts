// ============================================================
// SHOP.JS - FRONTEND DA LOJA DE DIAMANTES
// ============================================================

import { supabase } from './auth';
import { addCsrfHeader, addIdempotencyHeader } from '../core/session';
import { showAlert, showToast } from '../shared/effects';
import { getActiveUser } from '../core/session';

// ============================================================
// TIPOS E INTERFACES
// ============================================================

interface FirstPurchaseBonus {
  type: 'percentage' | 'fixed';
  value: number;
  label: string;
}

interface TimedBonus {
  percentage: number;
  endsAt: string;
  label: string;
}

interface ShopPackage {
  id: string;
  name: string;
  diamonds: number;
  price: number;
  priceBRL: number;
  icon: string;
  popular: boolean;
  firstPurchaseBonus?: FirstPurchaseBonus;
  timedBonus?: TimedBonus;
}

interface ShopSubscription {
  id: string;
  name: string;
  price: number;
  priceBRL: number;
  duration: number;
  icon: string;
  diamonds: number;
  dailyDiamonds: number;
  benefits: string[];
  popular: boolean;
}

interface BonusCalculation {
  bonus: number;
  type: 'first_purchase' | 'timed' | null;
  label: string;
  total: number;
  hasBonus: boolean;
}

interface SelectedProduct {
  id: string;
  name: string;
  price: number;
  priceBRL: number;
  icon: string;
  type: 'package' | 'subscription';
  [key: string]: any;
}

interface PlayerStats {
  total_purchases: number;
  active_subscription: string | null;
  subscription_expires_at: string | null;
  diamonds: number;
}

interface UserData {
  id: string;
  [key: string]: any;
}

declare global {
  interface Window {
    playerDiamonds?: { value: number };
    updateDiamondsDisplay?: (amount: number) => void;
    applyTranslations?: () => void;
    refreshLucideIcons?: () => void;
    closeShopPaymentModal?: () => void;
    proceedToCheckout?: () => Promise<void>;
    initShop?: typeof initShop;
  }
}

// ============================================================
// CONFIGURAÇÃO DE PACOTES E ASSINATURAS
// ============================================================

const PACKAGES = [
  {
    id: 'pkg_150',
    name: 'STARTER PACK',
    diamonds: 150,
    price: 1.99, // USD
    priceBRL: 14.99,
    icon: '💎',
    popular: false,
    firstPurchaseBonus: {
      type: 'percentage',
      value: 50,
      label: '+50% First Purchase'
    }
  },
  {
    id: 'pkg_400',
    name: 'BRONZE PACK',
    diamonds: 400,
    price: 4.49,
    priceBRL: 27.49,
    icon: '💎',
    popular: true
  },
  {
    id: 'pkg_1000',
    name: 'SILVER PACK',
    diamonds: 1000,
    price: 11.99,
    priceBRL: 69.99,
    icon: '💎',
    popular: false,
    timedBonus: {
      percentage: 25,
      endsAt: '2026-01-20T23:59:59Z',
      label: '+25% Limited Time'
    }
  },
  {
    id: 'pkg_1800',
    name: 'GOLD PACK',
    diamonds: 1800,
    price: 19.99,
    priceBRL: 119.99,
    icon: '💎',
    popular: false
  }
];

const SUBSCRIPTIONS = [
  {
    id: 'sub_premium',
    name: 'PREMIUM SUBSCRIPTION',
    price: 4.99,
    priceBRL: 29.99,
    duration: 30,
    icon: '👑',
    diamonds: 250,
    dailyDiamonds: 12,
    benefits: [
      '250💎 instantly',
      '12💎 daily (360 total/30 days)',
      'Premium badge on your profile',
      'Access to exclusive cases',
      'Priority support'
    ],
    popular: true
  }
];

// ============================================================
// ESTADO GLOBAL
// ============================================================

let currentUser: UserData | null = null;
let userTotalPurchases: number = 0;
let userActiveSubscription: string | null = null;
let selectedProduct: SelectedProduct | null = null;
let selectedPaymentMethod: string = 'stripe';
let isProcessing: boolean = false;

// Timer para bônus temporários
let bonusTimers: Map<string, NodeJS.Timeout> = new Map();

// ============================================================
// VERIFICAR RETORNO DE PAGAMENTO
// ============================================================

function checkPaymentReturn(): void {
  const urlParams = new URLSearchParams(window.location.search);
  const paymentStatus = urlParams.get('payment');
  const orderId = urlParams.get('order_id');

  if (paymentStatus === 'success' && orderId) {
    showAlert('success', 'Payment Successful!', `Your payment is being processed. Diamonds will be added to your account shortly.`);
    
    // Recarregar dados do usuário para atualizar diamantes a cada 2 segundos por até 10 segundos
    let attempts = 0;
    const maxAttempts = 5;
    const reloadInterval = setInterval(async () => {
      attempts++;
      await loadUserData();
      if (window.playerDiamonds && window.updateDiamondsDisplay) {
        window.updateDiamondsDisplay(window.playerDiamonds.value);
      }
      if (attempts >= maxAttempts) {
        clearInterval(reloadInterval);
      }
    }, 2000);
    
    // Limpar parâmetros da URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (paymentStatus === 'pending' && orderId) {
    showAlert('info', 'Payment Pending', 'Your payment is being processed. This may take a few minutes. We will notify you when it\'s complete.');
    
    // Recarregar dados periodicamente para verificar se foi processado
    let attempts = 0;
    const maxAttempts = 10;
    const reloadInterval = setInterval(async () => {
      attempts++;
      await loadUserData();
      if (window.playerDiamonds && window.updateDiamondsDisplay) {
        window.updateDiamondsDisplay(window.playerDiamonds.value);
      }
      if (attempts >= maxAttempts) {
        clearInterval(reloadInterval);
      }
    }, 3000);
    
    // Limpar parâmetros da URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (paymentStatus === 'cancelled') {
    showToast('info', 'Payment Cancelled', 'Payment was cancelled');
    // Limpar parâmetros da URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (paymentStatus === 'failed') {
    showAlert('error', 'Payment Failed', 'Your payment could not be processed. Please try again.');
    // Limpar parâmetros da URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (paymentStatus === 'pending') {
    showAlert('info', 'Payment Pending', 'Your payment is being processed. Please wait for confirmation.');
    // Limpar parâmetros da URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================

export async function initShop(): Promise<void> {
  console.log('🔄 Iniciando shop...');
  
  try {
    const user = getActiveUser({ sync: true, allowStored: true });
    if (!user || !user.id) {
      console.warn('⚠️ Usuário não autenticado');
      showToast('error', 'Authentication Required', 'Please login to access the shop');
      return;
    }

    console.log('✅ Usuário autenticado:', user.id);
    currentUser = user;
    
    console.log('🔄 Carregando dados do usuário...');
    await loadUserData();
    
    console.log('🔄 Renderizando shop...');
    renderShop();
    
    console.log('🔄 Iniciando timers de bônus...');
    startBonusTimers();
    
    console.log('🔄 Vinculando eventos...');
    bindShopEvents();
    
    console.log('🔄 Verificando retorno de pagamento...');
    // Verificar se há retorno de pagamento na URL
    checkPaymentReturn();
    
    console.log('✅ Shop inicializada com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao inicializar shop:', error);
    showAlert('error', 'Shop Error', 'Failed to load shop. Please refresh the page.');
  }
}

// ============================================================
// CARREGAR DADOS DO USUÁRIO
// ============================================================

async function loadUserData(): Promise<void> {
  try {
    const { data: stats, error } = await supabase
      .from('player_stats')
      .select('total_purchases, active_subscription, subscription_expires_at, diamonds')
      .eq('user_id', currentUser.id)
      .single();

    if (error) throw error;

    userTotalPurchases = stats?.total_purchases || 0;
    userActiveSubscription = stats?.active_subscription || null;
    
    // Atualizar UI de assinatura ativa se houver
    if (stats?.active_subscription && stats?.subscription_expires_at) {
      const expiresAt = new Date(stats.subscription_expires_at);
      if (expiresAt > new Date()) {
        updateActiveSubscriptionUI(stats.active_subscription, expiresAt);
      }
    }

    // Atualizar contador de diamantes no header
    if (stats && typeof stats.diamonds === 'number') {
      if (window.playerDiamonds) {
        window.playerDiamonds.value = stats.diamonds;
      }
    }
  } catch (error) {
    console.error('❌ Erro ao carregar dados do usuário:', error);
  }
}

// ============================================================
// RENDERIZAÇÃO DA SHOP
// ============================================================

function renderShop(): void {
  console.log('🔄 Renderizando shop...');
  
  // Remover skeleton se existir
  const skeleton = document.getElementById('shop-skeleton');
  if (skeleton) {
    skeleton.remove();
    console.log('✅ Skeleton removido');
  }

  // Renderizar apenas os cards nos grids existentes
  const packagesGrid = document.getElementById('packages-grid');
  const subsGrid = document.getElementById('subscriptions-grid');

  if (!packagesGrid || !subsGrid) {
    console.error('❌ Grids não encontrados!');
    return;
  }

  // Limpar grids
  packagesGrid.innerHTML = '';
  subsGrid.innerHTML = '';

  // Renderizar Pacotes
  console.log(`📦 Renderizando ${PACKAGES.length} pacotes...`);
  PACKAGES.forEach(pkg => {
    const card = createPackageCard(pkg);
    packagesGrid.appendChild(card);
  });

  // Renderizar Assinaturas
  console.log(`👑 Renderizando ${SUBSCRIPTIONS.length} assinaturas...`);
  SUBSCRIPTIONS.forEach(sub => {
    const card = createSubscriptionCard(sub);
    subsGrid.appendChild(card);
  });

  console.log('✅ Shop renderizada com sucesso!');

  // Aplicar traduções se disponível
  if (window.applyTranslations) {
    window.applyTranslations();
  }

  // Refresh Lucide icons
  if (window.refreshLucideIcons) {
    window.refreshLucideIcons();
  }
}

// ============================================================
// CRIAR CARD DE PACOTE
// ============================================================

function createPackageCard(pkg: ShopPackage): HTMLDivElement {
  const isFirstPurchase = userTotalPurchases === 0;
  const bonus = calculateBonus(pkg, isFirstPurchase);
  
  const card = document.createElement('div');
  card.className = 'shop-package-card';
  if (pkg.popular) card.classList.add('popular');
  if (bonus.hasBonus) card.classList.add('has-bonus');

  // Badges no topo - CENTRALIZADOS
  let topBadges = '';
  
  // Badge Popular - CENTRALIZADO
  if (pkg.popular) {
    topBadges += '<div class="top-badge popular-badge"><i data-lucide="star"></i><span>POPULAR</span></div>';
  }
  
  // Badge de Bônus - CENTRALIZADO
  if (bonus.hasBonus) {
    if (bonus.type === 'first_purchase') {
      topBadges += '<div class="top-badge first-purchase-badge"><i data-lucide="gift"></i><span>+50%</span></div>';
    } else if (bonus.type === 'timed') {
      topBadges += `
        <div class="top-badge timed-badge">
          <span>+25%</span>
          <div class="badge-timer" id="timer-${pkg.id}">7d 4h</div>
        </div>
      `;
    }
  }

  // Texto do bônus abaixo do valor (se houver)
  const bonusText = bonus.hasBonus ? `
    <div class="bonus-text">+${bonus.bonus} bonus</div>
  ` : '';

  card.innerHTML = `
    ${topBadges}
    <div class="package-content">
      <div class="package-icon-wrapper">
        <i data-lucide="gem" class="package-icon-lucide"></i>
        <span class="base-value">${pkg.diamonds}</span>
      </div>
      <h4 class="package-name">${pkg.name}</h4>
      
      <div class="package-diamonds-row">
        <span class="diamonds-amount">${pkg.diamonds.toLocaleString()}</span>
        <i data-lucide="gem" class="diamonds-icon-lucide"></i>
      </div>
      
      ${bonusText}
      
      <div class="package-divider"></div>
      
      <div class="package-price">
        <span class="price-currency">$</span>
        <span class="price-amount">${pkg.price.toFixed(2)}</span>
      </div>
      
      <button class="package-buy-btn" data-package-id="${pkg.id}">
        <span data-translate>Buy Now</span>
        <i data-lucide="arrow-right" class="btn-icon-lucide"></i>
      </button>
    </div>
  `;

  return card;
}

// ============================================================
// CRIAR CARD DE ASSINATURA
// ============================================================

function createSubscriptionCard(sub: ShopSubscription): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'shop-subscription-card';
  if (sub.popular) card.classList.add('popular');

  const isActive = userActiveSubscription === sub.id;
  const popularBadge = sub.popular ? '<div class="subscription-popular-badge"><i data-lucide="crown"></i><span>MOST POPULAR</span></div>' : '';
  const activeBadge = isActive ? '<div class="subscription-active-badge">✓ Active</div>' : '';

  const benefitsList = sub.benefits.map(b => `<li>✓ ${b}</li>`).join('');

  card.innerHTML = `
    ${popularBadge}
    ${activeBadge}
    <div class="subscription-icon">${sub.icon}</div>
    <h4 class="subscription-name">${sub.name}</h4>
    <div class="subscription-price">
      <span class="price-value">$${sub.price.toFixed(2)}</span>
      <span class="price-period">/${sub.duration} days</span>
    </div>
    <div class="subscription-benefits">
      <ul>${benefitsList}</ul>
    </div>
    <button class="subscription-buy-btn ${isActive ? 'active' : ''}" data-subscription-id="${sub.id}">
      <span data-translate>${isActive ? 'Renew' : 'Subscribe Now'}</span>
      <span class="btn-icon">→</span>
    </button>
  `;

  return card;
}

// ============================================================
// CALCULAR BÔNUS
// ============================================================

function calculateBonus(pkg: ShopPackage, isFirstPurchase: boolean): BonusCalculation {
  let bonus = 0;
  let bonusType = null;
  let label = '';

  // Bônus de primeira compra
  if (isFirstPurchase && pkg.firstPurchaseBonus) {
    if (pkg.firstPurchaseBonus.type === 'percentage') {
      bonus = Math.floor(pkg.diamonds * (pkg.firstPurchaseBonus.value / 100));
    } else {
      bonus = pkg.firstPurchaseBonus.value;
    }
    bonusType = 'first_purchase';
    label = pkg.firstPurchaseBonus.label;
  }

  // Bônus temporário (substitui o de primeira compra se maior)
  if (pkg.timedBonus && new Date(pkg.timedBonus.endsAt) > new Date()) {
    const timedBonus = Math.floor(pkg.diamonds * (pkg.timedBonus.percentage / 100));
    if (timedBonus > bonus) {
      bonus = timedBonus;
      bonusType = 'timed';
      label = pkg.timedBonus.label;
    }
  }

  return {
    bonus,
    type: bonusType,
    label,
    total: pkg.diamonds + bonus,
    hasBonus: bonus > 0
  };
}

// ============================================================
// TIMERS DE BÔNUS
// ============================================================

function startBonusTimers(): void {
  PACKAGES.forEach(pkg => {
    if (pkg.timedBonus && new Date(pkg.timedBonus.endsAt) > new Date()) {
      startTimerForPackage(pkg.id, pkg.timedBonus.endsAt);
    }
  });
}

function startTimerForPackage(pkgId: string, endsAt: string): void {
  const timerEl = document.getElementById(`timer-${pkgId}`);
  if (!timerEl) return;

  const intervalId = setInterval(() => {
    const now = new Date();
    const end = new Date(endsAt);
    const diff = end - now;

    if (diff <= 0) {
      clearInterval(intervalId);
      bonusTimers.delete(pkgId);
      timerEl.textContent = 'EXPIRED';
      // Recarregar shop para remover bônus
      renderShop();
      startBonusTimers();
      return;
    }

    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);

    if (days > 0) {
      timerEl.textContent = `${days}d ${hours}h`;
    } else {
      timerEl.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }, 1000);

  bonusTimers.set(pkgId, intervalId);
}

// ============================================================
// EVENTOS
// ============================================================

function bindShopEvents(): void {
  // Botões de compra de pacotes
  document.addEventListener('click', (e) => {
    const buyBtn = e.target.closest('[data-package-id]');
    if (buyBtn) {
      const pkgId = buyBtn.dataset.packageId;
      openPaymentModal(pkgId, 'package');
    }

    const subBtn = e.target.closest('[data-subscription-id]');
    if (subBtn) {
      const subId = subBtn.dataset.subscriptionId;
      openPaymentModal(subId, 'subscription');
    }
  });
}

// ============================================================
// MODAL DE PAGAMENTO
// ============================================================

function openPaymentModal(productId: string, type: 'package' | 'subscription'): void {
  if (isProcessing) return;

  let product;
  if (type === 'package') {
    product = PACKAGES.find(p => p.id === productId);
  } else {
    product = SUBSCRIPTIONS.find(s => s.id === productId);
    
    // Aviso de upgrade/substituição de assinatura
    if (userActiveSubscription && userActiveSubscription !== productId) {
      const confirmUpgrade = confirm(
        '⚠️ You already have an active subscription. Purchasing this will replace your current subscription and you will lose the remaining time. Continue?'
      );
      if (!confirmUpgrade) return;
    }
  }

  if (!product) {
    showAlert('error', 'Product Not Found', 'The selected product could not be found.');
    return;
  }

  selectedProduct = { ...product, type };

  // Preencher o modal que já está no HTML
  const modal = document.getElementById('shop-payment-modal');
  const productContainer = document.getElementById('payment-product-container');
  
  if (!modal || !productContainer) {
    console.error('❌ Modal elements not found');
    return;
  }

  // Preencher informações do produto
  const isFirstPurchase = userTotalPurchases === 0;
  const bonus = type === 'package' ? calculateBonus(product, isFirstPurchase) : null;

  if (type === 'package') {
    productContainer.innerHTML = `
      <div class="payment-product-header">
        <div class="payment-product-icon">${product.icon}</div>
        <div class="payment-product-info">
          <h3>${product.name}</h3>
          <div class="payment-diamonds-display">
            <span class="diamonds-amount">${bonus.total.toLocaleString()}</span>
            <span class="diamonds-icon">💎</span>
          </div>
          ${bonus.hasBonus ? `<div class="payment-bonus-tag">🎁 +${bonus.bonus} Bonus Diamonds</div>` : ''}
        </div>
      </div>
    `;
  } else {
    productContainer.innerHTML = `
      <div class="payment-product-header subscription-header">
        <div class="payment-product-icon">${product.icon}</div>
        <div class="payment-product-info">
          <h3>${product.name}</h3>
          <div class="subscription-features">
            ${product.benefits.map(b => `<div class="feature-item">✓ ${b}</div>`).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // Atualizar preços nos métodos de pagamento
  document.getElementById('stripe-price').textContent = `$${product.price.toFixed(2)}`;
  document.getElementById('mercadopago-price').textContent = `R$ ${product.priceBRL.toFixed(2)}`;
  document.getElementById('nowpayments-price').textContent = `$${product.price.toFixed(2)}`;

  // Resetar seleção para Stripe por padrão
  modal.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('active'));
  const stripeBtn = modal.querySelector('.payment-method-btn[data-method="stripe"]');
  if (stripeBtn) stripeBtn.classList.add('active');
  selectedPaymentMethod = 'stripe';

  // Bind eventos de seleção de método (remover listeners antigos primeiro)
  modal.querySelectorAll('.payment-method-btn').forEach(btn => {
    // Clonar o elemento para remover todos os listeners antigos
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    newBtn.addEventListener('click', () => {
      modal.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('active'));
      newBtn.classList.add('active');
      selectedPaymentMethod = newBtn.dataset.method;
    });
  });

  // Mostrar modal
  modal.classList.add('active');
  
  // Scroll suave para o topo do modal
  setTimeout(() => {
    modal.scrollTop = 0;
  }, 50);
}

// ============================================================
// FECHAR MODAL
// ============================================================

window.closeShopPaymentModal = function() {
  const modal = document.getElementById('shop-payment-modal');
  if (modal) {
    modal.classList.remove('active');
    // Não remover o modal do DOM, apenas limpar o conteúdo
    setTimeout(() => {
      const productContainer = document.getElementById('payment-product-container');
      if (productContainer) {
        productContainer.innerHTML = '';
      }
    }, 300);
  }
  selectedProduct = null;
  selectedPaymentMethod = 'stripe';
};

// ============================================================
// PROSSEGUIR PARA CHECKOUT
// ============================================================

window.proceedToCheckout = async function() {
  if (isProcessing || !selectedProduct) return;

  isProcessing = true;
  const continueBtn = document.querySelector('.payment-continue-btn');
  if (continueBtn) {
    continueBtn.disabled = true;
    continueBtn.innerHTML = '<span class="loading-spinner"></span><span>Processing...</span>';
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');

    // 🔑 Gerar chave de idempotência para prevenir cliques duplos
    const { headers, idempotencyKey } = addIdempotencyHeader(
      addCsrfHeader({ 'Content-Type': 'application/json' })
    );

    // Criar pedido
    const response = await fetch('/api/_shop', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'createOrder',
        userId: currentUser.id,
        authToken: session.access_token,
        productId: selectedProduct.id,
        productType: selectedProduct.type,
        paymentMethod: selectedPaymentMethod,
        idempotencyKey  // 🛡️ Enviar idempotency key
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to create order');
    }

    // Fechar modal atual
    window.closeShopPaymentModal();

    // Redirecionar para checkout do gateway
    if (result.checkoutUrl) {
      showToast('success', 'Redirecting', 'Redirecting to payment gateway...');
      setTimeout(() => {
        window.location.href = result.checkoutUrl;
      }, 1000);
    } else {
      showAlert('success', 'Order Created', 'Your order has been created. Please wait for confirmation.');
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    }

  } catch (error) {
    console.error('❌ Erro ao processar checkout:', error);
    showAlert('error', 'Checkout Error', error.message || 'Failed to process payment. Please try again.');
  } finally {
    isProcessing = false;
    if (continueBtn) {
      continueBtn.disabled = false;
      continueBtn.innerHTML = '<span data-translate>Continue to Checkout</span><span class="btn-icon">→</span>';
    }
  }
};

// ============================================================
// ATUALIZAR UI DE ASSINATURA ATIVA
// ============================================================

function updateActiveSubscriptionUI(subId: string, expiresAt: Date): void {
  const sub = SUBSCRIPTIONS.find(s => s.id === subId);
  if (!sub) return;

  // Renderizar novamente para atualizar badges
  renderShop();
}

// ============================================================
// EXPORTAR FUNÇÕES
// ============================================================

if (typeof window !== 'undefined') {
  window.initShop = initShop;
  window.closeShopPaymentModal = closeShopPaymentModal;
  window.proceedToCheckout = proceedToCheckout;
}
