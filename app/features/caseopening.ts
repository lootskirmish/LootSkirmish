// ============================================================
// CASE OPENING - FRONTEND (CLIENT-SIDE)
// ============================================================

import { supabase } from './auth';
import { addCsrfHeader } from '../core/session';
import { RARITIES, OPENING_CASES, getCaseById, getRarityByIndex, PASSES_CONFIG, getPassConfig, canOpenQuantity, getRequiredPassForQuantity } from '../shared/constants';
import type { Case, CaseItem, Rarity, PassConfig } from '../shared/constants';
import { playSound, startLoop } from '../shared/sfx';
import type { LoopHandle } from '../shared/sfx';
import { showToast, showAlert } from '../shared/effects';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

interface PreviewItem {
  name: string;
  value: number;
  icon: string;
  color: string;
  rarity: string;
  rarityIcon: string;
}

interface CaseOpeningElements {
  galleryGrid: HTMLElement | null;
  galleryScreen: HTMLElement | null;
  openingScreen: HTMLElement | null;
  currentCaseName: HTMLElement | null;
  currentCasePrice: HTMLElement | null;
  lootTableGrid: HTMLElement | null;
  reelWrapper: HTMLElement | null;
  backToGallery: HTMLElement | null;
  quickSpin: HTMLInputElement | null;
  openCaseBtn: HTMLElement | null;
  resultContinueBtn: HTMLElement | null;
  priceFilter: HTMLSelectElement | null;
  totalCostDisplay: HTMLElement | null;
  baseCostDisplay: HTMLElement | null;
  discountChip: HTMLElement | null;
  discountPercent: HTMLElement | null;
  discountLevel: HTMLElement | null;
  discountNextCost: HTMLElement | null;
  upgradeDiscountBtn: HTMLElement | null;
  resultModal: HTMLElement | null;
  quickSpinCost: HTMLElement | null;
  passModal: HTMLElement | null;
  passModalTitle: HTMLElement | null;
  passModalIcon: HTMLElement | null;
  passModalDesc: HTMLElement | null;
  passModalCost: HTMLElement | null;
  passModalBenefits: HTMLElement | null;
  passModalConfirm: HTMLElement | null;
  passModalCancel: HTMLElement | null;
}

interface CaseCost {
  baseTotal: number;
  discountedTotal: number;
  discountPercent: number;
  savings: number;
}

interface AdjustedPoolItem {
  item: CaseItem;
  min?: number;
  max?: number;
  rarity?: Rarity;
  cumulative?: number;
}

interface SlotData {
  items: PreviewItem[];
  winnerIndex: number;
  winner: PreviewItem;
}

interface User {
  id: string;
  [key: string]: any;
}

declare global {
  interface Window {
    playerMoney?: { value: number };
    initCaseOpening: typeof initCaseOpening;
  }
}

// ============================================================
// GLOBAL STATE
// ============================================================

let currentCaseId: string | null = null;
let selectedQuantity: number = 1;
let isQuickSpin: boolean = false;
let isOpening: boolean = false;
let currentUser: User | null = null;
let playerMoney: number = 0;
let previewItems: PreviewItem[] = []; // 🔥 NOVO: armazena preview dos 96 itens

let caseOpeningUIBound: boolean = false;
let previewInFlight: Promise<void> | null = null;
let previewPending: boolean = false;
let previewToken: number = 0;

let playerDiamonds: number = 0;
let ownedPasses: string[] = [];
let reelLoopHandle: LoopHandle | null = null;
let caseDiscountLevel: number = 0;
let isUpgradingDiscount: boolean = false;

const MAX_DISCOUNT_LEVEL: number = 40;

function getCaseOpeningEls(): CaseOpeningElements {
  return {
    galleryGrid: document.getElementById('case-gallery-grid'),
    galleryScreen: document.getElementById('case-gallery-screen'),
    openingScreen: document.getElementById('case-opening-screen'),
    currentCaseName: document.getElementById('current-case-name'),
    currentCasePrice: document.getElementById('current-case-price'),
    lootTableGrid: document.getElementById('loot-table-grid'),
    reelWrapper: document.getElementById('reel-wrapper'),
    backToGallery: document.getElementById('back-to-gallery'),
    quickSpin: document.getElementById('quick-spin-checkbox') as HTMLInputElement | null,
    openCaseBtn: document.getElementById('open-case-btn'),
    resultContinueBtn: document.getElementById('result-continue-btn'),
    priceFilter: document.getElementById('price-filter') as HTMLSelectElement | null,
    totalCostDisplay: document.getElementById('total-cost-display'),
    baseCostDisplay: document.getElementById('base-cost-display'),
    discountChip: document.getElementById('discount-chip'),
    discountPercent: document.getElementById('case-discount-percent'),
    discountLevel: document.getElementById('case-discount-level'),
    discountNextCost: document.getElementById('case-discount-next-cost'),
    upgradeDiscountBtn: document.getElementById('upgrade-discount-btn'),
    resultModal: document.getElementById('result-modal'),
    quickSpinCost: document.getElementById('quick-spin-cost'),
    passModal: document.getElementById('pass-modal'),
    passModalTitle: document.getElementById('pass-modal-title'),
    passModalIcon: document.getElementById('pass-modal-icon'),
    passModalDesc: document.getElementById('pass-modal-desc'),
    passModalCost: document.getElementById('pass-modal-cost'),
    passModalBenefits: document.getElementById('pass-modal-benefits'),
    passModalConfirm: document.getElementById('pass-modal-confirm'),
    passModalCancel: document.getElementById('pass-modal-cancel')
  };
}

function getCurrentMoney(): number {
  return (window.playerMoney && typeof window.playerMoney.value === 'number')
    ? window.playerMoney.value
    : playerMoney;
}

