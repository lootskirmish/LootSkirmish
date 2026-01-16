// ============================================================
// INVENTORY.JS - Sistema de Inventário (FRONTEND SEGURO)
// ============================================================

import { supabase } from './auth';
import { addCsrfHeader } from '../core/session';
import { 
  createSellParticles, 
  showSellConfirmation,
  showMoneyPopup,
  showToast,
  showAlert
} from '../shared/effects';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

interface InventoryItem {
  id: string;
  user_id: string;
  item_name: string;
  value: number;
  icon: string;
  color: string;
  rarity: string;
  created_at: string;
}

interface GridMode {
  id: string;
  label: string;
  cols: number;
  rows?: number;
  perPage: number;
}

interface Filters {
  rarity: string;
  value: string;
  date: string;
}

interface UpgradeOffer {
  maxed?: boolean;
  current?: string;
  next?: string;
  nextMax: number;
  cost: number;
  newSlots: number;
  canAfford: boolean;
  discountApplied?: boolean;
  upgradesDone?: number;
}

interface PlayerStats {
  max_inventory?: number;
  diamonds?: number;
}

declare global {
  interface Window {
    playerDiamonds?: { value: number };
    renderInventory: typeof renderInventory;
    setCurrentUserId: typeof setCurrentUserId;
    toggleItemSelection: typeof toggleItemSelection;
    sellSingleItem: typeof sellSingleItem;
    sellSelected: typeof sellSelected;
    openFilterModal: typeof openFilterModal;
    closeFilterModal: typeof closeFilterModal;
    resetFilters: typeof resetFilters;
    applyFilters: typeof applyFilters;
    openSellAllModal: typeof openSellAllModal;
    closeSellAllModal: typeof closeSellAllModal;
    updateSellAllSummary: typeof updateSellAllSummary;
    confirmSellAll: typeof confirmSellAll;
    goToPage: typeof goToPage;
    invalidateInventoryCaches: typeof invalidateInventoryCaches;
    openInventoryUpgradeModal: typeof openInventoryUpgradeModal;
    closeInventoryUpgradeModal: typeof closeInventoryUpgradeModal;
    purchaseInventoryUpgrade: typeof purchaseInventoryUpgrade;
    cycleGridMode: typeof cycleGridMode;
  }
}

// ============================================================

// Capacidade agora vem do Supabase (player_stats.max_inventory)
const INVENTORY_BASE_CAPACITY: number = 15;
const INVENTORY_MAX_CAPACITY: number = 50;
const UPGRADE_STEP: number = 5;
const UPGRADE_COSTS: number[] = [50, 75, 100, 150, 250];

// Layout modes for inventory grid
const GRID_MODES: GridMode[] = [
  { id: '3x3', label: '3x3', cols: 3, perPage: 9 },
  { id: '5x5', label: '5x5', cols: 5, perPage: 25 },
  { id: '7x7', label: '7x7', cols: 7, perPage: 49 }
];

// Layout modes específicos para mobile
const MOBILE_GRID_MODES: GridMode[] = [
  { id: '2x2', label: '2x2', cols: 2, rows: 2, perPage: 4 },
  { id: '4x4', label: '4x4', cols: 4, rows: 4, perPage: 16 },
  { id: '2x6', label: '2x6', cols: 2, rows: 6, perPage: 12 }
];

// Detectar se é mobile
function isMobileDevice(): boolean {
  return window.innerWidth <= 768;
}

// Obter modos corretos baseado no dispositivo
function getGridModes(): GridMode[] {
  return isMobileDevice() ? MOBILE_GRID_MODES : GRID_MODES;
}

// ============================================================
// STATE MANAGEMENT
// ============================================================

let currentFilters: Filters = {
  rarity: 'all',
  value: 'none',
  date: 'newest'
};

let selectedItems: Set<string> = new Set();
let isSelling: boolean = false;
let currentUserId: string | null = null;
let currentGridModeIndex: number = 0;
let lastGridToggleAt: number = 0;

async function syncPlayerStats(userId: string): Promise<PlayerStats | null> {
  try {
    const { data, error } = await supabase
      .from('player_stats')
      .select('max_inventory, diamonds')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.warn('⚠️ Failed to fetch player_stats for inventory:', error.message);
      return null;
    }

    if (data) {
      setMaxCapacityFromBackend(data.max_inventory);
      if (window.playerDiamonds && data.diamonds !== undefined) {
        window.playerDiamonds.value = data.diamonds;
      }
    }

    return data;
  } catch (err) {
    console.warn('⚠️ Unexpected error syncing player_stats:', ((err as any)?.message || err));
    return null;
  }
}

