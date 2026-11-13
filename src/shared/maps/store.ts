// Карта «Магазин»: супермаркет под крышей. Две команды — на складах в западном и восточном концах,
// между ними торговый зал. У каждой стороны свой цвет стеллажей и над складом офис с окном на зал,
// перед окном — мостик, на который можно забраться снизу по лестнице. В центре зала — два промо-стенда
// с узким проходом между ними и кассы. Вдоль северной и южной стен за длинными стеллажами — служебные
// коридоры с паллетами: ими обходят зал. Планировка своя; стороны зеркальны по X, чтобы командам было поровну.
import { builder, type Breakable, type GameMap, type Ladder, type SpawnPoint } from './types.js';
import { addGround } from './ground.js';

const HALF = { x: 26, z: 18 };
/** Потолок зала */
const H = 9;

const TILE = '#d9d6cf';
const WALL = '#e8e4da';
const CONCRETE = '#9aa0a6';
const CEILING = '#c9c4b8';
const SHELF_GREEN = '#3f8f4f';
const SHELF_YELLOW = '#d8b03a';
const GOODS = '#e7e1d2';
const PROMO = '#c0392b';
const PROMO_TOP = '#f0d36b';
const COUNTER = '#5a5f66';
const BELT = '#2b2e33';
const PALLET = '#9a7347';
const BOX = '#c9a36b';
const OFFICE = '#f2efe6';
const FLOOR2 = '#8a8f96';
const RAIL = '#3d4148';
const WOOD = '#8a5a2b';
const DOOR = '#6b7078';
const GLASS = '#9fd3ff';

const { boxes, b } = builder();

/** Блок на западной половине и его отражение на восточной (x → −x); у восточной свой цвет. */
const mx = (x1: number, z1: number, x2: number, z2: number, h: number, left: string, y = 0, right = left): void => {
  b(x1, z1, x2, z2, h, left, y);
  b(-x2, z1, -x1, z2, h, right, y);
};
/** То же и ещё отражение по Z — для декора, одинакового у северной и южной стен. */
const q = (x1: number, z1: number, x2: number, z2: number, h: number, left: string, y = 0, right = left): void => {
  mx(x1, z1, x2, z2, h, left, y, right);
  mx(x1, -z2, x2, -z1, h, left, y, right);
};

// Стены и потолок: выхода наружу нет
b(-HALF.x - 1, -HALF.z - 1, HALF.x + 1, -HALF.z, H + 0.3, WALL);
b(-HALF.x - 1, HALF.z, HALF.x + 1, HALF.z + 1, H + 0.3, WALL);
b(-HALF.x - 1, -HALF.z, -HALF.x, HALF.z, H + 0.3, WALL);
b(HALF.x, -HALF.z, HALF.x + 1, HALF.z, H + 0.3, WALL);
b(-HALF.x, -HALF.z, HALF.x, HALF.z, 0.3, CEILING, H);

// ---------- Склады: стена между складом и залом, выходы в зал и в служебные коридоры ----------
const SW = -19;           // внутренняя грань стены склада со стороны зала
/** Пол офиса над складом */
const F2 = 3.6;
const T = 0.3;
const DOOR_H = 2.4;
// Сплошные куски стены (по Z), между ними — проёмы: широкие в коридоры, двери в зал
const openings: Array<[number, number, boolean]> = [[-16.4, -13.6, false], [-7.4, -6, true], [6, 7.4, true], [13.6, 16.4, false]];
/** Сплошной кусок стены; напротив офиса (z −5…5) — только до его пола: выше — передняя стена офиса с окнами */
const solid = (z1: number, z2: number): void => {
  const lo = Math.max(z1, -5), hi = Math.min(z2, 5);
  if (lo >= hi) { mx(SW - T, z1, SW, z2, H, CONCRETE); return; }
  mx(SW - T, z1, SW, z2, F2, CONCRETE);
  if (z1 < lo) mx(SW - T, z1, SW, lo, H - F2, CONCRETE, F2);
  if (hi < z2) mx(SW - T, hi, SW, z2, H - F2, CONCRETE, F2);
};
let z = -HALF.z;
for (const [z1, z2, door] of openings) {
  solid(z, z1);
  const top = door ? DOOR_H : 3.2;                                         // двери — по росту, проходы в коридоры — шире
  mx(SW - T, z1, SW, z2, H - top, CONCRETE, top);
  z = z2;
}
solid(z, HALF.z);
// Паллеты с коробками на складе — укрытия у точек появления
q(-24, 10, -22, 12, 1.4, PALLET);
q(-24, 10.2, -22.2, 11.8, 0.6, BOX, 1.4);

