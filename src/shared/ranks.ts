// Звания: каждые 50 убийств (за всё время, по сохранённому прогрессу) — следующее.
// Названия — званий армии США, по порядку от рядового до генерала армии.
export const KILLS_PER_RANK = 50;

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

export function rankOf(kills: number): number {
  return Math.min(RANKS.length - 1, Math.floor(Math.max(0, kills) / KILLS_PER_RANK));
}