// Cache para evitar re-fetch em paginação
let lastInventoryCacheKey: string | null = null;
let lastInventoryItems: InventoryItem[] | null = null;

// Contador total (sem filtro)
let lastInventoryTotalCount: number | null = null;
let lastInventoryCountUserId: string | null = null;

// Capacidade dinâmica (sincronizada com Supabase)
let currentMaxCapacity: number = INVENTORY_BASE_CAPACITY;

// Cache para Sell All (evita fetch por checkbox change)
let sellAllInventoryCache: InventoryItem[] | null = null;
let sellAllInventoryCacheUserId: string | null = null;

function invalidateInventoryCaches(): void {
  lastInventoryCacheKey = null;
  lastInventoryItems = null;
  lastInventoryTotalCount = null;
  lastInventoryCountUserId = null;
  sellAllInventoryCache = null;
  sellAllInventoryCacheUserId = null;
}

function getCurrentGridMode(): GridMode {
  const modes = getGridModes();
  // Resetar índice se mudou de desktop para mobile ou vice-versa
  if (currentGridModeIndex >= modes.length) {
    currentGridModeIndex = 0;
  }
  return modes[currentGridModeIndex] || modes[0];
}

function getItemsPerPage(): number {
  return getCurrentGridMode().perPage;
}

function applyGridModeToGrid(): void {
  const grid = document.getElementById('inv-grid');
  if (!grid) return;
  
  // Remover todas as classes de grid
  const allModes = [...GRID_MODES, ...MOBILE_GRID_MODES];
  allModes.forEach(mode => {
    grid.classList.remove(`grid-mode-${mode.id}`);
  });
  
  // Adicionar classe do modo atual
  const currentMode = getCurrentGridMode();
  grid.classList.add(`grid-mode-${currentMode.id}`);
}

function updateGridModeButtonUI(): void {
  const btn = document.getElementById('grid-mode-btn');
  if (!btn) return;
  const mode = getCurrentGridMode();
  const prefix = isMobileDevice() ? '📱 ' : '';
  btn.textContent = `${prefix}Layout ${mode.label}`;
}

function cycleGridMode(): void {
  const now = Date.now();
  if (now - lastGridToggleAt < 400) return; // simple debounce
  lastGridToggleAt = now;

  const modes = getGridModes();
  currentGridModeIndex = (currentGridModeIndex + 1) % modes.length;
  currentPage = 1;
  updateGridModeButtonUI();
  applyGridModeToGrid();
  if (currentUserId) {
    renderInventory(currentUserId);
  }
}

// Paginação
let currentPage = 1;
const ITEMS_PER_PAGE = 5; // legacy (not used)

// ============================================================
// USER ID MANAGEMENT
// ============================================================

