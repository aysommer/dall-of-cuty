// Матч: появление, раунды, лимит по времени или убийствам, победитель, голосование за карту.
import { chooseSpawn } from '../spawn.js';
import { fitGear, isMapId, MAP_ORDER, type MapId, MAPS, MATCH } from '../../shared/map.js';
import type { BestPlayer, ServerMsg, Winner } from '../../shared/protocol.js';
import { rankOf } from '../../shared/ranks.js';
import { clearMines } from './mines.js';
import { broadcast, broadcastInfo, broadcastPlayers, send, teamScores } from './net.js';
import { clearAmmoPacks, clearCrate, clearMedkits, setRockets } from './pickups.js';
import type { Player, Room } from './state.js';
import { endGunship, sendLoadout } from './streaks.js';
import { resetBreakables } from './world.js';

export function startMatchClock(room: Room): void {
  room.matchEndsAt = room.limitKind === 'time' ? Date.now() + room.limitValue * 60_000 : Infinity;
}

export function spawn(room: Room, p: Player): void {
  const s = chooseSpawn(MAPS[room.mapId], room.mode, p, room.players.values());
  p.pos = [s[0], s[3] ?? 0, s[1]];
  p.yaw = s[2];
  p.hp = 100;
  p.armor = 0;
  p.big = false;
  p.helmet = 0;
  p.slide = false;
  p.crouch = false;
  // Нож или граната возвращаются после смерти — смотря что выбрано
  p.gear = fitGear(p.melee, p.profile.kills);
  p.hasKnife = p.gear === 'knife';
  p.grenades = p.gear === 'knife' ? 0 : 1;
  p.cookStart = 0;
  p.alive = true;
  sendLoadout(p);
  broadcast(room, { t: 'spawn', id: p.id, p: p.pos, yaw: p.yaw });
}

export function resetRound(room: Room): void {
  room.roundOver = false;
  resetBreakables(room);
  endGunship(room, null);
  for (const p of room.players.values()) {
    p.kills = 0;
    p.deaths = 0;
    clearTimeout(p.respawnTimer);
    p.alive = false;
    setRockets(p, 0);
  }
  // Новый раунд начинается без ящика; следующий упадёт по расписанию
  room.rockets = [];
  room.knives = [];
  room.grenades = [];
  clearMines(room);
  room.missiles.clear();
  clearCrate(room);
  clearMedkits(room);
  clearAmmoPacks(room);
  for (const p of room.players.values()) spawn(room, p);
  broadcast(room, { t: 'reset' });
  broadcastPlayers(room);
}

/** Матч кончается по лимиту убийств или по времени; дальше — голосование за карту. */
export function checkWin(room: Room): void {
  if (room.roundOver) return;
  let winner: Winner | null = null;
  if (room.limitKind !== 'kills') return;
  if (room.mode === 'tdm') {
    const s = teamScores(room);
    if (s.green >= room.limitValue) winner = { team: 'green' };
    else if (s.red >= room.limitValue) winner = { team: 'red' };
  } else {
    for (const p of room.players.values()) if (p.kills >= room.limitValue) winner = { id: p.id, name: p.name };
  }
  if (winner) endMatch(room, winner);
}

/** Победитель по счёту на момент окончания времени; при равенстве — ничья. */
export function winnerByScore(room: Room): Winner {
  if (room.mode === 'tdm') {
    const s = teamScores(room);
    if (s.green === s.red) return { draw: true };
    return { team: s.green > s.red ? 'green' : 'red' };
  }
  const list = [...room.players.values()].sort((a, b) => b.kills - a.kills);
  const [first, second] = list;
  if (!first || (second && second.kills === first.kills)) return { draw: true };
  return { id: first.id, name: first.name };
}

export function voteMsg(room: Room, p: Player | null): ServerMsg {
  const counts = Object.fromEntries(MAP_ORDER.map((m) => [m, 0])) as Record<MapId, number>;
  for (const m of room.votes.values()) counts[m]++;
  return { t: 'vote', counts, ms: MATCH.voteMs, mine: p ? room.votes.get(p.id) ?? null : null };
}

export function broadcastVotes(room: Room): void {
  for (const p of room.players.values()) send(p.ws, voteMsg(room, p));
}

export function endMatch(room: Room, winner: Winner): void {
  room.roundOver = true;
  endGunship(room, null);
  room.votes.clear();
  room.rockets = [];
  room.knives = [];
  room.grenades = [];
  clearMines(room);
  room.missiles.clear();
  clearTimeout(room.nukeTimer);
  room.nukeTimer = undefined;
  broadcast(room, { t: 'over', winner, pause: MATCH.voteMs });
  broadcastVotes(room);
  clearTimeout(room.voteTimer);
  room.voteTimer = setTimeout(() => finishVote(room), MATCH.voteMs);
}

export function handleVote(room: Room, p: Player, map: unknown): void {
  if (!room.roundOver || !isMapId(map)) return;
  room.votes.set(p.id, map);
  broadcastVotes(room);
}

/** Карта с большинством голосов; при равенстве (или если никто не голосовал) — случайная из лидеров. */
export function finishVote(room: Room): void {
  const counts = new Map<MapId, number>(MAP_ORDER.map((m) => [m, 0]));
  for (const m of room.votes.values()) counts.set(m, (counts.get(m) ?? 0) + 1);
  const best = Math.max(...counts.values());
  const leaders = MAP_ORDER.filter((m) => counts.get(m) === best);
  room.mapId = leaders[Math.floor(Math.random() * leaders.length)]!;
  room.votes.clear();
  room.voteTimer = undefined;
  broadcast(room, { t: 'newmap', map: room.mapId });
  startMatchClock(room);
  resetRound(room);
  broadcastInfo(room);
  console.log(`[${room.roomName}] новый матч на карте ${room.mapId}`);
}

/** Игроки комнаты — для лучшего игрока в главном меню */
export function best(room: Room): BestPlayer | null {
  let top: Player | null = null;
  for (const p of room.players.values()) {
    if (!top || p.kills > top.kills || (p.kills === top.kills && p.deaths < top.deaths)) top = p;
  }
  return top && {
    name: top.name, room: room.roomName, rank: rankOf(top.profile.kills),
    kills: top.kills, deaths: top.deaths, totalKills: top.profile.kills, totalDeaths: top.profile.deaths,
  };
}
