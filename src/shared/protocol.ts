// Типы сетевого протокола — общие для клиента и сервера.

import type { MapId } from './maps/types.js';
import type { LimitKind, RewardKind, RewardSlot, WeatherKind } from './map.js';

export type Team = 'green' | 'red';
export type Mode = 'tdm' | 'ffa';
export type WeaponId = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'lmg' | 'sniper' | 'knife' | 'grenade' | 'rocket';
/** Что в слоте 1 вместо огнестрела: нож или граната */
export type MeleeKind = 'knife' | 'grenade' | 'flash' | 'sticky' | 'mine' | 'tripwire' | 'launcher';
/** falling — летит с неба, idle — лежит, opening — его открывают, gone — ящика нет */
export type CrateState = 'falling' | 'idle' | 'opening' | 'gone';
export type Vec3 = [number, number, number];

export interface PlayerInfo {
  id: number;
  name: string;
  team: Team;
  hp: number;
  /** Броня из ящика: тратится раньше здоровья */
  armor: number;
  alive: boolean;
  kills: number;
  deaths: number;
  /** Суперброня из серии (Джаггернаут): игрок на 10% больше, весь серый и в шлеме */
  big: boolean;
  /** Звание: номер в RANKS (по убийствам за всё время) */
  rank: number;
  /** Шлем Джаггернаута: сколько попаданий в голову он ещё выдержит (0 — шлема нет) */
  helmet: number;
}

/** [id, x, y, z, yaw, pitch, оружие, лежит 0/1 (подкат или лёжа), в воздухе 0/1, перезаряжается 0/1, присел 0/1] */
export type SnapRow = [number, number, number, number, number, number, WeaponId, 0 | 1, 0 | 1, 0 | 1, 0 | 1];

export interface Winner {
  team?: Team;
  id?: number;
  name?: string;
  /** Ничья */
  draw?: boolean;
}

/** Чем убили: оружие, ящик-ловушка, метательный нож, ракета с неба или бомба. */
export type KillWeapon = WeaponId | 'crate' | 'throw' | 'missile' | 'nuke' | 'gunship' | 'mine';

/** Комната в списке главного меню. locked — с паролем. */
export interface RoomInfo {
  id: number; name: string; locked: boolean;
  mode: Mode; map: MapId; limitKind: LimitKind; limitValue: number;
  count: number; green: number; red: number; max: number;
}
/** Лучший игрок сейчас по всем комнатам: счёт в текущем матче и прогресс за всё время. */
export interface BestPlayer {
  name: string; room: string; rank: number;
  kills: number; deaths: number; totalKills: number; totalDeaths: number;
}
/** Главное меню: список комнат, сколько их может быть и лучший игрок. */
export type LobbyMsg = { t: 'lobby'; rooms: RoomInfo[]; maxRooms: number; best: BestPlayer | null };
/** limit — до скольких убийств идёт матч (0 — по времени); left — сколько миллисекунд осталось (0 — по убийствам) */
export type PlayersMsg = { t: 'players'; mode: Mode; limit: number; left: number; scores: Record<Team, number>; list: PlayerInfo[] };
export type SpawnMsg = { t: 'spawn'; id: number; p: Vec3; yaw: number };
export type SnapMsg = { t: 'snap'; ps: SnapRow[] };
export type ShotMsg = { t: 'shot'; id: number; w: WeaponId; ends: Vec3[] };
/** killer = null и w = 'crate' — игрока убил взорвавшийся ящик. */
export type KillMsg = { t: 'kill'; killer: number | null; victim: number; w: KillWeapon; head?: boolean };
/** Аптечки на карте: ms — сколько ещё падать. */
export type MedkitsMsg = { t: 'medkits'; list: Array<{ id: number; at: Vec3; ms: number }> };
export type ProfileMsg = { t: 'profile'; token: string; kills: number; deaths: number };
/**
 * Состояние ящика. at — куда он падает или где лежит; by — кто открывает;
 * ms — сколько осталось падать или открывать; left — через сколько исчезнет, если не открыть.
 */
