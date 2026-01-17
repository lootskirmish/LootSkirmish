// ============================================================
// SHOP.JS - FRONTEND DA LOJA DE DIAMANTES
// ============================================================

import { supabase } from './auth';
import { addCsrfHeader, addIdempotencyHeader } from '../core/session';
import { showAlert, showToast } from '../shared/effects';
import { getActiveUser } from '../core/session';
import { ErrorHandler, ErrorCategory, ErrorSeverity } from '../shared/error-handler';
import { stateManager } from '../core/state-manager';

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
    id: 'pkg_250',
    name: 'STARTER PACK',
    diamonds: 250,
    price: 1.99, // USD
    priceBRL: 14.99,
    icon: '💎',
    popular: false,
    firstPurchaseBonus: {
      type: 'percentage',
      value: 10,
      label: '+10% First Purchase'
    }
  },
  {
    id: 'pkg_600',
    name: 'BRONZE PACK',
    diamonds: 600,
    price: 4.49,
    priceBRL: 27.49,
    icon: '💎',
    popular: true
  },
  {
    id: 'pkg_1400',
    name: 'SILVER PACK',
    diamonds: 1400,
    price: 9.99,
    priceBRL: 59.99,
    icon: '💎',
    popular: false,
    timedBonus: {
      percentage: 40,
      endsAt: '2026-01-16T23:59:59Z',
      label: '+40% Limited Time'
    }
  },
  {
    id: 'pkg_2800',
    name: 'GOLD PACK',
    diamonds: 2800,
    price: 17.99,
    priceBRL: 109.99,
    icon: '💎',
    popular: false
  },
  {
    id: 'pkg_3750',
    name: 'PLATINUM PACK',
    diamonds: 3750,
    price: 27.99,
    priceBRL: 159.99,
    icon: '💎',
    popular: false,
    timedBonus: {
      percentage: 20,
      endsAt: '2026-02-20T23:59:59Z',
      label: '+20% Limited Time'
    }
  }
];

const SUBSCRIPTIONS = [
  {
    id: 'sub_premium',
    name: 'PREMIUM SUBSCRIPTION',
    price: 5.99,
    priceBRL: 34.99,
    duration: 30,
    icon: '👑',
    diamonds: 300,
    dailyDiamonds: 15,
    benefits: [
      '300💎 instantly',
      '15💎 daily (450 total/30 days)',
      'Premium badge on your profile',
      'Access to exclusive cases',
      'Priority support'
    ],
    popular: true
  },
  {
    id: 'sub_premium_bp',
    name: 'PREMIUM + BATTLE PASS',
    price: 9.99,
    priceBRL: 59.99,
    duration: 30,
    icon: '👑',
    diamonds: 300,
    dailyDiamonds: 15,
    benefits: [
      '300💎 instantly',
      '15💎 daily (450 total/30 days)',
      'Battle Pass included',
      'Premium badge on your profile',
      'Access to exclusive cases',
      'Priority support'
    ],
    popular: false
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
let battlePassAddonEnabled: boolean = false; // Add-on Battle Pass

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
  try {
    const user = getActiveUser({ sync: true, allowStored: true });
    if (!user || !user.id) {
      console.warn('⚠️ Usuário não autenticado');
      showToast('error', 'Authentication Required', 'Please login to access the shop');
      return;
    }
    currentUser = user;
    await loadUserData();
    renderShop();
    startBonusTimers();
    bindShopEvents();
    // Verificar se há retorno de pagamento na URL
    checkPaymentReturn();
  } catch (error) {
    ErrorHandler.handleError('Failed to initialize shop', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      details: error,
      userMessage: 'Failed to load shop. Please refresh the page.',
      showToUser: true
    });
  }
}

// ============================================================
// CARREGAR DADOS DO USUÁRIO
// ============================================================

async function loadUserData(): Promise<void> {
  try {
    if (!currentUser?.id) {
      ErrorHandler.handleError('No currentUser.id available in shop', {
        category: ErrorCategory.AUTH,
        severity: ErrorSeverity.WARNING,
        details: {},
        showToUser: false
      });
      return;
    }
    
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
      stateManager.updateDiamonds(stats.diamonds);
    }
  } catch (error) {
    ErrorHandler.handleDatabaseError('Failed to load user shop data', error);
  }
}

// ============================================================
// RENDERIZAÇÃO DA SHOP
// ============================================================

