// ============================================================
// STORE.JS - Redux Store com Redux Toolkit
// ============================================================

import { configureStore, createSlice } from '@reduxjs/toolkit';

// ============================================================
// AUTH SLICE
// ============================================================
const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    isAuthenticated: false,
    isLoading: false
  },
  reducers: {
    setUser: (state, action) => {
      state.user = action.payload;
      state.isAuthenticated = !!action.payload;
    },
    clearUser: (state) => {
      state.user = null;
      state.isAuthenticated = false;
    }
  }
});

// ============================================================
// ROUTER SLICE
// ============================================================
const routerSlice = createSlice({
  name: 'router',
  initialState: {
    currentPath: '/',
    currentScreen: 'menu',
    previousPath: null
  },
  reducers: {
    setRoute: (state, action) => {
      state.previousPath = state.currentPath;
      state.currentPath = action.payload.path;
      state.currentScreen = action.payload.screen;
    }
  }
});

// ============================================================
// DATA SLICE
// ============================================================
const dataSlice = createSlice({
  name: 'data',
  initialState: {
    inventory: {
      items: [],
      isLoaded: false,
      isLoading: false
    },
    leaderboard: {
      data: [],
      isLoaded: false,
      isLoading: false
    },
    cases: {
      list: [],
      isLoaded: false,
      isLoading: false
    },
    profile: {
      data: null,
      isLoaded: false,
      isLoading: false
    },
    shop: {
      items: [],
      isLoaded: false,
      isLoading: false
    }
  },
  reducers: {
    setInventory: (state, action) => {
      state.inventory.items = action.payload;
      state.inventory.isLoaded = true;
      state.inventory.isLoading = false;
    },
    setInventoryLoading: (state, action) => {
      state.inventory.isLoading = action.payload;
    },
    setLeaderboard: (state, action) => {
      state.leaderboard.data = action.payload;
      state.leaderboard.isLoaded = true;
      state.leaderboard.isLoading = false;
    },
    setLeaderboardLoading: (state, action) => {
      state.leaderboard.isLoading = action.payload;
    },
    setCases: (state, action) => {
      state.cases.list = action.payload;
      state.cases.isLoaded = true;
      state.cases.isLoading = false;
    },
    setCasesLoading: (state, action) => {
      state.cases.isLoading = action.payload;
    },
    setProfile: (state, action) => {
      state.profile.data = action.payload;
      state.profile.isLoaded = true;
      state.profile.isLoading = false;
    },
    setProfileLoading: (state, action) => {
      state.profile.isLoading = action.payload;
    },
    setShop: (state, action) => {
      state.shop.items = action.payload;
      state.shop.isLoaded = true;
      state.shop.isLoading = false;
    },
    setShopLoading: (state, action) => {
      state.shop.isLoading = action.payload;
    },
    clearAllData: (state) => {
      state.inventory = { items: [], isLoaded: false, isLoading: false };
      state.leaderboard = { data: [], isLoaded: false, isLoading: false };
      state.cases = { list: [], isLoaded: false, isLoading: false };
      state.profile = { data: null, isLoaded: false, isLoading: false };
      state.shop = { items: [], isLoaded: false, isLoading: false };
    }
  }
});

// ============================================================
// STORE CONFIGURATION
// ============================================================
export const store = configureStore({
  reducer: {
    auth: authSlice.reducer,
    router: routerSlice.reducer,
    data: dataSlice.reducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false // Desabilitar para trabalhar com funções no payload
    })
});

// ============================================================
// EXPORTS
// ============================================================
export const authActions = authSlice.actions;
export const routerActions = routerSlice.actions;
export const dataActions = dataSlice.actions;

// Expor store globalmente
if (typeof window !== 'undefined') {
  window.store = store;
  window.authActions = authActions;
  window.routerActions = routerActions;
  window.dataActions = dataActions;
}