function getDiscountPercent(): number {
  return Math.min(Math.max(Number(caseDiscountLevel) || 0, 0), MAX_DISCOUNT_LEVEL);
}

function getDiscountFactor(): number {
  return 1 - (getDiscountPercent() / 100);
}

function calcDiscountUpgradeCost(level: number): number {
  return Math.round(100 * Math.pow(1.38, level));
}

function formatCurrency(amount: number): string {
  return `$${(Number(amount) || 0).toFixed(2)}`;
}

function computeCaseCost(caseData: Case, qty: number = selectedQuantity): CaseCost {
  const baseTotal = parseFloat((caseData.price * qty).toFixed(2));
  const discountPercent = getDiscountPercent();
  const discountedTotal = parseFloat((baseTotal * getDiscountFactor()).toFixed(2));
  const savings = Math.max(0, parseFloat((baseTotal - discountedTotal).toFixed(2)));

  return { baseTotal, discountedTotal, discountPercent, savings };
}

// ============================================================
// SEEDED RNG (CLIENT-SIDE - MUST MATCH BACKEND)
// ============================================================

function seededRandom(seed: number | string): number {
  let seedValue = 0;
  const seedStr = String(seed);
  
  for (let i = 0; i < seedStr.length; i++) {
    seedValue = ((seedValue << 5) - seedValue) + seedStr.charCodeAt(i);
    seedValue = seedValue & seedValue;
  }
  
  const x = Math.sin(Math.abs(seedValue)) * 10000;
  return x - Math.floor(x);
}

function createSeededRNG(seed: number | string): () => number {
  let seedValue = 0;
  const seedStr = String(seed);
  
  for (let i = 0; i < seedStr.length; i++) {
    seedValue = ((seedValue << 5) - seedValue) + seedStr.charCodeAt(i);
    seedValue = seedValue & seedValue;
  }
  
  return function() {
    const x = Math.sin(Math.abs(seedValue++)) * 10000;
    return x - Math.floor(x);
  };
}

// ============================================================
// ITEM GENERATION (CLIENT-SIDE - FOR VISUAL ONLY)
// ============================================================
// ITEM GENERATION (CLIENT-SIDE - FOR VISUAL ONLY)
// ============================================================

function buildAdjustedPools(caseData: Case): AdjustedPoolItem[] {
  const pools: AdjustedPoolItem[] = [];
  const buckets = RARITIES.map((rarity, idx) => {
    const items = caseData.items.filter((it) => it.rarityIndex === idx);
    return items.length ? { rarity, items } : null;
  }).filter((b): b is { rarity: Rarity; items: CaseItem[] } => b !== null);

  if (!buckets.length) return pools;

  const totalBase = buckets.reduce((sum, b) => sum + (b?.rarity?.chance || 0), 0);
  let cumulative = 0;

  for (const bucket of buckets) {
    if (!bucket) continue;
    const rarityChance = (bucket.rarity.chance / totalBase) * 100;
    const perItemChance = rarityChance / bucket.items.length;
    for (const item of bucket.items) {
      cumulative += perItemChance;
      pools.push({ item, rarity: bucket.rarity, cumulative });
    }
  }

  // Garantir 100% para evitar gaps de floating point
  if (pools.length) pools[pools.length - 1].cumulative = 100;
  return pools;
}

function generateRandomItem(caseData: Case | null): CaseItem | null {
  if (!caseData) return null;
  
  const pools = buildAdjustedPools(caseData);
  if (!pools.length) {
    const fallback = caseData.items?.[0];
    return fallback
      ? {
          name: fallback.name,
          icon: fallback.icon,
          minValue: RARITIES[Math.min(fallback.rarityIndex, RARITIES.length - 1)]?.chance || 0,
          maxValue: RARITIES[Math.min(fallback.rarityIndex, RARITIES.length - 1)]?.chance || 0,
          rarityIndex: fallback.rarityIndex
        }
      : null;
  }

  const roll = Math.random() * 100;
  const hit = pools.find(p => (p.cumulative || 0) >= roll) || pools[pools.length - 1];
  if (!hit) return null;
  
  const value = hit.item.minValue + (Math.random() * (hit.item.maxValue - hit.item.minValue));

  return {
    name: hit.item.name,
    icon: hit.item.icon,
    minValue: parseFloat(value.toFixed(2)),
    maxValue: parseFloat(value.toFixed(2)),
    rarityIndex: hit.item.rarityIndex
  };
}

// ============================================================
// INITIALIZATION
// ============================================================

export function initCaseOpening(user: User, money: number, diamonds: number = 0, passes: string[] = [], discountLevel: number | null = null): void {
  currentUser = user;
  playerMoney = Number(money) || 0;
  playerDiamonds = diamonds;
  ownedPasses = Array.isArray(passes) ? passes : [];
  caseDiscountLevel = Math.min(
    Math.max(Number(discountLevel ?? window.cachedCaseDiscountLevel ?? 0) || 0, 0),
    MAX_DISCOUNT_LEVEL
  );

  bindCaseOpeningUIOnce();
  renderCaseGallery();
  updateDiscountUI();
}

// ============================================================
// CASE GALLERY RENDERING
// ============================================================

function renderCaseGallery(): void {
  const { galleryGrid } = getCaseOpeningEls();
  if (!galleryGrid) return;

  galleryGrid.innerHTML = OPENING_CASES.map(caseData => {
    const iconContent = caseData.iconImage
      ? `<img src="${caseData.iconImage}" alt="${caseData.name} icon" style="filter: drop-shadow(0 8px 20px ${caseData.color});">`
      : `<span style="font-size: 5rem; filter: drop-shadow(0 8px 20px ${caseData.color});">${caseData.icon}</span>`;

    return `
    <div class="case-card" data-case-id="${caseData.id}">
      <div class="case-card-icon" style="background: linear-gradient(180deg, ${caseData.color}40, transparent);">
        ${iconContent}
      </div>
      <div class="case-card-info">
        <h3 class="case-card-name">${caseData.name}</h3>
        <p class="case-card-price">$${caseData.price.toFixed(2)}</p>
      </div>
    </div>
  `;
  }).join('');
}

