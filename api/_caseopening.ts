// ============================================================
// API/CASEOPENING.TS - BACKEND (FIXED & COMPLETE)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { applyCors, createSecureLog, updatePlayerBalance, validateSessionAndFetchPlayerStats, ValidationSchemas, validateCsrfMiddleware } from './_utils.js';

import dotenv from 'dotenv';
dotenv.config();

interface PassConfig {
  enabled: boolean;
  cost?: number;
  name?: string;
  requires?: string | null;
}

interface OpenedItem {
  name: string;
  icon: string;
  value: number;
  rarity: string;
  rarityColor: string;
  rarityIcon: string;
  color?: string;
}

interface ApiRequest {
  method?: string;
  body?: {
    action?: string;
    userId?: string;
    authToken?: string;
    caseId?: string;
    quantity?: number;
    passTier?: string;
    passId?: string;
    cost?: number;
    requiredPass?: string | null;
    [key: string]: any;
  };
  headers?: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (body: any) => void;
  end: (body?: any) => void;
  setHeader: (name: string, value: string) => void;
}

interface Rarity {
  name: string;
  chance: number;
  color: string;
  icon: string;
}

interface CaseItem {
  name: string;
  icon: string;
  minValue: number;
  maxValue: number;
  rarityIndex: number;
}

interface CaseDefinition {
  id: string;
  name: string;
  icon: string;
  price: number;
  color: string;
  items: CaseItem[];
}

interface PassesConfigEntry {
  id: string;
  name: string;
  cost: number;
  requires: string | null;
}

type PassesConfig = Record<string, PassesConfigEntry>;

const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ============================================================
// CONSTANTS
// ============================================================

const RARITIES: Rarity[] = [
  { name: 'Common', chance: 55, color: '#9ca3af', icon: '⚪' },
  { name: 'Uncommon', chance: 25, color: '#22c55e', icon: '🟢' },
  { name: 'Rare', chance: 12, color: '#3b82f6', icon: '🔵' },
  { name: 'Epic', chance: 5, color: '#a855f7', icon: '🟣' },
  { name: 'Legendary', chance: 2.5, color: '#eab308', icon: '🟡' },
  { name: 'Mythic', chance: 0.5, color: '#ef4444', icon: '🔴' }
];

