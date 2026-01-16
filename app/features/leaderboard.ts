// ============================================================
// LEADERBOARD.JS - SISTEMA COMPLETO DE RANKINGS
// ============================================================

import { supabase } from './auth';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

interface PlayerData {
  user_id: string;
  username: string;
  avatar_url?: string;
  level?: number;
  money?: number;
  total_wins?: number;
  total_cases_opened?: number;
  best_drop?: number;
  total_spent?: number;
  total_gains?: number;
  [key: string]: any;
}

interface LeaderboardType {
  id: string;
  name: string;
  icon: string;
  isSpecial?: boolean;
  column: string;
  order: 'asc' | 'desc';
  format: (value: number) => string;
}

interface LeaderboardTypes {
  [key: string]: LeaderboardType;
}

interface RankMaps {
  [key: string]: Map<string, number>;
}

interface User {
  id: string;
  username?: string;
  [key: string]: any;
}

declare global {
  interface Window {
    goTo?: (screen: string) => void;
    toggleCategoryDropdown: () => void;
    switchLeaderboardCategory: (categoryId: string) => void;
    loadMorePlayers: () => Promise<void>;
  }
}

// ============================================================
// CONFIGURAÇÃO DE LEADERBOARDS
// ============================================================

const LEADERBOARD_TYPES: LeaderboardTypes = {
general: {
    id: 'general',
    name: '⭐ General',
    icon: '⭐',
    isSpecial: true,
    column: 'average_rank',
    order: 'asc' as const,
    format: (value: number) => `Rank ${value.toFixed(1)}`
  },
  money: {
    id: 'money',
    name: '💰 Top Money',
    icon: '💰',
    column: 'money',
    order: 'desc',
    format: (value) => `${value.toLocaleString()} 💰`
  },
  wins: {
    id: 'wins',
    name: '🏆 Top Wins',
    icon: '🏆',
    column: 'total_wins',
    order: 'desc',
    format: (value) => `${value} victories`
  },
  cases: {
    id: 'cases',
    name: '📦 Top Cases',
    icon: '📦',
    column: 'total_cases_opened',
    order: 'desc',
    format: (value) => `${value} cases`
  },
  best_drop: {
    id: 'best_drop',
    name: '💎 Best Drop',
    icon: '💎',
    column: 'best_drop',
    order: 'desc',
    format: (value) => `${value.toFixed(2)} 💰`
  },
  total_spent: {
    id: 'total_spent',
    name: '💸 Top Spent',
    icon: '💸',
    column: 'total_spent',
    order: 'desc',
    format: (value) => `${value.toFixed(2)} 💰`
  },
  total_gains: {
    id: 'total_gains',
    name: '💵 Top Gains',
    icon: '💵',
    column: 'total_gains',
    order: 'desc',
    format: (value) => `${value.toFixed(2)} 💰`
  }
};

// ============================================================
// ESTADO DO LEADERBOARD
// ============================================================

let currentLeaderboardType: string = 'general';
let currentPage: number = 0;
let hasMorePages: boolean = true;
let isLoading: boolean = false;
let allPlayersData: PlayerData[] = [];
let currentUserData: User | null = null;

let renderToken: number = 0;

const USER_POSITION_CACHE_MS: number = 30000;
const userPositionCache: Map<string, any> = new Map();

const ITEMS_PER_PAGE: number = 10;

