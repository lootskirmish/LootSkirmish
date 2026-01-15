// @ts-nocheck

import { supabase } from './auth';
import { navigateTo } from '../core/router';
import { requestFriendFromContext } from './friends';
import { showToast } from '../shared/effects';

// Stub exports
export function initChat(user, onMessageReceived) {}
export function cleanupChat() {}
