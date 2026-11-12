// Карта «Падение»: городок из глины и камня на двух уровнях. Посреди площади рухнула водонапорная башня:
// бак раскололся надвое, между половинами — проход, вокруг — опоры и обломки. На северо-западе и юго-востоке
// над площадью — каменные террасы со ступенями, на них трёхэтажки с выходом на крышу — места для снайпера.
// Внизу — лавки, два ряда рыночных прилавков под навесами и машины; вдоль края — тихий переулок
// и двор с забором для обхода. Команды появляются на западной и восточной окраинах.
// Планировка своя и симметрична относительно центра, чтобы стороны были в равных условиях.
import { builder, type Breakable, type GameMap, type Ladder, type SpawnPoint } from './types.js';
import { addGround, subtract } from './ground.js';

const HALF = { x: 28, z: 22 };
const WALL_H = 4;

const SAND = '#d8c39a';
const CLAY = '#c79a6b';
const STONE = '#bfae8e';
const HOUSE = '#d9c3a0';
const SHOP = '#c9a27c';
const FLOOR = '#8a6a45';
const ROOF = '#9c7f5c';
const RUST = '#7d6a58';
const IRON = '#5b5f66';
const AWNING_A = '#b5473a';
const AWNING_B = '#3a7fb5';
const WOOD = '#8a5a2b';
const CAR = '#6f7f74';
const DARK = '#24272c';
const DOOR = '#6b4423';
const GLASS = '#9fd3ff';

const { boxes, b, sym } = builder();

// Глиняная стена вокруг городка
b(-HALF.x - 1, -HALF.z - 1, HALF.x + 1, -HALF.z, WALL_H, CLAY);
b(-HALF.x - 1, HALF.z, HALF.x + 1, HALF.z + 1, WALL_H, CLAY);
b(-HALF.x - 1, -HALF.z, -HALF.x, HALF.z, WALL_H, CLAY);
b(HALF.x, -HALF.z, HALF.x + 1, HALF.z, WALL_H, CLAY);

/**
 * Стена вдоль оси X (z1…z2 — толщина) от x1 до x2 с проёмами [a1, a2, подоконник, верх проёма];
 * подоконник 0 — дверь. Всё с отражением через центр.
 */
const wallX = (z1: number, z2: number, x1: number, x2: number, y0: number, h: number, color: string, open: Array<[number, number, number, number]> = []): void => {
  let x = x1;
  for (const [a1, a2, sill, top] of open) {
    if (a1 > x) sym(x, z1, a1, z2, h, color, y0);
    if (sill > 0) sym(a1, z1, a2, z2, sill, color, y0);
    if (top < h) sym(a1, z1, a2, z2, h - top, color, y0 + top);
    x = a2;
  }
  if (x < x2) sym(x, z1, x2, z2, h, color, y0);
};
/** То же вдоль оси Z (x1…x2 — толщина). */
const wallZ = (x1: number, x2: number, z1: number, z2: number, y0: number, h: number, color: string, open: Array<[number, number, number, number]> = []): void => {
  let z = z1;
  for (const [a1, a2, sill, top] of open) {
    if (a1 > z) sym(x1, z, x2, a1, h, color, y0);
    if (sill > 0) sym(x1, a1, x2, a2, sill, color, y0);
    if (top < h) sym(x1, a1, x2, a2, h - top, color, y0 + top);
    z = a2;
  }
  if (z < z2) sym(x1, z, x2, z2, h, color, y0);
};

// ---------- Террасы: северо-западная и (отражением) юго-восточная, на 1.8 м выше площади ----------
const TER = 1.8;
const T_X1 = -27, T_X2 = -6, T_Z1 = 9;
boxes.push({ min: [-HALF.x, 0, T_Z1], max: [T_X2, TER, HALF.z], color: STONE, top: SAND });
boxes.push({ min: [-T_X2, 0, -HALF.z], max: [HALF.x, TER, -T_Z1], color: STONE, top: SAND });
// Ступени: с площади на юг террасы и с восточного края
const STEP = TER / 6;
for (let k = 0; k < 6; k++) {
  sym(-20, T_Z1 - (6 - k) * 0.4, -17, T_Z1 - (5 - k) * 0.4, STEP * (k + 1), STONE);   // с юга, вверх на север
  sym(T_X2 + k * 0.4, 13, T_X2 + (k + 1) * 0.4, 15.5, TER - STEP * k, STONE);         // с востока, вверх на запад
}
// Низкий парапет по краю террасы — укрытие сверху (с проходами к ступеням)
sym(T_X1 + 1, T_Z1, -20.2, T_Z1 + 0.3, 0.9, STONE, TER);
sym(-16.8, T_Z1, T_X2, T_Z1 + 0.3, 0.9, STONE, TER);
sym(T_X2 - 0.3, T_Z1 + 0.3, T_X2, 12.8, 0.9, STONE, TER);
sym(T_X2 - 0.3, 15.7, T_X2, HALF.z, 0.9, STONE, TER);

