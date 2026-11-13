// Настройки игрока (громкость, чувствительность, рука, тени, набор оружия) — хранятся в браузере.
import type { MeleeKind, WeaponId } from '../../shared/protocol.js';
import { DEFAULT_KIT, isKit, isGear } from '../../shared/map.js';

interface Settings {
  /** Громкость, 0…1 */
  volume: number;
  /** Множитель чувствительности мыши */
  sens: number;
  hand: 'right' | 'left';
  /** Угол обзора, градусы (70…100) */
  fov: number;
  /** Выбранные стволы — не больше двух, нож есть всегда */
  kit: WeaponId[];
  /** Слот 1: нож или граната */
  melee: MeleeKind;
  /** Тени от солнца (на слабом телефоне их можно выключить) */
  shadows: boolean;
}

export const SETTINGS_KEY = 'doc-settings';

export const TOKEN_KEY = 'doc-progress';

function loadSettings(): Settings {
  const s: Settings = { volume: 0.7, sens: 1, hand: 'right', fov: 75, kit: [...DEFAULT_KIT], melee: 'knife', shadows: true };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    if (typeof raw.volume === 'number') s.volume = Math.max(0, Math.min(1, raw.volume));
    if (typeof raw.sens === 'number') s.sens = Math.max(0.2, Math.min(3, raw.sens));
    if (raw.hand === 'left') s.hand = 'left';
    if (typeof raw.fov === 'number') s.fov = Math.max(70, Math.min(100, Math.round(raw.fov)));
    if (isKit(raw.kit)) s.kit = raw.kit;
    if (isGear(raw.melee)) s.melee = raw.melee;
    if (raw.shadows === false) s.shadows = false;
  } catch { /* испорченные настройки — берём стандартные */ }
  return s;
}

export const settings = loadSettings();
