// ============================================================
// FRIENDS.JS - Friend graph UI + interactions
// ============================================================

import { supabase } from './auth';
import { addCsrfHeader } from '../core/session';
import { showToast } from '../shared/effects';
import { navigateTo } from '../core/router';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

interface User {
  id: string;
  username?: string;
  avatar_url?: string;
}

interface FriendItem {
  user_id: string;
  username?: string;
  avatar_url?: string;
  created_at?: string;
}

interface FriendState {
  friends: FriendItem[];
  incoming: FriendItem[];
  outgoing: FriendItem[];
}

interface ProfileData {
  user_id: string;
  username: string;
  avatar_url?: string;
  level?: number;
  [key: string]: any;
}

interface SearchResult {
  user_id: string;
  username: string;
  avatar_url?: string;
  level?: number;
}

declare global {
  interface Window {
    publicProfileUsername?: string;
    refreshLucideIcons?: () => void;
    initializeFriends: typeof initializeFriends;
    cleanupFriends: typeof cleanupFriends;
    openFriendsPanel: typeof openFriendsPanel;
    closeFriendsPanel: typeof closeFriendsPanel;
    requestFriendFromContext: typeof requestFriendFromContext;
    syncPublicProfileFriendButton: typeof syncPublicProfileFriendButton;
  }
}

// ============================================================
// STATE
// ============================================================
let currentUser: User | null = null;
let friendState: FriendState = { friends: [], incoming: [], outgoing: [] };
let profileCache: Map<string, ProfileData> = new Map();
let panelBound: boolean = false;
let isPanelOpen: boolean = false;
let activeTab: string = 'friends';
let notificationsPopoverBound: boolean = false;
let publicProfileTarget: User | null = null;

// Elements
let friendsPanelEl: HTMLElement | null = null;
let friendsBtnEl: HTMLElement | null = null;
let notificationsBtnEl: HTMLElement | null = null;
let friendsListEl: HTMLElement | null = null;
let incomingListEl: HTMLElement | null = null;
let outgoingListEl: HTMLElement | null = null;
let searchInputEl: HTMLInputElement | null = null;
let searchResultsEl: HTMLElement | null = null;
let notificationsPopoverEl: HTMLElement | null = null;
let notificationsListEl: HTMLElement | null = null;
let notificationsLinkBtn: HTMLElement | null = null;
let tabButtons: HTMLElement[] | null = null;

const EMPTY_STATE: FriendState = { friends: [], incoming: [], outgoing: [] };

// ============================================================
// HELPERS
// ============================================================
function getSessionToken(): Promise<string | null> {
  return supabase.auth.getSession().then(({ data }) => data?.session?.access_token || null);
}

function normalizeState(raw: any): FriendState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE };
  const safe = (arr: any[]): any[] => Array.isArray(arr) ? arr.filter((x: any) => x && x.user_id) : [];
  return {
    friends: safe(raw.friends),
    incoming: safe(raw.incoming),
    outgoing: safe(raw.outgoing)
  };
}

function relationTo(userId: string): 'friend' | 'incoming' | 'outgoing' | 'none' {
  if (!userId) return 'none';
  if (friendState.friends.some((f) => f.user_id === userId)) return 'friend';
  if (friendState.incoming.some((f) => f.user_id === userId)) return 'incoming';
  if (friendState.outgoing.some((f) => f.user_id === userId)) return 'outgoing';
  return 'none';
}

function ensureEls(): void {
  friendsPanelEl ||= document.getElementById('friends-panel');
  friendsBtnEl ||= document.getElementById('friends-toggle-icon');
  notificationsBtnEl ||= document.getElementById('notifications-toggle-icon');
  friendsListEl ||= document.getElementById('friends-list');
  incomingListEl ||= document.getElementById('friends-incoming');
  outgoingListEl ||= document.getElementById('friends-outgoing');
  searchInputEl = (searchInputEl || document.getElementById('friend-search-input')) as HTMLInputElement | null;
  searchResultsEl ||= document.getElementById('friend-search-results');
  notificationsPopoverEl ||= document.getElementById('notifications-popover');
  notificationsListEl ||= document.getElementById('notification-items');
  notificationsLinkBtn ||= document.getElementById('notifications-open-requests');
  tabButtons ||= Array.from(document.querySelectorAll('[data-friends-tab]'));
}