// ---------- Трёхэтажка на террасе: две лестницы внутри, окна на площадь, выход на крышу ----------
const T = 0.3, HX1 = -24, HX2 = -15, HZ1 = 12, HZ2 = 20;
const F2 = TER + 3, F3 = F2 + 3, TOP = F3 + 3;
// Первый этаж: дверь на юг (к ступеням) и на восток, окна на юг
wallX(HZ1, HZ1 + T, HX1, HX2, TER, 3, HOUSE, [[-23, -21.5, 1, 2.2], [-20, -18.6, 0, 2.3], [-17, -15.8, 1, 2.2]]);
wallX(HZ2 - T, HZ2, HX1, HX2, TER, 3, HOUSE);
wallZ(HX1, HX1 + T, HZ1 + T, HZ2 - T, TER, 3, HOUSE, [[15, 16.5, 1, 2.2]]);
wallZ(HX2 - T, HX2, HZ1 + T, HZ2 - T, TER, 3, HOUSE, [[15, 16.4, 0, 2.3]]);
// Второй этаж: окна на все стороны
wallX(HZ1, HZ1 + T, HX1, HX2, F2, 3, HOUSE, [[-23, -21, 1, 2.2], [-18, -16, 1, 2.2]]);
wallX(HZ2 - T, HZ2, HX1, HX2, F2, 3, HOUSE, [[-19, -17, 1, 2.2]]);
wallZ(HX1, HX1 + T, HZ1 + T, HZ2 - T, F2, 3, HOUSE);
wallZ(HX2 - T, HX2, HZ1 + T, HZ2 - T, F2, 3, HOUSE, [[13, 15, 1, 2.2]]);
// Лестница вдоль северной стены, вверх на восток
const STEPS = 10, RISE = 3 / STEPS, RUN = 0.42;
// Перед нижней ступенью — метр площадки: к лестнице подходят вдоль неё
const SX = HX1 + T + 1.0, SZ1 = HZ2 - T - 1.3;
for (let i = 0; i < STEPS; i++) sym(SX + i * RUN, SZ1, SX + (i + 1) * RUN, HZ2 - T, RISE * (i + 1), WOOD, TER);
const STAIR_END = SX + STEPS * RUN;
for (const [x1, z1, x2, z2] of subtract([HX1 + T, HZ1 + T, HX2 - T, HZ2 - T], [[HX1 + T, SZ1 - 0.1, STAIR_END + 0.1, HZ2 - T]])) {
  sym(x1, z1, x2, z2, 0.25, FLOOR, F2 - 0.25);
}
sym(HX1 + T, SZ1 - 0.2, STAIR_END - 0.4, SZ1 - 0.1, 1, WOOD, F2);      // перила у проёма
// Третий этаж: окна на площадь и на восток
wallX(HZ1, HZ1 + T, HX1, HX2, F3, 3, HOUSE, [[-23, -21, 1, 2.2], [-18, -16, 1, 2.2]]);
wallX(HZ2 - T, HZ2, HX1, HX2, F3, 3, HOUSE, [[-19, -17, 1, 2.2]]);
wallZ(HX1, HX1 + T, HZ1 + T, HZ2 - T, F3, 3, HOUSE);
wallZ(HX2 - T, HX2, HZ1 + T, HZ2 - T, F3, 3, HOUSE, [[13, 15, 1, 2.2]]);
// Вторая лестница — со второго этажа на третий, вдоль западной стены, вверх на север
const S2X1 = HX1 + T, S2X2 = HX1 + T + 1.3, S2Z = HZ1 + T + 1.4;
for (let i = 0; i < STEPS; i++) sym(S2X1, S2Z + i * RUN, S2X2, S2Z + (i + 1) * RUN, RISE * (i + 1), WOOD, F2);
const S2_END = S2Z + STEPS * RUN;
for (const [x1, z1, x2, z2] of subtract([HX1 + T, HZ1 + T, HX2 - T, HZ2 - T], [[S2X1, S2Z - 0.1, S2X2 + 0.1, S2_END + 0.1]])) {
  sym(x1, z1, x2, z2, 0.25, FLOOR, F3 - 0.25);
}
sym(S2X2 + 0.1, S2Z - 0.1, S2X2 + 0.2, S2_END - 0.4, 1, WOOD, F3);      // перила у проёма
// Крыша с парапетом; на неё — лестница по восточной стене снаружи
sym(HX1, HZ1, HX2, HZ2, 0.3, ROOF, TOP);
sym(HX1, HZ1, HX2, HZ1 + 0.25, 1, HOUSE, TOP + 0.3);
sym(HX1, HZ2 - 0.25, HX2, HZ2, 1, HOUSE, TOP + 0.3);
sym(HX1, HZ1 + 0.25, HX1 + 0.25, HZ2 - 0.25, 1, HOUSE, TOP + 0.3);
sym(HX2 - 0.25, HZ1 + 0.25, HX2, 17.6, 1, HOUSE, TOP + 0.3);             // проём в парапете над лестницей

