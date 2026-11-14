// Состояние комнаты: игроки, матч, снаряды, ящики, погода — и типы сущностей.
// Все функции комнаты получают объект Room первым параметром.
import { type Box, type LimitKind, type MapId, type RewardSlot, ROOMS, type WeatherKind } from '../../shared/map.js';
import type { WebSocket } from 'ws';
import type { CrateState, MeleeKind, Mode, Team, Vec3, WeaponId } from '../../shared/protocol.js';
import type { Profile } from '../../shared/progress.js';

export const MAX_PLAYERS = ROOMS.players;

export const TEAM_SIZE = ROOMS.team;

export const RESPAWN_MS = 3000;

export interface Player {
  id: number;
  ws: WebSocket;
  name: string;
  team: Team;
  pos: Vec3;
  yaw: number;
  pitch: number;
  w: WeaponId;
  /** Лежит: подкат или лёжа (меняет хитбокс) */
  slide: boolean;
  /** Присел (хитбокс ниже) */
  crouch: boolean;
  /** В воздухе и перезаряжается — только для анимации у других игроков */
  air: boolean;
  reloading: boolean;
  hp: number;
  armor: number;
  alive: boolean;
  kills: number;
  deaths: number;
  lastShot: number;
  /** Метка времени последнего присланного положения (часы игрока, мс) — пересылается другим для плавной интерполяции */
  stateTs: number;
  /** Задержка до игрока (туда и обратно), мс; сглаженная */
  ping: number;
  /** Когда последний раз рисовал на стене */
  lastSpray: number;
  profile: Profile;
  /** Сколько ракет осталось (ракетница из ящика или за серию) */
  rockets: number;
  /** Что в слоте 1: нож или граната (выбор действует со следующей жизни) */
  melee: MeleeKind;
  /** Что в слоте 1 в этой жизни (выбор melee на момент появления, если он открыт на уровне игрока) */
  gear: MeleeKind;
  /** Гранат в руках (одна на жизнь) */
  grenades: number;
  /** Когда сорвана чека гранаты в руке (0 — не держит) */
  cookStart: number;
  /** Метательный нож: один на жизнь */
  hasKnife: boolean;
  /** Убийств подряд без смерти */
  streak: number;
  /** Награда, ждущая применения (одна; новая заменяет неиспользованную), — её можно применить и после смерти */
  reward: RewardSlot | null;
  /** До какого момента работает БПЛА этого игрока */
  uavUntil: number;
  /** Суперброня (Джаггернаут): игрок на 10% больше */
  big: boolean;
  /** Шлем Джаггернаута: сколько попаданий в голову ещё выдержит */
  helmet: number;
  /** Выбранные стволы (не больше двух), нож — всегда */
  kit: WeaponId[];
  respawnTimer?: NodeJS.Timeout;
}

/** Входящее сообщение: клиенту не доверяем, поля проверяем вручную. */
export type Incoming = Record<string, unknown>;

export interface RoomHooks {
  /** Поменялось то, что видно в главном меню */
  changed(): void;
  /** Ушёл последний игрок — комнату пора закрыть */
  empty(): void;
}

// Игрок ведёт её сам с высоты STREAK.missileHeight; сервер принимает точку попадания и взрывает по области.
export interface Missile { id: number; owner: number; born: number; last: Vec3 }

// Летит сам по кругу над картой (gunshipPos), хозяин только стреляет. Сбивают двумя попаданиями из ракетницы.
export interface Gunship { id: number; owner: number; phase: number; start: number; hits: number; lastGun: number; lastRocket: number }

export interface Knife { id: number; owner: number; pos: Vec3; vel: Vec3; born: number }

export interface Grenade { id: number; owner: number; pos: Vec3; vel: Vec3; explodeAt: number; kind: 'grenade' | 'flash' | 'sticky'; stuck: boolean }

/** Мина или растяжка (to — конец верёвки); armedAt — когда её взвёл враг (0 — ещё нет) */
export interface Mine { id: number; kind: 'mine' | 'tripwire'; owner: number; pos: Vec3; to: Vec3 | null; armedAt: number }

export interface AmmoPack { id: number; at: Vec3; until: number }