export function setCurrentUserId(userId: string): void {
  currentUserId = userId;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

// ============================================================
// INVENTORY RENDERING COM PAGINAÇÃO
// ============================================================

export async function renderInventory(userId: string): Promise<void> {
  
  if (!userId && !currentUserId) {
    console.error('❌ No userId available!');
    const grid = document.getElementById('inv-grid');
    if (grid) {
      grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 20px;">Error: User not authenticated</p>';
    }
    return;
  }
  
  const targetUserId = userId || currentUserId;
  
  if (!currentUserId) {
    currentUserId = targetUserId;
  }
  
  try {
    await syncPlayerStats(targetUserId || '');

    const grid = document.getElementById('inv-grid');
    const empty = document.getElementById('inv-empty');
  applyGridModeToGrid();
  updateGridModeButtonUI();
    if (!grid) return;
    
    const filtersKey = JSON.stringify(currentFilters);
    const cacheKey = `${targetUserId}:${filtersKey}`;

    // Buscar itens só quando usuário/filtros mudarem
    if (cacheKey !== lastInventoryCacheKey || !Array.isArray(lastInventoryItems)) {
      // Buscar TODOS os itens
      let query = supabase
        .from('inventory')
        .select('*')
        .eq('user_id', targetUserId);
    
    // Aplicar filtros
    if (currentFilters.rarity !== 'all') {
      query = query.eq('rarity', currentFilters.rarity);
    }
    
      // Ordenação (preferir ordenar no banco quando possível)
      if (currentFilters.value !== 'none') {
        query = query.order('value', { ascending: currentFilters.value !== 'high' });
      } else {
        query = query.order('obtained_at', { ascending: currentFilters.date !== 'newest' });
      }

      const { data, error } = await query;
    
      if (error) {
        console.error('Error loading inventory:', error);
        grid.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 20px;">Error: ${error.message}</p>`;
        showAlert('error', 'Loading Failed! 📦', 'Unable to load inventory. Please refresh the page.');
        return;
      }

      lastInventoryCacheKey = cacheKey;
      lastInventoryItems = Array.isArray(data) ? data : [];
    }

    // Sempre que usuário mudar ou cache invalidar, buscar contagem total (sem filtros)
    let totalCount = lastInventoryTotalCount;
    if (lastInventoryCountUserId !== targetUserId || totalCount === null || totalCount === undefined) {
      const { count, error: countError } = await supabase
        .from('inventory')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', targetUserId);

      if (countError) {
        console.error('Error counting inventory:', countError);
        totalCount = Array.isArray(lastInventoryItems) ? lastInventoryItems.length : 0;
      } else {
        totalCount = count || 0;
        lastInventoryTotalCount = totalCount;
        lastInventoryCountUserId = targetUserId;
      }
    }

    const data = lastInventoryItems;
    const itemCountFiltered = data ? data.length : 0;

    // Atualizar contador TOTAL (sem filtro)
    const countElement = document.getElementById('inv-count');
    if (countElement) countElement.textContent = String(totalCount ?? itemCountFiltered);
    
    // Atualizar barra de capacidade com total ocupado
    updateCapacityBar(totalCount ?? itemCountFiltered);
    
    // Se vazio
    if (!data || data.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'block';
      removePagination();
      return;
    }
    
    if (empty) empty.style.display = 'none';
    
    // PAGINAÇÃO: Pegar apenas os itens da página atual
    const perPage = getItemsPerPage();
    const totalPages = Math.max(1, Math.ceil(itemCountFiltered / perPage));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const startIndex = (currentPage - 1) * perPage;
    const endIndex = startIndex + perPage;
    const paginatedData = data.slice(startIndex, endIndex);
    
    // Renderizar apenas os itens da página
    grid.innerHTML = paginatedData.map(item => {
      const itemId = String(item.id);
      const isSelected = selectedItems.has(itemId);
      
      return `
        <div class="inv-item ${isSelected ? 'selected' : ''}" 
             style="border-color: ${item.color}"
             data-item-id="${itemId}">
          <input type="checkbox" 
                 class="inv-item-checkbox" 
                 ${isSelected ? 'checked' : ''}
                 onchange="window.toggleItemSelection('${itemId}')">
          <div class="inv-item-icon">🎁</div>
          <div class="name">${item.item_name}</div>
          <div class="rarity" style="color:${item.color}">${item.rarity}</div>
          <div class="value">
            ${item.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 💰
          </div>
          <button onclick="window.sellSingleItem('${itemId}')">Sell</button>
        </div>
      `;
    }).join('');
    
    // Renderizar paginação
    renderPagination(itemCountFiltered);
    
  } catch (err) {
    console.error('Inventory error:', err);
    alert('❌ Error loading inventory');
  }
}

/**
 * Renderiza a paginação
 */
function renderPagination(totalItems: number): void {
  const totalPages = Math.ceil(totalItems / getItemsPerPage());
  
  let paginationDiv = document.getElementById('inv-pagination');
  
  // Criar div se não existir
  if (!paginationDiv) {
    paginationDiv = document.createElement('div');
    paginationDiv.id = 'inv-pagination';
    paginationDiv.className = 'inv-pagination';
    
    const invSection = document.getElementById('inventory');
    const invGrid = document.getElementById('inv-grid');
    if (invSection && invGrid) {
      invSection.insertBefore(paginationDiv, invGrid.nextSibling);
    }
  }
  
  // Se só tem 1 página, esconder
  if (totalPages <= 1) {
    paginationDiv.style.display = 'none';
    return;
  }
  
  paginationDiv.style.display = 'flex';
  
  paginationDiv.innerHTML = `
    <button ${currentPage === 1 ? 'disabled' : ''} onclick="window.goToPage(${currentPage - 1})">
      ‹ Previous
    </button>
    <span>Page ${currentPage} of ${totalPages}</span>
    <button ${currentPage === totalPages ? 'disabled' : ''} onclick="window.goToPage(${currentPage + 1})">
      Next ›
    </button>
  `;
}

/**
 * Remove paginação
 */
function removePagination(): void {
  const paginationDiv = document.getElementById('inv-pagination');
  if (paginationDiv) {
    paginationDiv.remove();
  }
}

/**
 * Vai para página específica
 */
export function goToPage(page: number): void {
  const perPage = getItemsPerPage();
  const totalItems = Array.isArray(lastInventoryItems) ? lastInventoryItems.length : 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  currentPage = Math.min(Math.max(1, page), totalPages);
  if (currentUserId && lastInventoryCacheKey && Array.isArray(lastInventoryItems)) {
    // Só re-renderizar com cache (sem refetch)
    renderInventory(currentUserId);
  } else if (currentUserId) {
    renderInventory(currentUserId);
  }
  
  // Scroll para o topo
  const inventoryEl = document.getElementById('inventory');
  if (inventoryEl) {
    inventoryEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/**
 * Atualiza a barra de capacidade do inventário
 */
export function updateCapacityBar(current: number): void {
  lastInventoryTotalCount = current;
  const safeMax = currentMaxCapacity || INVENTORY_BASE_CAPACITY;
  const percentage = safeMax > 0 ? (current / safeMax) * 100 : 0;
  const fill = document.getElementById('inv-capacity-fill');
  const text = document.getElementById('inv-capacity-text');
  
  if (!fill || !text) return;
  
  fill.style.width = percentage + '%';
  text.textContent = `${current}/${safeMax}`;
  
  fill.classList.remove('warning', 'danger');
  
  if (percentage >= 90) {
    fill.classList.add('danger');
  } else if (percentage >= 70) {
    fill.classList.add('warning');
  }
}

function setMaxCapacityFromBackend(value: number): void {
  const parsed = Number(value);
  const clamped = Math.min(INVENTORY_MAX_CAPACITY, Math.max(INVENTORY_BASE_CAPACITY, Number.isFinite(parsed) ? parsed : INVENTORY_BASE_CAPACITY));
  currentMaxCapacity = clamped;
  const currentCount = lastInventoryTotalCount ?? 0;
  updateCapacityBar(currentCount);
  updateUpgradeButtonUI();
}

function computeUpgradeOffer(): UpgradeOffer | null {
  const current = currentMaxCapacity || INVENTORY_BASE_CAPACITY;
  if (current >= INVENTORY_MAX_CAPACITY) {
    return { maxed: true, current: String(current), next: String(current), cost: 0, discountApplied: false, upgradesDone: 0, nextMax: current, newSlots: 0, canAfford: false } as UpgradeOffer;
  }

  const upgradesDone = Math.max(0, Math.floor((current - INVENTORY_BASE_CAPACITY) / UPGRADE_STEP));
  const tierIndex = Math.min(UPGRADE_COSTS.length - 1, upgradesDone);
  const baseCost = UPGRADE_COSTS[tierIndex];
  const discountApplied = current >= 46;
  const cost = discountApplied ? Math.ceil(baseCost * 0.7) : baseCost;
  const next = Math.min(current + UPGRADE_STEP, INVENTORY_MAX_CAPACITY);

  return { maxed: false, current: String(current), next: String(next), cost, discountApplied, upgradesDone, nextMax: next, newSlots: UPGRADE_STEP, canAfford: true } as UpgradeOffer;
}

function updateUpgradeButtonUI(): void {
  const btn = document.getElementById('inv-upgrade-btn') as HTMLButtonElement | null;
  if (!btn) return;

  const offer = computeUpgradeOffer();
  if (offer?.maxed) {
    btn.textContent = 'Max Capacity';
    btn.disabled = true;
    btn.classList.add('disabled');
    return;
  }

  btn.textContent = `Upgrade +${UPGRADE_STEP}`;
  btn.disabled = false;
  btn.classList.remove('disabled');
}

function renderUpgradeModalContent(): UpgradeOffer | null {
  const offer = computeUpgradeOffer();
  const currentEl = document.getElementById('upgrade-current-cap');
  const nextEl = document.getElementById('upgrade-next-cap');
  const costEl = document.getElementById('upgrade-cost');
  const badgeEl = document.getElementById('upgrade-discount');
  const ctaEl = document.getElementById('upgrade-confirm-btn');
  const noteEl = document.getElementById('upgrade-note');

  if (currentEl) currentEl.textContent = offer?.current || '';
  if (nextEl) nextEl.textContent = offer?.next || '';
  if (costEl) costEl.textContent = String(offer?.cost || 0);

  if (badgeEl) {
    badgeEl.style.display = offer?.discountApplied ? 'inline-flex' : 'none';
  }

  if (ctaEl) {
    const ctaButton = ctaEl as HTMLButtonElement;
    if (offer?.maxed) {
      ctaButton.disabled = true;
      ctaEl.textContent = 'Maxed Out';
    } else {
      ctaButton.disabled = false;
      ctaEl.textContent = `Buy for ${offer?.cost || 0} 💎`;
    }
  }

  if (noteEl) {
    if (offer?.maxed) {
      noteEl.textContent = 'You already reached the maximum capacity (50).';
    } else {
      noteEl.textContent = 'Each upgrade adds 5 slots. Maximum capacity is 50.';
    }
  }

  return offer;
}

export function openInventoryUpgradeModal(): void {
  const modal = document.getElementById('inventory-upgrade-modal');
  if (!modal) return;
  renderUpgradeModalContent();
  modal.classList.remove('hidden');
}

export function closeInventoryUpgradeModal(): void {
  const modal = document.getElementById('inventory-upgrade-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  const ctaEl = document.getElementById('upgrade-confirm-btn') as HTMLButtonElement | null;
  if (ctaEl) ctaEl.disabled = false;
}

export async function purchaseInventoryUpgrade(): Promise<void> {
  if (isSelling) return; // reuse guard
  if (!currentUserId) {
    alert('❌ Authentication error. Please refresh the page.');
    return;
  }

  const modal = document.getElementById('inventory-upgrade-modal');
  const ctaEl = document.getElementById('upgrade-confirm-btn') as HTMLButtonElement | null;
  const offer = computeUpgradeOffer();

  if (offer?.maxed) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      alert('❌ Not authenticated!');
      return;
    }

    if (ctaEl) {
      ctaEl.disabled = true;
      ctaEl.textContent = 'Processing...';
    }

    const response = await fetch('/api/inventory', {
      method: 'POST',
      headers: await addCsrfHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        action: 'upgradeInventory',
        userId: currentUserId,
        authToken: session.access_token
      })
    });

    const result = await response.json();

    if (!response.ok || !result?.success) {
      const errorCode = result?.error;
      if (errorCode === 'INSUFFICIENT_DIAMONDS') {
        showAlert('error', 'Insufficient Diamonds 💎', `You need ${result.needed || ''} more diamonds.`);
      } else if (errorCode === 'MAX_CAPACITY_REACHED') {
        showAlert('info', 'Max Capacity', 'You already reached the maximum inventory capacity.');
      } else {
        showAlert('error', 'Upgrade Failed', result?.error || 'Could not upgrade inventory.');
      }
      return;
    }

    const newMax = result.newMax || result.newmax;
    const newDiamonds = result.newDiamonds ?? result.newdiamonds;

    if (newMax) setMaxCapacityFromBackend(newMax);
    if (window.playerDiamonds && newDiamonds !== undefined) {
      window.playerDiamonds.value = newDiamonds;
    }

    showToast('success', 'Inventory Upgraded! 📦', `Capacity increased to ${newMax}.`);
    if (modal) modal.classList.add('hidden');
    renderUpgradeModalContent();
  } catch (err) {
    console.error('Error upgrading inventory:', err);
    showAlert('error', 'Connection Error', 'Unable to upgrade inventory now.');
  } finally {
    if (ctaEl) {
      ctaEl.disabled = false;
      const offerCost = computeUpgradeOffer();
      ctaEl.textContent = `Buy for ${offerCost?.cost || 0} 💎`;
    }
  }
}

