// Настройки игрока (громкость, чувствительность, рука, набор оружия) — хранятся в браузере.
import type { MeleeKind, WeaponId } from '../../shared/protocol.js';
import { DEFAULT_KIT, isKit, isGear } from '../../shared/map.js';

interface Settings {
  /** Громкость, 0…1 */
  volume: number;
  /** Множитель чувствительности мыши */
  sens: number;
  hand: 'right' | 'left';
  /** Выбранные стволы — не больше двух, нож есть всегда */
  kit: WeaponId[];
  /** Слот 1: нож или граната */
  melee: MeleeKind;
}

export const SETTINGS_KEY = 'doc-settings';

export const TOKEN_KEY = 'doc-progress';

function loadSettings(): Settings {
  const s: Settings = { volume: 0.7, sens: 1, hand: 'right', kit: [...DEFAULT_KIT], melee: 'knife' };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    if (typeof raw.volume === 'number') s.volume = Math.max(0, Math.min(1, raw.volume));
    if (typeof raw.sens === 'number') s.sens = Math.max(0.2, Math.min(3, raw.sens));
    if (raw.hand === 'left') s.hand = 'left';
    if (isKit(raw.kit)) s.kit = raw.kit;
    if (isGear(raw.melee)) s.melee = raw.melee;
  } catch { /* испорченные настройки — берём стандартные */ }
  return s;
}

export const settings = loadSettings();