export type CrateMsg = { t: 'crate'; state: CrateState; at: Vec3 | null; by: number | null; ms: number; left: number };
export type RocketMsg = { t: 'rocket'; id: number; by: number; o: Vec3; d: Vec3 };
export type BoomMsg = { t: 'boom'; id: number; p: Vec3 };
/** Рисунок на стене: точка, нормаль стены по X/Z и номер эмодзи из EMOJIS. */
export type SprayMsg = { t: 'spray'; by: number; p: Vec3; n: [number, number]; e: number };
export type OverMsg = { t: 'over'; winner: Winner; pause: number };
/** Голосование за карту после матча: голоса по картам и сколько осталось. */
export type VoteMsg = { t: 'vote'; counts: Record<MapId, number>; ms: number; mine: MapId | null };
/** Своё снаряжение: есть ли нож, текущая серия и запас наград. */
export type LoadoutMsg = {
  /** gear — что в слоте 1 в этой жизни; grenades — сколько штук осталось (у ножа — 0) */
  t: 'loadout'; gear: MeleeKind; knife: boolean; grenades: number; streak: number; reward: RewardSlot | null;
};
/** Брошенный нож летит (o — откуда, d — направление) и где он остановился. */
export type ThrowMsg = { t: 'throw'; id: number; by: number; o: Vec3; d: Vec3 };
export type ThrowEndMsg = { t: 'thrown'; id: number; p: Vec3; hit: boolean };
/** Отметки противников от БПЛА (x, z) */
export type PingMsg = { t: 'ping'; list: Array<[number, number, number]> };
/** Замер задержки: сервер шлёт метку времени, игрок сразу возвращает её (pong); list — пинг всех игроков, мс */
export type LatencyMsg = { t: 'lat'; at: number; list: Array<[id: number, ms: number]> };
/** Ракета с неба: положение для остальных игроков */
export type MissileMsg = { t: 'missile'; id: number; by: number; p: Vec3 };
/** Бомба: через ms упадёт и убьёт всех */
export type NukeMsg = { t: 'nuke'; by: number; ms: number };
/** Самолёт в воздухе: phase — начальный угол на круге, ms — сколько ещё летать (траектория — gunshipPos) */
export type GunshipMsg = { t: 'gunship'; id: number; by: number; phase: number; ms: number; elapsed: number };
/** Самолёт сбит (by — кто сбил) или улетел (by = null) */
export type GunshipEndMsg = { t: 'gunship-end'; id: number; by: number | null; p: Vec3 };
/** Очередь пулемёта самолёта — для трассеров у остальных */
export type GunshipShotMsg = { t: 'gsshot'; id: number; ends: Vec3[] };
/** Гранаты в полёте и на земле: [id, x, y, z, мс до взрыва] */
/** …и вид: 0 — осколочная, 1 — световая, 2 — липучка */
export type GrenadesMsg = { t: 'grenades'; list: Array<[number, number, number, number, number, 0 | 1 | 2]> };
/**
 * Мина или растяжка на карте: p — где лежит, to — куда натянута верёвка (у растяжки),
 * by и team — чья, armed — через сколько миллисекунд взорвётся (0 — не сработала).
 */
export interface MineInfo { id: number; kind: 'mine' | 'tripwire'; by: number; team: Team; p: Vec3; to: Vec3 | null; armed: number }
export type MinesMsg = { t: 'mines'; list: MineInfo[] };
/** Патроны, выпавшие из погибших */
/** Погода: дождь или снег на ms миллисекунд; kind = null — ясно. */
export type WeatherMsg = { t: 'weather'; kind: WeatherKind | null; ms: number };
export type AmmoPacksMsg = { t: 'ammopacks'; list: Array<{ id: number; at: Vec3 }> };