function renderShop(): void {
  
  // Remover skeleton se existir
  const skeleton = document.getElementById('shop-skeleton');
  if (skeleton) {
    skeleton.remove();
  }

  // Renderizar apenas os cards nos grids existentes
  const packagesGrid = document.getElementById('packages-grid');
  const subsGrid = document.getElementById('subscriptions-grid');

  if (!packagesGrid || !subsGrid) {
    ErrorHandler.handleError('Shop grids not found in DOM', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      details: { packagesGrid: !!packagesGrid, subsGrid: !!subsGrid },
      showToUser: false
    });
    return;
  }

  // Limpar grids
  packagesGrid.innerHTML = '';
  subsGrid.innerHTML = '';

  // Renderizar Pacotes
  PACKAGES.forEach(pkg => {
    const card = createPackageCard(pkg as any);
    packagesGrid.appendChild(card);
  });

  // Renderizar Assinaturas (apenas sub_premium, não mostrar sub_premium_bp como card separado)
  SUBSCRIPTIONS.filter(sub => sub.id === 'sub_premium').forEach(sub => {
    const card = createSubscriptionCard(sub);
    subsGrid.appendChild(card);
  });

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
  let bonusType: 'first_purchase' | 'timed' | null = null;
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
    const now = new Date().getTime();
    const end = new Date(endsAt).getTime();
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
    const target = e.target as HTMLElement;
    const buyBtn = target?.closest('[data-package-id]') as HTMLElement | null;
    if (buyBtn) {
      const pkgId = buyBtn.getAttribute('data-package-id');
      if (pkgId) openPaymentModal(pkgId, 'package');
    }

    const subBtn = target?.closest('[data-subscription-id]') as HTMLElement | null;
    if (subBtn) {
      const subId = subBtn.getAttribute('data-subscription-id');
      if (subId) openPaymentModal(subId, 'subscription');
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
    ErrorHandler.handleError('Shop payment modal elements not found', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      details: { modal: !!modal, productContainer: !!productContainer },
      showToUser: false
    });
    return;
  }

  // Preencher informações do produto
  const isFirstPurchase = userTotalPurchases === 0;
  const bonus = type === 'package' ? calculateBonus(product as any, isFirstPurchase) : null;

  if (type === 'package' && bonus) {
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
    // É uma assinatura - verificar se é sub_premium (que pode ter Battle Pass add-on)
    const canAddBattlePass = product.id === 'sub_premium';
    
    productContainer.innerHTML = `
      <div class="payment-product-header subscription-header">
        <div class="payment-product-icon">${product.icon}</div>
        <div class="payment-product-info">
          <h3 class="subscription-product-name">${product.name}</h3>
          <div class="subscription-features">
            ${(product as any).benefits?.map((b: string) => `<div class="feature-item">✓ ${b}</div>`).join('') || ''}
          </div>
        </div>
      </div>
      ${canAddBattlePass ? `
        <div class="battlepass-addon-section">
          <label class="battlepass-addon-checkbox">
            <input type="checkbox" id="battlepass-addon-checkbox" ${battlePassAddonEnabled ? 'checked' : ''}>
            <span class="checkbox-custom"></span>
            <div class="addon-info">
              <span class="addon-title">🎮 Add Battle Pass</span>
              <span class="addon-price">+$4.00</span>
            </div>
          </label>
          <div class="addon-description">Unlock exclusive Battle Pass rewards and challenges!</div>
        </div>
      ` : ''}
    `;
    
    // Se pode adicionar Battle Pass, vincular evento do checkbox
    if (canAddBattlePass) {
      setTimeout(() => {
        const checkbox = document.getElementById('battlepass-addon-checkbox') as HTMLInputElement;
        if (checkbox) {
          checkbox.addEventListener('change', () => {
            battlePassAddonEnabled = checkbox.checked;
            toggleBattlePassAddon(product, checkbox.checked);
          });
        }
      }, 50);
    }
  }

  // Atualizar preços nos métodos de pagamento
  const stripePriceEl = document.getElementById('stripe-price');
  const mercadopagoEl = document.getElementById('mercadopago-price');
  const nowpaymentsEl = document.getElementById('nowpayments-price');
  
  if (stripePriceEl) stripePriceEl.textContent = `$${product.price.toFixed(2)}`;
  if (mercadopagoEl) mercadopagoEl.textContent = `R$ ${product.priceBRL.toFixed(2)}`;
  if (nowpaymentsEl) nowpaymentsEl.textContent = `$${product.price.toFixed(2)}`;

  // Resetar seleção para Stripe por padrão
  modal.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('active'));
  const stripeBtn = modal.querySelector('.payment-method-btn[data-method="stripe"]');
  if (stripeBtn) stripeBtn.classList.add('active');
  selectedPaymentMethod = 'stripe';

  // Bind eventos de seleção de método (remover listeners antigos primeiro)
  modal.querySelectorAll('.payment-method-btn').forEach(btn => {
    // Clonar o elemento para remover todos os listeners antigos
    const newBtn = btn.cloneNode(true) as HTMLElement;
    if (btn.parentNode) {
      btn.parentNode.replaceChild(newBtn, btn);
    }
    
    newBtn.addEventListener('click', () => {
      modal.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('active'));
      newBtn.classList.add('active');
      selectedPaymentMethod = newBtn.dataset.method || 'stripe';
    });
  });

  // Bind evento de fechar modal - Usar delegação de evento
  const closeBtnOld = modal.querySelector('.payment-close-btn');
  if (closeBtnOld && closeBtnOld.parentNode) {
    const newCloseBtn = closeBtnOld.cloneNode(true) as HTMLElement;
    closeBtnOld.parentNode.replaceChild(newCloseBtn, closeBtnOld);
    
    // Remover evento onclick do HTML e adicionar via addEventListener
    newCloseBtn.onclick = null;
    newCloseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const modal = document.getElementById('shop-payment-modal');
      if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
          const productContainer = document.getElementById('payment-product-container');
          if (productContainer) {
            productContainer.innerHTML = '';
          }
        }, 300);
      }
      selectedProduct = null;
      selectedPaymentMethod = 'stripe';
      battlePassAddonEnabled = false;
    });
  }
  
  // Mostrar modal
  modal.classList.add('active');
  
  // Scroll suave para o topo do modal
  setTimeout(() => {
    modal.scrollTop = 0;
  }, 50);
}