// ============================================================
// ITEM SELECTION
// ============================================================

/**
 * Alterna seleção de um item
 */
export function toggleItemSelection(itemId: string): void {
  itemId = String(itemId);
  if (selectedItems.has(itemId)) {
    selectedItems.delete(itemId);
  } else {
    selectedItems.add(itemId);
  }
  
  updateSelectedButton();
  
  const card = document.querySelector(`[data-item-id="${itemId}"]`);
  if (card) {
    card.classList.toggle('selected');
  }
}

/**
 * Atualiza o botão "Vender Selecionados"
 */
export function updateSelectedButton(): void {
  const btn = document.getElementById('sell-selected-btn') as HTMLButtonElement | null;
  if (!btn) return;
  
  const count = selectedItems.size;
  btn.disabled = count === 0;
  const textSpan = btn.querySelector('span:last-child');
  if (textSpan) {
    textSpan.textContent = `Sell Selected (${count})`;
  }
}

/**
 * Limpa a seleção de itens
 */
export function clearSelection(): void {
  selectedItems.clear();
  updateSelectedButton();
}

// ============================================================
// SELLING ITEMS (BACKEND-SECURED)
// ============================================================

/**
 * Wrapper para sellItem que pega userId automaticamente
 */
export async function sellSingleItem(itemId: string): Promise<void> {
  itemId = String(itemId);
  if (!currentUserId) {
    console.error('❌ No userId available for selling!');
    alert('❌ Authentication error. Please refresh the page.');
    return;
  }
  
  await sellItem(itemId, currentUserId || '', () => renderInventory(currentUserId || ''));
}

