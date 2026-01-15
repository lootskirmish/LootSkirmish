// @ts-nocheck

import { supabase } from './auth';
import { 
  createSellParticles, 
  showSellConfirmation,
  showMoneyPopup,
  showToast,
  showAlert
} from '../shared/effects';

// Stub exports
export function initInventory(user, money, diamonds = 0) {}
export async function renderInventory(userId) {}
export function setCurrentUserId(userId) {}
export function getCurrentUserId() {}