// Каждые MEDKIT.everyMs аптечка падает с неба в свободную точку карты (не больше MEDKIT.max сразу).
// Подобрать — подойти вплотную, если здоровье не полное.
export interface Medkit { id: number; at: Vec3; landAt: number }

export interface Rocket { id: number; owner: number; pos: Vec3; dir: Vec3; born: number; fromGunship?: boolean }

/** Всё состояние одной комнаты: игроки, матч, снаряды, ящики, погода. Функции ниже получают его первым параметром. */
export interface Room {
  id: number;
  roomName: string;
  password: string;
  hooks: RoomHooks;
  players: Map<number, Player>;
  mode: Mode;
  mapId: MapId;
  /** Матч окончен — идёт голосование за карту; урон и награды не засчитываются */
  roundOver: boolean;
  /** Матч ограничен временем (минуты) или числом убийств — на выбор первого игрока */
  limitKind: LimitKind;
  limitValue: number;
  matchEndsAt: number;
  voteTimer: NodeJS.Timeout | undefined;
  /** Голоса за карту: id игрока → карта */
  votes: Map<number, MapId>;
  lastPing: number;
  /** Когда последний раз замеряли задержку игроков */
  lastLatency: number;
  missiles: Map<number, Missile>;
  nextMissileId: number;
  gunship: Gunship | null;
  nextGunshipId: number;

  nukeTimer: NodeJS.Timeout | undefined;
  knives: Knife[];
  nextKnifeId: number;
  grenades: Grenade[];
  mines: Mine[];
  nextMineId: number;
  nextGrenadeId: number;
  crate: {
    state: CrateState;
    at: Vec3 | null;
    by: number | null;
    /** Где стоял открывающий: сдвинулся — открытие сорвано */
    start: Vec3;
    /** Когда закончится падение или открытие */
    until: number;
    /** Когда ящик исчезнет, если его не открыть */
    expiresAt: number;
    /** Срок вышел, пока ящик открывали: при отмене открытия он исчезнет */
    expired: boolean;
    timer?: NodeJS.Timeout;
    expireTimer?: NodeJS.Timeout;
  };
  dropTimer: NodeJS.Timeout | undefined;

  // Целые разрушаемые блоки твёрдые: закрывают видимость, останавливают пули, ракеты и гранаты.
  brokenIds: Set<number>;
  breakHp: Map<number, number>;
  /** Открытые двери не мешают ни движению, ни выстрелам */
  openDoors: Set<number>;
  solidsVersion: number;
  solidCache: { map: MapId; version: number; boxes: Box[] } | null;

  weather: { kind: WeatherKind; until: number } | null;
  lastWeatherRoll: number;
  ammoPacks: AmmoPack[];
  nextPackId: number;
  medkits: Medkit[];
  nextMedkitId: number;
  medkitTimer: NodeJS.Timeout | undefined;
  rockets: Rocket[];
  nextRocketId: number;
}

export function newRoom(id: number, roomName: string, password: string, hooks: RoomHooks): Room {
  return {
    id,
    roomName,
    password,
    hooks,
    players: new Map<number, Player>(),
    mode: 'tdm',
    mapId: 'sands',
    roundOver: false,
    limitKind: 'time',
    limitValue: 10,
    matchEndsAt: 0,
    voteTimer: undefined,
    votes: new Map<number, MapId>(),
    lastPing: 0,
    lastLatency: 0,
    missiles: new Map<number, Missile>(),
    nextMissileId: 1,
    gunship: null,
    nextGunshipId: 1,
    nukeTimer: undefined,
    knives: [],
    nextKnifeId: 1,
    grenades: [],
    mines: [],
    nextMineId: 1,
    nextGrenadeId: 1,
    crate: { state: 'gone', at: null, by: null, start: [0, 0, 0], until: 0, expiresAt: 0, expired: false },
    dropTimer: undefined,
    brokenIds: new Set<number>(),
    breakHp: new Map<number, number>(),
    openDoors: new Set<number>(),
    solidsVersion: 0,
    solidCache: null,
    weather: null,
    lastWeatherRoll: 0,
    ammoPacks: [],
    nextPackId: 1,
    medkits: [],
    nextMedkitId: 1,
    medkitTimer: undefined,
    rockets: [],
    nextRocketId: 1,
  };
}
