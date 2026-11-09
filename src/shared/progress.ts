// Прокачка: общие правила для клиента и сервера.

export type Stat = 'sprint' | 'walk' | 'reload';
export const STATS: Stat[] = ['sprint', 'walk', 'reload'];

export interface Upgrade {
  name: string;
  hint: string;
  /** Множитель на каждом уровне: values[0] — без прокачки. */
  values: number[];
}

export const UPGRADES: Record<Stat, Upgrade> = {
  sprint: { name: 'Спринт', hint: 'скорость бега с Shift', values: [1.25, 1.3, 1.35, 1.4] },
  walk: { name: 'Ходьба', hint: 'скорость ходьбы', values: [1, 1.05, 1.1, 1.15] },
  reload: { name: 'Перезарядка', hint: 'скорость перезарядки', values: [1, 1.03, 1.06, 1.1] },
};

export const KILLS_PER_POINT = 10;

export type Levels = Record<Stat, number>;

export interface Profile {
  kills: number;
  levels: Levels;
}

export function newProfile(): Profile {
  return { kills: 0, levels: { sprint: 0, walk: 0, reload: 0 } };
}

export function maxLevel(stat: Stat): number {
  return UPGRADES[stat].values.length - 1;
}

/** Сколько очков прокачки ещё не потрачено. */
export function pointsLeft(p: Profile): number {
  const spent = STATS.reduce((sum, s) => sum + p.levels[s], 0);
  return Math.floor(p.kills / KILLS_PER_POINT) - spent;
}

export function multiplier(levels: Levels, stat: Stat): number {
  const values = UPGRADES[stat].values;
  return values[Math.min(levels[stat], values.length - 1)] ?? 1;
}

export function isStat(v: unknown): v is Stat {
  return typeof v === 'string' && (STATS as string[]).includes(v);
}
