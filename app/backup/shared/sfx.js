// ============================================================
// SFX.JS - Simple sound helper with localStorage-backed prefs
// ============================================================

const SOUND_MAP = {
  click: '/sounds/click.mp3',
  buy: '/sounds/click.mp3',
  open_case: '/sounds/open_case.mp3',
  reel_spin: '/sounds/reel_spin.mp3',
  payout: '/sounds/payout.mp3',
  switch: '/sounds/switch.mp3',
  win: '/sounds/win.mp3',
  error: '/sounds/error.mp3',
  notify: '/sounds/notify.mp3',
  hover: '/sounds/hover.mp3'
};

function getEnabled() {
  const saved = localStorage.getItem('soundEffects');
  return saved == null ? true : saved === 'true';
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem('soundPrefs');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  localStorage.setItem('soundPrefs', JSON.stringify(prefs || {}));
}

function isSoundAllowed(key) {
  const prefs = loadPrefs();
  if (Object.prototype.hasOwnProperty.call(prefs, key)) {
    return !!prefs[key];
  }
  return true;
}

export function setSoundPreference(key, enabled) {
  const prefs = loadPrefs();
  prefs[key] = !!enabled;
  savePrefs(prefs);
}

export function setAllSoundPreferences(enabled) {
  const prefs = {};
  Object.keys(SOUND_MAP).forEach(k => {
    prefs[k] = !!enabled;
  });
  savePrefs(prefs);
}

function getVolume() {
  const saved = localStorage.getItem('volume');
  const vol = saved == null ? 50 : Number(saved);
  if (Number.isNaN(vol)) return 0.5;
  return Math.min(Math.max(vol, 0), 100) / 100;
}

export function setSoundEnabled(enabled) {
  localStorage.setItem('soundEffects', String(!!enabled));
}

export function setMasterVolume(volume0to100) {
  const clamped = Math.min(Math.max(Number(volume0to100) || 0, 0), 100);
  localStorage.setItem('volume', String(clamped));
}

export function playSound(key, { volume = 1, loop = false } = {}) {
  if (!getEnabled()) return null;
  const src = SOUND_MAP[key];
  if (!src) return null;
  if (!isSoundAllowed(key)) return null;
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.loop = loop;
  audio.volume = Math.min(Math.max(getVolume() * volume, 0), 1);
  audio.play().catch(() => {});
  return audio;
}

export function startLoop(key, opts = {}) {
  const handle = playSound(key, { ...opts, loop: true });
  return {
    stop() {
      if (handle) {
        handle.pause();
        handle.currentTime = 0;
      }
    }
  };
}

let globalClickBound = false;
let globalHoverBound = false;

export function bindGlobalClickSfx() {
  if (globalClickBound) return;
  globalClickBound = true;
  document.addEventListener('click', (e) => {
    if (!getEnabled()) return;
    if (e.defaultPrevented) return;
    const target = e.target instanceof Element ? e.target : null;
    const skip = target?.closest('[data-no-click-sfx]');
    if (skip) return;
    const custom = target?.closest('[data-click-sfx]');
    if (custom?.dataset?.clickSfx) {
      playSound(custom.dataset.clickSfx, { volume: 0.35 });
      return;
    }
    playSound('click', { volume: 0.35 });
  });
}

export function bindGlobalHoverSfx() {
  if (globalHoverBound) return;
  globalHoverBound = true;
  document.addEventListener('mouseenter', (e) => {
    if (!getEnabled()) return;
    const el = e.target instanceof Element ? e.target : null;
    const skip = el?.closest('[data-no-hover-sfx]');
    if (skip) return;
    const hoverEl = el?.closest('[data-hover-sfx], button, a, [role="button"], .btn');
    if (!hoverEl) return;
    const key = hoverEl.dataset.hoverSfx || 'hover';
    playSound(key, { volume: 0.2 });
  }, true);
}
