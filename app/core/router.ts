// @ts-nocheck
// ============================================================
// ROUTER.TS - Sistema de Rotas com History API + Redux (TypeScript)
// ============================================================

import { store, routerActions } from './store.js';
import { loadRouteData } from './route-loader.js';
import { getActiveUser, setActiveUser } from './session.js';

// ============================================================
// TYPES
// ============================================================

interface RouteConfig {
  path: string;
  screen: string;
  title: string;
  requiresAuth: boolean;
  publicProfileUsername?: string;
}

interface RouteChangeOptions {
  reason?: string;
  force?: boolean;
}

interface WindowWithRouter extends Window {
  goTo?: (screenName: string) => void;
  stopShopPolling?: () => void;
  stopAdminPolling?: () => void;
  stopRoomPolling?: () => void;
  publicProfileUsername?: string;
  currentUser?: any;
  navigateTo?: (path: string) => void;
  routerGoTo?: (screenName: string) => void;
  checkRouteAuth?: () => void;
}

// ============================================================
// INTERNAL STATE
// ============================================================

let lastHandledPath: string | null = null;
let activeScreenId: string | null = null;
let routeChangeSeq = 0;
let routerInitialized = false;
let popstateBound = false;

// ============================================================
// ROUTE CONFIGURATION
// ============================================================

/**
 * Configuração das rotas da aplicação
 */
export const routes: RouteConfig[] = [
  {
    path: '/',
    screen: 'menu',
    title: 'Menu',
    requiresAuth: true,
  },
  {
    path: '/auth',
    screen: 'auth-screen',
    title: 'Login',
    requiresAuth: false,
  },
  {
    path: '/case-opening',
    screen: 'case-opening',
    title: 'Cases',
    requiresAuth: true,
  },
  {
    path: '/inventory',
    screen: 'inventory',
    title: 'Inventory',
    requiresAuth: true,
  },
  {
    path: '/leaderboard',
    screen: 'leaderboard',
    title: 'Leaderboard',
    requiresAuth: true,
  },
  {
    path: '/profile',
    screen: 'profile',
    title: 'Profile',
    requiresAuth: true,
  },
  {
    path: '/settings',
    screen: 'settings',
    title: 'Settings',
    requiresAuth: true,
  },
  {
    path: '/shop',
    screen: 'shop',
    title: 'Shop',
    requiresAuth: true,
  },
  {
    path: '/skill-tree',
    screen: 'skill-tree',
    title: 'Skill Tree',
    requiresAuth: true,
  },
  {
    path: '/referrals',
    screen: 'referrals',
    title: 'Referrals',
    requiresAuth: true,
  },
  {
    path: '/legal',
    screen: 'legal',
    title: 'Legal',
    requiresAuth: false,
  },
  {
    path: '/admin',
    screen: 'admin',
    title: 'Admin',
    requiresAuth: true,
  },
];

const routeByPath = new Map<string, RouteConfig>(routes.map((r) => [r.path, r]));

// Mapa de telas para paths (reverse lookup)
const screenToPath: Record<string, string> = {};
routes.forEach((route) => {
  screenToPath[route.screen] = route.path;
});

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function normalizeScreenName(screenName: string): string {
  // Backward-compatible aliases
  if (screenName === 'home') return 'menu';
  return screenName;
}

function stopAllPollings(): void {
  try {
    const win = window as WindowWithRouter;
    if (win.stopShopPolling) win.stopShopPolling();
    if (win.stopAdminPolling) win.stopAdminPolling();
    if (win.stopRoomPolling) win.stopRoomPolling();
  } catch (e) {
    // non-fatal
  }
}

function showScreen(screenId: string): void {
  const targetScreen = document.getElementById(screenId);
  if (!targetScreen) {
    console.warn(`⚠️ Tela não encontrada: ${screenId}`);
    return;
  }

  // Esconder todas as screens
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  targetScreen.classList.add('active');

  // Controlar visibilidade do header
  const header = document.getElementById('header');
  if (header) {
    if (screenId === 'auth-screen') header.classList.add('hidden');
    else header.classList.remove('hidden');
  }

  // Controlar visibilidade do footer
  const footer = document.getElementById('site-footer');
  if (footer) {
    if (screenId === 'auth-screen') footer.classList.add('hidden');
    else footer.classList.remove('hidden');
  }

  // Controlar visibilidade do link Support no footer (apenas para autenticados)
  const footerSupportLink = document.getElementById('footer-support-link');
  if (footerSupportLink) {
    const isLoggedIn = isUserLoggedIn();
    if (isLoggedIn) {
      footerSupportLink.style.display = 'inline';
    } else {
      footerSupportLink.style.display = 'none';
    }
  }
}

/**
 * Verifica se há usuário logado
 */
function isUserLoggedIn(): boolean {
  // Se já temos user, está logado.
  const user = getActiveUser({ sync: true, allowStored: true });
  if (user && user.id) return true;

  // Verificar token do Supabase
  let supabaseToken: string | null = null;
  try {
    supabaseToken = localStorage.getItem('sb-auth-token');
  } catch (e) {
    supabaseToken = null;
  }
  if (supabaseToken) {
    try {
      const tokenData = JSON.parse(supabaseToken);
      return tokenData && tokenData.access_token;
    } catch (e) {
      return false;
    }
  }

  return false;
}

