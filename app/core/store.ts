// ============================================================
// STORE.TS - Redux Store com Redux Toolkit (TypeScript)
// ============================================================

import { configureStore, createSlice, PayloadAction } from '@reduxjs/toolkit';

// ============================================================
// TYPES
// ============================================================

interface User {
  id: string;
  username?: string;
  email?: string;
  [key: string]: unknown;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface RouterState {
  currentPath: string;
  currentScreen: string;
  previousPath: string | null;
}

interface DataItem {
  [key: string]: unknown;
}

interface LoadingData<T> {
  data: T;
  isLoaded: boolean;
  isLoading: boolean;
}

interface DataState {
  inventory: LoadingData<DataItem[]>;
  leaderboard: LoadingData<DataItem[]>;
  cases: LoadingData<DataItem[]>;
  profile: LoadingData<DataItem | null>;
  shop: LoadingData<DataItem[]>;
}

// ============================================================
// AUTH SLICE
// ============================================================

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    isAuthenticated: false,
    isLoading: false,
  } as AuthState,
  reducers: {
    setUser: (state, action: PayloadAction<User | null>) => {
      state.user = action.payload;
      state.isAuthenticated = !!action.payload;
    },
    clearUser: (state) => {
      state.user = null;
      state.isAuthenticated = false;
    },
  },
});

// ============================================================
// ROUTER SLICE
// ============================================================

const routerSlice = createSlice({
  name: 'router',
  initialState: {
    currentPath: '/',
    currentScreen: 'menu',
    previousPath: null,
  } as RouterState,
  reducers: {
    setRoute: (state, action: PayloadAction<{ path: string; screen: string }>) => {
      state.previousPath = state.currentPath;
      state.currentPath = action.payload.path;
      state.currentScreen = action.payload.screen;
    },
  },
});

// ============================================================
// DATA SLICE
// ============================================================

const dataSlice = createSlice({
  name: 'data',
  initialState: {
    inventory: {
      data: [],
      isLoaded: false,
      isLoading: false,
    },
    leaderboard: {
      data: [],
      isLoaded: false,
      isLoading: false,
    },
    cases: {
      data: [],
      isLoaded: false,
      isLoading: false,
    },
    profile: {
      data: null,
      isLoaded: false,
      isLoading: false,
    },
    shop: {
      data: [],
      isLoaded: false,
      isLoading: false,
    },
  } as DataState,
  reducers: {
    setInventory: (state, action: PayloadAction<DataItem[]>) => {
      state.inventory.data = action.payload;
      state.inventory.isLoaded = true;
      state.inventory.isLoading = false;
    },
    setInventoryLoading: (state, action: PayloadAction<boolean>) => {
      state.inventory.isLoading = action.payload;
    },
    setLeaderboard: (state, action: PayloadAction<DataItem[]>) => {
      state.leaderboard.data = action.payload;
      state.leaderboard.isLoaded = true;
      state.leaderboard.isLoading = false;
    },
    setLeaderboardLoading: (state, action: PayloadAction<boolean>) => {
      state.leaderboard.isLoading = action.payload;
    },
    setCases: (state, action: PayloadAction<DataItem[]>) => {
      state.cases.data = action.payload;
      state.cases.isLoaded = true;
      state.cases.isLoading = false;
    },
    setCasesLoading: (state, action: PayloadAction<boolean>) => {
      state.cases.isLoading = action.payload;
    },
    setProfile: (state, action: PayloadAction<DataItem | null>) => {
      state.profile.data = action.payload;
      state.profile.isLoaded = true;
      state.profile.isLoading = false;
    },
    setProfileLoading: (state, action: PayloadAction<boolean>) => {
      state.profile.isLoading = action.payload;
    },
    setShop: (state, action: PayloadAction<DataItem[]>) => {
      state.shop.data = action.payload;
      state.shop.isLoaded = true;
      state.shop.isLoading = false;
    },
    setShopLoading: (state, action: PayloadAction<boolean>) => {
      state.shop.isLoading = action.payload;
    },
    clearAllData: (state) => {
      state.inventory = { data: [], isLoaded: false, isLoading: false };
      state.leaderboard = { data: [], isLoaded: false, isLoading: false };
      state.cases = { data: [], isLoaded: false, isLoading: false };
      state.profile = { data: null, isLoaded: false, isLoading: false };
      state.shop = { data: [], isLoaded: false, isLoading: false };
    },
  },
});

// ============================================================
// STORE CONFIGURATION
// ============================================================

export const store = configureStore({
  reducer: {
    auth: authSlice.reducer,
    router: routerSlice.reducer,
    data: dataSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

// ============================================================
// EXPORTS
// ============================================================

export const authActions = authSlice.actions;
export const routerActions = routerSlice.actions;
export const dataActions = dataSlice.actions;

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Expor store globalmente
if (typeof window !== 'undefined') {
  (window as any).store = store;
  (window as any).authActions = authActions;
  (window as any).routerActions = routerActions;
  (window as any).dataActions = dataActions;
}
