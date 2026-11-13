// Интерполяция положений других игроков по меткам времени отправителя (без зависимостей — проверяется в тестах).
// Игрок рисуется с небольшой задержкой между двумя соседними положениями: снимки приходят неровно (сеть, редкие кадры
// у отправителя), а движение на экране остаётся ровным.

/** Положение с меткой времени отправителя: [ts, x, y, z, yaw] */
export type Sample = [number, number, number, number, number];

/**
 * На сколько отстаём от отправителя, мс: не меньше двух тактов сервера, а если отправитель шлёт реже
 * (тормозит его графика) — на полтора его интервала больше, чтобы между двумя положениями всегда было что рисовать.
 */
export const INTERP_DELAY = 100;
export const delayFor = (gap: number): number => Math.min(300, Math.max(INTERP_DELAY, 60 + gap * 1.5));
/** Дальше этого не угадываем вперёд, если новые положения задержались, мс */
export const MAX_EXTRAPOLATE = 120;
/** Скачок больше этого между соседними положениями — телепорт (появление), без размазывания, м */
const TELEPORT = 3;

/** Состояние интерполяции одного игрока */
export interface Interp {
  buf: Sample[];
  /** Оценка разницы часов (наше время − время отправителя) */
  off: number | null;
  /** Средний интервал между положениями отправителя, мс */
  gap: number;
  /** На сколько сейчас отстаём (разница часов + задержка); меняется плавно, без скачков времени */
  lag: number | null;
  lastNow: number;
}
export const newInterp = (): Interp => ({ buf: [], off: null, gap: 50, lag: null, lastNow: 0 });

/** Добавить положение в буфер (повторы — те же метки — пропускаются), обновить оценку разницы часов и интервала. */
export function pushSample(st: Interp, s: Sample, now: number): void {
  const buf = st.buf;
  const last = buf.at(-1);
  if (last && s[0] <= last[0]) return;
  // Интервал между положениями отправителя: быстро растёт, медленно спадает
  if (last) { const g = Math.min(500, s[0] - last[0]); st.gap = g > st.gap ? st.gap + (g - st.gap) * 0.5 : st.gap + (g - st.gap) * 0.05; }
  buf.push(s);
  if (buf.length > 30) buf.shift();
  // Разница часов «наше время − время отправителя»: берём наименьшую (самая быстрая доставка),
  // а если сеть стала медленнее — медленно подстраиваемся
  const o = now - s[0];
  st.off = st.off === null || o < st.off ? o : st.off + (o - st.off) * 0.02;
}

/** Положение на момент «сейчас − задержка» по часам отправителя; null — буфер пуст. */
export function sampleAt(st: Interp, now: number): Sample | null {
  const { buf, off } = st;
  if (!buf.length || off === null) return null;
  // Отставание подтягивается к нужному не быстрее 5 % от прошедшего времени: время отрисовки не прыгает,
  // и движение не дёргается, когда меняется оценка часов или задержка
  const want = off + delayFor(st.gap);
  if (st.lag === null || Math.abs(want - st.lag) > 400) st.lag = want;
  else {
    const step = Math.max(0, now - st.lastNow) * 0.05;
    st.lag += Math.max(-step, Math.min(step, want - st.lag));
  }
  st.lastNow = now;
  const t = now - st.lag;
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1]![0] > t) i--;
  const hi = buf[i]!, lo = i > 0 ? buf[i - 1]! : hi;
  if (t >= hi[0]) {
    // Новых положений ещё нет: немного продолжаем движение по последней скорости, потом стоим
    const prev = buf.length > 1 ? buf[buf.length - 2]! : hi;
    const span = hi[0] - prev[0];
    const f = span > 0 && Math.hypot(hi[1] - prev[1], hi[3] - prev[3]) < TELEPORT ? Math.min(t - hi[0], MAX_EXTRAPOLATE) / span : 0;
    return [t, hi[1] + (hi[1] - prev[1]) * f, hi[2], hi[3] + (hi[3] - prev[3]) * f, hi[4]];
  }
  if (Math.hypot(hi[1] - lo[1], hi[2] - lo[2], hi[3] - lo[3]) > TELEPORT) return hi;
  const f = hi[0] > lo[0] ? Math.max(0, (t - lo[0]) / (hi[0] - lo[0])) : 1;
  const dy = Math.atan2(Math.sin(hi[4] - lo[4]), Math.cos(hi[4] - lo[4]));
  return [t, lo[1] + (hi[1] - lo[1]) * f, lo[2] + (hi[2] - lo[2]) * f, lo[3] + (hi[3] - lo[3]) * f, lo[4] + dy * f];
}
