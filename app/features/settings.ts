// @ts-nocheck

import { supabase } from './auth';
import { getActiveUser } from '../core/session';
import { playSound, setMasterVolume, setSoundEnabled, setSoundPreference, setAllSoundPreferences } from '../shared/sfx';
import { showToast, showAlert } from '../shared/effects';

// Stub exports
export async function loadSettingsData() {}
export async function enableUsernameEdit() {}
export function cancelUsernameEdit() {}
export async function changePassword() {}
export function goToSettings() {}