// ---------- Лавка внизу, на юго-западе (и отражением на северо-востоке) ----------
const LX1 = -21, LX2 = -12, LZ1 = -19, LZ2 = -11, LH = 3.4;
wallX(LZ2 - T, LZ2, LX1, LX2, 0, LH, SHOP, [[-20, -18.5, 1, 2.2], [-17, -15.6, 0, 2.3], [-14, -12.6, 1, 2.2]]);
wallX(LZ1, LZ1 + T, LX1, LX2, 0, LH, SHOP);
wallZ(LX1, LX1 + T, LZ1 + T, LZ2 - T, 0, LH, SHOP, [[-16, -14.6, 0, 2.3]]);
wallZ(LX2 - T, LX2, LZ1 + T, LZ2 - T, 0, LH, SHOP, [[-16, -14.6, 0, 2.3]]);
sym(LX1, LZ1, LX2, LZ2, 0.3, ROOF, LH);
sym(-19.5, -17.6, -15, -17, 1.05, WOOD);                                 // прилавок внутри
// Навес у входа
sym(-17.6, LZ2, -15, LZ2 + 1.4, 0.12, AWNING_A, 2.5);

// ---------- Площадь: рухнувшая водонапорная башня ----------
// Бак лежит вдоль улицы, расколот надвое; между половинами — проход
sym(-7, -1.6, -1, 1.6, 3, RUST);
sym(-5.2, -1.8, -4.7, 1.8, 3.1, IRON, 0.05);                             // обручи бака
sym(-2.6, -1.8, -2.1, 1.8, 3.1, IRON, 0.05);
// Опоры башни: одна ещё стоит, остальные лежат на площади
sym(-1.5, 4, 5, 4.4, 0.4, IRON);
sym(5.5, 6.5, 5.9, 6.9, 5, IRON);
sym(3, 7.8, 7.5, 8.2, 0.35, IRON);
// Обломки и ящики
sym(-3, 6.8, -1.8, 8, 1.1, WOOD);
sym(-1.8, 7.2, -1, 8, 0.8, WOOD);
sym(9, -1, 10.2, 0.2, 1.2, WOOD);