// ============================================================
// PUBLIC FUNCTIONS
// ============================================================

/**
 * Navegação entre páginas usando History API
 */
export function navigateTo(path: string): void {
  window.history.pushState({}, '', path);
  handleRouteChange({ reason: 'navigateTo' });
}

/**
 * Obtém o path atual
 */
export function getCurrentPath(): string {
  return window.location.pathname;
}

/**
 * Inicializa o sistema de rotas
 */
export function initRouter(): void {
  if (routerInitialized) {
    // Idempotente: evita múltiplos listeners e re-overrides
    return;
  }
  routerInitialized = true;

  // Se não há path na URL ou é apenas '/', definir baseado em autenticação
  // Mas apenas na primeira carga (não em reloads com F5)
  const currentPath = window.location.pathname;
  const isRootPath = currentPath === '' || currentPath === '/';

  if (isRootPath) {
    const isLoggedIn = isUserLoggedIn();
    const initialPath = isLoggedIn ? '/' : '/auth';

    // Usar replaceState para não adicionar ao histórico
    if (window.location.pathname !== initialPath) {
      window.history.replaceState({}, '', initialPath);
    }
  }

  // Listener para mudanças de URL (botão voltar/avançar)
  if (!popstateBound) {
    popstateBound = true;
    window.addEventListener('popstate', () => {
      handleRouteChange({ reason: 'popstate', force: true });
    });
  }

  // Handler inicial
  handleRouteChange({ reason: 'init' });

  // Interceptar goTo: no plano A, clique só navega; loading vem do handler de rota.
  const win = window as WindowWithRouter;
  if (!win.goTo || !(win.goTo as any)._routerIntercepted) {
    win.goTo = function (screenName: string) {
      const normalized = normalizeScreenName(screenName);
      const path = screenToPath[normalized] || '/';

      if (window.location.pathname === path) return;
      window.history.pushState({}, '', path);
      handleRouteChange({ reason: 'goTo' });
    };
    (win.goTo as any)._routerIntercepted = true;
  }
}

/**
 * Função de navegação compatível com o código existente
 * Agora é apenas um wrapper para goTo
 */
export function goTo(screenName: string): void {
  const win = window as WindowWithRouter;
  if (win.goTo) {
    win.goTo(screenName);
  }
}

// ============================================================
// PRIVATE ROUTE CHANGE HANDLER
// ============================================================

/**
 * Manipula mudanças de rota
 */
async function handleRouteChange(options: RouteChangeOptions = {}): Promise<void> {
  let path = window.location.pathname || '/';
  const force = Boolean(options.force);
  const reason = options.reason || 'route';

  const seq = ++routeChangeSeq;

  if (!force && path === lastHandledPath) {
    return;
  }
  lastHandledPath = path;

  // Dynamic public profile: /u/:username
  let publicProfileUsername: string | null = null;
  if (path.startsWith('/u/')) {
    publicProfileUsername = decodeURIComponent(path.slice(3));
  }

  let route = routeByPath.get(path);

  if (!route) {
    if (publicProfileUsername) {
      route = {
        path,
        screen: 'profile',
        title: 'Profile',
        requiresAuth: false,
        publicProfileUsername,
      };
    } else {
      route = routes[0];
    }
  }

  const loggedIn = isUserLoggedIn();

  // Verificar se a rota requer autenticação
  if (route.requiresAuth && !loggedIn) {
    // Redirecionar para auth
    window.history.replaceState({}, '', '/auth');
    route = routeByPath.get('/auth')!;
    path = '/auth';
    lastHandledPath = path;
  }

  // Se está na tela de auth e já está logado, redirecionar para menu
  if (route.path === '/auth' && loggedIn) {
    window.history.replaceState({}, '', '/');
    route = routes[0];
    path = '/';
    lastHandledPath = path;
  }

  // Atualizar Redux store
  store.dispatch(
    routerActions.setRoute({
      path: route.path,
      screen: route.screen,
    })
  );

  // Atualizar título da página
  document.title = `${route.title} - Loot Skirmish`;

  // Trocar tela (e parar pollings antigos) apenas se mudou de screen
  if (activeScreenId !== route.screen) {
    stopAllPollings();
    showScreen(route.screen);
    activeScreenId = route.screen;
  }

  // Carregar dados: sempre via mudança de rota (plano A)
  if (route.requiresAuth || publicProfileUsername) {
    // Só carregar dados quando existir um user real.
    // Se houver apenas token (restaurando sessão), evitamos load prematuro.
    const activeUser = getActiveUser({ sync: true, allowStored: true });
    if (publicProfileUsername) {
      (window as WindowWithRouter).publicProfileUsername = publicProfileUsername;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (seq !== routeChangeSeq) return;
      await loadRouteData(route.screen);
    } else if (activeUser && activeUser.id) {
      if (!(window as WindowWithRouter).currentUser) {
        setActiveUser(activeUser, { persist: false });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (seq !== routeChangeSeq) return;
      await loadRouteData(route.screen);
    }
  }
}

// ============================================================
// GLOBAL EXPORTS
// ============================================================

if (typeof window !== 'undefined') {
  const win = window as WindowWithRouter;
  win.navigateTo = navigateTo;
  win.routerGoTo = goTo;
  win.checkRouteAuth = () => handleRouteChange({ reason: 'checkRouteAuth', force: true });
}