const OPENING_CASES: CaseDefinition[] = [
  // Cases organizadas por valor crescente - sincronizado com o frontend
  {
    id: 'starter_box',
    name: 'Starter Box',
    icon: '📦',
    price: 5.0,
    color: '#9ca3af',
    items: [
      { name: 'Basic Coin', icon: '🪙', minValue: 0.50, maxValue: 1.50, rarityIndex: 0 },
      { name: 'Snack Pack', icon: '🧃', minValue: 1.00, maxValue: 2.80, rarityIndex: 0 },
      { name: 'Mini Plush', icon: '🧸', minValue: 2.00, maxValue: 4.20, rarityIndex: 1 },
      { name: 'Old Manual', icon: '📄', minValue: 3.50, maxValue: 6.50, rarityIndex: 2 },
      { name: 'Collector Pin', icon: '📍', minValue: 6.00, maxValue: 11.00, rarityIndex: 3 },
      { name: 'Mythic Token', icon: '✨', minValue: 12.00, maxValue: 25.00, rarityIndex: 4 }
    ]
  },
  {
    id: 'utility_box',
    name: 'Utility Box',
    icon: '🧰',
    price: 9.0,
    color: '#065f46',
    items: [
      { name: 'Small Hammer', icon: '🔨', minValue: 1.50, maxValue: 4.00, rarityIndex: 0 },
      { name: 'Screwdriver', icon: '🪛', minValue: 2.50, maxValue: 5.50, rarityIndex: 0 },
      { name: 'Weak Flashlight', icon: '🔦', minValue: 4.00, maxValue: 8.00, rarityIndex: 1 },
      { name: 'Metal Screw', icon: '🔩', minValue: 7.00, maxValue: 13.00, rarityIndex: 2 },
      { name: 'Mini Canteen', icon: '🧃', minValue: 11.00, maxValue: 20.00, rarityIndex: 3 },
      { name: 'Compact Extinguisher', icon: '🧯', minValue: 18.00, maxValue: 35.00, rarityIndex: 4 },
      { name: 'Prototype Gadget', icon: '🛰️', minValue: 30.00, maxValue: 60.00, rarityIndex: 5 }
    ]
  },
  {
    id: 'green_box',
    name: 'Green Box',
    icon: '📦',
    price: 14.0,
    color: '#3b82f6',
    items: [
      { name: 'Cardboard Stash', icon: '📦', minValue: 2.00, maxValue: 6.00, rarityIndex: 0 },
      { name: 'Sealed Supply', icon: '📮', minValue: 5.00, maxValue: 11.00, rarityIndex: 1 },
      { name: 'Crate Cache', icon: '🧰', minValue: 9.00, maxValue: 17.00, rarityIndex: 2 },
      { name: 'Fortified Box', icon: '🪤', minValue: 15.00, maxValue: 28.00, rarityIndex: 3 },
      { name: 'Vaulted Shipment', icon: '💼', minValue: 25.00, maxValue: 48.00, rarityIndex: 4 },
      { name: 'Mythic Cargo', icon: '🎁', minValue: 50.00, maxValue: 95.00, rarityIndex: 5 }
    ]
  },
  {
    id: 'urban_box',
    name: 'Urban Box',
    icon: '🏙️',
    price: 22.0,
    color: '#6b7280',
    items: [
      { name: 'Street Headphones', icon: '🎧', minValue: 5.00, maxValue: 12.00, rarityIndex: 0 },
      { name: 'Graffiti Note', icon: '🗒️', minValue: 8.00, maxValue: 18.00, rarityIndex: 1 },
      { name: 'Keychain Key', icon: '🔑', minValue: 14.00, maxValue: 26.00, rarityIndex: 2 },
      { name: 'Crushed Can', icon: '🥫', minValue: 22.00, maxValue: 40.00, rarityIndex: 3 },
      { name: 'Neon Mask', icon: '🎭', minValue: 35.00, maxValue: 65.00, rarityIndex: 4 },
      { name: 'Underground Pass', icon: '🚇', minValue: 70.00, maxValue: 130.00, rarityIndex: 5 }
    ]
  },
  {
    id: 'old_stuff',
    name: 'Old Stuff Box',
    icon: '🏺',
    price: 35.0,
    color: '#a16207',
    items: [
      { name: 'Worn Coin', icon: '🪙', minValue: 8.00, maxValue: 18.00, rarityIndex: 0 },
      { name: 'Rusty Key', icon: '🗝️', minValue: 15.00, maxValue: 28.00, rarityIndex: 1 },
      { name: 'Old Scroll', icon: '📜', minValue: 24.00, maxValue: 45.00, rarityIndex: 2 },
      { name: 'Ancient Compass', icon: '🧭', minValue: 38.00, maxValue: 70.00, rarityIndex: 3 },
      { name: 'Broken Relic', icon: '🪨', minValue: 65.00, maxValue: 120.00, rarityIndex: 4 },
      { name: 'Forgotten Medallion', icon: '🏺', minValue: 130.00, maxValue: 250.00, rarityIndex: 5 }
    ]
  },
  {
    id: 'toy_box',
    name: 'Toy Box',
    icon: '🧸',
    price: 48.0,
    color: '#ec4899',
    items: [
      { name: 'Blue Bunny Plush', icon: '🐰', minValue: 12.00, maxValue: 25.00, rarityIndex: 0 },
      { name: 'Heart Emoji Ball', icon: '😍', minValue: 20.00, maxValue: 38.00, rarityIndex: 1 },
      { name: 'Toy Dolphin', icon: '🐬', minValue: 32.00, maxValue: 60.00, rarityIndex: 2 },
      { name: 'Holographic Stickers', icon: '✨', minValue: 50.00, maxValue: 95.00, rarityIndex: 3 },
      { name: 'Color Spring', icon: '🌀', minValue: 85.00, maxValue: 160.00, rarityIndex: 4 },
      { name: 'Limited Figure', icon: '🧩', minValue: 170.00, maxValue: 320.00, rarityIndex: 5 }
    ]
  },
  {
    id: 'scrap_box',
    name: 'Scrap Box',
    icon: '⚙️',
    price: 65.0,
    color: '#525252',
    items: [
      { name: 'Metal Gears', icon: '⚙️', minValue: 15.00, maxValue: 32.00, rarityIndex: 0 },
      { name: 'Old Circuit Board', icon: '🖥️', minValue: 28.00, maxValue: 52.00, rarityIndex: 1 },
      { name: 'Bolts & Nuts', icon: '🔩', minValue: 45.00, maxValue: 85.00, rarityIndex: 2 },
      { name: 'Brushed Metal Block', icon: '⬛', minValue: 70.00, maxValue: 135.00, rarityIndex: 3 },
      { name: 'Alloy Core', icon: '🧊', minValue: 120.00, maxValue: 230.00, rarityIndex: 4 },
      { name: 'Singularity Scrap', icon: '🌀', minValue: 250.00, maxValue: 480.00, rarityIndex: 5 }
    ]
  },
  {
    id: 'mixed_box',
    name: 'Mixed Box',
    icon: '🧳',
    price: 85.0,
    color: '#22d3ee',
    items: [
      { name: 'Thermal Cup', icon: '☕', minValue: 20.00, maxValue: 42.00, rarityIndex: 0 },
      { name: 'Rest Pillow', icon: '😴', minValue: 35.00, maxValue: 68.00, rarityIndex: 1 },
      { name: 'Photo Frame', icon: '🖼️', minValue: 55.00, maxValue: 105.00, rarityIndex: 2 },
      { name: 'Snack Container', icon: '🍱', minValue: 90.00, maxValue: 170.00, rarityIndex: 3 },
      { name: 'Weekend Bag', icon: '👜', minValue: 150.00, maxValue: 285.00, rarityIndex: 4 },
      { name: 'Premium Travel Kit', icon: '🧴', minValue: 300.00, maxValue: 550.00, rarityIndex: 5 }
    ]
  },
  {
    id: 'basic_gun',
    name: 'Basic Gun',
    icon: '🔫',
    price: 120.0,
    color: '#ef4444',
    items: [
      { name: 'Training Pistol', icon: '🔫', minValue: 30.00, maxValue: 65.00, rarityIndex: 0 },
      { name: 'Old Revolver', icon: '🤠', minValue: 55.00, maxValue: 110.00, rarityIndex: 1 },
      { name: 'Rusty SMG', icon: '💥', minValue: 90.00, maxValue: 175.00, rarityIndex: 2 },
      { name: 'Ammo Pack', icon: '📦', minValue: 140.00, maxValue: 270.00, rarityIndex: 3 },
      { name: 'Weapon Parts', icon: '🧩', minValue: 240.00, maxValue: 450.00, rarityIndex: 4 },
      { name: 'Collector Weapon', icon: '🎯', minValue: 500.00, maxValue: 900.00, rarityIndex: 5 }
    ]
  },
  {
    id: 'travel_box',
    name: 'Travel Box',
    icon: '🧭',
    price: 175.0,
    color: '#f97316',
    items: [
      { name: 'Trail Flashlight', icon: '🔦', minValue: 45.00, maxValue: 90.00, rarityIndex: 0 },
      { name: 'Adventure Passport', icon: '📘', minValue: 75.00, maxValue: 145.00, rarityIndex: 1 },
      { name: 'Star Map', icon: '🌌', minValue: 120.00, maxValue: 230.00, rarityIndex: 2 },
      { name: 'Aluminum Canteen', icon: '🥤', minValue: 190.00, maxValue: 360.00, rarityIndex: 3 },
      { name: 'Magnetic Compass', icon: '🧭', minValue: 320.00, maxValue: 600.00, rarityIndex: 4 },
      { name: 'First Aid Kit', icon: '🩹', minValue: 650.00, maxValue: 1200.00, rarityIndex: 5 }
    ]
  },
  {
    id: 'treasure_chest',
    name: 'Treasure Chest',
    icon: '💎',
    price: 250.0,
    color: '#a855f7',
    items: [
      { name: 'Bronze Coin', icon: '🪙', minValue: 60.00, maxValue: 120.00, rarityIndex: 0 },
      { name: 'Emerald Ring', icon: '💍', minValue: 110.00, maxValue: 210.00, rarityIndex: 1 },
      { name: 'Sapphire Gem', icon: '💠', minValue: 180.00, maxValue: 350.00, rarityIndex: 2 },
      { name: 'Ruby Crown', icon: '👑', minValue: 300.00, maxValue: 580.00, rarityIndex: 3 },
      { name: 'Diamond Scepter', icon: '🔱', minValue: 550.00, maxValue: 1050.00, rarityIndex: 4 },
      { name: 'Ancient Artifact', icon: '🏺', minValue: 1200.00, maxValue: 2500.00, rarityIndex: 5 }
    ]
  },
  {
    id: 'military_case',
    name: 'Military Case',
    icon: '🪖',
    price: 400.0,
    color: '#374151',
    items: [
      { name: 'Military Helmet', icon: '🪖', minValue: 100.00, maxValue: 200.00, rarityIndex: 0 },
      { name: 'Ammo Crate', icon: '📦', minValue: 180.00, maxValue: 350.00, rarityIndex: 1 },
      { name: 'Light Rifle', icon: '🔫', minValue: 300.00, maxValue: 580.00, rarityIndex: 2 },
      { name: 'Armored Jeep', icon: '🚙', minValue: 500.00, maxValue: 950.00, rarityIndex: 3 },
      { name: 'Battle Tank', icon: '🛡️', minValue: 900.00, maxValue: 1700.00, rarityIndex: 4 },
      { name: 'Fighter Jet', icon: '✈️', minValue: 2000.00, maxValue: 4000.00, rarityIndex: 5 }
    ]
  }
];

