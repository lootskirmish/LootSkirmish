// ============================================================
// SFX.TS - Simple sound helper with localStorage-backed prefs
// ============================================================

const SOUND_MAP: Record<string, string> = {
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

function getEnabled(): boolean {
  const saved = localStorage.getItem('soundEffects');
  return saved == null ? true : saved === 'true';
}

function loadPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem('soundPrefs');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savePrefs(prefs: Record<string, boolean>): void {
  localStorage.setItem('soundPrefs', JSON.stringify(prefs || {}));
}

function isSoundAllowed(key: string): boolean {
  const prefs = loadPrefs();
  if (Object.prototype.hasOwnProperty.call(prefs, key)) {
    return !!prefs[key];
  }
  return true;
}

export function setSoundPreference(key: string, enabled: boolean): void {
  const prefs = loadPrefs();
  prefs[key] = !!enabled;
  savePrefs(prefs);
}

export function setAllSoundPreferences(enabled: boolean): void {
  const prefs: Record<string, boolean> = {};
  Object.keys(SOUND_MAP).forEach(k => {
    prefs[k] = !!enabled;
  });
  savePrefs(prefs);
}

function getVolume(): number {
  const saved = localStorage.getItem('volume');
  const vol = saved == null ? 50 : Number(saved);
  if (Number.isNaN(vol)) return 0.5;
  return Math.min(Math.max(vol, 0), 100) / 100;
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem('soundEffects', String(!!enabled));
}

export function setMasterVolume(volume0to100: number): void {
  const clamped = Math.min(Math.max(Number(volume0to100) || 0, 0), 100);
  localStorage.setItem('volume', String(clamped));
}

interface PlaySoundOptions {
  volume?: number;
  loop?: boolean;
}

export function playSound(key: string, { volume = 1, loop = false }: PlaySoundOptions = {}): HTMLAudioElement | null {
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

interface LoopHandle {
  stop(): void;
}

export function startLoop(key: string, opts: PlaySoundOptions = {}): LoopHandle {
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