// ============================================================
// ALTERNAR BATTLE PASS ADD-ON
// ============================================================

function toggleBattlePassAddon(baseProduct: any, enabled: boolean): void {
  // Encontrar o produto correto
  let newProduct;
  if (enabled) {
    // Mudar para sub_premium_bp
    newProduct = SUBSCRIPTIONS.find(s => s.id === 'sub_premium_bp');
  } else {
    // Voltar para sub_premium
    newProduct = SUBSCRIPTIONS.find(s => s.id === 'sub_premium');
  }
  
  if (!newProduct) {
    ErrorHandler.handleError('Subscription product not found', {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.ERROR,
      details: { enabled, baseProductId: baseProduct?.id },
      userMessage: 'Subscription product not found',
      showToUser: true
    });
    return;
  }
  
  // Atualizar selectedProduct
  selectedProduct = { ...newProduct, type: 'subscription' };
  
  // Atualizar nome do produto no modal
  const productNameEl = document.querySelector('.subscription-product-name');
  if (productNameEl) {
    productNameEl.textContent = newProduct.name;
  }
  
  // Atualizar benefícios
  const featuresEl = document.querySelector('.subscription-features');
  if (featuresEl) {
    featuresEl.innerHTML = newProduct.benefits?.map((b: string) => `<div class="feature-item">✓ ${b}</div>`).join('') || '';
  }
  
  // Atualizar preços nos métodos de pagamento com animação
  const stripePriceEl = document.getElementById('stripe-price');
  const mercadopagoEl = document.getElementById('mercadopago-price');
  const nowpaymentsEl = document.getElementById('nowpayments-price');
  
  // Adicionar classe de atualização para animação
  [stripePriceEl, mercadopagoEl, nowpaymentsEl].forEach(el => {
    if (el) {
      el.classList.add('price-updating');
      setTimeout(() => el.classList.remove('price-updating'), 300);
    }
  });
  
  // Atualizar valores
  if (stripePriceEl) stripePriceEl.textContent = `$${newProduct.price.toFixed(2)}`;
  if (mercadopagoEl) mercadopagoEl.textContent = `R$ ${newProduct.priceBRL.toFixed(2)}`;
  if (nowpaymentsEl) nowpaymentsEl.textContent = `$${newProduct.price.toFixed(2)}`;
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
  battlePassAddonEnabled = false;
};

// ============================================================
// PROSSEGUIR PARA CHECKOUT
// ============================================================

window.proceedToCheckout = async function() {
  if (isProcessing || !selectedProduct) return;

  isProcessing = true;
  const continueBtn = document.querySelector('.payment-continue-btn') as HTMLButtonElement | null;
  if (continueBtn) {
    continueBtn.disabled = true;
    continueBtn.innerHTML = '<span class="loading-spinner"></span><span>Processing...</span>';
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !currentUser?.id) throw new Error('Not authenticated');

    // 🔑 Gerar chave de idempotência para prevenir cliques duplos
    const { headers, idempotencyKey } = addIdempotencyHeader(
      await addCsrfHeader({ 'Content-Type': 'application/json' })
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
        battlePassAddon: battlePassAddonEnabled, // 🎮 Battle Pass add-on
        idempotencyKey  // 🛡️ Enviar idempotency key
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to create order');
    }

    // Fechar modal atual
    ((window as any).closeShopPaymentModal as Function)?.();

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
    ErrorHandler.handleError('Checkout processing failed', {
      category: ErrorCategory.PAYMENT,
      severity: ErrorSeverity.ERROR,
      details: error,
      userMessage: (error as any)?.message || 'Failed to process payment. Please try again.',
      showToUser: true
    });
  } finally {
    isProcessing = false;
    if (continueBtn) {
      continueBtn.disabled = false;
      continueBtn.innerHTML = '<span data-translate>Continue to Checkout</span><span class="btn-icon">→</span>';
    }
  }
};

// ============================================================
// EXPORTS DE FUNÇÕES
// ============================================================

window.closeShopPaymentModal = function closeShopPaymentModal() {
  const modal = document.getElementById('payment-modal');
  if (modal) {
    modal.classList.remove('active');
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
  window.closeShopPaymentModal = function closeShopPaymentModal() {
    const modal = document.getElementById('payment-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  };
}