// ---------- Офис над складом: лестница со склада, окно и дверь на мостик над залом ----------
const OX1 = -24, OX2 = SW, OZ1 = -5, OZ2 = 5;
mx(OX1, OZ1, OX2 - T, OZ2, 0.25, FLOOR2, F2 - 0.25);                    // пол офиса
// Стены офиса: задняя, боковые (в северной — дверь к лестнице), передняя — в стене склада (окна и дверь)
mx(OX1, OZ1, OX1 + T, OZ2, H - F2, OFFICE, F2);
mx(OX1 + T, OZ1, SW - T, OZ1 + T, H - F2, OFFICE, F2);
mx(OX1 + T, OZ2 - T, -22.5, OZ2, H - F2, OFFICE, F2);
mx(-21.1, OZ2 - T, SW - T, OZ2, H - F2, OFFICE, F2);
mx(-22.5, OZ2 - T, -21.1, OZ2, H - F2 - DOOR_H, OFFICE, F2 + DOOR_H);
// Передняя стена офиса: окна на зал и дверь на мостик посередине
const front = (z1: number, z2: number, sill: number, top: number): void => {
  if (sill > 0) mx(SW - T, z1, SW, z2, sill, CONCRETE, F2);
  mx(SW - T, z1, SW, z2, H - F2 - top, CONCRETE, F2 + top);
};
front(-4, -1.5, 1, 2.2);
front(-1, 1, 0, DOOR_H);
front(1.5, 4, 1, 2.2);
mx(SW - T, -5, SW, -4, H - F2, CONCRETE, F2);
mx(SW - T, -1.5, SW, -1, H - F2, CONCRETE, F2);
mx(SW - T, 1, SW, 1.5, H - F2, CONCRETE, F2);
mx(SW - T, 4, SW, 5, H - F2, CONCRETE, F2);
// Лестница со склада на площадку у двери офиса: вдоль северной стороны, вверх к залу
// 11 ступеней по 0.33 м: выше 0.35 м без прыжка не шагнуть
const STEPS = 11, RISE = F2 / STEPS, RUN = 0.4, SX = -25.2;
for (let i = 0; i < STEPS; i++) mx(SX + i * RUN, 6.2, SX + (i + 1) * RUN, 7.5, RISE * (i + 1), WOOD);
const STAIR_END = SX + STEPS * RUN;
mx(STAIR_END, OZ2, SW - T, 7.6, 0.25, FLOOR2, F2 - 0.25);                // площадка наверху лестницы
mx(-22.6, OZ2, STAIR_END, 6.2, 0.25, FLOOR2, F2 - 0.25);                 // и проход к двери офиса
// Мостик над залом перед окнами офиса, с перилами; снизу на него — лестница с южного края
mx(SW, -6, -17.8, 6, 0.25, FLOOR2, F2 - 0.25);
mx(-17.9, -6, -17.8, 6, 1, RAIL, F2);
// Опорные колонны мостика; к южной прислонена лестница
mx(-18.9, -6, -18.1, -5.6, F2 - 0.25, RAIL);
mx(-18.9, 5.6, -18.1, 6, F2 - 0.25, RAIL);