// ============================================================
// CASE VIEW
// ============================================================

async function openCaseView(caseId: string): Promise<void> {
  currentCaseId = caseId;
  const caseData = getCaseById(caseId);
  
  if (!caseData) {
    console.error('Case not found:', caseId);
    return;
  }
  
  const { currentCaseName, currentCasePrice, galleryScreen, openingScreen } = getCaseOpeningEls();
  if (currentCaseName) currentCaseName.textContent = caseData.name;
  if (currentCasePrice) currentCasePrice.textContent = `$${caseData.price.toFixed(2)}`;
  
  selectedQuantity = 1;
  updateQuantityButtons();
  updateTotalCost();
  updatePassUI(); // NOVO
  
  renderLootTable(caseData);
  
  await generatePreview();
  
  if (galleryScreen) galleryScreen.classList.remove('active');
  if (openingScreen) openingScreen.classList.add('active');
}

function renderLootTable(caseData: Case): void {
  const { lootTableGrid } = getCaseOpeningEls();
  const grid = lootTableGrid;
  if (!grid) return;
  
  grid.innerHTML = caseData.items.map(item => {
    const rarity = getRarityByIndex(item.rarityIndex);
    return `
      <div class="loot-item" style="border-color: ${rarity.color};">
        <div class="loot-item-icon">${item.icon}</div>
        <div class="loot-item-name">${item.name}</div>
        <div class="loot-item-value">$${item.minValue.toFixed(2)} - $${item.maxValue.toFixed(2)}</div>
        <div class="loot-item-chance" style="color: ${rarity.color};">
          ${rarity.chance}% ${rarity.icon}
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// PREVIEW GENERATION (NOVO)
// ============================================================

async function generatePreview(): Promise<void> {
  if (!currentCaseId) return;

  previewToken++;
  const myToken = previewToken;
  previewPending = true;

  if (previewInFlight) return;

  previewInFlight = (async () => {
    while (previewPending) {
      previewPending = false;

      const caseId = currentCaseId;
      const quantity = selectedQuantity;
      const requestToken = previewToken;

      try {
        const response = await fetch('/api/_caseopening', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'generatePreview',
            caseId,
            quantity
          })
        });

        const result = await response.json();

        // Não aplicar se ficou stale
        if (requestToken !== previewToken || myToken !== previewToken) continue;

        if (!response.ok) {
          console.error('❌ Preview generation failed:', result.error);
          previewItems = [];
          setupReel();
          continue;
        }

        previewItems = result.previews || [];
        setupReel();
      } catch (error) {
        if (requestToken !== previewToken || myToken !== previewToken) continue;
        console.error('💥 Preview error:', error);
        previewItems = [];
        setupReel();
      }
    }
  })().finally(() => {
    previewInFlight = null;
  });

  await previewInFlight;
}

// ============================================================
// REEL SETUP (ATUALIZADO)
// ============================================================

function setupReel(): void {
  const { reelWrapper } = getCaseOpeningEls();
  const wrapper = reelWrapper;
  if (!wrapper) return;
  
  if (selectedQuantity === 1) {
    wrapper.className = 'reel-wrapper horizontal';
    wrapper.innerHTML = `
      <div class="reel-container-horizontal" id="reel-container-0">
        <div class="reel-indicator-horizontal"></div>
        <div class="reel-track-horizontal" id="reel-track-0"></div>
      </div>
    `;
    
    // 🔥 RENDERIZAR PREVIEW
    if (previewItems.length > 0 && previewItems[0]) {
      renderPreviewItems(0, true);
    }
  } else {
    wrapper.className = 'reel-wrapper vertical';
    wrapper.innerHTML = Array.from({ length: selectedQuantity }, (_, i) => `
      <div class="reel-container-vertical" id="reel-container-${i}">
        <div class="reel-indicator-vertical"></div>
        <div class="reel-track-vertical" id="reel-track-${i}"></div>
      </div>
    `).join('');
    
    // 🔥 RENDERIZAR PREVIEW
    for (let i = 0; i < selectedQuantity; i++) {
      if (previewItems.length > i && previewItems[i]) {
        renderPreviewItems(i, false);
      }
    }
  }
}

// ============================================================
// RENDER PREVIEW ITEMS (NOVO)
// ============================================================

function renderPreviewItems(slotIndex: number, isHorizontal: boolean): void {
  const track = document.getElementById(`reel-track-${slotIndex}`);
  if (!track) return;
  
  const slotItems = previewItems[slotIndex];
  if (!Array.isArray(slotItems) || slotItems.length === 0) return;
  
  const itemClass = isHorizontal ? 'reel-item-horizontal' : 'reel-item-vertical';
  
  track.innerHTML = slotItems.map((item: PreviewItem) => `
    <div class="reel-item ${itemClass}" style="border-color: ${item.color}; background: ${item.color}20;">
      <div class="reel-item-icon">${item.icon}</div>
      <div class="reel-item-name">${item.name}</div>
      <div class="reel-item-value">$${item.value}</div>
    </div>
  `).join('');
  
  // Reset position
  track.style.transition = 'none';
  track.style.transform = isHorizontal ? 'translateX(0)' : 'translateY(0)';
}

// ============================================================
// CONTROLS
// ============================================================

function updateQuantityButtons(): void {
  document.querySelectorAll('.qty-btn').forEach(btn => {
    const element = btn as HTMLElement;
    const qtyStr = element.getAttribute('data-qty');
    if (!qtyStr) return;
    
    const qty = parseInt(qtyStr);
    const isActive = qty === selectedQuantity;
    const canOpen = canOpenQuantity(ownedPasses, qty);
    const requiredPass = getRequiredPassForQuantity(qty);
    
    element.classList.toggle('active', isActive);
    element.classList.toggle('locked', !canOpen && !!requiredPass);
    element.setAttribute('aria-disabled', String(!canOpen));
    
    // Visual feedback
    if (!canOpen && requiredPass) {
      const config = getPassConfig(requiredPass);
      if (config) {
        (element as HTMLElement).style.opacity = '0.65';
        (element as HTMLElement).style.cursor = 'pointer';
        (element as HTMLElement).title = `Requires ${config.name} (${config.cost} 💎)`;
      }
    } else {
      (element as HTMLElement).style.opacity = '1';
      (element as HTMLElement).style.cursor = 'pointer';
      (element as HTMLElement).title = '';
    }
  });
}

function updateTotalCost(): void {
  const caseData = getCaseById(currentCaseId || undefined);
  if (!caseData) return;
  
  const { totalCostDisplay, openCaseBtn, baseCostDisplay, discountChip } = getCaseOpeningEls();
  const { baseTotal, discountedTotal, discountPercent, savings } = computeCaseCost(caseData, selectedQuantity);
  const hasDiscount = discountPercent > 0 && savings > 0;

  if (totalCostDisplay) totalCostDisplay.textContent = formatCurrency(discountedTotal);

  if (baseCostDisplay) {
    baseCostDisplay.textContent = formatCurrency(baseTotal);
    baseCostDisplay.style.opacity = hasDiscount ? '0.75' : '0';
    baseCostDisplay.style.visibility = hasDiscount ? 'visible' : 'hidden';
  }

  if (discountChip) {
    if (hasDiscount) {
      discountChip.textContent = `-${discountPercent}% • Save ${formatCurrency(savings)}`;
      discountChip.style.display = 'inline-flex';
    } else {
      discountChip.style.display = 'none';
    }
  }

  const availableMoney = getCurrentMoney();
  if (openCaseBtn) {
    (openCaseBtn as HTMLButtonElement).disabled = discountedTotal > availableMoney || isOpening;
  }
}

function updateDiscountUI(): void {
  const {
    discountPercent: discountPercentEl,
    discountLevel: discountLevelEl,
    discountNextCost,
    upgradeDiscountBtn
  } = getCaseOpeningEls();

  const percent = getDiscountPercent();
  const isMaxed = percent >= MAX_DISCOUNT_LEVEL;

  if (discountPercentEl) {
    discountPercentEl.textContent = `${percent}% OFF`;
  }

  if (discountLevelEl) {
    discountLevelEl.textContent = `Lvl ${caseDiscountLevel} / ${MAX_DISCOUNT_LEVEL}`;
  }

  if (discountNextCost) {
    if (isMaxed) {
      discountNextCost.textContent = 'Max level reached';
    } else {
      const nextCost = calcDiscountUpgradeCost(caseDiscountLevel);
      discountNextCost.textContent = `Next: ${formatCurrency(nextCost)}`;
    }
  }

  if (upgradeDiscountBtn) {
    if (isMaxed) {
      upgradeDiscountBtn.textContent = 'Max Level Reached';
      (upgradeDiscountBtn as HTMLButtonElement).disabled = true;
    } else {
      const nextCost = calcDiscountUpgradeCost(caseDiscountLevel);
      const canAfford = getCurrentMoney() >= nextCost;
      upgradeDiscountBtn.textContent = `Upgrade for ${formatCurrency(nextCost)}`;
      (upgradeDiscountBtn as HTMLButtonElement).disabled = isOpening || isUpgradingDiscount || !canAfford;
    }
  }
}

// ============================================================
// UPDATE PASS UI
// ============================================================

function updatePassUI(): void {
  const { quickSpinCost } = getCaseOpeningEls();
  const quickSpinToggleEl = document.querySelector('.quick-spin-toggle') as HTMLElement | null;
  
  // Atualizar custo do Quick Roll
  const hasQuickRoll = ownedPasses.includes('quick_roll');
  if (quickSpinCost) {
    if (hasQuickRoll) {
      quickSpinCost.textContent = 'UNLOCKED';
      quickSpinCost.classList.remove('locked');
      quickSpinCost.classList.add('unlocked');
    } else {
      const config = getPassConfig('quick_roll');
      if (config) {
        quickSpinCost.textContent = `${config.cost} 💎`;
      }
      quickSpinCost.classList.remove('unlocked');
      quickSpinCost.classList.add('locked');
    }
  }

  if (quickSpinToggleEl) {
    quickSpinToggleEl.classList.toggle('locked', !hasQuickRoll);
    quickSpinToggleEl.classList.toggle('unlocked', hasQuickRoll);
  }
  
  // Atualizar botões de quantidade
  updateQuantityButtons();
}

// ============================================================
// PASS PURCHASE MODAL
// ============================================================

function showPassModal(passId: string): void {
  const config = getPassConfig(passId);
  if (!config) return;
  
  const {
    passModal,
    passModalTitle,
    passModalIcon,
    passModalDesc,
    passModalCost,
    passModalBenefits
  } = getCaseOpeningEls();
  
  if (!passModal) return;
  
  // Preencher modal
  if (passModalTitle) passModalTitle.textContent = config.name;
  if (passModalIcon) passModalIcon.textContent = config.icon;
  if (passModalDesc) passModalDesc.textContent = config.description;
  if (passModalCost) passModalCost.textContent = `${config.cost} 💎`;
  
  // Renderizar benefícios
  if (passModalBenefits) {
    passModalBenefits.innerHTML = config.benefits.map(benefit => `
      <li style="color: var(--text-primary); margin-bottom: 8px;">
        <span style="color: ${config.color};">✓</span> ${benefit}
      </li>
    `).join('');
  }
  
  // Armazenar passId no modal para usar no confirm
  passModal.dataset.passId = passId;
  
  // Mostrar modal
  passModal.classList.add('active');
}

function hidePassModal(): void {
  const { passModal } = getCaseOpeningEls();
  if (passModal) {
    passModal.classList.remove('active');
    delete passModal.dataset.passId;
  }
}

// ============================================================
// PURCHASE PASS (API CALL)
// ============================================================

async function purchasePass(passId: string): Promise<void> {
  const config = getPassConfig(passId);
  if (!config) return;
  
  // Verificar se já tem
  if (ownedPasses.includes(passId)) {
    showAlert('info', 'Already Owned', `You already own ${config.name}!`);
    hidePassModal();
    return;
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !currentUser) {
      showAlert('error', 'Auth Error', 'Not logged in');
      return;
    }
    
    const response = await fetch('/api/_caseopening', {
      method: 'POST',
      headers: addCsrfHeader({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        action: 'purchasePass',
        userId: currentUser.id,
        authToken: session.access_token,
        passId: passId,
        cost: config.cost,
        requiredPass: config.requires
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      if (result.error === 'PASS_ALREADY_OWNED') {
        showAlert('info', 'Already Owned', `You already own ${config.name}!`);
      } else if (result.error === 'INSUFFICIENT_DIAMONDS') {
        showAlert('error', 'Insufficient Diamonds! 💎', `You need ${result.needed} diamonds but only have ${result.current}.`);
      } else if (result.error === 'REQUIRED_PASS_NOT_OWNED') {
        const requiredConfig = getPassConfig(result.requiredPass);
        if (requiredConfig) {
          showAlert('warning', 'Pass Required!', `You need ${requiredConfig.name} first.`);
        }
      } else {
        showAlert('error', 'Purchase Failed', result.error || 'An error occurred. Please try again.');
      }
      hidePassModal();
      return;
    }
    
    // Atualizar estado local
    const updatedDiamonds = typeof result.newDiamonds === 'number'
      ? result.newDiamonds
      : playerDiamonds;
    const updatedPasses = Array.isArray(result.unlockedPasses)
      ? result.unlockedPasses
      : ownedPasses;

    playerDiamonds = updatedDiamonds;
    ownedPasses = updatedPasses;

    // Atualizar caches globais para persistir estado nas próximas rotas/refresh
    window.cachedUnlockedPasses = updatedPasses;
    if (window.playerDiamonds) {
      window.playerDiamonds.value = updatedDiamonds;
    }
    window.cachedDiamonds = updatedDiamonds;
    const diamondDisplay = document.getElementById('diamonds');
    if (diamondDisplay) diamondDisplay.textContent = updatedDiamonds;
    
    // Atualizar UI
    updatePassUI();
    
    // Fechar modal
    hidePassModal();
    
    // Mostrar sucesso
    showToast('success', 'Pass Unlocked! ✨', `${config.name} has been unlocked!`);
    
  } catch (error) {
    console.error('Purchase pass error:', error);
    showAlert('error', 'Connection Error! 🌐', 'Unable to connect to server. Please check your internet connection.');
    hidePassModal();
  }
}

// ============================================================
// DISCOUNT UPGRADE (money-based)
// ============================================================

async function upgradeCaseDiscount(): Promise<void> {
  if (isUpgradingDiscount) return;
  if (!currentUser?.id) {
    showAlert('error', 'Not logged in', 'Please sign in to upgrade your discount.');
    return;
  }

  const isMaxed = caseDiscountLevel >= MAX_DISCOUNT_LEVEL;
  if (isMaxed) {
    showToast('info', 'Discount Maxed', 'You already reached the maximum discount.');
    updateDiscountUI();
    return;
  }

  const nextCost = calcDiscountUpgradeCost(caseDiscountLevel);
  const currentBalance = getCurrentMoney();

  if (currentBalance < nextCost) {
    const missing = nextCost - currentBalance;
    showAlert('error', 'Insufficient Balance! 💸', `You need ${formatCurrency(missing)} more to upgrade.`);
    updateDiscountUI();
    return;
  }

  isUpgradingDiscount = true;
  updateDiscountUI();

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      showAlert('error', 'Auth Error', 'Could not verify your session. Please re-login.');
      return;
    }

    const response = await fetch('/api/_caseopening', {
      method: 'POST',
      headers: addCsrfHeader({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({
        action: 'upgradeCaseDiscount',
        userId: currentUser.id,
        authToken: session.access_token
      })
    });

    const result = await response.json();

    if (!response.ok) {
      if (result.error === 'MAX_DISCOUNT_REACHED') {
        caseDiscountLevel = Math.min(
          Math.max(Number(result.level) || caseDiscountLevel, caseDiscountLevel),
          MAX_DISCOUNT_LEVEL
        );
        window.cachedCaseDiscountLevel = caseDiscountLevel;
        showToast('info', 'Discount Maxed', 'Maximum discount already reached.');
        return;
      }

      if (result.error === 'INSUFFICIENT_FUNDS') {
        const missingValue = typeof result.needed === 'number' ? result.needed : (nextCost - currentBalance);
        showAlert('error', 'Insufficient Balance! 💸', `You need ${formatCurrency(missingValue)} more.`);
        return;
      }

      showAlert('error', 'Upgrade Failed', result.error || 'Could not upgrade discount.');
      return;
    }

    caseDiscountLevel = Math.min(
      typeof result.level === 'number' ? result.level : caseDiscountLevel + 1,
      MAX_DISCOUNT_LEVEL
    );
    window.cachedCaseDiscountLevel = caseDiscountLevel;

    const newBalance = typeof result.newBalance === 'number'
      ? result.newBalance
      : currentBalance - nextCost;

    playerMoney = newBalance;
    if (window.playerMoney) {
      window.playerMoney.value = newBalance;
    }

    updateDiscountUI();
    if (currentCaseId) {
      updateTotalCost();
    }

    const appliedPercent = result.discountPercent ?? getDiscountPercent();
    const nextUpgradeCost = result.nextCost ?? (caseDiscountLevel < MAX_DISCOUNT_LEVEL
      ? calcDiscountUpgradeCost(caseDiscountLevel)
      : null);

    showToast(
      'success',
      'Discount upgraded! ✨',
      nextUpgradeCost !== null
        ? `Now ${appliedPercent}% off. Next upgrade: ${formatCurrency(nextUpgradeCost)}.`
        : `Now ${appliedPercent}% off. Max level reached.`
    );
  } catch (error) {
    console.error('Upgrade discount error:', error);
    showAlert('error', 'Connection Error! 🌐', 'Unable to connect to server. Please try again.');
  } finally {
    isUpgradingDiscount = false;
    updateDiscountUI();
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function bindCaseOpeningUIOnce(): void {
  if (caseOpeningUIBound) return;

  const {
    galleryGrid,
    galleryScreen,
    openingScreen,
    backToGallery,
    quickSpin,
    openCaseBtn,
    resultContinueBtn,
    priceFilter,
    resultModal
  } = getCaseOpeningEls();

  if (galleryGrid && !galleryGrid.dataset.bound) {
    galleryGrid.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const card = target?.closest?.('.case-card') as HTMLElement | null;
      if (!card) return;
      const caseId = card.getAttribute('data-case-id');
      if (caseId) openCaseView(caseId);
    });
    galleryGrid.dataset.bound = '1';
  }

  const qtyContainer = document.querySelector('#case-opening-screen .quantity-selector') as HTMLElement | null;
  if (qtyContainer && !qtyContainer.dataset.bound) {
    qtyContainer.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;
      const btn = target?.closest?.('.qty-btn') as HTMLElement | null;
      if (!btn) return;
      if (isOpening) return;

      const qtyStr = btn.getAttribute('data-qty');
      if (!qtyStr) return;
      
      const nextQty = parseInt(qtyStr);
      if (!Number.isFinite(nextQty)) return;
      
      // Verificar se pode abrir essa quantidade
      if (!canOpenQuantity(ownedPasses, nextQty)) {
        const requiredPass = getRequiredPassForQuantity(nextQty);
        if (requiredPass) {
          showPassModal(requiredPass);
        }
        return;
      }

      selectedQuantity = nextQty;
      updateQuantityButtons();
      updateTotalCost();
      await generatePreview();
    });
    qtyContainer.dataset.bound = '1';
  }

  if (backToGallery && !backToGallery.dataset.bound) {
    backToGallery.addEventListener('click', () => {
      if (isOpening) return;
      if (openingScreen) openingScreen.classList.remove('active');
      if (galleryScreen) galleryScreen.classList.add('active');
      playSound('click', { volume: 0.4 });
    });
    backToGallery.dataset.bound = '1';
  }

  if (quickSpin && !quickSpin.dataset.bound) {
    quickSpin.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement | null;
      const wantsQuickSpin = !!target?.checked;
      playSound('switch', { volume: 0.35 });
      
      // Se não tem o pass, mostrar modal
      if (wantsQuickSpin && !ownedPasses.includes('quick_roll')) {
        if (target) target.checked = false;
        showPassModal('quick_roll');
        return;
      }
      
      isQuickSpin = wantsQuickSpin;
    });
    quickSpin.dataset.bound = '1';
  }

  if (openCaseBtn && !openCaseBtn.dataset.bound) {
    openCaseBtn.addEventListener('click', async () => {
      if (isOpening) return;
      playSound('buy', { volume: 0.6 });
      await openCase();
    });
    openCaseBtn.dataset.bound = '1';
  }

  if (resultContinueBtn && !resultContinueBtn.dataset.bound) {
    resultContinueBtn.addEventListener('click', () => {
      if (resultModal) resultModal.classList.remove('active');
      generatePreview();
      playSound('click', { volume: 0.35 });
    });
    resultContinueBtn.dataset.bound = '1';
  }

  if (priceFilter && !priceFilter.dataset.bound) {
    priceFilter.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement | null;
      if (target?.value) filterCases(target.value);
    });
    priceFilter.dataset.bound = '1';
  }

  // Quick Spin Cost Click (comprar quick roll)
  const quickSpinCost = document.getElementById('quick-spin-cost');
  if (quickSpinCost && !quickSpinCost.dataset.bound) {
    quickSpinCost.addEventListener('click', () => {
      if (!ownedPasses.includes('quick_roll')) {
        showPassModal('quick_roll');
        playSound('click', { volume: 0.4 });
      }
    });
    quickSpinCost.dataset.bound = '1';
  }
  
  // Pass Modal - Confirm
  const passModalConfirm = document.getElementById('pass-modal-confirm');
  if (passModalConfirm && !passModalConfirm.dataset.bound) {
    passModalConfirm.addEventListener('click', async () => {
      const { passModal } = getCaseOpeningEls();
      const passId = passModal?.dataset.passId;
      if (passId) {
        await purchasePass(passId);
      }
    });
    passModalConfirm.dataset.bound = '1';
  }
  
  // Pass Modal - Cancel
  const passModalCancel = document.getElementById('pass-modal-cancel');
  if (passModalCancel && !passModalCancel.dataset.bound) {
    passModalCancel.addEventListener('click', () => {
      hidePassModal();
    });
    passModalCancel.dataset.bound = '1';
  }
  
  // Pass Modal - Click fora para fechar
  const passModal = document.getElementById('pass-modal');
  if (passModal && !passModal.dataset.bound) {
    passModal.addEventListener('click', (e) => {
      if (e.target === passModal) {
        hidePassModal();
      }
    });
    passModal.dataset.bound = '1';
  }

  const upgradeDiscountBtn = document.getElementById('upgrade-discount-btn');
  if (upgradeDiscountBtn && !upgradeDiscountBtn.dataset.bound) {
    upgradeDiscountBtn.addEventListener('click', upgradeCaseDiscount);
    upgradeDiscountBtn.dataset.bound = '1';
  }

  caseOpeningUIBound = true;
}

// ============================================================
// CASE OPENING (API CALL)
// ============================================================

async function openCase(): Promise<void> {
  if (isOpening) return;
  
  const caseData = getCaseById(currentCaseId || undefined);
  if (!caseData) return;
  
  const { discountedTotal } = computeCaseCost(caseData, selectedQuantity);
  const currentMoney = getCurrentMoney();
  if (discountedTotal > currentMoney) {
    showAlert('error', 'Insufficient Balance! 💸', `You need ${formatCurrency(discountedTotal - currentMoney)} more to open this case.`);
    return;
  }
  
  isOpening = true;
  const { openCaseBtn } = getCaseOpeningEls();
  if (openCaseBtn) (openCaseBtn as HTMLButtonElement).disabled = true;
  updateDiscountUI();
  playSound('open_case', { volume: 0.55 });
  
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !currentUser?.id) throw new Error('Not authenticated');
    
    const response = await fetch('/api/_caseopening', {
      method: 'POST',
      headers: addCsrfHeader({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        action: 'openCases',
        userId: currentUser.id,
        authToken: session.access_token,
        caseId: currentCaseId,
        quantity: selectedQuantity
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      // 🔥 VERIFICAR TIPO DE ERRO
    if (result.error === 'INVENTORY_FULL') {
        const { current, max, available } = result;
        
        // 🔥 Alert for full inventory
        showAlert(
          'warning', 
          'Inventory Full! 📦', 
          available > 0 
            ? `Available space: ${available}/${max}. Open ${available} or fewer cases, or sell some items.`
            : `You have ${current}/${max} items. Sell some items to free up space!`
        );
      } else {
        // Other errors
        showAlert('error', 'Opening Failed', result.error || 'An unknown error occurred. Please try again.');
      }
      
      isOpening = false;
      if (openCaseBtn) (openCaseBtn as HTMLButtonElement).disabled = false;
      return;
    }
    
    // Update balance
    playerMoney = result.newBalance;
    if (window.playerMoney) {
      window.playerMoney.value = result.newBalance;
    }
    updateDiscountUI();
    updateTotalCost();

    // Inventário mudou (itens adicionados): invalidar cache se disponível
    if (typeof window.invalidateInventoryCaches === 'function') {
      window.invalidateInventoryCaches();
    }
    
    // 🔥 Success toast
    showToast('success', 'Case Opened! 🎁', `Successfully opened ${selectedQuantity} case(s)!`);
    
    // Start animation + looped spin audio
    reelLoopHandle = startLoop('reel_spin', { volume: 0.25 });
    await animateReels(result.slots);
    if (reelLoopHandle) {
      reelLoopHandle.stop();
      reelLoopHandle = null;
    }
    
    // Show result modal
    showResultModal(result.winners, result.totalValue);
    
    } catch (error) {
    console.error('💥 Error opening case:', error);
    showAlert('error', 'Connection Error! 🌐', 'Unable to connect to server. Please check your internet connection.');
  } finally {
    isOpening = false;
    if (openCaseBtn) (openCaseBtn as HTMLButtonElement).disabled = false;
    if (reelLoopHandle) {
      reelLoopHandle.stop();
      reelLoopHandle = null;
    }
    updateDiscountUI();
    if (currentCaseId) {
      updateTotalCost();
    }
  }
}

// ============================================================
// REEL ANIMATION (ATUALIZADO)
// ============================================================

async function animateReels(slots: SlotData[]): Promise<void> {
  const animationTime = isQuickSpin ? 5000 : 15000;
  
  if (selectedQuantity === 1) {
    await animateHorizontalReel(0, slots[0], animationTime);
  } else {
    const promises = [];
    for (let i = 0; i < selectedQuantity; i++) {
      promises.push(animateVerticalReel(i, slots[i], animationTime));
    }
    await Promise.all(promises);
  }
}

// ============================================================
// HORIZONTAL REEL ANIMATION (ATUALIZADO)
// ============================================================

async function animateHorizontalReel(slotIndex: number, slotData: SlotData, duration: number): Promise<void> {
  return new Promise((resolve) => {
    const track = document.getElementById(`reel-track-${slotIndex}`);
    
    if (!track) {
      console.error('❌ Track not found:', slotIndex);
      resolve();
      return;
    }
    
    const { items, winnerIndex, winner } = slotData;
    
    // 🔥 RENDERIZAR OS 96 ITENS DO BACKEND
    track.innerHTML = items.map((item, idx) => `
      <div class="reel-item reel-item-horizontal" 
           data-index="${idx}"
           style="border-color: ${item.color}; background: ${item.color}20;">
        <div class="reel-item-icon">${item.icon}</div>
        <div class="reel-item-name">${item.name}</div>
        <div class="reel-item-value">$${item.value}</div>
      </div>
    `).join('');
    
    // 🔥 CALCULAR DISTÂNCIA PARA CENTRALIZAR O VENCEDOR
    const ITEM_WIDTH = 116; // 110px + 6px margin
    if (!track.parentElement) return;
    const CONTAINER_CENTER = track.parentElement.offsetWidth / 2;
    
    const itemPosition = winnerIndex * ITEM_WIDTH;
    const itemCenter = itemPosition + (ITEM_WIDTH / 2);
    const distance = itemCenter - CONTAINER_CENTER;
    
    // Reset position
    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
    void track.offsetHeight;
    
    // Animate
    setTimeout(() => {
      track.style.transition = `transform ${duration}ms cubic-bezier(0.15, 0.8, 0.2, 1)`;
      track.style.transform = `translateX(-${distance}px)`;
      
      setTimeout(() => {
        showWinner(slotIndex, winner, true);
        resolve();
      }, duration + 100);
    }, 50);
  });
}

// ============================================================
// VERTICAL REEL ANIMATION (ATUALIZADO)
// ============================================================

async function animateVerticalReel(slotIndex: number, slotData: SlotData, duration: number): Promise<void> {
  return new Promise((resolve) => {
    const track = document.getElementById(`reel-track-${slotIndex}`);
    
    if (!track) {
      console.error('❌ Track not found:', slotIndex);
      resolve();
      return;
    }
    
    const { items, winnerIndex, winner } = slotData;
    
    // 🔥 RENDERIZAR OS 96 ITENS DO BACKEND
    track.innerHTML = items.map((item, idx) => `
      <div class="reel-item reel-item-vertical" 
           data-index="${idx}"
           style="border-color: ${item.color}; background: ${item.color}20;">
        <div class="reel-item-icon">${item.icon}</div>
        <div class="reel-item-name">${item.name}</div>
        <div class="reel-item-value">$${item.value}</div>
      </div>
    `).join('');
    
    // 🔥 CALCULAR DISTÂNCIA PARA CENTRALIZAR O VENCEDOR
    const ITEM_HEIGHT = 96; // 90px + 6px margin
    if (!track.parentElement) return;
    const CONTAINER_CENTER = track.parentElement.offsetHeight / 2;
    
    const itemPosition = winnerIndex * ITEM_HEIGHT;
    const itemCenter = itemPosition + (ITEM_HEIGHT / 2);
    const distance = itemCenter - CONTAINER_CENTER;
    
    // Reset position
    track.style.transition = 'none';
    track.style.transform = 'translateY(0)';
    void track.offsetHeight;
    
    // Animate
    setTimeout(() => {
      track.style.transition = `transform ${duration}ms cubic-bezier(0.15, 0.8, 0.2, 1)`;
      track.style.transform = `translateY(-${distance}px)`;
      
      setTimeout(() => {
        showWinner(slotIndex, winner, false);
        resolve();
      }, duration + 100);
    }, 50);
  });
}

// ============================================================
// SHOW WINNER (ATUALIZADO)
// ============================================================

function showWinner(slotIndex: number, item: PreviewItem, isHorizontal: boolean): void {
  const container = document.getElementById(`reel-container-${slotIndex}`);
  
  if (!container) {
    console.error('❌ Container not found:', slotIndex);
    return;
  }
  
  container.innerHTML = `
    <div class="winner-display" style="border-color: ${item.color}; box-shadow: 0 0 40px ${item.color};">
      <div class="winner-icon">${item.icon}</div>
      <div class="winner-name">${item.name}</div>
      <div class="winner-value">$${item.value}</div>
      <div class="winner-rarity" style="border-color: ${item.color}; color: ${item.color}; background: ${item.color}20;">
        ${item.rarityIcon} ${item.rarity}
      </div>
    </div>
  `;

  playSound('win', { volume: 0.55 });
}

// ============================================================
// RESULT MODAL
// ============================================================

function showResultModal(items: PreviewItem[], totalValue: number): void {
  const grid = document.getElementById('result-items-grid');
  if (!grid) return;
  
  grid.innerHTML = items.map((item, i) => `
    <div class="result-item" style="border-color: ${item.color}; animation-delay: ${i * 0.1}s;">
      <div class="result-item-icon">${item.icon}</div>
      <div class="result-item-name">${item.name}</div>
      <div class="result-item-value">$${item.value}</div>
    </div>
  `).join('');
  
  const resultTotalEl = document.getElementById('result-total-value');
  const resultModalEl = document.getElementById('result-modal');
  if (resultTotalEl) resultTotalEl.textContent = `$${totalValue.toFixed(2)}`;
  if (resultModalEl) resultModalEl.classList.add('active');
  
  // 🔥 Alert with final result (delay to avoid overlap with toast)
  setTimeout(() => {
    const bestItem = items.reduce((best, current) => 
      current.value > best.value ? current : best
    );
    
    showAlert(
      'success', 
      'Congratulations! 🎉', 
      `Best item: ${bestItem.name} ($${bestItem.value}) • Total: $${totalValue.toFixed(2)}`
    );
  }, 1000);
}

// ============================================================
// FILTER
// ============================================================

function filterCases(priceRange: string): void {
  const cards = document.querySelectorAll('.case-card');
  
  cards.forEach(card => {
    const caseId = card.getAttribute('data-case-id');
    if (!caseId) return;
    const caseData = getCaseById(caseId);
    
    if (!caseData) return;
    
    let show = true;
    
    if (priceRange !== 'all') {
      // index.html usa: 0-10, 10-50, 50-250, 250+
      if (priceRange === '0-10' || priceRange === '0-5') {
        const max = priceRange === '0-10' ? 10 : 5;
        show = caseData.price <= max;
      } else if (priceRange === '10-50' || priceRange === '5-20') {
        const min = priceRange === '10-50' ? 10 : 5;
        const max = priceRange === '10-50' ? 50 : 20;
        show = caseData.price > min && caseData.price <= max;
      } else if (priceRange === '50-250' || priceRange === '20-50') {
        const min = priceRange === '50-250' ? 50 : 20;
        const max = priceRange === '50-250' ? 250 : 50;
        show = caseData.price > min && caseData.price <= max;
      } else if (priceRange === '250+' || priceRange === '50+') {
        const min = priceRange === '250+' ? 250 : 50;
        show = caseData.price > min;
      }
    }
    
    (card as HTMLElement).style.display = show ? 'block' : 'none';
  });
}

// ============================================================
// EXPORT
// ============================================================

window.initCaseOpening = initCaseOpening;
