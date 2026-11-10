// Выбор точки появления: игрок должен появиться там, где его не видит ни один противник.
import { PLAYER, lineOfSight, type GameMap, type SpawnPoint } from '../shared/map.js';
import type { Mode, Team, Vec3 } from '../shared/protocol.js';

export interface SpawnActor {
  id: number;
  team: Team;
  alive: boolean;
  pos: Vec3;
}

/** Ближе этого расстояния к другому игроку не появляемся, чтобы не оказаться друг в друге. */
const MIN_GAP = 1.5;

/** Видит ли стоящий в точке `from` игрок того, кто появится в точке `s`. */
function sees(map: GameMap, from: Vec3, s: SpawnPoint): boolean {
  const eye: Vec3 = [from[0], from[1] + PLAYER.eye, from[2]];
  const y = s[3] ?? 0;
  // Проверяем голову, грудь и ноги: достаточно, чтобы была видна любая часть
  return [PLAYER.h - 0.1, PLAYER.h / 2, 0.2].some((h) => lineOfSight(map.boxes, eye, [s[0], y + h, s[1]]));
}

export function chooseSpawn(map: GameMap, mode: Mode, me: SpawnActor, everyone: Iterable<SpawnActor>): SpawnPoint {
  const others = [...everyone].filter((o) => o.id !== me.id && o.alive);
  const enemies = others.filter((o) => mode === 'ffa' || o.team !== me.team);

  const rate = (s: SpawnPoint) => {
    let seenBy = 0, enemyDist = 1000, free = true;
    for (const o of others) {
      if (Math.hypot(o.pos[0] - s[0], o.pos[2] - s[1]) < MIN_GAP) free = false;
    }
    for (const e of enemies) {
      if (sees(map, e.pos, s)) seenBy++;
      enemyDist = Math.min(enemyDist, Math.hypot(e.pos[0] - s[0], e.pos[2] - s[1]));
    }
    return { s, seenBy, free, score: enemyDist + Math.random() * 3 };
  };
  const farthest = (list: ReturnType<typeof rate>[]) => list.reduce((a, b) => (b.score > a.score ? b : a));

  // В командном режиме сначала пробуем свою базу, и только если она вся простреливается — остальную карту
  const own = (mode === 'tdm' ? map.spawns[me.team] : map.spawns.ffa).map(rate);
  const rest = mode === 'tdm' ? map.spawns.ffa.map(rate) : [];

  for (const pool of [own, rest]) {
    const hidden = pool.filter((c) => c.free && c.seenBy === 0);
    if (hidden.length) return farthest(hidden).s;
  }
  // Скрытых точек нет: берём ту, которую видит меньше всего противников, из них — самую дальнюю
  const pool = [...own, ...rest];
  const usable = pool.some((c) => c.free) ? pool.filter((c) => c.free) : pool;
  const fewest = Math.min(...usable.map((c) => c.seenBy));
  return farthest(usable.filter((c) => c.seenBy === fewest)).s;
}