function getCaseById(caseId: string): CaseDefinition | undefined {
  return OPENING_CASES.find(c => c.id === caseId);
}

function getRarityByIndex(index: number): Rarity {
  return RARITIES[Math.min(index, RARITIES.length - 1)];
}

// ============================================================
// PASSES CONFIG (DUPLICADO DO FRONTEND)
// ============================================================

const PASSES_CONFIG: PassesConfig = {
  quick_roll: {
    id: 'quick_roll',
    name: 'Quick Roll',
    cost: 100,
    requires: null
  },
  multi_2x: {
    id: 'multi_2x',
    name: '2x Multi-Open',
    cost: 50,
    requires: null
  },
  multi_3x: {
    id: 'multi_3x',
    name: '3x Multi-Open',
    cost: 100,
    requires: 'multi_2x'
  },
  multi_4x: {
    id: 'multi_4x',
    name: '4x Multi-Open',
    cost: 150,
    requires: 'multi_3x'
  }
};

function getPassConfig(passId: string): PassConfig | null {
  return (PASSES_CONFIG as any)[passId] || null;
}

// ============================================================
// SECURE RNG
// ============================================================

function generateSecureSeed(userId: string, caseId: string, timestamp: number): string {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomInt(0, 1000000);
  return `case-${userId}-${caseId}-${timestamp}-${nonce}-${randomBytes}`;
}

