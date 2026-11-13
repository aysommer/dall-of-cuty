// Карта «Падение»: глиняный городок, разрезанный двумя улицами. Главная улица идёт с запада на восток
// от одной окраины, где появляются команды, к другой; поперечная — с севера на юг. На перекрёстке
// лежит рухнувшая водонапорная башня: бак раскололся надвое, все пути проходят мимо него.
// У каждой стороны свои ключевые здания: трёхэтажка с выходом на крышу (окна на улицу и перекрёсток),
// двухэтажный дом с балконом над главной улицей и крытый рынок у перекрёстка. Рядом с трёхэтажкой —
// двор за забором. Вдоль северного и южного краёв — тихие переулки для обхода, края закрыты стеной.
// Планировка своя и симметрична относительно центра, чтобы стороны были в равных условиях.
import { builder, type Breakable, type GameMap, type Ladder, type SpawnPoint } from './types.js';
import { addGround, subtract } from './ground.js';

const HALF = { x: 30, z: 22 };
const WALL_H = 4.5;

const SAND = '#d8c39a';
const CLAY = '#c79a6b';
const TOWER = '#d9c3a0';
const HOUSE = '#b9a58a';
const FLOOR = '#8a6a45';
const ROOF = '#9c7f5c';
const RUST = '#7d6a58';
const IRON = '#5b5f66';
const AWNING_A = '#b5473a';
const AWNING_B = '#3a7fb5';
const WOOD = '#8a5a2b';
const FENCE = '#7a5a3a';
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

type Open = Array<[number, number, number, number]>;
/**
 * Стена вдоль оси X (z1…z2 — толщина) от x1 до x2 с проёмами [a1, a2, подоконник, верх проёма];
 * подоконник 0 — дверь. Всё с отражением через центр.
 */