/**
 * Vende um item individual - VERSÃO SEGURA
 */
export async function sellItem(itemId: string, userId: string, renderCallback: () => Promise<void>): Promise<void> {
  itemId = String(itemId);
  if (isSelling) {
    return;
  }
  
  if (!userId) {
    console.error('❌ No userId provided to sellItem!');
    alert('❌ Authentication error. Please refresh the page.');
    return;
  }
  
  try {
    isSelling = true;
    
    const card = document.querySelector(`[data-item-id="${itemId}"]`);
    
    // 🔥 Criar partículas verdes
    if (card) {
      createSellParticles(card as HTMLElement);
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // 🔒 CHAMAR API BACKEND
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      alert('❌ Not authenticated!');
      isSelling = false;
      return;
    }
    
    const response = await fetch('/api/inventory', {
      method: 'POST',
      headers: await addCsrfHeader({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        action: 'sellItem',
        userId: userId,
        itemId: itemId,
        authToken: session.access_token
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      showAlert('error', 'Sale Failed! ❌', result.error || 'An error occurred. Please try again.');
      isSelling = false;
      return;
    }
    
    // ✅ BACKEND VALIDOU E PROCESSOU
    const { soldValue, newBalance, itemName } = result;
    
    // Atualizar dinheiro local
    if (window.playerMoney) {
      window.playerMoney.value = newBalance;
    }

    // 🔥 Toast de sucesso
    showToast('success', 'Item Sold! 💰', `You received $${soldValue.toFixed(2)}`);

    // Remover da seleção se estava selecionado
    selectedItems.delete(itemId);
    updateSelectedButton();

    // Inventário mudou: invalidar cache antes do re-render
    invalidateInventoryCaches();
    
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Re-renderizar inventário
    if (renderCallback && typeof renderCallback === 'function') {
      await renderCallback();
    }
    
    isSelling = false;
    
  } catch (err) {
    alert('❌ Error when selling: ' + ((err as any)?.message || String(err)));
    console.error('Error:', err);
    isSelling = false;
  }
}

/**
 * Vende itens selecionados - VERSÃO SEGURA
 */
export async function sellSelected(): Promise<void> {
  if (isSelling || selectedItems.size === 0) return;
  
  if (!currentUserId) {
    console.error('❌ No userId available for selling!');
    alert('❌ Authentication error. Please refresh the page.');
    return;
  }

  try {
    isSelling = true;
    
    // Criar partículas para cada item selecionado
    selectedItems.forEach(itemId => {
      const card = document.querySelector(`[data-item-id="${itemId}"]`);
      if (card) createSellParticles(card as HTMLElement);
    });
    
    await new Promise(resolve => setTimeout(resolve, 400));
    
    // 🔒 CHAMAR API BACKEND
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      alert('❌ Not authenticated!');
      isSelling = false;
      return;
    }
    
    const response = await fetch('/api/inventory', {
      method: 'POST',
      headers: await addCsrfHeader({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        action: 'sellSelected',
        userId: currentUserId,
        itemIds: Array.from(selectedItems),
        authToken: session.access_token
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      showAlert('error', 'Sale Failed! ❌', result.error || 'Unable to sell items. Please try again.');
      isSelling = false;
      return;
    }
    
    // ✅ BACKEND VALIDOU E PROCESSOU
    const { soldCount, totalValue, newBalance } = result;
    
    // Atualizar dinheiro local
    if (window.playerMoney) {
      window.playerMoney.value = newBalance;
    }
    
    // 🔥 Toast de sucesso
    showToast('success', 'Items Sold! 💰', `${soldCount} items sold for $${totalValue.toFixed(2)}`);
    
    // Mostrar confirmação
    showSellConfirmation(soldCount, totalValue);
    
    // Limpar seleção
    clearSelection();

    // Inventário mudou: invalidar cache antes do re-render
    invalidateInventoryCaches();
    
    // Re-renderizar
    await renderInventory(currentUserId);
    
    isSelling = false;
    
  } catch (err) {
    showAlert('error', 'Connection Error! 🌐', 'Unable to connect to server. Check your internet.');
    console.error('Error:', err);
    isSelling = false;
  }
}

/**
 * Confirma a venda de todos os itens das raridades selecionadas
 */
export async function confirmSellAll(): Promise<void> {
  if (isSelling) return;
  
  if (!currentUserId) {
    console.error('❌ No userId available for selling!');
    alert('❌ Authentication error. Please refresh the page.');
    return;
  }
  
  try {
    const checkboxes = document.querySelectorAll('.rarity-checkbox input:checked');
    const selectedRarities = Array.from(checkboxes).map(cb => (cb as HTMLInputElement).value);
    
    if (selectedRarities.length === 0) {
      showAlert('warning', 'No Selection! ⚠️', 'Please select at least one rarity to sell.');
      return;
    }
    
    isSelling = true;
    
    // 🔒 CHAMAR API BACKEND
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      alert('❌ Not authenticated!');
      isSelling = false;
      return;
    }
    
    const response = await fetch('/api/inventory', {
      method: 'POST',
      headers: await addCsrfHeader({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        action: 'sellAll',
        userId: currentUserId,
        rarities: selectedRarities,
        authToken: session.access_token
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      showAlert('error', 'Sale Failed! ❌', result.error || 'Unable to process mass sale.');
      isSelling = false;
      return;
    }
    
    // ✅ BACKEND VALIDOU E PROCESSOU
    const { soldCount, totalValue, newBalance } = result;
    
    // Atualizar dinheiro local
    if (window.playerMoney) {
      window.playerMoney.value = newBalance;
    }
    
    closeSellAllModal();

    // 🔥 Alert de sucesso com detalhes
    showAlert('success', 'Mass Sale Completed! 🎉', `${soldCount} items sold for $${totalValue.toFixed(2)}`);
    
    // Mostrar confirmação
    showSellConfirmation(soldCount, totalValue);

    // Inventário mudou: invalidar cache antes do re-render
    invalidateInventoryCaches();

    // Re-renderizar
    await renderInventory(currentUserId);
    
    isSelling = false;
    
  } catch (err) {
    showAlert('error', 'Connection Error! 🌐', 'Unable to process request. Check your connection.');
    console.error('Error:', err);
    isSelling = false;
  }
}

// ============================================================
// FILTERS
// ============================================================

export function openFilterModal(): void {
  const modal = document.getElementById('filter-modal');
  if (modal) modal.classList.add('active');
}

export function closeFilterModal(): void {
  const modal = document.getElementById('filter-modal');
  if (modal) modal.classList.remove('active');
}

export function resetFilters(): void {
  currentFilters = {
    rarity: 'all',
    value: 'none',
    date: 'newest'
  };
  
  const raritySelect = document.getElementById('filter-rarity') as HTMLSelectElement | null;
  const valueSelect = document.getElementById('filter-value') as HTMLSelectElement | null;
  const dateSelect = document.getElementById('filter-date') as HTMLSelectElement | null;
  
  if (raritySelect) raritySelect.value = 'all';
  if (valueSelect) valueSelect.value = 'none';
  if (dateSelect) dateSelect.value = 'newest';
  
  // Reset página para 1
  currentPage = 1;

  // 🔥 Toast informativo
  showToast('info', 'Filters Reset! 🔄', 'All filters have been cleared.');
  
  // Re-renderizar direto
  if (currentUserId) {
    lastInventoryCacheKey = null;
    lastInventoryItems = null;
    renderInventory(currentUserId);
  }
  
  closeFilterModal();
}

export function applyFilters(): void {
  const raritySelect = document.getElementById('filter-rarity') as HTMLSelectElement | null;
  const valueSelect = document.getElementById('filter-value') as HTMLSelectElement | null;
  const dateSelect = document.getElementById('filter-date') as HTMLSelectElement | null;
  
  currentFilters = {
    rarity: raritySelect?.value || 'all',
    value: valueSelect?.value || 'none',
    date: dateSelect?.value || 'newest'
  };
  
  // Reset página para 1
  currentPage = 1;

  // 🔥 Toast informativo
  showToast('info', 'Filters Applied! 🔽', 'Inventory updated with new filters.');
  
  // Re-renderizar direto
  if (currentUserId) {
    lastInventoryCacheKey = null;
    lastInventoryItems = null;
    renderInventory(currentUserId);
  }
  
  closeFilterModal();
}

export function getCurrentFilters(): Filters {
  return { ...currentFilters };
}

// ============================================================
// SELL ALL MODAL
// ============================================================

/**
 * Abre o modal "Sell All"
 */
export async function openSellAllModal(): Promise<void> {
  if (!currentUserId) {
    alert('❌ Authentication error. Please refresh the page.');
    return;
  }
  
  // Precarregar inventário para evitar fetch a cada change
  sellAllInventoryCache = null;
  sellAllInventoryCacheUserId = null;
  await updateSellAllSummary();
  
  const modal = document.getElementById('sell-all-modal');
  if (modal) modal.classList.remove('hidden');
  
  const modalRoot = document.getElementById('sell-all-modal');
  if (modalRoot && modalRoot.dataset.bound !== '1') {
    modalRoot.dataset.bound = '1';
    const checkboxes = document.querySelectorAll('.rarity-checkbox input');
    checkboxes.forEach(cb => {
      cb.addEventListener('change', () => updateSellAllSummary());
    });
  }
}

/**
 * Fecha o modal "Sell All"
 */
export function closeSellAllModal(): void {
  const modal = document.getElementById('sell-all-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Atualiza o resumo do "Sell All"
 */
export async function updateSellAllSummary(): Promise<void> {
  if (!currentUserId) return;
  
  try {
    if (!sellAllInventoryCache || sellAllInventoryCacheUserId !== currentUserId) {
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .eq('user_id', currentUserId);

      if (error) {
        console.error('Erro ao buscar inventário:', error);
        return;
      }

      sellAllInventoryCache = Array.isArray(data) ? data : [];
      sellAllInventoryCacheUserId = currentUserId;
    }
    
    const checkboxes = document.querySelectorAll('.rarity-checkbox input:checked');
    const selectedRarities = Array.from(checkboxes).map(cb => (cb as HTMLInputElement).value);
    
    const itemsToSell = sellAllInventoryCache.filter(item => selectedRarities.includes(item.rarity));
    const totalValue = itemsToSell.reduce((sum, item) => sum + item.value, 0);
    
    const countElement = document.getElementById('sell-count');
    const totalElement = document.getElementById('sell-total');
    
    if (countElement) countElement.textContent = String(itemsToSell.length);
    if (totalElement) {
      totalElement.textContent = 
        totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 💰';
    }
    
    const confirmBtn = document.querySelector('.sell-all-content .modal-create-btn') as HTMLButtonElement | null;
    if (confirmBtn) {
      if (itemsToSell.length === 0) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = '❌ No items selected';
      } else {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '✅ Confirm Sale';
      }
    }
    
  } catch (err) {
    console.error('Erro ao atualizar resumo:', err);
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

export function isCurrentlySelling(): boolean {
  return isSelling;
}

export function getSelectedCount(): number {
  return selectedItems.size;
}

export function getSelectedIds(): string[] {
  return Array.from(selectedItems);
}

// ============================================================
// EXPOR FUNÇÕES GLOBALMENTE
// ============================================================

window.renderInventory = renderInventory;
window.setCurrentUserId = setCurrentUserId;
window.toggleItemSelection = toggleItemSelection;
window.sellSingleItem = sellSingleItem;
window.sellSelected = sellSelected;
window.openFilterModal = openFilterModal;
window.closeFilterModal = closeFilterModal;
window.resetFilters = resetFilters;
window.applyFilters = applyFilters;
window.openSellAllModal = openSellAllModal;
window.closeSellAllModal = closeSellAllModal;
window.updateSellAllSummary = updateSellAllSummary;
window.confirmSellAll = confirmSellAll;
window.goToPage = goToPage;
window.invalidateInventoryCaches = invalidateInventoryCaches;
window.openInventoryUpgradeModal = openInventoryUpgradeModal;
window.closeInventoryUpgradeModal = closeInventoryUpgradeModal;
window.purchaseInventoryUpgrade = purchaseInventoryUpgrade;
window.cycleGridMode = cycleGridMode;

// Garantir estado inicial do botão de upgrade
updateUpgradeButtonUI();
updateGridModeButtonUI();
applyGridModeToGrid();

// Listener para atualizar grid quando redimensionar de desktop para mobile ou vice-versa
let wasMobile = isMobileDevice();
let resizeTimeout: NodeJS.Timeout | null = null;

window.addEventListener('resize', () => {
  if (resizeTimeout) clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const isNowMobile = isMobileDevice();
    
    // Se mudou de desktop->mobile ou mobile->desktop
    if (wasMobile !== isNowMobile) {
      wasMobile = isNowMobile;
      
      // Resetar para primeiro modo do novo conjunto
      currentGridModeIndex = 0;
      
      // Atualizar UI
      updateGridModeButtonUI();
      applyGridModeToGrid();
      
      // Re-renderizar se necessário
      if (currentUserId) {
        renderInventory(currentUserId);
      }
    }
  }, 300);
});
