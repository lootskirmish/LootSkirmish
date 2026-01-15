// @ts-nocheck

import { supabase } from './auth';
import { 
  showUploadNotification, 
  showDiamondPopup, 
  showXPPopup,
  showToast,
  showAlert
} from '../shared/effects';
import { syncPublicProfileFriendButton } from './friends';
import { getActiveUser } from '../core/session';

// Stub exports
export async function loadProfileData(user, calculateLevel, applyTranslations) {}
export async function loadPublicProfile(username, calculateLevel, applyTranslations) {}
export async function resizeImage(file, maxWidth, maxHeight, isCircle = false) {}
export async function uploadToSupabase(file, folder, userId) {}
export async function updateAvatar(file, userId) {}
export async function updateBanner(file, userId) {}
export async function loadUserImages(userId) {}
export function toggleProfilePanel(panelType, loadDebitHistory) {}
export function toggleProfileDropdown() {}
export function setupProfileDropdownClose() {}
export function setupProfileUploadListeners(userId) {}
export function goToProfile() {}