// ✅ Função para resetar estado
function resetLeaderboardState(): void {
  renderToken++;
  currentPage = 0;
  hasMorePages = true;
  allPlayersData = [];
  isLoading = false;
  
  // Limpar container
  const listContainer = document.getElementById('leader-list');
  if (listContainer) {
    listContainer.innerHTML = '';
  }
  
  // Ocultar botão "Load More"
  const loadMoreContainer = document.getElementById('load-more-container');
  if (loadMoreContainer) {
    loadMoreContainer.classList.add('hidden');
  }
  
  // Ocultar overlay
  const overlay = document.getElementById('user-position-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================

export function initLeaderboard(currentUser: User): void {
  currentUserData = currentUser;
  
  // ✅ RESETAR ESTADO AO INICIALIZAR
  resetLeaderboardState();
  
  setupLeaderboardUI();
  renderLeaderboard();
}

function setupLeaderboardUI(): void {
  const container = document.getElementById('leaderboard');
  
  if (!container) return;
  
  // Criar estrutura
  container.innerHTML = `
    <button class="back-btn" onclick="goTo('menu')" data-translate>← Back</button>
    
    <div class="leaderboard-header">
      <h2 data-translate>🏆 Leaderboard</h2>
      
      <!-- Dropdown de Categorias -->
      <div class="leaderboard-category-selector">
        <button class="category-dropdown-btn" id="category-dropdown-btn" onclick="toggleCategoryDropdown()">
          <span class="category-icon" id="current-category-icon">⭐</span>
          <span class="category-name" id="current-category-name">General</span>
          <span class="dropdown-arrow">▼</span>
        </button>
        
        <div class="category-dropdown-menu hidden" id="category-dropdown-menu">
          ${Object.values(LEADERBOARD_TYPES).map(type => `
            <button class="category-option ${type.id === 'general' ? 'active' : ''}" 
                    data-category="${type.id}"
                    onclick="switchLeaderboardCategory('${type.id}')">
              <span class="category-option-icon">${type.icon}</span>
              <span class="category-option-name">${type.name}</span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
    
    <!-- Container Principal -->
    <div id="leader-list"></div>
    
    <!-- Botão Carregar Mais -->
    <div id="load-more-container" class="load-more-container hidden">
      <button class="load-more-btn" onclick="loadMorePlayers()">
        <span>⬇️</span>
        <span data-translate>Load More</span>
      </button>
    </div>
    
    <!-- Posição do Usuário (Overlay) -->
    <div id="user-position-overlay" class="user-position-overlay hidden">
      <div class="user-position-card">
        <div class="user-position-header">
          <span data-translate>Your Position</span>
        </div>
        <div class="user-position-content">
          <div class="user-position-rank">#<span id="user-rank">-</span></div>
          <div class="user-position-info">
            <div class="user-position-name" id="user-position-name">Username</div>
            <div class="user-position-value" id="user-position-value">0</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// TROCAR CATEGORIA
// ============================================================

window.switchLeaderboardCategory = function(categoryId: string) {
  if (currentLeaderboardType === categoryId) {
    if (typeof window.toggleCategoryDropdown === 'function') {
      window.toggleCategoryDropdown();
    }
    return;
  }
  
  currentLeaderboardType = categoryId;
  userPositionCache.delete(`${categoryId}:${currentUserData?.id || ''}`);
  
  // ✅ RESETAR COMPLETAMENTE AO TROCAR CATEGORIA
  resetLeaderboardState();
  
  // Atualizar UI do dropdown
  const typeConfig = LEADERBOARD_TYPES[categoryId];
  const iconEl = document.getElementById('current-category-icon');
  const nameEl = document.getElementById('current-category-name');
  if (iconEl) iconEl.textContent = typeConfig.icon;
  if (nameEl) nameEl.textContent = typeConfig.name;
  
  // Atualizar opções ativas
  document.querySelectorAll('.category-option').forEach(opt => {
    (opt as HTMLElement).classList.toggle('active', (opt as HTMLElement).dataset.category === categoryId);
  });
  
  if (typeof window.toggleCategoryDropdown === 'function') {
    window.toggleCategoryDropdown();
  }
  renderLeaderboard();
};

window.toggleCategoryDropdown = function() {
  const menu = document.getElementById('category-dropdown-menu');
  const btn = document.getElementById('category-dropdown-btn');

  if (!menu || !btn) return;
  menu.classList.toggle('hidden');
  btn.classList.toggle('active');
};

// ============================================================
// RENDERIZAR LEADERBOARD
// ============================================================

export async function renderLeaderboard(): Promise<void> {
  const listContainer = document.getElementById('leader-list');
  
  if (!listContainer) return;

  const myToken = renderToken;
  
  // Mostrar loading
  if (currentPage === 0) {
    listContainer.innerHTML = `
      <div class="leaderboard-loading">
        <div class="loading-spinner"></div>
        <p data-translate>Loading rankings...</p>
      </div>
    `;
  }
  
  try {
    const typeConfig = LEADERBOARD_TYPES[currentLeaderboardType];
    
    // ⭐ GENERAL é especial
    if (typeConfig.isSpecial) {
      await renderGeneralLeaderboard(myToken);
      return;
    }
    
    // Buscar dados do banco
    const { data, error } = await supabase
      .from('player_stats')
      .select('username, money, total_wins, total_cases_opened, best_drop, total_spent, total_gains, total_battles, level, collected_badges, user_id, role, avatar_url')
      .neq('role', 'bot') // ✅ FILTRAR BOTS
      .order(typeConfig.column, { ascending: typeConfig.order === 'asc' })
      .range(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE - 1);

    if (myToken !== renderToken) return;
    
    if (error) {
      listContainer.innerHTML = `<p style="color: #ef4444;">Error: ${error.message}</p>`;
      return;
    }
    
    if (!data || data.length === 0) {
      if (currentPage === 0) {
        listContainer.innerHTML = `
          <div class="leaderboard-empty">
            <div class="empty-icon">🏆</div>
            <p data-translate>No players yet</p>
          </div>
        `;
      }
      hasMorePages = false;
      const loadMoreContainer = document.getElementById('load-more-container');
      if (loadMoreContainer) loadMoreContainer.classList.add('hidden');
      return;
    }
    
    // Adicionar à lista global
    allPlayersData.push(...data);
    
    // Verificar se há mais páginas
    hasMorePages = data.length === ITEMS_PER_PAGE;
    
    // Renderizar
    if (currentPage === 0) {
      renderTop3(data.slice(0, 3), typeConfig);
      renderList(data.slice(3), 4, typeConfig);
    } else {
      renderList(data, currentPage * ITEMS_PER_PAGE + 1, typeConfig);
    }
    
    // Mostrar/ocultar botão "Carregar Mais"
    const loadMoreContainer = document.getElementById('load-more-container');
    if (loadMoreContainer) {
      if (hasMorePages) {
        loadMoreContainer.classList.remove('hidden');
      } else {
        loadMoreContainer.classList.add('hidden');
      }
    }
    
    // Buscar posição do usuário
    await updateUserPosition(typeConfig, myToken);
    
  } catch (err) {
    console.error('Error rendering leaderboard:', err);
    listContainer.innerHTML = `<p style="color: #ef4444;">Unexpected error</p>`;
  }
}

// ============================================================
// RENDERIZAR TOP 3 (PÓDIO)
// ============================================================

function renderTop3(players: PlayerData[], typeConfig: LeaderboardType): string {
  const listContainer = document.getElementById('leader-list');
  
  if (players.length === 0) return '';
  
  const maxValue = (players[0]?.[typeConfig.column] as number) || 1;
  
  const podiumHTML = `
    <div class="leaderboard-podium">
      ${renderPodiumCard(players[1], 2, maxValue, typeConfig, 'silver')}
      ${renderPodiumCard(players[0], 1, maxValue, typeConfig, 'gold')}
      ${renderPodiumCard(players[2], 3, maxValue, typeConfig, 'bronze')}
    </div>
  `;
  
  if (listContainer) listContainer.innerHTML = podiumHTML;
  return podiumHTML;
}

function renderPodiumCard(player: PlayerData, rank: number, maxValue: number, typeConfig: LeaderboardType, medal: string): string {
  if (!player) return '<div></div>';
  
  const value = (player[typeConfig.column] as number) || 0;
  const progress = (value / maxValue) * 100;
  const progressText = rank === 1 ? '100%' : `${progress.toFixed(0)}%`;
  
  const medalIcons: Record<string, string> = {
    gold: '<div class="podium-crown">👑</div>',
    silver: '<div class="podium-medal">🥈</div>',
    bronze: '<div class="podium-medal">🥉</div>'
  };
  
  const badges = (player.collected_badges || []).slice(0, 3).map((badgeId: string) => {
    const badgeEmojis: Record<string, string> = {
      'starter': '🎯',
      'lucky': '🔥',
      'veteran': '⚡',
      'rich': '💎',
      'champion': '👑',
      'legendary': '🌟'
    };
    return `<span class="podium-badge">${badgeEmojis[badgeId] || '⭐'}</span>`;
  }).join('');
  
  const isYou = player.user_id === currentUserData?.id;
  
  return `
    <div class="podium-card ${medal} ${isYou ? 'you' : ''}">
      <div class="podium-rank">#${rank}</div>
      ${medalIcons[medal] || ''}
      
      <img src="${player.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${player.username}`}" alt="${player.username}" class="podium-avatar-img" loading="lazy">
      
      <div class="podium-name">
        ${player.username}
        ${isYou ? '<span class="you-tag">YOU</span>' : ''}
        ${badges ? `<div class="podium-badges">${badges}</div>` : ''}
      </div>
      
      <div class="podium-money">
        ${typeConfig.format(value)}
      </div>
      
      <div class="podium-stats">
        <div class="podium-stat">
          <span class="podium-stat-label">Victories</span>
          <span class="podium-stat-value">${player.total_wins || 0}</span>
        </div>
        <div class="podium-stat">
          <span class="podium-stat-label">Battles</span>
          <span class="podium-stat-value">${player.total_battles || 0}</span>
        </div>
        <div class="podium-stat">
          <span class="podium-stat-label">Level</span>
          <span class="podium-stat-value">${player.level || 1}</span>
        </div>
      </div>
      
      ${rank > 1 ? `
        <div class="podium-progress">
          <div class="podium-progress-label">
            <span>vs #1</span>
            <span>${progressText}</span>
          </div>
          <div class="podium-progress-bar">
            <div class="podium-progress-fill" style="width: ${progress}%"></div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// ============================================================
// RENDERIZAR LISTA (4+)
// ============================================================

function renderList(players: PlayerData[], startRank: number, typeConfig: LeaderboardType): string {
  const listContainer = document.getElementById('leader-list') as HTMLElement | null;
  
  if (players.length === 0) return '';
  
  const maxValue = allPlayersData[0]?.[typeConfig.column as keyof PlayerData] || 1;
  
  const listHTML = `
    <div class="leaderboard-list">
      ${players.map((player, index) => renderListItem(player, startRank + index, maxValue, typeConfig)).join('')}
    </div>
  `;
  
  if (!listContainer) return listHTML;
  
  if (currentPage === 0) {
    listContainer.innerHTML += listHTML;
  } else {
    const existingList = listContainer.querySelector('.leaderboard-list');
    if (existingList) {
      existingList.innerHTML += players.map((player, index) => renderListItem(player, startRank + index, maxValue, typeConfig)).join('');
    } else {
      listContainer.innerHTML += listHTML;
    }
  }
  
  return listHTML;
}

function renderListItem(player: PlayerData, rank: number, maxValue: number, typeConfig: LeaderboardType): string {
  const value = (player[typeConfig.column as keyof PlayerData] as number) || 0;
  const progress = (value / maxValue) * 100;
  
  const badgeEmojis: Record<string, string> = {
    'starter': '🎯',
    'lucky': '🔥',
    'veteran': '⚡',
    'rich': '💎',
    'champion': '👑',
    'legendary': '🌟'
  };
  
  const badges = (player.collected_badges || []).slice(0, 2).map((badgeId: string) => {
    return `<span class="leader-badge-small">${badgeEmojis[badgeId] || '⭐'}</span>`;
  }).join('');
  
  const winRate = player.total_battles && player.total_wins
    ? ((player.total_wins / player.total_battles) * 100).toFixed(0)
    : 0;
  
  const isYou = player.user_id === currentUserData?.id;
  
  return `
    <div class="leader-item ${isYou ? 'you' : ''}">
      <div class="left">
        <div class="rank">#${rank}</div>
        <img src="${player.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${player.username}`}" alt="${player.username}" class="leader-avatar-img" loading="lazy">
        <div class="info">
          <div class="name">
            ${player.username}
            ${isYou ? '<span class="you-tag-small">YOU</span>' : ''}
            ${badges ? `<div class="leader-badges-small">${badges}</div>` : ''}
          </div>
          <div class="wins">${player.total_wins} victories • ${winRate}% win rate</div>
          <div class="leader-progress-small">
            <div class="leader-progress-bar-small">
              <div class="leader-progress-fill-small" style="width: ${progress}%"></div>
            </div>
          </div>
        </div>
      </div>
      <span class="money">${typeConfig.format(value)}</span>
      
      <div class="leader-expanded-content">
        <div class="leader-expanded-stats">
          <div class="expanded-stat">
            <div class="expanded-stat-value">${player.total_battles || 0}</div>
            <div class="expanded-stat-label">Total Battles</div>
          </div>
          <div class="expanded-stat">
            <div class="expanded-stat-value">${player.level || 1}</div>
            <div class="expanded-stat-label">Level</div>
          </div>
          <div class="expanded-stat">
            <div class="expanded-stat-value">${(player.collected_badges || []).length}</div>
            <div class="expanded-stat-label">Badges</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// CARREGAR MAIS JOGADORES
// ============================================================

window.loadMorePlayers = async function() {
  if (isLoading || !hasMorePages) return;
  
  isLoading = true;
  const btn = document.querySelector('.load-more-btn');
  if (!btn) {
    isLoading = false;
    return;
  }
  const originalHTML = btn.innerHTML;
  const btnElement = btn as HTMLButtonElement;
  
  btnElement.innerHTML = `
    <span class="loading-spinner-small"></span>
    <span data-translate>Loading...</span>
  `;
  btnElement.disabled = true;
  
  currentPage++;
  
  await renderLeaderboard();
  
  btnElement.innerHTML = originalHTML;
  btnElement.disabled = false;
  isLoading = false;
};

async function getUserPositionForType(typeConfig: LeaderboardType, token: number): Promise<{ userRank: number; username: string; valueText: string } | null> {
  if (!currentUserData?.id) return null;
  if (token !== renderToken) return null;

  const cacheKey = `${currentLeaderboardType}:${currentUserData.id}`;
  const now = Date.now();
  const cached = userPositionCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  // 1) Buscar valor do usuário na categoria
  const { data: userRow, error: userError } = await supabase
    .from('player_stats')
    .select(`user_id, username, ${typeConfig.column}, role`)
    .eq('user_id', currentUserData!.id)
    .single();

  if (token !== renderToken) return null;
  if (userError || !userRow || (userRow as any).role === 'bot') return null;

  const userValue = (userRow as any)[typeConfig.column] ?? 0;

  // 2) Contar quantos usuários estão acima/abaixo (evita baixar a tabela inteira)
  let countQuery = supabase
    .from('player_stats')
    .select('*', { count: 'exact', head: true })
    .neq('role', 'bot');

  if (typeConfig.order === 'desc') {
    countQuery = countQuery.gt(typeConfig.column, userValue);
  } else {
    countQuery = countQuery.lt(typeConfig.column, userValue);
  }

  const { count, error: countError } = await countQuery;
  if (token !== renderToken) return null;
  if (countError) return null;

  const userRank = (count || 0) + 1;
  const valueText = typeConfig.format(userValue);

  const value: any = {
    userRank,
    username: (userRow as any).username,
    valueText
  };

  userPositionCache.set(cacheKey, {
    expiresAt: now + USER_POSITION_CACHE_MS,
    value
  });

  return value;
}

// ============================================================
// ATUALIZAR POSIÇÃO DO USUÁRIO
// ============================================================

async function updateUserPosition(typeConfig: LeaderboardType, token: number): Promise<void> {
  if (!currentUserData) return;
  
  try {
    const pos = await getUserPositionForType(typeConfig, token);
    if (!pos) return;
    if (token !== renderToken) return;

    const userRank = pos.userRank;
    
    // Verificar se está visível no top exibido
    const isVisible = userRank <= (currentPage + 1) * ITEMS_PER_PAGE;
    
    const overlay = document.getElementById('user-position-overlay');
    if (!overlay) return;
    
    if (!isVisible && userRank > 10) {
      // Mostrar overlay
      const rankEl = document.getElementById('user-rank');
      const nameEl = document.getElementById('user-position-name');
      const valueEl = document.getElementById('user-position-value');
      if (rankEl) rankEl.textContent = String(userRank);
      if (nameEl) nameEl.textContent = pos.username;
      if (valueEl) valueEl.textContent = pos.valueText;
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
    }
    
  } catch (err) {
    console.error('Error getting user position:', err);
  }
}

// ============================================================
// LEADERBOARD GERAL (MÉDIA DE TODAS AS POSIÇÕES)
// ============================================================

async function renderGeneralLeaderboard(token: number): Promise<void> {
  const listContainer = document.getElementById('leader-list');
  if (!listContainer) return;
  
  listContainer.innerHTML = `
    <div class="leaderboard-loading">
      <div class="loading-spinner"></div>
      <p data-translate>Calculating general rankings...</p>
    </div>
  `;
  
  try {
    // Buscar todos os jogadores
    const { data: allPlayers, error } = await supabase
      .from('player_stats')
      .select('username, money, total_wins, total_cases_opened, best_drop, total_spent, total_gains, total_battles, level, collected_badges, user_id, role, avatar_url')
      .neq('role', 'bot'); // ✅ FILTRAR BOTS

    if (token !== renderToken) return;
    
    if (error || !allPlayers) {
      if (listContainer) listContainer.innerHTML = `<p style="color: #ef4444;">Error loading data</p>`;
      return;
    }
    
    // Calcular rankings para cada categoria
    const rankMaps: Record<string, Map<string, number>> = {};
    
    Object.entries(LEADERBOARD_TYPES).forEach(([key, config]) => {
      if (config.isSpecial) return;
      
      const sorted = [...allPlayers].sort((a, b) => {
        const valA = Number((a as any)[config.column] || 0);
        const valB = Number((b as any)[config.column] || 0);
        return config.order === 'desc' ? valB - valA : valA - valB;
      });

      rankMaps[key] = new Map(sorted.map((p, i) => [p.user_id, i + 1]));
    });
    
    // Calcular média de posições para cada jogador
    const playerAverages = allPlayers.map(player => {
      const positions = Object.values(rankMaps).map((map: Map<string, number>) => map.get(player.user_id) ?? 999);
      
      const average = positions.reduce((sum, pos) => sum + pos, 0) / positions.length;
      
      return {
        ...player,
        averageRank: average,
        positions: positions
      };
    });
    
    // Ordenar por melhor média
    playerAverages.sort((a, b) => a.averageRank - b.averageRank);
    
    // Renderizar top 10
    const top10 = playerAverages.slice(0, 10);
    
    renderGeneralTop3(top10.slice(0, 3), rankMaps);
    renderGeneralList(top10.slice(3), 4, rankMaps);
    
    // Ocultar botão "Carregar Mais" no modo geral
    const loadMoreContainer = document.getElementById('load-more-container');
    if (loadMoreContainer) loadMoreContainer.classList.add('hidden');
    
    // Atualizar posição do usuário
    if (currentUserData) {
      const userIndex = playerAverages.findIndex(p => p.user_id === (currentUserData?.id || ''));
      if (userIndex !== -1 && userIndex >= 10) {
        const overlay = document.getElementById('user-position-overlay');
        if (overlay) {
          const rankEl = document.getElementById('user-rank');
          const nameEl = document.getElementById('user-position-name');
          const valueEl = document.getElementById('user-position-value');
          if (rankEl) rankEl.textContent = String(userIndex + 1);
          if (nameEl) nameEl.textContent = playerAverages[userIndex].username;
          if (valueEl) valueEl.textContent = `Avg: ${playerAverages[userIndex].averageRank.toFixed(1)}`;
          overlay.classList.remove('hidden');
        }
      }
    }
    
  } catch (err) {
    console.error('Error rendering general leaderboard:', err);
    if (listContainer) listContainer.innerHTML = `<p style="color: #ef4444;">Unexpected error</p>`;
  }
}

function renderGeneralTop3(players: PlayerData[], rankMaps: Record<string, Map<string, number>>): string {
  const listContainer = document.getElementById('leader-list') as HTMLElement | null;
  
  const podiumHTML = `
    <div class="leaderboard-podium">
      ${renderGeneralPodiumCard(players[1], 2, rankMaps, 'silver')}
      ${renderGeneralPodiumCard(players[0], 1, rankMaps, 'gold')}
      ${renderGeneralPodiumCard(players[2], 3, rankMaps, 'bronze')}
    </div>
  `;
  
  if (listContainer) {
    listContainer.innerHTML = podiumHTML;
  }
  
  return podiumHTML;
}

function renderGeneralPodiumCard(player: PlayerData, rank: number, rankMaps: Record<string, Map<string, number>>, medal: string): string {
  if (!player) return '<div></div>';
  
  const medalIcons: Record<string, string> = {
    gold: '<div class="podium-crown">👑</div>',
    silver: '<div class="podium-medal">🥈</div>',
    bronze: '<div class="podium-medal">🥉</div>'
  };
  
  const isYou = player.user_id === currentUserData?.id;
  
  // Mostrar posições em cada categoria
  const categoryPositions = Object.entries(LEADERBOARD_TYPES)
    .filter(([key, config]) => !config.isSpecial)
    .map(([key, config]) => {
      const map = rankMaps[key];
      const position = map?.get(player.user_id) ?? '-';
      
      return `
        <div class="podium-stat">
          <span class="podium-stat-label">${config.icon} ${config.name}</span>
          <span class="podium-stat-value">#${position}</span>
        </div>
      `;
    }).join('');
  
  return `
    <div class="podium-card ${medal} ${isYou ? 'you' : ''}">
      <div class="podium-rank">#${rank}</div>
      ${medalIcons[medal]}
      
      <img src="${player.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${player.username}`}" alt="${player.username}" class="podium-avatar-img" loading="lazy">
      
      <div class="podium-name">
        ${player.username}
        ${isYou ? '<span class="you-tag">YOU</span>' : ''}
      </div>
      
      <div class="podium-money">
        Avg: ${player.averageRank.toFixed(1)}
      </div>
      
      <div class="podium-stats">
        ${categoryPositions}
      </div>
    </div>
  `;
}

function renderGeneralList(players: PlayerData[], startRank: number, rankMaps: Record<string, Map<string, number>>): string {
  const listContainer = document.getElementById('leader-list');
  if (!listContainer) return '';
  
  const listHTML = `
    <div class="leaderboard-list">
      ${players.map((player, index) => {
        const rank = startRank + index;
        const isYou = player.user_id === currentUserData?.id;
        
        return `
          <div class="leader-item ${isYou ? 'you' : ''}">
            <div class="left">
              <div class="rank">#${rank}</div>
              <img src="${player.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${player.username}`}" alt="${player.username}" class="leader-avatar-img" loading="lazy">
              <div class="info">
                <div class="name">
                  ${player.username}
                  ${isYou ? '<span class="you-tag-small">YOU</span>' : ''}
                </div>
                <div class="wins">Average rank: ${player.averageRank.toFixed(1)}</div>
              </div>
            </div>
            <span class="money">⭐ ${player.averageRank.toFixed(1)}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
  
  listContainer.innerHTML += listHTML;
  return listHTML;
}

// ============================================================
// EXPORTS GLOBAIS
// ============================================================
(window as any).initLeaderboard = initLeaderboard;
(window as any).renderLeaderboard = renderLeaderboard;