const wallX = (z1: number, z2: number, x1: number, x2: number, y0: number, h: number, color: string, open: Open = []): void => {
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
const wallZ = (x1: number, x2: number, z1: number, z2: number, y0: number, h: number, color: string, open: Open = []): void => {
  let z = z1;
  for (const [a1, a2, sill, top] of open) {
    if (a1 > z) sym(x1, z, x2, a1, h, color, y0);
    if (sill > 0) sym(x1, a1, x2, a2, sill, color, y0);
    if (top < h) sym(x1, a1, x2, a2, h - top, color, y0 + top);
    z = a2;
  }
  if (z < z2) sym(x1, z, x2, z2, h, color, y0);
};

const T = 0.3;                                   // толщина стен
const STEPS = 10, RISE = 0.3, RUN = 0.42;        // пролёт лестницы — 3 м по высоте

// ---------- Трёхэтажка: северо-запад (и отражением юго-восток) ----------
// Три этажа и крыша; окна на главную улицу, на поперечную и в северный переулок.
const HX1 = -15, HX2 = -7, HZ1 = 8, HZ2 = 16;
const F2 = 3, F3 = 6, TOP = 9;
// Первый этаж: дверь на улицу, во двор и на поперечную улицу
wallX(HZ1, HZ1 + T, HX1, HX2, 0, 3, TOWER, [[-14, -12.5, 1, 2.2], [-11.4, -10.1, 0, 2.3], [-9, -7.6, 1, 2.2]]);
wallX(HZ2 - T, HZ2, HX1, HX2, 0, 3, TOWER);
wallZ(HX1, HX1 + T, HZ1 + T, HZ2 - T, 0, 3, TOWER, [[10, 11.3, 0, 2.3]]);
wallZ(HX2 - T, HX2, HZ1 + T, HZ2 - T, 0, 3, TOWER, [[9.5, 10.8, 0, 2.3], [12.5, 14, 1, 2.2]]);
// Второй этаж: окна на юг, восток и север
wallX(HZ1, HZ1 + T, HX1, HX2, F2, 3, TOWER, [[-14, -12.2, 1, 2.2], [-10, -8.2, 1, 2.2]]);
wallX(HZ2 - T, HZ2, HX1, HX2, F2, 3, TOWER, [[-9.2, -7.8, 1, 2.2]]);
wallZ(HX1, HX1 + T, HZ1 + T, HZ2 - T, F2, 3, TOWER);
wallZ(HX2 - T, HX2, HZ1 + T, HZ2 - T, F2, 3, TOWER, [[10, 12, 1, 2.2]]);
// Третий этаж: окна на все стороны
wallX(HZ1, HZ1 + T, HX1, HX2, F3, 3, TOWER, [[-14, -12.2, 1, 2.2], [-10, -8.2, 1, 2.2]]);
wallX(HZ2 - T, HZ2, HX1, HX2, F3, 3, TOWER, [[-12, -10, 1, 2.2]]);
wallZ(HX1, HX1 + T, HZ1 + T, HZ2 - T, F3, 3, TOWER, [[9, 10.5, 1, 2.2]]);
wallZ(HX2 - T, HX2, HZ1 + T, HZ2 - T, F3, 3, TOWER, [[10, 12, 1, 2.2]]);
// Первый пролёт — вдоль северной стены, вверх на восток; перед нижней ступенью метр площадки
const SX = HX1 + T + 1.0, SZ1 = HZ2 - T - 1.3;
for (let i = 0; i < STEPS; i++) sym(SX + i * RUN, SZ1, SX + (i + 1) * RUN, HZ2 - T, RISE * (i + 1), WOOD);
const STAIR_END = SX + STEPS * RUN;
for (const [x1, z1, x2, z2] of subtract([HX1 + T, HZ1 + T, HX2 - T, HZ2 - T], [[HX1 + T, SZ1 - 0.1, STAIR_END + 0.1, HZ2 - T]])) {
  sym(x1, z1, x2, z2, 0.25, FLOOR, F2 - 0.25);
}
sym(HX1 + T, SZ1 - 0.2, STAIR_END - 0.4, SZ1 - 0.1, 1, WOOD, F2);        // перила у проёма
// Второй пролёт — вдоль западной стены, вверх на север
const S2X1 = HX1 + T, S2X2 = HX1 + T + 1.3, S2Z = HZ1 + T + 1.4;
for (let i = 0; i < STEPS; i++) sym(S2X1, S2Z + i * RUN, S2X2, S2Z + (i + 1) * RUN, RISE * (i + 1), WOOD, F2);
const S2_END = S2Z + STEPS * RUN;
for (const [x1, z1, x2, z2] of subtract([HX1 + T, HZ1 + T, HX2 - T, HZ2 - T], [[S2X1, S2Z - 0.1, S2X2 + 0.1, S2_END + 0.1]])) {
  sym(x1, z1, x2, z2, 0.25, FLOOR, F3 - 0.25);
}
sym(S2X2 + 0.1, S2Z - 0.1, S2X2 + 0.2, S2_END - 0.4, 1, WOOD, F3);        // перила у проёма
// Крыша с парапетом; на неё — лестница снаружи по западной стене, со двора
sym(HX1, HZ1, HX2, HZ2, 0.3, ROOF, TOP);
sym(HX1, HZ1, HX2, HZ1 + 0.25, 1, TOWER, TOP + 0.3);
sym(HX1, HZ2 - 0.25, HX2, HZ2, 1, TOWER, TOP + 0.3);
sym(HX2 - 0.25, HZ1 + 0.25, HX2, HZ2 - 0.25, 1, TOWER, TOP + 0.3);
sym(HX1, HZ1 + 0.25, HX1 + 0.25, 12.3, 1, TOWER, TOP + 0.3);
sym(HX1, 13.9, HX1 + 0.25, HZ2 - 0.25, 1, TOWER, TOP + 0.3);             // проём в парапете над лестницей

// ---------- Двор за забором к западу от трёхэтажки ----------
const YX1 = -23, YZ1 = 5.5, YZ2 = 16;
wallX(YZ2 - 0.15, YZ2, YX1, HX1, 0, 2, FENCE, [[-20, -18.5, 0, 2]]);      // калитка в переулок
wallX(YZ1, YZ1 + 0.15, YX1, HX1, 0, 2, FENCE, [[-18.5, -17, 0, 2]]);      // калитка на улицу
wallZ(YX1, YX1 + 0.15, YZ1 + 0.15, YZ2 - 0.15, 0, 2, FENCE, [[9.5, 11, 0, 2]]); // калитка к окраине
sym(-21.5, 13.3, -20.3, 14.5, 1.2, WOOD);                                 // ящики во дворе
sym(-20.3, 13.6, -19.5, 14.4, 0.8, WOOD);
sym(-18.6, 8.2, -17.4, 9.4, 1.2, WOOD);
sym(-21.8, 6.4, -20.6, 7.6, 0.9, WOOD);
// Вдоль поперечной улицы у трёхэтажки — бочки
sym(-5.8, 12.5, -5, 13.3, 1.1, IRON);
sym(-5.6, 14.6, -4.8, 15.4, 1.1, IRON);

// ---------- Дом с балконом: юго-запад (и отражением северо-восток) ----------
const BX1 = -21, BX2 = -13, BZ1 = -15, BZ2 = -7;
const BF2 = 3, BROOF = 6;
// Первый этаж: дверь на улицу, к окраине и в проход к рынку
wallX(BZ2 - T, BZ2, BX1, BX2, 0, 3, HOUSE, [[-20, -18.6, 1, 2.2], [-15.6, -14.3, 0, 2.3]]);
wallX(BZ1, BZ1 + T, BX1, BX2, 0, 3, HOUSE);
wallZ(BX1, BX1 + T, BZ1 + T, BZ2 - T, 0, 3, HOUSE, [[-10.2, -8.9, 0, 2.3]]);
wallZ(BX2 - T, BX2, BZ1 + T, BZ2 - T, 0, 3, HOUSE, [[-12.2, -10.9, 0, 2.3]]);
// Второй этаж: дверь на балкон, окна на улицу, к окраине и на рынок
wallX(BZ2 - T, BZ2, BX1, BX2, BF2, 3, HOUSE, [[-18.6, -17.3, 0, 2.3], [-15.8, -14.2, 1, 2.2]]);
wallX(BZ1, BZ1 + T, BX1, BX2, BF2, 3, HOUSE, [[-15, -13.6, 1, 2.2]]);
wallZ(BX1, BX1 + T, BZ1 + T, BZ2 - T, BF2, 3, HOUSE, [[-11, -9.5, 1, 2.2]]);
wallZ(BX2 - T, BX2, BZ1 + T, BZ2 - T, BF2, 3, HOUSE, [[-10, -8.4, 1, 2.2]]);
sym(BX1, BZ1, BX2, BZ2, 0.3, ROOF, BROOF);
// Лестница вдоль южной стены, вверх на восток
const BSX = BX1 + T + 1.0, BSZ2 = BZ1 + T + 1.3;
for (let i = 0; i < STEPS; i++) sym(BSX + i * RUN, BZ1 + T, BSX + (i + 1) * RUN, BSZ2, RISE * (i + 1), WOOD);
const B_END = BSX + STEPS * RUN;
for (const [x1, z1, x2, z2] of subtract([BX1 + T, BZ1 + T, BX2 - T, BZ2 - T], [[BX1 + T, BZ1 + T, B_END + 0.1, BSZ2 + 0.1]])) {
  sym(x1, z1, x2, z2, 0.25, FLOOR, BF2 - 0.25);
}
sym(BX1 + T, BSZ2 + 0.1, B_END - 0.4, BSZ2 + 0.2, 1, WOOD, BF2);           // перила у проёма
// Балкон над главной улицей
sym(-20.5, BZ2, -13.5, BZ2 + 1.4, 0.25, FLOOR, BF2 - 0.25);
sym(-20.5, BZ2 + 1.25, -13.5, BZ2 + 1.4, 1, WOOD, BF2);
sym(-20.5, BZ2, -20.35, BZ2 + 1.25, 1, WOOD, BF2);
sym(-13.65, BZ2, -13.5, BZ2 + 1.25, 1, WOOD, BF2);

// ---------- Крытый рынок у перекрёстка (юго-запад и отражением северо-восток) ----------
const MX1 = -11, MX2 = -4, MZ1 = -15, MZ2 = -6;
sym(MX1, MZ1, MX2, MZ2, 0.15, AWNING_A, 3);                                // навес
for (const x of [MX1, -7.6, MX2 - 0.2]) for (const z of [MZ1, MZ2 - 0.2]) sym(x, z, x + 0.2, z + 0.2, 3, WOOD);
sym(MX1, MZ1, -7.6, MZ1 + 0.2, 2.2, WOOD);                                 // задняя стенка лавки
sym(-10, -13, -8, -12.4, 1, WOOD);                                         // прилавки
sym(-7, -9.6, -5, -9, 1, WOOD);
sym(-10.4, -9.4, -9.6, -7.8, 1, WOOD);
sym(-5.6, -13.6, -4.6, -12.6, 1.1, WOOD);                                  // ящики
sym(-6.4, -13.4, -5.8, -12.8, 0.6, WOOD);
// Палатка у входа на рынок
sym(-12.7, -6.5, -11.5, -5.5, 0.1, AWNING_B, 2.4);
for (const [px, pz] of [[-12.7, -6.5], [-11.6, -6.5], [-12.7, -5.6], [-11.6, -5.6]] as const) sym(px, pz, px + 0.1, pz + 0.1, 2.4, WOOD);

// ---------- Перекрёсток: рухнувшая водонапорная башня ----------
// Бак лежит поперёк главной улицы, расколот надвое; между половинами — проход по поперечной улице
sym(-7, -1.6, -1.2, 1.6, 3, RUST);
sym(-5.2, -1.8, -4.7, 1.8, 3.1, IRON, 0.05);                              // обручи бака
sym(-2.9, -1.8, -2.4, 1.8, 3.1, IRON, 0.05);
// Опоры башни: одна ещё стоит, остальные лежат
sym(0.6, 3.2, 1, 3.6, 5, IRON);
sym(-1.5, 3.4, 4.5, 3.8, 0.4, IRON);
sym(2.5, -4.6, 6.5, -4.2, 0.35, IRON);
// Сорванная с бака площадка обслуживания лежит рядом
sym(7.4, -3.4, 9, -1.4, 2.1, RUST);
sym(7.2, -3.6, 9.2, -3.4, 2.3, IRON);

// ---------- Главная улица: машины и низкие стенки ----------
for (const z of [2.3, 3.7]) for (const x of [-17, -14.4]) sym(x, z, x + 0.35, z + 0.5, 0.3, DARK);
sym(-17.2, 2.1, -14, 4.4, 0.8, CAR, 0.3);
sym(-16.5, 2.3, -14.7, 4.2, 0.55, DARK, 1.1);
sym(-10.2, -4.6, -9.8, -1.8, 1.2, CLAY);                                   // стенка у рынка
sym(-11.8, 1.6, -10.6, 2.8, 1.1, WOOD);                                    // ящики
// Окраина: машина и стенки прикрывают точку появления
for (const z of [-0.8, 1.8]) for (const x of [-24.3, -22.5]) sym(x, z, x + 0.5, z + 0.35, 0.3, DARK);
sym(-24.4, -1, -22.2, 2.4, 0.8, CAR, 0.3);
sym(-24.2, -0.6, -22.4, 2, 0.55, DARK, 1.1);
sym(-24, -6, -23.6, -3.4, 1.6, CLAY);
sym(-24, 3.8, -23.6, 6.2, 1.6, CLAY);

// ---------- Переулки вдоль краёв ----------
sym(-9, -19.5, -7.6, -18.1, 1.4, WOOD);                                    // ящики в южном переулке
sym(-7.6, -19.2, -6.8, -18.4, 0.9, WOOD);
sym(4.5, -22, 7, -20.6, 1.6, IRON);                                        // мусорный бак
sym(-25, -21.2, -23.8, -20, 1.2, WOOD);

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
breakable('door', -11.4, 0, HZ1 + 0.05, -10.1, 2.3, HZ1 + 0.25);         // трёхэтажка: на улицу
breakable('door', HX2 - 0.25, 0, 9.5, HX2 - 0.05, 2.3, 10.8);             // трёхэтажка: на поперечную улицу
breakable('glass', -14, 1, HZ1 + 0.1, -12.5, 2.2, HZ1 + 0.2);             // окна первого этажа
breakable('glass', -9, 1, HZ1 + 0.1, -7.6, 2.2, HZ1 + 0.2);
breakable('door', -15.6, 0, BZ2 - 0.25, -14.3, 2.3, BZ2 - 0.05);          // дом: на улицу
breakable('door', BX1 + 0.05, 0, -10.2, BX1 + 0.25, 2.3, -8.9);           // дом: к окраине
breakable('glass', -20, 1, BZ2 - 0.2, -18.6, 2.2, BZ2 - 0.1);             // окно дома на улицу

// Лестница на крышу трёхэтажки — снаружи по западной стене, во дворе
const ladders: Ladder[] = [
  { min: [HX1 - 0.45, 0, 12.5], max: [HX1, TOP + 0.4, 13.7], normal: [-1, 0] },
  { min: [-HX1, 0, -13.7], max: [-HX1 + 0.45, TOP + 0.4, -12.5], normal: [1, 0] },
];

addGround(boxes, HALF, SAND);

// Зелёные — на западной окраине (взгляд на восток), красные — на восточной
const E = -Math.PI / 2, W = Math.PI / 2;
const green: SpawnPoint[] = [[-27.5, -12], [-27.5, -6.5], [-26.5, -2.5], [-26.5, 4.5], [-27.5, 9], [-27.5, 14]].map(([x, z]) => [x, z, E] as SpawnPoint);
const red: SpawnPoint[] = green.map(([x, z]) => [-x, -z, W] as SpawnPoint);

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
  crateDrops: [[0, 0, 6], [0, 0, -6], [-20, 0, 11], [20, 0, -11]],
  medkitDrops: [[-7.5, 0, -11], [7.5, 0, 11], [-12, 0, 19], [12, 0, -19]],
  spawns: {
    green,
    red,
    // Плюс этажи трёхэтажек, второй этаж домов и переулки
    ffa: [...green, ...red, [-11, 11, E, F2], [11, -11, W, F2], [-11, 11, E, F3], [11, -11, W, F3],
      [-17, -10, E, BF2], [17, 10, W, BF2], [0, -19, 0], [0, 19, Math.PI]],
  },
};