// ---------- Рынок: прилавки под навесами ----------
for (const [x, z, roof] of [[-11, -5, AWNING_A], [-11, 3, AWNING_B], [-8, -10.5, AWNING_B], [-3.6, -12, AWNING_A]] as const) {
  sym(x, z, x + 2.4, z + 1, 1, WOOD);                                    // прилавок
  for (const [px, pz] of [[x, z - 0.4], [x + 2.3, z - 0.4], [x, z + 1.3], [x + 2.3, z + 1.3]] as const) sym(px, pz, px + 0.1, pz + 0.1, 2.4, WOOD);
  sym(x - 0.2, z - 0.6, x + 2.6, z + 1.6, 0.1, roof, 2.4);               // навес
}
// Машины на улице
for (const z of [4.6, 6.0]) for (const x of [-12, -9.3]) sym(x, z, x + 0.35, z + 0.5, 0.3, DARK);
sym(-12, 4.4, -8.9, 6.6, 0.8, CAR, 0.3);
sym(-11.3, 4.6, -9.6, 6.4, 0.55, DARK, 1.1);
// Двор с забором у южного переулка — обход к площади (и отражением на севере)
sym(0.5, -20, 0.65, -16, 1.8, WOOD);
sym(0.5, -16.15, 4, -16, 1.8, WOOD);
sym(2, -19.5, 3.2, -18.3, 1.2, WOOD);
sym(4.2, -18, 5, -17.2, 0.9, WOOD);
// Низкие стенки у окраин — прикрывают точки появления
sym(-16, 1.5, -15.6, 5, 1.6, CLAY);
sym(-16, -7.5, -15.6, -4.5, 1.6, CLAY);

// ---------- Двери и окна: двери открываются на F, стёкла и двери можно разбить ----------
let nextId = 1;
const breakables: Breakable[] = [];
const breakable = (kind: 'glass' | 'door', x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): void => {
  for (const box of [{ min: [x1, y1, z1], max: [x2, y2, z2] }, { min: [-x2, y1, -z2], max: [-x1, y2, -z1] }] as const) {
    breakables.push({
      id: nextId++, kind, hp: kind === 'glass' ? 20 : 250,
      box: { min: [...box.min], max: [...box.max], color: kind === 'glass' ? GLASS : DOOR },
    });
  }
};
breakable('door', -20, TER, HZ1 + 0.05, -18.6, TER + 2.3, HZ1 + 0.25);   // дом: на юг
breakable('door', HX2 - 0.25, TER, 15, HX2 - 0.05, TER + 2.3, 16.4);    // дом: на восток
breakable('door', -17, 0, LZ2 - 0.25, -15.6, 2.3, LZ2 - 0.05);          // лавка: на площадь
breakable('glass', -23, TER + 1, HZ1 + 0.1, -21.5, TER + 2.2, HZ1 + 0.2); // окна дома на площадь
breakable('glass', -17, TER + 1, HZ1 + 0.1, -15.8, TER + 2.2, HZ1 + 0.2);
breakable('glass', -20, 1, LZ2 - 0.2, -18.5, 2.2, LZ2 - 0.1);           // окна лавки
breakable('glass', -14, 1, LZ2 - 0.2, -12.6, 2.2, LZ2 - 0.1);

// Лестница на крышу дома — снаружи по восточной стене
const ladders: Ladder[] = [
  { min: [HX2, TER, 17.6], max: [HX2 + 0.45, TOP + 0.4, 18.8], normal: [1, 0] },
  { min: [-HX2 - 0.45, TER, -18.8], max: [-HX2, TOP + 0.4, -17.6], normal: [-1, 0] },
];

addGround(boxes, HALF, SAND);

// Зелёные — на западной окраине (взгляд на восток), красные — на восточной
const E = -Math.PI / 2, W = Math.PI / 2;
const green: SpawnPoint[] = [[-26, -6, E], [-26, -2, E], [-26, 2, E], [-26, 6, E], [-25.5, 14, E, TER], [-24.5, -20.5, E]];
const red: SpawnPoint[] = green.map(([x, z, , y]) => (y === undefined ? [-x, -z, W] : [-x, -z, W, y]) as SpawnPoint);

export const FALL: GameMap = {
  id: 'fall',
  name: 'Падение',
  fresh: true,
  half: HALF,
  floor: SAND,
  sky: '#e9d3a8',
  boxes,
  ladders,
  breakables,
  crateDrops: [[-4, 0, -6], [4, 0, 6], [-10, TER, 17], [10, TER, -17]],
  medkitDrops: [[-14, 0, 0], [14, 0, 0], [0, 0, -9.5], [0, 0, 9.5]],
  spawns: {
    green,
    red,
    // Плюс этажи трёхэтажек и площадь у бака
    ffa: [...green, ...red, [-19, 15, E, F2], [19, -15, W, F2], [-19, 15, E, F3], [19, -15, W, F3], [0, -5.5, 0], [0, 5.5, Math.PI]],
  },
};
