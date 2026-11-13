// Звания и уровни: звание с номером i — это уровень i + 1. Повышают за убийства за всё время
// (по сохранённому прогрессу), и чем выше уровень, тем больше убийств нужно до следующего:
// с уровня L на L + 1 — RANK_BASE + RANK_STEP × (L − 1) убийств (20, 30, 40, …).
// Названия — званий армии США, по порядку от рядового до генерала армии.
export const RANK_BASE = 20;
export const RANK_STEP = 10;

export const RANKS: Array<{ abbr: string; name: string }> = [
  { abbr: 'PV1', name: 'Рядовой' },
  { abbr: 'PV2', name: 'Рядовой 2-го класса' },
  { abbr: 'PFC', name: 'Рядовой 1-го класса' },
  { abbr: 'SPC', name: 'Специалист' },
  { abbr: 'CPL', name: 'Капрал' },
  { abbr: 'SGT', name: 'Сержант' },
  { abbr: 'SSG', name: 'Штаб-сержант' },
  { abbr: 'SFC', name: 'Сержант 1-го класса' },
  { abbr: 'MSG', name: 'Мастер-сержант' },
  { abbr: '1SG', name: 'Первый сержант' },
  { abbr: 'SGM', name: 'Сержант-майор' },
  { abbr: 'CSM', name: 'Командный сержант-майор' },
  { abbr: '2LT', name: 'Второй лейтенант' },
  { abbr: '1LT', name: 'Первый лейтенант' },
  { abbr: 'CPT', name: 'Капитан' },
  { abbr: 'MAJ', name: 'Майор' },
  { abbr: 'LTC', name: 'Подполковник' },
  { abbr: 'COL', name: 'Полковник' },
  { abbr: 'BG', name: 'Бригадный генерал' },
  { abbr: 'MG', name: 'Генерал-майор' },
  { abbr: 'LTG', name: 'Генерал-лейтенант' },
  { abbr: 'GEN', name: 'Генерал' },
  { abbr: 'GA', name: 'Генерал армии' },
];

/** Сколько убийств за всё время нужно, чтобы получить звание с номером rank (уровень rank + 1). */
export function killsForRank(rank: number): number {
  // Сумма арифметической прогрессии: RANK_BASE·n + RANK_STEP·n(n − 1)/2
  return RANK_BASE * rank + (RANK_STEP * rank * (rank - 1)) / 2;
}

/** Номер звания в RANKS по числу убийств за всё время. */
export function rankOf(kills: number): number {
  let r = 0;
  while (r < RANKS.length - 1 && kills >= killsForRank(r + 1)) r++;
  return r;
}

/** Уровень игрока (с 1) — это номер звания + 1. */
export const levelOf = (rank: number): number => rank + 1;

export interface RankProgress {
  rank: number;
  level: number;
  /** Убийств сделано на этом уровне и сколько всего нужно до следующего (0 — звание последнее) */
  done: number;
  need: number;
  /** Доля пути до следующего звания, 0…1 (на последнем — 1) */
  part: number;
}

export function rankProgress(kills: number): RankProgress {
  const rank = rankOf(kills);
  const last = rank >= RANKS.length - 1;
  const from = killsForRank(rank);
  const need = last ? 0 : killsForRank(rank + 1) - from;
  const done = Math.max(0, kills) - from;
  return { rank, level: levelOf(rank), done, need, part: last ? 1 : done / need };
}

/**
 * С какого уровня открываются оружие и снаряжение (чего в списке нет — доступно с первого).
 * Уровень — номер звания + 1, растёт с убийствами за всё время.
 */
export const UNLOCK_LEVEL: Record<string, number> = {
  mine: 2, flash: 2,
  lmg: 3, tripwire: 3,
  smg: 4, sticky: 4,
  sniper: 5,
  launcher: 6,
};
export const unlockLevel = (id: string): number => UNLOCK_LEVEL[id] ?? 1;
/** Открыто ли оружие или снаряжение при таком числе убийств за всё время */
export const isUnlocked = (id: string, kills: number): boolean => levelOf(rankOf(kills)) >= unlockLevel(id);