function openPublicProfile(username: string): void {
  const target = (username || '').trim();
  if (!target) return;
  // Keep chat/friends overlays closed before routing to a profile
  closeFriendsPanel();
  closeChatIfOpen();
  window.publicProfileUsername = target;
  navigateTo(`/u/${encodeURIComponent(target)}`);
}

function closeChatIfOpen(): void {
  const chatPanel = document.getElementById('chat-panel');
  const chatBtn = document.getElementById('chat-toggle-icon');
  if (chatPanel) chatPanel.classList.remove('active');
  if (chatBtn) {
    chatBtn.classList.remove('active');
    const currentCount = document.getElementById('chat-online-count');
    const countText = currentCount ? currentCount.textContent : '0';
    if (typeof window.setChatToggleIcon === 'function') {
      window.setChatToggleIcon({ count: countText, icon: 'messages-square', showCount: true });
    } else {
      chatBtn.innerHTML = `<span class="header-icon" data-lucide="messages-square"></span><span class="chat-online-count" id="chat-online-count">${countText}</span>`;
      if (typeof window.refreshLucideIcons === 'function') {
        window.refreshLucideIcons();
      }
    }
  }
  document.body.classList.remove('chat-open-mobile');
}

async function callFriendsApi(action: string, payload: Record<string, any> = {}): Promise<any> {
  if (!currentUser?.id) throw new Error('Not authenticated');
  const token = await getSessionToken();
  if (!token) throw new Error('Not authenticated');

  const response = await fetch('/api/profile', {
    method: 'POST',
    headers: await addCsrfHeader({
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({
      action,
      userId: currentUser.id,
      authToken: token,
      ...payload
    })
  });

  let data = {};
  try {
    data = await response.json();
  } catch (_) {
    // ignore
  }

  if (!response.ok) {
    throw new Error((data as any)?.error || 'Request failed');
  }

  return data;
}

function setState(nextState: any, profiles: Record<string, ProfileData> = {}): void {
  friendState = normalizeState(nextState);
  profileCache = new Map(Object.entries(profiles || {}));
  renderAll();
}

// ============================================================
// RENDERING
// ============================================================
function renderAll(): void {
  ensureEls();
  renderFriendsList();
  renderIncoming();
  renderOutgoing();
  renderBadges();
  renderNotificationsPopover();
  updatePublicProfileCta();
}

function renderFriendsList(): void {
  if (!friendsListEl) return;
  friendsListEl.innerHTML = '';
  if (!friendState.friends.length) {
    friendsListEl.innerHTML = '<div class="friends-empty">No friends yet. Search to add someone!</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  friendState.friends.forEach((f) => {
    const profile = (profileCache.get(f.user_id) || {}) as any;
    const item = document.createElement('div');
    item.className = 'friend-item';
    item.innerHTML = `
      <div class="friend-meta">
        <img src="${profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(f.username || '')}`}" alt="${f.username}" class="friend-avatar" style="cursor:pointer;">
        <div>
          <div class="friend-name">${f.username}</div>
          <div class="friend-sub">Lv ${profile.level || 1}</div>
        </div>
      </div>
      <div class="friend-actions">
        <button class="friend-danger" data-action="remove">Remove</button>
      </div>
    `;

    // Abrir perfil público ao clicar no avatar ou no bloco meta
    const navigateToProfile = () => openPublicProfile(f.username || '');
    const avatarEl = item.querySelector('.friend-avatar');
    const metaEl = item.querySelector('.friend-meta');
    avatarEl?.addEventListener('click', navigateToProfile);
    metaEl?.addEventListener('click', (e) => {
      // Evitar conflito com botões
      if (!(e.target instanceof Element) || e.target.closest('.friend-actions')) return;
      navigateToProfile();
    });

    const removeBtn = item.querySelector('[data-action="remove"]') as HTMLElement | null;
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        try {
          await callFriendsApi('removeFriend', { targetUserId: f.user_id });
          await refreshState();
          showToast('info', `Removed ${f.username}`);
        } catch (err) {
          showToast('error', ((err as any)?.message || 'Failed to remove friend'));
        }
      });
    }

    fragment.appendChild(item);
  });

  friendsListEl.appendChild(fragment);
}

function renderIncoming(): void {
  if (!incomingListEl) return;
  incomingListEl.innerHTML = '';
  if (!friendState.incoming.length) {
    incomingListEl.innerHTML = '<div class="friends-empty">No pending requests</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  friendState.incoming.forEach((f) => {
    const profile = (profileCache.get(f.user_id) || {}) as any;
    const item = document.createElement('div');
    item.className = 'friend-item';
    item.innerHTML = `
      <div class="friend-meta">
        <img src="${profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(f.username || '')}`}" alt="${f.username}" class="friend-avatar" style="cursor:pointer;">
        <div>
          <div class="friend-name">${f.username}</div>
          <div class="friend-sub">Lv ${profile.level || 1}</div>
        </div>
      </div>
      <div class="friend-actions">
        <button class="friend-primary" data-action="accept">Accept</button>
        <button class="friend-secondary" data-action="reject">Decline</button>
      </div>
    `;

    // Clique no avatar/meta abre perfil público
    const go = () => openPublicProfile(f.username || '');
    item.querySelector('.friend-avatar')?.addEventListener('click', go);
    item.querySelector('.friend-meta')?.addEventListener('click', (e) => {
      if (!(e.target instanceof Element) || e.target.closest('.friend-actions')) return;
      go();
    });

    const acceptBtn = item.querySelector('[data-action="accept"]') as HTMLElement | null;
    if (acceptBtn) {
      acceptBtn.addEventListener('click', async () => {
        try {
          await callFriendsApi('acceptRequest', { fromUserId: f.user_id });
          await refreshState();
          showToast('success', `Accepted ${f.username}`);
        } catch (err) {
          showToast('error', ((err as any)?.message || 'Failed to accept'));
        }
      });
    }

    const rejectBtn = item.querySelector('[data-action="reject"]') as HTMLElement | null;
    if (rejectBtn) {
      rejectBtn.addEventListener('click', async () => {
        try {
          await callFriendsApi('rejectRequest', { fromUserId: f.user_id });
          await refreshState();
          showToast('info', `Declined ${f.username}`);
        } catch (err) {
          showToast('error', ((err as any)?.message || 'Failed to decline'));
        }
      });
    }

    frag.appendChild(item);
  });

  incomingListEl.appendChild(frag);
}

function renderOutgoing(): void {
  if (!outgoingListEl) return;
  outgoingListEl.innerHTML = '';
  if (!friendState.outgoing.length) {
    outgoingListEl.innerHTML = '<div class="friends-empty">No sent requests</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  friendState.outgoing.forEach((f) => {
    const profile = (profileCache.get(f.user_id) || {}) as any;
    const item = document.createElement('div');
    item.className = 'friend-item';
    item.innerHTML = `
      <div class="friend-meta">
        <img src="${profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(f.username || '')}`}" alt="${f.username}" class="friend-avatar" style="cursor:pointer;">
        <div>
          <div class="friend-name">${f.username}</div>
          <div class="friend-sub">Lv ${profile.level || 1}</div>
        </div>
      </div>
      <div class="friend-actions">
        <button class="friend-secondary" data-action="cancel">Cancel</button>
      </div>
    `;

    // Clique no avatar/meta abre perfil público
    const go = () => openPublicProfile(f.username || '');
    item.querySelector('.friend-avatar')?.addEventListener('click', go);
    item.querySelector('.friend-meta')?.addEventListener('click', (e) => {
      if (!(e.target instanceof Element) || e.target.closest('.friend-actions')) return;
      go();
    });

    const cancelBtn = item.querySelector('[data-action="cancel"]') as HTMLElement | null;
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        try {
          await callFriendsApi('cancelRequest', { targetUserId: f.user_id });
          await refreshState();
          showToast('info', `Cancelled request to ${f.username}`);
        } catch (err) {
          showToast('error', ((err as any)?.message || 'Failed to cancel'));
        }
      });
    }

    frag.appendChild(item);
  });

  outgoingListEl.appendChild(frag);
}

function renderSearchResults(results: SearchResult[] = []): void {
  if (!searchResultsEl) return;
  searchResultsEl.innerHTML = '';
  if (!results.length) {
    searchResultsEl.innerHTML = '<div class="friends-empty">No users found</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  results.forEach((r) => {
    const rel = relationTo(r.user_id);
    const item = document.createElement('div');
    item.className = 'friend-item';
    item.innerHTML = `
      <div class="friend-meta">
        <img src="${r.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(r.username)}`}" alt="${r.username}" class="friend-avatar" style="cursor:pointer;">
        <div>
          <div class="friend-name">${r.username}</div>
          <div class="friend-sub">Lv ${r.level || 1}</div>
        </div>
      </div>
      <div class="friend-actions" data-status="${rel}"></div>
    `;

    // Avatar/meta abre perfil público
    const go = () => openPublicProfile(r.username);
    item.querySelector('.friend-avatar')?.addEventListener('click', go);
    item.querySelector('.friend-meta')?.addEventListener('click', (e) => {
      if (!(e.target instanceof Element) || e.target.closest('.friend-actions')) return;
      go();
    });

    const actions = item.querySelector('.friend-actions') as HTMLElement | null;
    if (rel === 'friend') {
      if (actions) actions.innerHTML = '<span class="friend-pill">Friends</span>';
    } else if (rel === 'outgoing') {
      const btn = document.createElement('button');
      btn.className = 'friend-secondary';
      btn.textContent = 'Pending';
      (btn as HTMLButtonElement).disabled = true;
      if (actions) actions.appendChild(btn);
    } else if (rel === 'incoming') {
      const accept = document.createElement('button');
      accept.className = 'friend-primary';
      accept.textContent = 'Accept';
      accept.addEventListener('click', async () => {
        try {
          await callFriendsApi('acceptRequest', { fromUserId: r.user_id });
          await refreshState();
          showToast('success', `Accepted ${r.username}`);
        } catch (err) {
          showToast('error', ((err as any)?.message || 'Failed'));
        }
      });
      const decline = document.createElement('button');
      decline.className = 'friend-secondary';
      decline.textContent = 'Decline';
      decline.addEventListener('click', async () => {
        try {
          await callFriendsApi('rejectRequest', { fromUserId: r.user_id });
          await refreshState();
          showToast('info', `Declined ${r.username}`);
        } catch (err) {
          showToast('error', ((err as any)?.message || 'Failed'));
        }
      });
      if (actions) {
        actions.appendChild(accept);
        actions.appendChild(decline);
      }
    } else {
      const addBtn = document.createElement('button');
      addBtn.className = 'friend-primary';
      addBtn.textContent = 'Add';
      addBtn.addEventListener('click', async () => {
        await requestFriend(r.user_id, r.username);
      });
      if (actions) actions.appendChild(addBtn);
    }

    frag.appendChild(item);
  });

  searchResultsEl.appendChild(frag);
}

function renderBadges(): void {
  ensureEls();
  const pendingCount = friendState.incoming.length;
  const friendCount = friendState.friends.length;

  const friendBadge = document.getElementById('friends-count-badge');
  if (friendBadge) {
    friendBadge.textContent = String(Math.min(friendCount, 99));
    friendBadge.style.display = friendCount > 0 ? 'flex' : 'none';
  }

  const notifBadge = document.getElementById('notifications-count');
  if (notifBadge) {
    notifBadge.textContent = String(Math.min(pendingCount, 99));
    notifBadge.style.display = pendingCount > 0 ? 'flex' : 'none';
  }
}

function renderNotificationsPopover(): void {
  ensureEls();
  if (!notificationsPopoverEl || !notificationsListEl) return;
  notificationsListEl.innerHTML = '';

  if (!friendState.incoming.length) {
    notificationsListEl.innerHTML = '<div class="friends-empty">No notifications</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  friendState.incoming.slice(0, 5).forEach((f) => {
    const profile = (profileCache.get(f.user_id) || {}) as any;
    const item = document.createElement('div');
    item.className = 'notification-item';
    item.innerHTML = `
      <div class="friend-meta">
        <img src="${profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(f.username || '')}`}" alt="${f.username}" class="friend-avatar">
        <div>
          <div class="friend-name">${f.username}</div>
          <div class="friend-sub">Friend request</div>
        </div>
      </div>
      <div class="friend-actions">
        <button class="friend-primary" data-action="accept">Accept</button>
        <button class="friend-secondary" data-action="reject">Reject</button>
      </div>
    `;

    const acceptBtn = item.querySelector('[data-action="accept"]') as HTMLElement | null;
    if (acceptBtn) {
      acceptBtn.addEventListener('click', async () => {
        try {
          await callFriendsApi('acceptRequest', { fromUserId: f.user_id });
          await refreshState();
          showToast('success', `Accepted ${f.username}`);
        } catch (err) {
          showToast('error', ((err as any)?.message || 'Failed'));
        }
      });
    }

    const rejectBtn = item.querySelector('[data-action="reject"]') as HTMLElement | null;
    if (rejectBtn) {
      rejectBtn.addEventListener('click', async () => {
        try {
          await callFriendsApi('rejectRequest', { fromUserId: f.user_id });
          await refreshState();
          showToast('info', `Declined ${f.username}`);
        } catch (err) {
          showToast('error', ((err as any)?.message || 'Failed'));
        }
      });
    }

    frag.appendChild(item);
  });

  notificationsListEl.appendChild(frag);
}

function updatePublicProfileCta(): void {
  const btn = document.getElementById('public-profile-add-friend') as HTMLButtonElement | null;
  if (!btn) return;
  const userTarget = publicProfileTarget as any;
  if (!publicProfileTarget || !userTarget?.user_id) {
    btn.style.display = 'none';
    return;
  }

  btn.style.display = 'inline-flex';

  if (!currentUser?.id) {
    btn.textContent = 'Login to add';
    btn.disabled = true;
    return;
  }

  const rel = relationTo(userTarget.user_id);
  btn.disabled = false;

  if (rel === 'friend') {
    btn.textContent = 'Remove friend';
    btn.onclick = async () => {
      try {
        const userTarget = publicProfileTarget as any;
        await callFriendsApi('removeFriend', { targetUserId: userTarget?.user_id });
        await refreshState();
        showToast('info', `Removed ${publicProfileTarget?.username}`);
      } catch (err) {
        showToast('error', ((err as any)?.message || 'Failed to remove'));
      }
    };
  } else if (rel === 'outgoing') {
    btn.textContent = 'Request sent';
    btn.disabled = true;
  } else if (rel === 'incoming') {
    btn.textContent = 'Accept request';
    btn.onclick = async () => {
      try {
        const userTarget = publicProfileTarget as any;
        await callFriendsApi('acceptRequest', { fromUserId: userTarget?.user_id });
        await refreshState();
        showToast('success', `Accepted ${publicProfileTarget?.username}`);
      } catch (err) {
        showToast('error', ((err as any)?.message || 'Failed'));
      }
    };
  } else {
    btn.textContent = 'Add friend';
    btn.onclick = async () => {
      const userTarget = publicProfileTarget as any;
      await requestFriend(userTarget?.user_id, publicProfileTarget?.username || '');
    };
  }
}

// ============================================================
// ACTIONS
// ============================================================
async function refreshState(): Promise<void> {
  try {
    const data = await callFriendsApi('fetchState');
    setState(data.state, data.profiles);
  } catch (err) {
    console.error('Friends refresh failed:', err);
    showToast('error', ((err as any)?.message || 'Failed to load friends'));
  }
}

async function requestFriend(targetUserId: string, targetUsername: string): Promise<void> {
  try {
    await callFriendsApi('sendRequest', { targetUserId, targetUsername });
    await refreshState();
    showToast('success', `Request sent to ${targetUsername || 'player'}`);
  } catch (err) {
    showToast('error', ((err as any)?.message || 'Failed to send request'));
  }
}

async function searchUsers(query: string): Promise<void> {
  try {
    const data = await callFriendsApi('searchUsers', { query });
    renderSearchResults(data.results || []);
  } catch (err) {
    showToast('error', ((err as any)?.message || 'Search failed'));
  }
}

// ============================================================
// UI BINDINGS
// ============================================================
function switchTab(tab: string): void {
  activeTab = tab;
  const panels = document.querySelectorAll('[data-friends-section]');
  panels.forEach((p) => {
    const isTarget = (p as HTMLElement).dataset.friendsSection === tab;
    p.classList.toggle('hidden', !isTarget);
  });
  tabButtons?.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.friendsTab === tab);
  });
}

function toggleFriendsPanel(tab: string = 'friends'): void {
  ensureEls();
  if (!friendsPanelEl) return;
  const willOpen = !isPanelOpen;
  isPanelOpen = willOpen;

  friendsPanelEl.classList.toggle('active', willOpen);
  if (friendsBtnEl) friendsBtnEl.classList.toggle('active', willOpen);
  
  // ✅ Controlar scroll no mobile
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    document.body.classList.toggle('friends-open-mobile', willOpen);
  }
  
  if (willOpen) {
    closeChatIfOpen();
    switchTab(tab);
  }
}

// Fecha o painel de amigos sem resetar estado/render
function closeFriendsPanel(): void {
  ensureEls();
  isPanelOpen = false;
  if (friendsPanelEl) friendsPanelEl.classList.remove('active');
  if (friendsBtnEl) friendsBtnEl.classList.remove('active');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    document.body.classList.remove('friends-open-mobile');
  }
}

function toggleNotificationsPopover(): void {
  ensureEls();
  if (!notificationsPopoverEl) return;
  const willShow = notificationsPopoverEl.classList.contains('hidden');
  notificationsPopoverEl.classList.toggle('hidden', !willShow);
  if (willShow) {
    renderNotificationsPopover();
  }
}

function bindDomOnce(): void {
  if (panelBound) return;
  ensureEls();
  panelBound = true;

  friendsBtnEl?.addEventListener('click', () => {
    void openFriendsPanel('friends');
  });

  document.getElementById('friends-close-btn')?.addEventListener('click', () => {
    isPanelOpen = false;
    friendsPanelEl?.classList.remove('active');
    friendsBtnEl?.classList.remove('active');
    
    // ✅ Liberar scroll no mobile
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      document.body.classList.remove('friends-open-mobile');
    }
  });

  tabButtons?.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.friendsTab || 'friends'));
  });

  searchInputEl?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const q = searchInputEl?.value.trim() || '';
      if (q.length >= 2) searchUsers(q);
    }
  });

  document.getElementById('friend-search-btn')?.addEventListener('click', () => {
    const q = searchInputEl?.value?.trim() || '';
    if (q.length < 2) {
      showToast('info', 'Type at least 2 characters');
      return;
    }
    searchUsers(q);
  });

  notificationsBtnEl?.addEventListener('click', () => {
    toggleNotificationsPopover();
  });

  if (!notificationsPopoverBound) {
    notificationsPopoverBound = true;
    document.addEventListener('click', (e) => {
      if (!notificationsPopoverEl || notificationsPopoverEl.classList.contains('hidden')) return;
      const isInside = notificationsPopoverEl.contains(e.target as Node | null);
      const isBtn = notificationsBtnEl && notificationsBtnEl.contains(e.target as Node | null);
      if (!isInside && !isBtn) {
        notificationsPopoverEl.classList.add('hidden');
      }
    });
  }

  notificationsLinkBtn?.addEventListener('click', () => {
    notificationsPopoverEl?.classList.add('hidden');
    toggleFriendsPanel('requests');
  });

  // Prevenir abertura acidental no resize
  let resizeTimeout: NodeJS.Timeout | null = null;
  window.addEventListener('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (!isPanelOpen && friendsPanelEl) {
        friendsPanelEl.classList.remove('active');
        if (friendsBtnEl) friendsBtnEl.classList.remove('active');
        document.body.classList.remove('friends-open-mobile');
      }
    }, 100);
  });
}

// ============================================================
// PUBLIC API
// ============================================================
export async function initializeFriends(user: User): Promise<void> {
  currentUser = user;
  bindDomOnce();
  await refreshState();
}

export function cleanupFriends(): void {
  friendState = { ...EMPTY_STATE };
  profileCache = new Map();
  publicProfileTarget = null;
  renderAll();
  isPanelOpen = false;
  if (friendsPanelEl) friendsPanelEl.classList.remove('active');
  friendsBtnEl?.classList.remove('active');
  document.body.classList.remove('friends-open-mobile');
}

export async function openFriendsPanel(tab: string = 'friends'): Promise<void> {
  await refreshState();
  ensureEls();
  isPanelOpen = true;
  if (friendsPanelEl) friendsPanelEl.classList.add('active');
  if (friendsBtnEl) friendsBtnEl.classList.add('active');
  
  // ✅ Bloquear scroll no mobile
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    document.body.classList.add('friends-open-mobile');
  }
  
  closeChatIfOpen();
  switchTab(tab);
}

export async function requestFriendFromContext({ userId, username }: { userId: string; username: string }): Promise<void> {
  await requestFriend(userId, username);
}

export function syncPublicProfileFriendButton(targetUser: User): void {
  publicProfileTarget = targetUser;
  updatePublicProfileCta();
}

// Expose globals for inline handlers
if (typeof window !== 'undefined') {
  window.initializeFriends = initializeFriends;
  window.cleanupFriends = cleanupFriends;
  window.openFriendsPanel = openFriendsPanel;
  window.closeFriendsPanel = closeFriendsPanel;
  window.requestFriendFromContext = requestFriendFromContext;
  window.syncPublicProfileFriendButton = syncPublicProfileFriendButton;
}
