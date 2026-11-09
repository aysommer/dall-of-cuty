// Общие данные для клиента и сервера: карта, оружие, размеры игрока.
// Вся геометрия — только прямоугольные блоки.

export const PLAYER = { w: 0.8, h: 1.8, eye: 1.6 };

export const WEAPONS = {
  pistol:  { name: 'Пистолет', dmg: 25, pellets: 1, rate: 280, mag: 12, reload: 1200, spread: 0.008, auto: false },
  shotgun: { name: 'Дробовик', dmg: 13, pellets: 8, rate: 900, mag: 6,  reload: 2200, spread: 0.07,  auto: false },
  rifle:   { name: 'Винтовка', dmg: 30, pellets: 1, rate: 110, mag: 30, reload: 2000, spread: 0.018, auto: true },
};
export const WEAPON_ORDER = ['pistol', 'shotgun', 'rifle'];

export const WORLD = { half: 30, wallH: 6 };

const SAND = '#d8b878';
const SAND_DARK = '#b9965a';
const STONE = '#9c8f7a';
const CRATE = '#8a5a2b';
const CRATE_LIGHT = '#a8743a';
const TUNNEL = '#6f6455';

export const BOXES = [];
function b(x1, z1, x2, z2, h, color, y = 0) {
  BOXES.push({ min: [x1, y, z1], max: [x2, y + h, z2], color });
}

// Внешние стены
b(-31, -31, 31, -30, WORLD.wallH, SAND_DARK);
b(-31, 30, 31, 31, WORLD.wallH, SAND_DARK);
b(-31, -30, -30, 30, WORLD.wallH, SAND_DARK);
b(30, -30, 31, 30, WORLD.wallH, SAND_DARK);

// Четыре больших здания, делящих карту на три линии: запад, центр, восток
b(-14, -18, -4, -3, 5, SAND);
b(-14, 3, -4, 18, 5, SAND);
b(4, -18, 14, -3, 5, SAND);
b(4, 3, 14, 18, 5, SAND);

// Центр: «двойные двери» с узким проходом
b(-4, -0.4, -1.2, 0.4, 3.5, STONE);
b(1.2, -0.4, 4, 0.4, 3.5, STONE);
b(-3.6, 8, -1.6, 10, 1.2, CRATE);
b(1.6, -10, 3.6, -8, 1.2, CRATE);

// Западная линия («длина»): открытая, с ящиками и полустенкой
b(-30, -0.5, -24, 0.5, 3, STONE);
b(-21, -1.5, -18, 1.5, 1.2, CRATE);
b(-21, -1.5, -19.5, 0, 1.2, CRATE_LIGHT, 1.2);
b(-27, 7, -25, 9, 2.4, CRATE);
b(-17.5, -12, -15.5, -10, 1.2, CRATE_LIGHT);
b(-28, -13, -26, -11, 1.2, CRATE);
b(-17.5, 11, -15.5, 13, 1.2, CRATE);

// Восточная линия («туннель»): крыша и два дверных проёма
b(14, -10, 30, 10, 0.5, TUNNEL, 3.6);
b(14, -10, 21, -9, 3.6, TUNNEL);
b(23, 9, 30, 10, 3.6, TUNNEL);
b(20, -1, 22, 1, 1.2, CRATE);
b(26, 2, 28, 4, 1.2, CRATE_LIGHT);
b(16, -5, 18, -3, 1.2, CRATE_LIGHT);

// Базы: укрытия у точек появления
b(-9, 21.5, -5, 22.5, 1.5, STONE);
b(5, 21.5, 9, 22.5, 1.5, STONE);
b(-9, -22.5, -5, -21.5, 1.5, STONE);
b(5, -22.5, 9, -21.5, 1.5, STONE);
b(18, 20, 20, 22, 1.2, CRATE);
b(-20, -22, -18, -20, 1.2, CRATE);
b(-22, 23, -20, 25, 1.2, CRATE_LIGHT);
b(20, -25, 22, -23, 1.2, CRATE_LIGHT);

// Точки появления: [x, z, yaw]. yaw = 0 — взгляд на север (-z).
export const SPAWNS = {
  green: [[-6, 26, 0], [-2, 26, 0], [2, 26, 0], [6, 26, 0]],
  red: [[-6, -26, Math.PI], [-2, -26, Math.PI], [2, -26, Math.PI], [6, -26, Math.PI]],
  ffa: [
    [-6, 26, 0], [6, 26, 0], [-6, -26, Math.PI], [6, -26, Math.PI],
    [-26, 16, 0], [-26, -18, Math.PI], [26, 16, 0], [26, -16, Math.PI],
    [-22, 27, 0], [22, -27, Math.PI],
  ],
};

// Пересечение луча с блоком (метод «слэбов»).
// Возвращает расстояние вдоль луча либо Infinity.
export function rayBox(o, d, min, max) {
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
    } else {
      let a = (min[i] - o[i]) / d[i];
      let c = (max[i] - o[i]) / d[i];
      if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

// Ближайшее пересечение луча с геометрией карты (включая пол).
export function rayWorld(o, d, maxDist = 200) {
  let t = maxDist;
  if (d[1] < -1e-9) {
    const tf = -o[1] / d[1];
    if (tf >= 0 && tf < t) t = tf;
  }
  for (const box of BOXES) {
    const tb = rayBox(o, d, box.min, box.max);
    if (tb < t) t = tb;
  }
  return t;
}

// Есть ли прямая видимость между двумя точками.
export function lineOfSight(a, c) {
  const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return true;
  d[0] /= len; d[1] /= len; d[2] /= len;
  return rayWorld(a, d, len) >= len - 0.05;
}