// ---------- Торговый зал: стеллажи своего цвета у каждой стороны ----------
const SHELF_H = 2.6;
/** Стеллаж с товаром: каркас цвета команды и полоска товара сверху */
const shelf = (x1: number, z1: number, x2: number, z2: number): void => {
  mx(x1, z1, x2, z2, SHELF_H, SHELF_GREEN, 0, SHELF_YELLOW);
  mx(x1 + 0.1, z1 - 0.05, x2 - 0.1, z2 + 0.05, 0.4, GOODS, 1.2);
};
shelf(-16, 9.6, -8, 10.5);
shelf(-16, 3.6, -9.5, 4.5);
shelf(-16, -4.5, -9.5, -3.6);
shelf(-16, -10.5, -8, -9.6);
// Длинные стеллажи вдоль служебных коридоров (с проходом в середине зала)
shelf(-17, 12.6, -6, 13.5);
shelf(-17, -13.5, -6, -12.6);

// ---------- Центр: два промо-стенда с узким проходом между ними и кассы ----------
mx(-4.5, -2.5, -1.2, 1, 2.2, PROMO);
mx(-4.3, -2.3, -1.4, 0.8, 0.25, PROMO_TOP, 2.2);
// Кассы: стойка с лентой и экраном
for (const [z1, z2] of [[5, 8], [-8, -5]] as const) {
  mx(-7, z1, -6.2, z2, 1.05, COUNTER);
  mx(-6.95, z1 + 0.2, -6.25, z2 - 0.2, 0.05, BELT, 1.05);
  mx(-7, z1 + 0.3, -6.9, z1 + 0.9, 0.5, BELT, 1.1);
}

// ---------- Служебные коридоры: паллеты и коробки ----------
q(-14, 15, -12.6, 16.4, 1.2, PALLET);
q(-9.5, 14.2, -8.5, 15.2, 1.6, BOX);
q(-3, 15.8, -1.6, 17.2, 1.2, PALLET);

// ---------- Двери и окна ----------
let nextId = 1;
const breakables: Breakable[] = [];
const breakable = (kind: 'glass' | 'door', x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): void => {
  for (const [a1, a2] of [[x1, x2], [-x2, -x1]] as const) {
    breakables.push({
      id: nextId++, kind, hp: kind === 'glass' ? 20 : 250,
      box: { min: [a1, y1, z1], max: [a2, y2, z2], color: kind === 'glass' ? GLASS : DOOR },
    });
  }
};
breakable('door', SW - 0.25, 0, 6, SW - 0.05, DOOR_H, 7.4);              // двери склада в зал
breakable('door', SW - 0.25, 0, -7.4, SW - 0.05, DOOR_H, -6);
breakable('glass', SW - 0.2, F2 + 1, -4, SW - 0.1, F2 + 2.2, -1.5);      // окна офиса
breakable('glass', SW - 0.2, F2 + 1, 1.5, SW - 0.1, F2 + 2.2, 4);

addGround(boxes, HALF, TILE);

// Лестница на мостик — с его южного края, со стороны зала
const ladders: Ladder[] = [
  { min: [-18.9, 0, -6.45], max: [-18.1, F2 + 0.4, -6], normal: [0, -1] },
  { min: [18.1, 0, -6.45], max: [18.9, F2 + 0.4, -6], normal: [0, -1] },
];

// Зелёные — на западном складе (взгляд на восток), красные — на восточном
const E = -Math.PI / 2, W = Math.PI / 2;
const green: SpawnPoint[] = [[-24.5, -15, E], [-24.5, -8.5, E], [-24.5, -1, E], [-24.5, 3, E], [-24.5, 9, E], [-24.5, 15, E]];
const red: SpawnPoint[] = green.map(([x, z]) => [-x, z, W]);

export const STORE: GameMap = {
  id: 'store',
  name: 'Магазин',
  fresh: true,
  half: HALF,
  floor: TILE,
  sky: '#cfd6dd',
  indoor: true,
  boxes,
  ladders,
  breakables,
  crateDrops: [[0, 0, 5], [0, 0, -6], [-12, 0, 15.5], [12, 0, -15.5]],
  medkitDrops: [[-12, 0, 0], [12, 0, 0], [0, 0, 10], [0, 0, -10]],
  spawns: {
    green,
    red,
    // Плюс офисы над складами и проходы у касс
    ffa: [...green, ...red, [-21.5, -2, E, F2], [21.5, 2, W, F2], [-9, 7, E], [9, -7, W]],
  },
};
