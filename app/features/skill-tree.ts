// @ts-nocheck

import { supabase } from './auth';
import { 
  SKILL_TREE_BADGES, 
  SKILL_TREE_CATEGORIES, 
  HUB,
  BADGE_DEFINITIONS 
} from '../shared/constants';
import { 
  showDiamondPopup, 
  showXPPopup 
} from '../shared/effects';

// Stub exports
export function initSkillTree() {}
export function openSkillTreeModal(badgeId) {}
export function closeSkillTreeModal() {}
export function zoomSkillTree(delta) {}
export function resetSkillTreeZoom() {}
export function setupSkillTreeKeyboardShortcuts() {}
export function setupSkillTreeModalClose() {}
