// ============================================================
// CONSTANTS.TS - Configurações e Constantes Globais
// ============================================================

// ============================================================
// CASE OPENING CONSTANTS
// ============================================================

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
  iconImage: string;
  price: number;
  color: string;
  items: CaseItem[];
}

// Rarities with drop chances
export const RARITIES: Rarity[] = [
  { name: 'Common', chance: 55, color: '#9ca3af', icon: '⚪' },
  { name: 'Uncommon', chance: 25, color: '#22c55e', icon: '🟢' },
  { name: 'Rare', chance: 12, color: '#3b82f6', icon: '🔵' },
  { name: 'Epic', chance: 5, color: '#a855f7', icon: '🟣' },
  { name: 'Legendary', chance: 2.5, color: '#eab308', icon: '🟡' },
  { name: 'Mythic', chance: 0.5, color: '#ef4444', icon: '🔴' }
];

// Case definitions
export const OPENING_CASES: CaseDefinition[] = [
  {
    id: 'starter_box',
    name: 'Starter Box',
    icon: '📦',
    iconImage: '/images/cases/images/starter_box.png',
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
    iconImage: '/images/cases/images/utility_box.png',
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
    iconImage: '/images/cases/images/green_box.png',
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
    iconImage: '/images/cases/images/urban_box.png',
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
    iconImage: '/images/cases/images/old_stuff.png',
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
    iconImage: '/images/cases/images/toy_box.png',
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
    iconImage: '/images/cases/images/scrap_box.png',
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
    iconImage: '/images/cases/images/mixed_box.png',
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
    iconImage: '/images/cases/images/basic_gun.png',
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
    iconImage: '/images/cases/images/travel_box.png',
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
    iconImage: '/images/cases/images/treasure_chest.png',
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
    iconImage: '/images/cases/images/military_case.png',
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

// Precomputed lookup (faster than linear .find on every call)
const CASE_BY_ID = new Map<string, CaseDefinition>(OPENING_CASES.map(c => [c.id, c]));

// Get case by ID
export function getCaseById(caseId: string | number | undefined): CaseDefinition | undefined {
  if (!caseId) return undefined;
  const key = typeof caseId === 'string' ? caseId : String(caseId);
  return CASE_BY_ID.get(key);
}

// Get rarity by index
export function getRarityByIndex(index: number): Rarity {
  return RARITIES[Math.min(index, RARITIES.length - 1)];
}

// ============================================================
// SKILL TREE CONFIG
// ============================================================

export const HUB = { x: 1200, y: 1200 };

interface SkillBadge {
  x: number;
  y: number;
  icon: string;
  name: string;
  desc: string;
  requirement: string;
  diamonds: number;
  xp: number;
  category: string;
  current: number;
  max: number;
}

type SkillBadges = Record<string, SkillBadge>;

export const SKILL_TREE_BADGES: SkillBadges = {
  'first-blood': { x: 851, y: 1384, icon: '⚔️', name: 'First Blood', desc: 'Win your first battle', requirement: '1 victory', diamonds: 10, xp: 50, category: 'battles', current: 0, max: 1 },
  'warrior': { x: 533, y: 1317, icon: '🗡️', name: 'Warrior', desc: 'Become an experienced warrior', requirement: '50 victories', diamonds: 25, xp: 100, category: 'battles', current: 0, max: 50 },
  'slayer': { x: 257, y: 1105, icon: '🔪', name: 'Slayer', desc: 'Dominate the battlefield', requirement: '250 victories', diamonds: 50, xp: 200, category: 'battles', current: 0, max: 250 },
  'berserker': { x: 130, y: 781, icon: '😈', name: 'Berserker', desc: 'Fight with uncontrollable fury', requirement: '1000 victories', diamonds: 100, xp: 500, category: 'battles', current: 0, max: 1000 },
  'titan': { x: 171, y: 362, icon: '🏔️', name: 'Titan', desc: 'A true titan of battles', requirement: '5000 victories', diamonds: 250, xp: 1000, category: 'battles', current: 0, max: 5000 },
  'beggar': { x: 1412, y: 1412, icon: '💰', name: 'Beggar', desc: 'Your first earnings', requirement: '100 💰', diamonds: 10, xp: 50, category: 'money', current: 0, max: 100 },
  'gold-digger': { x: 1603, y: 1461, icon: '⛏️', name: 'Gold Digger', desc: 'Accumulate wealth', requirement: '1000 💰', diamonds: 25, xp: 100, category: 'money', current: 0, max: 1000 },
  'treasure-hunter': { x: 1822, y: 1437, icon: '🗺️', name: 'Treasure Hunter', desc: 'Treasure hunter', requirement: '10000 💰', diamonds: 50, xp: 200, category: 'money', current: 0, max: 10000 },
  'fortune-seeker': { x: 2029, y: 1331, icon: '🔮', name: 'Fortune Seeker', desc: 'Seek your fortune', requirement: '50000 💰', diamonds: 100, xp: 500, category: 'money', current: 0, max: 50000 },
  'midas': { x: 2219, y: 1253, icon: '👑', name: 'Midas', desc: 'Everything you touch turns to gold', requirement: '1000000 💰', diamonds: 500, xp: 2000, category: 'money', current: 0, max: 1000000 },
  'curious': { x: 1359, y: 943, icon: '🔍', name: 'Curious', desc: 'Your first case', requirement: '10 cases', diamonds: 10, xp: 50, category: 'cases', current: 0, max: 10 },
  'unlocksmith': { x: 1406, y: 629, icon: '🔓', name: 'Unlocksmith', desc: 'Master of keys', requirement: '100 cases', diamonds: 25, xp: 100, category: 'cases', current: 0, max: 100 },
  'loot-master': { x: 1378, y: 371, icon: '🎁', name: 'Loot Master', desc: 'Master the art of loot', requirement: '1000 cases', diamonds: 50, xp: 200, category: 'cases', current: 0, max: 1000 },
  'key-collector': { x: 1219, y: 190, icon: '🗝️', name: 'Key Collector', desc: 'Key collector', requirement: '15000 cases', diamonds: 100, xp: 500, category: 'cases', current: 0, max: 15000 },
  'pandora': { x: 911, y: 76, icon: '📦', name: 'Pandora', desc: "Open Pandora's box", requirement: '100000 cases', diamonds: 500, xp: 2000, category: 'cases', current: 0, max: 100000 },
  'novice': { x: 1486, y: 1092, icon: '🎓', name: 'Novice', desc: 'Your first steps', requirement: 'Level 5', diamonds: 10, xp: 50, category: 'level', current: 0, max: 5 },
  'mage': { x: 1683, y: 984, icon: '🔮', name: 'Mage', desc: 'Become a mage', requirement: 'Level 25', diamonds: 25, xp: 100, category: 'level', current: 0, max: 25 },
  'warlock': { x: 1813, y: 835, icon: '🧙', name: 'Warlock', desc: 'Master black magic', requirement: 'Level 50', diamonds: 50, xp: 200, category: 'level', current: 0, max: 50 },
  'ascendant': { x: 1876, y: 610, icon: '⚡', name: 'Ascendant', desc: 'Ascend to a new level', requirement: 'Level 75', diamonds: 100, xp: 500, category: 'level', current: 0, max: 75 },
  'enlightened': { x: 1822, y: 381, icon: '🌟', name: 'Enlightened', desc: 'Achieve enlightenment', requirement: 'Level 100', diamonds: 500, xp: 2000, category: 'level', current: 0, max: 100 },
  'collector': { x: 1070, y: 1483, icon: '🎯', name: 'Collector', desc: 'Start your collection', requirement: '5 badges', diamonds: 10, xp: 50, category: 'collector', current: 0, max: 5 },
  'gatherer': { x: 1219, y: 1749, icon: '📚', name: 'Gatherer', desc: 'Gather knowledge', requirement: '15 badges', diamonds: 25, xp: 100, category: 'collector', current: 0, max: 15 },
  'achievement-hunter': { x: 1527, y: 1851, icon: '🏅', name: 'Achievement Hunter', desc: 'Achievement hunter', requirement: '25 badges', diamonds: 50, xp: 200, category: 'collector', current: 0, max: 25 },
  'trophy-master': { x: 1844, y: 1806, icon: '🏆', name: 'Trophy Master', desc: 'Master of trophies', requirement: '35 badges', diamonds: 100, xp: 500, category: 'collector', current: 0, max: 35 },
  'chosen-one': { x: 2092, y: 1692, icon: '👑', name: 'The Chosen One', desc: 'The chosen among all', requirement: '50 badges', diamonds: 1000, xp: 5000, category: 'collector', current: 0, max: 50 }
};

interface SkillCategory {
  color: string;
  badges: string[];
}

type SkillCategories = Record<string, SkillCategory>;

export const SKILL_TREE_CATEGORIES: SkillCategories = {
  battles: { color: '#ef4444', badges: ['first-blood', 'warrior', 'slayer', 'berserker', 'titan'] },
  money: { color: '#facc15', badges: ['beggar', 'gold-digger', 'treasure-hunter', 'fortune-seeker', 'midas'] },
  cases: { color: '#a855f7', badges: ['curious', 'unlocksmith', 'loot-master', 'key-collector', 'pandora'] },
  level: { color: '#06b6d4', badges: ['novice', 'mage', 'warlock', 'ascendant', 'enlightened'] },
  collector: { color: '#22c55e', badges: ['collector', 'gatherer', 'achievement-hunter', 'trophy-master', 'chosen-one'] }
};

// ============================================================
// BADGE DEFINITIONS
// ============================================================

interface BadgeDefinition {
  id: string;
  icon: string;
  name: string;
  nameKey: string;
  desc: string;
  descKey: string;
  requirement: (stats: any) => boolean;
  diamonds: number;
  xp: number;
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  { 
    id: 'starter',
    icon: '🎯', 
    name: 'Starter',
    nameKey: 'badge_starter',
    desc: 'Join 1 battle',
    descKey: 'badge_starter_desc',
    requirement: (stats: any) => stats.total_battles >= 1,
    diamonds: 10,
    xp: 50
  },
  { 
    id: 'lucky',
    icon: '🔥', 
    name: 'Lucky',
    nameKey: 'badge_lucky',
    desc: 'Win 5 battles',
    descKey: 'badge_lucky_desc',
    requirement: (stats: any) => stats.total_wins >= 5,
    diamonds: 10,
    xp: 100
  },
  { 
    id: 'veteran',
    icon: '⚡', 
    name: 'Veteran',
    nameKey: 'badge_veteran',
    desc: 'Join 50 battles',
    descKey: 'badge_veteran_desc',
    requirement: (stats: any) => stats.total_battles >= 50,
    diamonds: 10,
    xp: 200
  },
  { 
    id: 'rich',
    icon: '💎', 
    name: 'Rich',
    nameKey: 'badge_rich',
    desc: 'Have 1000 💰',
    descKey: 'badge_rich_desc',
    requirement: (stats: any) => stats.money >= 1000,
    diamonds: 25,
    xp: 300
  },
  { 
    id: 'champion',
    icon: '👑', 
    name: 'Champion',
    nameKey: 'badge_champion',
    desc: 'Win 20 battles',
    descKey: 'badge_champion_desc',
    requirement: (stats: any) => stats.total_wins >= 20,
    diamonds: 25,
    xp: 400
  },
  { 
    id: 'legendary',
    icon: '🌟', 
    name: 'Legendary',
    nameKey: 'badge_legendary',
    desc: 'Reach level 10',
    descKey: 'badge_legendary_desc',
    requirement: (stats: any) => stats.level >= 10,
    diamonds: 50,
    xp: 500
  },
  { 
    id: 'highroller',
    icon: '💰', 
    name: 'High Roller',
    nameKey: 'badge_highroller',
    desc: 'Spend 10,000 💰 on cases',
    descKey: 'badge_highroller_desc',
    requirement: (stats: any) => (stats.total_spent || 0) >= 10000,
    diamonds: 50,
    xp: 750
  },
  { 
    id: 'jackpot',
    icon: '🎰', 
    name: 'Jackpot',
    nameKey: 'badge_jackpot',
    desc: 'Win an item worth more than 5,000 💰',
    descKey: 'badge_jackpot_desc',
    requirement: (stats: any) => (stats.best_drop || 0) >= 5000,
    diamonds: 75,
    xp: 1000
  },
  { 
    id: 'ultimate',
    icon: '🏆', 
    name: 'Ultimate',
    nameKey: 'badge_ultimate',
    desc: 'Collect all other badges',
    descKey: 'badge_ultimate_desc',
    requirement: (stats: any) => {
      const collected = stats.collected_badges || [];
      const mainBadges = BADGE_DEFINITIONS.slice(0, 8);
      return mainBadges.every(b => collected.includes(b.id));
    },
    diamonds: 100,
    xp: 2000
  }
];

// ============================================================
// PAYMENT CONFIG
// ============================================================

interface PaymentConfig {
  pix_brl_key: string;
  pix_usd_key: string;
  ltc_address: string;
  discord_webhook: string;
}

export const PAYMENT_CONFIG: PaymentConfig = {
  pix_brl_key: 'alexomenor@gmail.com',
  pix_usd_key: 'SEU_EMAIL_OU_CHAVE_PIX_USD',
  ltc_address: 'SEU_ENDERECO_LTC_AQUI',
  discord_webhook: 'https://discord.com/api/webhooks/1429616029994061985/tGgE7Hd_IUngetbOmL9_2a2NIWUl0Jf4XzQd91L2yZQ58G8UeNoxwWyQaFWn6Cu2y8A5'
};

// ============================================================
// INVENTORY CONFIG
// ============================================================

export const MAX_CAPACITY: number = 15;

// ============================================================
// PASSES CONFIG
// ============================================================

interface PassConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  cost: number;
  requires: string | null;
  benefits: string[];
  color: string;
}

interface PassesConfigType {
  [key: string]: PassConfig;
}

export const PASSES_CONFIG: PassesConfigType = {
  quick_roll: {
    id: 'quick_roll',
    name: 'Quick Roll',
    description: 'Reduce animation time from 15s to 5s',
    icon: '⚡',
    cost: 100,
    requires: null,
    benefits: [
      '3x faster animations (15s ⇨ 5s)',
      'Skip to results instantly'
    ],
    color: '#facc15'
  },
  multi_2x: {
    id: 'multi_2x',
    name: '2x Open',
    description: 'Unlock ability to open 2 cases at once',
    icon: '📦',
    cost: 50,
    requires: null,
    benefits: [
      'Open 2 cases simultaneously',
      'Faster case opening',
      'Better efficiency'
    ],
    color: '#3b82f6'
  },
  multi_3x: {
    id: 'multi_3x',
    name: '3x Open',
    description: 'Unlock ability to open 3 cases at once',
    icon: '📦📦',
    cost: 100,
    requires: 'multi_2x',
    benefits: [
      'Open 3 cases simultaneously',
      'Advanced farming',
      'Maximum efficiency'
    ],
    color: '#8b5cf6'
  },
  multi_4x: {
    id: 'multi_4x',
    name: '4x Multi-Open',
    description: 'Unlock ability to open 4 cases at once',
    icon: '📦📦📦',
    cost: 150,
    requires: 'multi_3x',
    benefits: [
      'Open 4 cases simultaneously',
      'Elite farming',
      'Ultimate efficiency'
    ],
    color: '#ef4444'
  }
};

// Mapa de quantidade -> pass requerido
export const MULTI_OPEN_REQUIREMENTS: Record<number, string | null> = {
  1: null,
  2: 'multi_2x',
  3: 'multi_3x',
  4: 'multi_4x'
};

// Utility functions
export function getPassConfig(passId: string): PassConfig | null {
  return PASSES_CONFIG[passId] || null;
}

export function getRequiredPassForQuantity(quantity: number): string | null {
  return MULTI_OPEN_REQUIREMENTS[quantity] || null;
}

export function hasRequiredPass(ownedPasses: string[], requiredPassId: string | null): boolean {
  if (!requiredPassId) return true;
  return ownedPasses.includes(requiredPassId);
}

export function canOpenQuantity(ownedPasses: string[], quantity: number): boolean {
  const requiredPass = getRequiredPassForQuantity(quantity);
  return hasRequiredPass(ownedPasses, requiredPass);
}

// ============================================================
// UTILITY EXPORTS
// =============================================================
(window as any).RARITIES = RARITIES;
(window as any).PAYMENT_CONFIG = PAYMENT_CONFIG;
(window as any).PASSES_CONFIG = PASSES_CONFIG;