function seededRandom(seed: string | number): number {
  let seedValue = 0;
  const seedStr = String(seed);
  
  for (let i = 0; i < seedStr.length; i++) {
    seedValue = ((seedValue << 5) - seedValue) + seedStr.charCodeAt(i);
    seedValue = seedValue & seedValue;
  }
  
  const x = Math.sin(Math.abs(seedValue)) * 10000;
  return x - Math.floor(x);
}

function createSeededRNG(seed: string | number): () => number {
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
// ITEM GENERATION
// ============================================================

interface AdjustedPool {
  item: CaseItem;
  rarity: Rarity;
  cumulative: number;
}

function buildAdjustedPools(caseData: CaseDefinition): AdjustedPool[] {
  const pools: AdjustedPool[] = [];
  const buckets = RARITIES.map((rarity, idx) => {
    const items = caseData.items.filter((it) => it.rarityIndex === idx);
    return items.length ? { rarity, items } : null;
  }).filter((b): b is { rarity: Rarity; items: CaseItem[] } => b !== null);

  if (!buckets.length) return pools;

  const totalBase = buckets.reduce((sum, b) => sum + b.rarity.chance, 0);
  let cumulative = 0;

  for (const bucket of buckets) {
    const rarityChance = (bucket.rarity.chance / totalBase) * 100;
    const perItemChance = rarityChance / bucket.items.length;
    for (const item of bucket.items) {
      cumulative += perItemChance;
      pools.push({ item, rarity: bucket.rarity, cumulative });
    }
  }

  if (pools.length) pools[pools.length - 1].cumulative = 100;
  return pools;
}

function generateItemSeeded(caseData: CaseDefinition, seed: string | number): OpenedItem | null {
  const rng = createSeededRNG(seed);
  const pools = buildAdjustedPools(caseData);
  if (!pools.length) {
    const fallback = caseData.items?.[0];
    if (!fallback) return null;
    const rarity = RARITIES[Math.min(fallback.rarityIndex, RARITIES.length - 1)];
    const mid = (fallback.minValue + fallback.maxValue) / 2;
    return {
      name: fallback.name,
      icon: fallback.icon,
      rarity: rarity.name,
      rarityIcon: rarity.icon,
      rarityColor: rarity.color,
      value: parseFloat(mid.toFixed(2))
    };
  }

  const roll = rng() * 100;
  const hit = pools.find(p => roll <= p.cumulative) || pools[pools.length - 1];
  const itemValue = hit.item.minValue + (rng() * (hit.item.maxValue - hit.item.minValue));
  
  return {
    name: hit.item.name,
    icon: hit.item.icon,
    rarity: hit.rarity.name,
    rarityIcon: hit.rarity.icon,
    rarityColor: hit.rarity.color,
    value: parseFloat(itemValue.toFixed(2))
  };
}

// ============================================================
// INVENTORY CAPACITY CHECK
// ============================================================

interface CapacityCheckResult {
  valid: boolean;
  error?: string;
  current?: number;
  max?: number;
  available?: number;
}

async function checkInventoryCapacity(userId: string, quantity: number, providedMax?: number): Promise<CapacityCheckResult> {
  try {
    // max_inventory can be passed in by caller to avoid extra query
    let maxCapacity = 15;
    if (providedMax !== undefined && typeof providedMax === 'number' && Number.isFinite(providedMax) && providedMax > 0) {
      maxCapacity = providedMax;
    } else {
      const { data: stats, error: statsError } = await supabase
        .from('player_stats')
        .select('max_inventory')
        .eq('user_id', userId)
        .single();

      if (statsError || !stats) {
        return { valid: false, error: 'Failed to fetch inventory limit' };
      }

      maxCapacity = (stats as any).max_inventory || 15;
    }
    
    // Contar itens atuais
    const { count, error: countError } = await supabase
      .from('inventory')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    if (countError) {
      return { valid: false, error: 'Failed to count inventory' };
    }
    
    const currentCount = count || 0;
    const afterOpening = currentCount + quantity;
    
    if (afterOpening > maxCapacity) {
      const available = maxCapacity - currentCount;
      return { 
        valid: false, 
        error: 'INVENTORY_FULL',
        current: currentCount,
        max: maxCapacity,
        available: available
      };
    }
    
    return { valid: true, current: currentCount, max: maxCapacity };
    
  } catch (err) {
    console.error('💥 Capacity check error:', err);
    return { valid: false, error: 'Capacity check failed' };
  }
}

// ============================================================
// MAIN HANDLER - OPEN CASES (ATUALIZADO)
// ============================================================

export async function handleOpenCases(req: ApiRequest, res: ApiResponse) {
  try {
    const { userId, authToken, caseId, quantity } = req.body ?? {};

    // Validação de quantidade com schema
    if (!authToken) {
      return res.status(400).json({ error: 'Missing required fields: authToken' });
    }
    const qtyValidation = ValidationSchemas.diamonds.validate(quantity);
    if (!qtyValidation.success || !qtyValidation.data || qtyValidation.data < 1 || qtyValidation.data > 4) {
      const log = createSecureLog({
        action: 'INVALID_CASE_QUANTITY',
        userId,
        statusCode: 400,
        details: { quantity },
        isSecurityEvent: true
      });
      console.log('⚠️', JSON.stringify(log));
      return res.status(400).json({ error: 'Invalid quantity (1-4)' });
    }

    if (!userId || !caseId || quantity === undefined || quantity === null) {
      return res.status(400).json({ error: 'Missing required fields: userId, caseId, quantity' });
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1 || qty > 4) {
      return res.status(400).json({ error: 'Invalid quantity (1-4)' });
    }

    // Validar pass requerido para quantidade
    const MULTI_REQUIREMENTS: Record<number, string | null> = {
      1: null,
      2: 'multi_2x',
      3: 'multi_3x',
      4: 'multi_4x'
    };

    const requiredPass = MULTI_REQUIREMENTS[qty];
    if (requiredPass) {
      const session = await validateSessionAndFetchPlayerStats(supabase, authToken, userId, { 
        select: 'unlocked_passes'
      });
      
      const userPasses = (session.stats as any)?.unlocked_passes || [];
      
      if (!userPasses.includes(requiredPass)) {
        const passConfig = getPassConfig(requiredPass);
        return res.status(403).json({
          error: 'PASS_REQUIRED',
          requiredPass: requiredPass,
          passName: passConfig?.name || requiredPass
        });
      }
    }
    
    const session = await validateSessionAndFetchPlayerStats(supabase, authToken, userId, {
      select: 'money, username, level, avatar_url, max_inventory, case_discount_level',
    });
    const { valid, error: sessionError } = session;
    if (!valid) {
      return res.status(401).json({ error: sessionError });
    }
    const stats = session.stats;

    // 🛡️ Validar CSRF token
    const csrfValidation = validateCsrfMiddleware(req, userId);
    if (!csrfValidation.valid) {
      console.warn('⚠️ CSRF validation failed:', { userId, error: csrfValidation.error });
      // CSRF validation failed - logged elsewhere
      return res.status(403).json({ error: 'Security validation failed' });
    }

    // 🔥 Verificar capacidade do inventário
    const capacityCheck = await checkInventoryCapacity(userId, qty, stats.max_inventory);
    if (!capacityCheck.valid) {

    if (capacityCheck.error === 'INVENTORY_FULL') {
        return res.status(400).json({ 
        error: 'INVENTORY_FULL',
        current: capacityCheck.current,
        max: capacityCheck.max,
        available: capacityCheck.available
        });
    }
    return res.status(500).json({ error: capacityCheck.error });
    }
    
    const caseData = getCaseById(caseId);
    if (!caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }
    
    const discountLevel = Math.min(Number(stats.case_discount_level) || 0, 40);
    const discountFactor = 1 - (discountLevel / 100);
    const totalCost = parseFloat((caseData.price * qty * discountFactor).toFixed(2));
    
    if (stats.money < totalCost) {
      console.warn('⚠️ Insufficient funds');
      return res.status(400).json({ error: 'Insufficient funds' });
    }
    
    // 🔥 PASSO 1: DESCONTAR O CUSTO
    let newBalance;
    try {
      newBalance = await updatePlayerBalance(
        supabase,
        userId,
        -totalCost,
        `Opened ${qty}x ${caseData.name}`,
        { casesOpened: qty, req }
      );
    } catch (error) {
      console.error('❌ Failed to deduct cost:', error instanceof Error ? error.message : error);
      if (error instanceof Error && error.message === 'Insufficient funds') {
        return res.status(400).json({ error: 'Insufficient funds' });
      }
      if (error instanceof Error && error.message === 'Balance changed. Please try again.') {
        return res.status(409).json({ error: error.message });
      }
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update balance' });
    }
    
    // 🔥 PASSO 2: GERAR 96 ITENS + ESCOLHER ÍNDICE VENCEDOR
    const timestamp = Date.now();
    const masterSeed = generateSecureSeed(userId, caseId, timestamp);
    
    const slots = [];
    const winners = [];
    
    for (let slot = 0; slot < qty; slot++) {
      // Gerar 96 itens para este slot
      const items = [];
      for (let i = 0; i < 96; i++) {
        const itemSeed = `${masterSeed}-slot${slot}-item${i}`;
        const item = generateItemSeeded(caseData, itemSeed);
        items.push(item);
      }
      
      // Escolher índice aleatório (20-76 para drama visual)
      const winnerIndexSeed = `${masterSeed}-slot${slot}-index`;
      const winnerIndex = 20 + Math.floor(seededRandom(winnerIndexSeed) * 57);
      
      const winner = items[winnerIndex];
      
      slots.push({
        items: items,
        winnerIndex: winnerIndex,
        winner: winner
      });
      
      winners.push(winner);
    }
    
    const totalValue = parseFloat(winners.reduce((sum, item) => sum + (item?.value || 0), 0).toFixed(2));
    
    // 🔥 PASSO 3: ADICIONAR ITENS AO INVENTÁRIO (ESTRUTURA CORRETA)
    // Se falhar aqui, reembolsa o usuário para evitar cobrar sem entregar itens.
    try {
      const inventoryItems = winners.map(item => ({
        user_id: userId,
        item_name: item?.name || 'Unknown',
        rarity: item?.rarity || 'Unknown',
        color: item?.rarityColor || '#999999',
        value: item?.value || 0,
        case_name: caseData.name,
        obtained_at: new Date().toISOString()
      }));
      
      const { error: invError } = await supabase
        .from('inventory')
        .insert(inventoryItems);
      
      if (invError) {
        console.error('❌ Failed to add items to inventory:', invError);
        try {
          const refundedBalance = await updatePlayerBalance(
            supabase,
            userId,
            totalCost,
            `Refund: failed to add items for ${qty}x ${caseData.name}`,
            { casesOpened: 0, req }
          );
          return res.status(500).json({
            error: 'Failed to add items to inventory',
            refunded: true,
            newBalance: refundedBalance
          });
        } catch (refundErr) {
          console.error('💥 Refund failed after inventory insert failure:', refundErr instanceof Error ? refundErr.message : refundErr);
          return res.status(500).json({
            error: 'Failed to add items to inventory',
            refunded: false
          });
        }
      } else {
      }
    } catch (error) {
      console.error('❌ Inventory error:', error);
      try {
        const refundedBalance = await updatePlayerBalance(
          supabase,
          userId,
          totalCost,
          `Refund: inventory exception for ${qty}x ${caseData.name}`,
          { casesOpened: 0, req }
        );
        return res.status(500).json({
          error: 'Failed to add items to inventory',
          refunded: true,
          newBalance: refundedBalance
        });
      } catch (refundErr) {
        console.error('💥 Refund failed after inventory exception:', refundErr instanceof Error ? refundErr.message : refundErr);
        return res.status(500).json({
          error: 'Failed to add items to inventory',
          refunded: false
        });
      }
    }
    
    // 🔥 PASSO 4: ATUALIZAR BEST_DROP
    const bestDrop = Math.max(...winners.filter(i => i !== null).map(i => i!.value), 0);
    if (bestDrop > 0) {
      try {
        await supabase.rpc('update_best_drop', {
          p_user_id: userId,
          p_new_drop: bestDrop
        });
      } catch (err) {
        console.error('⚠️ Failed to update best_drop:', err instanceof Error ? err.message : err);
      }
    }
    
    // 📥 PASSO 5: LOG DROP_HISTORY (prefer batch insert; fallback to RPC)
    try {
      const rows = winners.map((item) => ({
        user_id: userId,
        username: (stats as any).username,
        item_name: item?.name || 'Unknown',
        rarity: item?.rarity || 'Unknown',
        color: item?.rarityColor || '#999999',
        value: item?.value || 0,
        drop_type: 'case_opening',
        created_at: new Date().toISOString(),
      }));

      const { error: batchError } = await supabase
        .from('drop_history')
        .insert(rows);

      if (batchError) {
        const insertPromises = winners.map((item) =>
          supabase.rpc('insert_drop_history', {
            p_user_id: userId,
            p_username: (stats as any).username,
            p_item_name: item?.name || 'Unknown',
            p_rarity: item?.rarity || 'Unknown',
            p_color: item?.rarityColor || '#999999',
            p_value: item?.value || 0,
            p_drop_type: 'case_opening',
          })
        );

        const results = await Promise.all(insertPromises);
        const errors = results.filter((r) => r.error);
        if (errors.length > 0) {
          console.error('❌ Failed to insert drops:', errors.length);
        }
      }
    } catch (err) {
      console.error('💥 Drop insert exception:', err instanceof Error ? err.message : err);
    }

    // 🔥 PASSO 6: NOTIFICAR NO CHAT SE HOUVER DROPS LEGENDARY+
    const legendaryOrBetter = winners.filter(item => 
      item && ['Legendary', 'Mythic'].includes(item.rarity)
    );

    if (legendaryOrBetter.length > 0) {
      try {
        const notifyPromises = legendaryOrBetter.map((item) => {
          if (!item) return Promise.resolve(null);
          const message = `${(stats as any).username} just dropped ${item.rarityIcon} ${item.name} ($${item.value}) from ${caseData.name}!`;
          return supabase.rpc('insert_chat_notification', {
            p_user_id: userId,
            p_username: (stats as any).username,
            p_message: message,
            p_user_level: (stats as any).level || 1,
            p_avatar_url: (stats as any).avatar_url || null,
          });
        });

        const notifyResults = await Promise.allSettled(notifyPromises);
        const notifyErrors = notifyResults.filter((r) => r.status === 'fulfilled' && r.value?.error);
        if (notifyErrors.length > 0) {
          console.error('❌ Failed to send drop notifications:', notifyErrors.length);
        }
      } catch (err) {
        console.error('💥 Exception sending drop notification:', err instanceof Error ? err.message : err);
      }
    }
    
    const netProfit = parseFloat((totalValue - totalCost).toFixed(2));
    
    return res.status(200).json({
      success: true,
      seed: masterSeed,
      slots: slots,
      winners: winners,
      totalValue: totalValue,
      totalCost: totalCost,
      netProfit: netProfit,
      newBalance: newBalance,
      inventoryUpdated: true
    });
    
  } catch (error) {
    console.error('💥 FATAL ERROR in handleOpenCases:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// PURCHASE PASS HANDLER
// ============================================================

export async function handlePurchasePass(req: ApiRequest, res: ApiResponse) {
  try {
    const { userId, authToken, passId, cost, requiredPass } = req.body ?? {};

    // Validação básica
    if (!userId || !passId || !cost || !authToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validar sessão
    const session = await validateSessionAndFetchPlayerStats(supabase, authToken, userId, {
      select: 'diamonds, unlocked_passes'
    });
    const { valid, error: sessionError } = session;
    if (!valid) {
      return res.status(401).json({ error: sessionError });
    }

    // 🛡️ Validar CSRF token
    const csrfValidation = validateCsrfMiddleware(req, userId);
    if (!csrfValidation.valid) {
      console.warn('⚠️ CSRF validation failed:', { userId, error: csrfValidation.error });
      return res.status(403).json({ error: 'Security validation failed' });
    }

    // Validar configuração do pass
    const passConfig = getPassConfig(passId);
    if (!passConfig) {
      return res.status(404).json({ error: 'Pass not found' });
    }

    // Validar custo (anti-cheat)
    if (cost !== passConfig.cost) {
      console.warn('Pass cost mismatch:', { passId, expected: passConfig.cost, received: cost });
      return res.status(400).json({ error: 'Invalid pass cost' });
    }

    // Validar pass requerido (anti-cheat)
    if (requiredPass !== passConfig.requires) {
      console.warn('Required pass mismatch:', { passId, expected: passConfig.requires, received: requiredPass });
      return res.status(400).json({ error: 'Invalid required pass' });
    }

    // Chamar função do Supabase (ATÔMICA)
    const { data: rpcResult, error: rpcError } = await supabase.rpc('purchase_pass', {
      p_user_id: userId,
      p_pass_name: passId,
      p_diamond_cost: cost,
      p_required_pass: requiredPass
    });

    if (rpcError) {
      console.error('RPC purchase_pass error:', rpcError);
      return res.status(500).json({ error: 'Failed to purchase pass' });
    }

    // Parse resultado
    const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;

    if (!result.success) {
      // Erros esperados
      if (result.error === 'PASS_ALREADY_OWNED') {
        return res.status(400).json({ error: 'PASS_ALREADY_OWNED' });
      }
      if (result.error === 'INSUFFICIENT_DIAMONDS') {
        return res.status(400).json({
          error: 'INSUFFICIENT_DIAMONDS',
          current: result.current,
          needed: result.needed
        });
      }
      if (result.error === 'REQUIRED_PASS_NOT_OWNED') {
        return res.status(400).json({
          error: 'REQUIRED_PASS_NOT_OWNED',
          requiredPass: result.requiredPass
        });
      }
      if (result.error === 'USER_NOT_FOUND') {
        return res.status(404).json({ error: 'User not found' });
      }

      // Erro genérico
      return res.status(500).json({ error: result.error || 'Unknown error' });
    }

    // Sucesso
    return res.status(200).json({
      success: true,
      passId: passId,
      newDiamonds: result.newdiamonds || result.newDiamonds,
      unlockedPasses: result.unlockedpasses || result.unlockedPasses
    });

  } catch (error) {
    console.error('FATAL ERROR in handlePurchasePass:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// EXPORT
// ============================================================

export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyCors(req, res);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { action } = req.body ?? {};

  if (action === 'openCases') {
    return await handleOpenCases(req, res);
  }

  if (action === 'generatePreview') {
    return await handleGeneratePreview(req, res);
  }

  if (action === 'purchasePass') {
    return await handlePurchasePass(req, res);
  }

  if (action === 'upgradeCaseDiscount') {
    return await handleUpgradeCaseDiscount(req, res);
  }

  return res.status(400).json({ error: 'Invalid action' });
}

// ============================================================
// CASE DISCOUNT UPGRADE (money-based, +1% por nível, máx 40%)
// ============================================================

function calcDiscountUpgradeCost(level: number): number {
  // level é o nível atual; custo do próximo upgrade
  return Math.round(100 * Math.pow(1.38, level));
}

export async function handleUpgradeCaseDiscount(req: ApiRequest, res: ApiResponse) {
  try {
    const { userId, authToken } = req.body ?? {};

    if (!userId || !authToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Buscar nível atual e dinheiro
    const session = await validateSessionAndFetchPlayerStats(supabase, authToken, userId, {
      select: 'money, case_discount_level'
    });
    const { valid, error: sessionError } = session;
    if (!valid) {
      return res.status(401).json({ error: sessionError });
    }

    const currentLevel = Math.min(Number(session.stats?.case_discount_level) || 0, 1000);
    const maxLevel = 40;

    if (currentLevel >= maxLevel) {
      return res.status(400).json({ error: 'MAX_DISCOUNT_REACHED', level: currentLevel, maxLevel });
    }

    const cost = calcDiscountUpgradeCost(currentLevel);
    if (session.stats.money < cost) {
      return res.status(400).json({ error: 'INSUFFICIENT_FUNDS', needed: cost - session.stats.money });
    }

    // Descontar
    let newBalance;
    try {
      newBalance = await updatePlayerBalance(
        supabase,
        userId,
        -cost,
        `Case discount upgrade to ${currentLevel + 1}`,
        { casesOpened: 0, req }
      );
    } catch (err) {
      console.error('❌ Failed to charge discount upgrade:', err instanceof Error ? err.message : err);
      if (err instanceof Error && err.message === 'Insufficient funds') {
        return res.status(400).json({ error: 'INSUFFICIENT_FUNDS' });
      }
      if (err instanceof Error && err.message === 'Balance changed. Please try again.') {
        return res.status(409).json({ error: err.message });
      }
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update balance' });
    }

    const newLevel = currentLevel + 1;
    const discountPercent = Math.min(newLevel, maxLevel);

    const { error: updErr } = await supabase
      .from('player_stats')
      .update({ case_discount_level: newLevel })
      .eq('user_id', userId)
      .single();

    if (updErr) {
      console.error('❌ Failed to persist discount level:', updErr.message);
      // tentar reembolsar
      try {
        await updatePlayerBalance(
          supabase,
          userId,
          cost,
          `Refund: failed upgrade to ${newLevel}`,
          { casesOpened: 0, req }
        );
      } catch (refundErr) {
        console.error('💥 Refund failed after upgrade persist error:', refundErr instanceof Error ? refundErr.message : refundErr);
      }
      return res.status(500).json({ error: 'Failed to save discount level' });
    }

    const nextCost = newLevel >= maxLevel ? null : calcDiscountUpgradeCost(newLevel);

    return res.status(200).json({
      success: true,
      level: newLevel,
      discountPercent,
      newBalance,
      nextCost,
      maxLevel
    });

  } catch (error) {
    console.error('FATAL ERROR in handleUpgradeCaseDiscount:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ============================================================
// PREVIEW GENERATION
// ============================================================
export async function handleGeneratePreview(req: ApiRequest, res: ApiResponse) {
  try {
    const { caseId, quantity } = req.body ?? {};
    const qty = Number(quantity);

    if (!caseId || !Number.isInteger(qty) || qty < 1 || qty > 4) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const caseData = getCaseById(caseId);
    if (!caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const timestamp = Date.now();
    const previewSeed = `preview-${caseId}-${timestamp}`;

    const previews: OpenedItem[][] = [];
    for (let slot = 0; slot < qty; slot++) {
      const items: OpenedItem[] = [];
      for (let i = 0; i < 96; i++) {
        const itemSeed = `${previewSeed}-slot${slot}-item${i}`;
        const item = generateItemSeeded(caseData, itemSeed);
        if (item) items.push(item);
      }
      previews.push(items);
    }

    return res.status(200).json({ success: true, previews });
  } catch (error) {
    console.error('💥 Preview generation error:', error);
    return res.status(500).json({ error: 'Failed to generate preview' });
  }
}