export type ServerMsg =
  | LobbyMsg
  /** Сообщение в чат комнаты: кто зашёл, кто вышел */
  | { t: 'chat'; kind: 'join' | 'leave'; name: string; team: Team }
  | PlayersMsg
  | SpawnMsg
  | SnapMsg
  | ShotMsg
  | KillMsg
  | MedkitsMsg
  | OverMsg
  | ProfileMsg
  | CrateMsg
  | RocketMsg
  | BoomMsg
  | SprayMsg
  | VoteMsg
  | LoadoutMsg
  | ThrowMsg
  | ThrowEndMsg
  | PingMsg
  | LatencyMsg
  | MissileMsg
  | NukeMsg
  | GunshipMsg
  | GunshipEndMsg
  | GunshipShotMsg
  | GrenadesMsg
  | MinesMsg
  /** Световая граната: вспышка в точке p (всем) и ослепление на ms (тем, кто рядом) */
  | { t: 'flash'; p: Vec3 }
  | { t: 'blind'; ms: number }
  /** Какие стёкла и двери уже разбиты */
  | { t: 'breaks'; broken: number[] }
  /** Какие двери сейчас открыты */
  | { t: 'doors'; open: number[] }
  | { t: 'gunship-hit'; id: number; left: number }
  | AmmoPacksMsg
  | WeatherMsg
  /** Попадание в шлем Джаггернаута: by — кто стрелял, left — сколько попаданий шлем ещё выдержит */
  | { t: 'helmet'; id: number; by: number; left: number }
  | { t: 'promoted'; rank: number }
  | { t: 'ammo' }
  | { t: 'uav'; ms: number }
  | { t: 'missile-go'; id: number; p: Vec3 }
  | { t: 'newmap'; map: MapId }
  | { t: 'rockets'; n: number }
  /** Что оказалось в открытом ящике */
  | { t: 'reward'; kind: RewardKind }
  | { t: 'error'; text: string }
  | { t: 'welcome'; id: number; mode: Mode; map: MapId }
  | { t: 'reset' };

export type ClientMsg =
  /**
   * Войти в комнату room (id) или создать новую (room = 'new': roomName, mode, map и лимит — её настройки).
   * password — пароль комнаты: при создании задаёт его (пустой — без пароля), при входе проверяется.
   */
  | {
    t: 'join'; room: number | 'new'; roomName?: string; password?: string;
    name: string; team: Team; mode: Mode; map: MapId;
    limitKind: LimitKind; limitValue: number; kit: WeaponId[]; melee: MeleeKind; token?: string;
  }
  | { t: 'vote'; map: MapId }
  | { t: 'kit'; guns: WeaponId[] }
  | { t: 'throw'; d: Vec3 }
  | { t: 'use' }
  | { t: 'pong'; at: number }
  | { t: 'mpos'; id: number; p: Vec3 }
  | { t: 'mhit'; id: number; p: Vec3 }
  | { t: 'gsfire'; ends: Vec3[]; hits: Record<number, number> }
  | { t: 'gsrocket'; d: Vec3 }
  /** Сорвать чеку, бросить гранату, сменить нож на гранату (со следующей жизни) */
  | { t: 'pin' }
  | { t: 'gthrow'; d: Vec3 }
  | { t: 'melee'; kind: MeleeKind }
  /** F у двери — открыть или закрыть */
  | { t: 'door'; id: number }
  | { t: 'open'; on: boolean }
  | { t: 'rocket'; d: Vec3 }
  | { t: 'spray'; p: Vec3; n: [number, number]; e: number }
  /** sl — лежит (подкат или лёжа), cr — присел, air — в воздухе, rl — перезаряжается (два последних — только для анимации у других) */
  | { t: 'state'; p: Vec3; yaw: number; pitch: number; w: WeaponId; sl: boolean; cr?: boolean; air?: boolean; rl?: boolean }
  /** hits: id игрока → [попаданий в тело, попаданий в голову] */
  | { t: 'shoot'; w: WeaponId; ends: Vec3[]; hits: Record<number, [number, number]>; brk?: Record<number, number> };
