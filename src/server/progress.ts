// Прогресс игрока хранится в браузере, но в виде токена, зашифрованного
// ключом сервера (AES-256-GCM). Браузер не может ни прочитать, ни подделать
// токен: любое изменение ломает проверку подлинности.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATS, maxLevel, newProfile, pointsLeft, type Profile } from '../shared/progress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (data: string | Buffer): Buffer => crypto.createHash('sha256').update(data).digest();

function loadKey(): Buffer {
  const env = process.env.PROGRESS_SECRET;
  if (env) return sha256(env);

  const dir = process.env.DATA_DIR ?? path.resolve(__dirname, '..', '..', 'data');
  const file = path.join(dir, 'secret.key');
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    // ключа ещё нет — создаём
  }
  const secret = crypto.randomBytes(32);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
  } catch (err) {
    console.warn(`Не удалось сохранить ключ в ${file}: прокачка игроков сбросится при перезапуске сервера.`, err);
  }
  return sha256(secret);
}

const KEY = loadKey();
const IV_LEN = 12, TAG_LEN = 16;
export const MAX_TOKEN_LEN = 512;

export function encodeProfile(p: Profile): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const payload = JSON.stringify({ v: 1, k: p.kills, d: p.deaths, l: STATS.map((s) => p.levels[s]) });
  const body = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** Расшифровывает токен. Пустой, чужой или испорченный токен даёт новый профиль. */
export function decodeProfile(token: unknown): Profile {
  const fresh = newProfile();
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LEN) return fresh;
  try {
    const raw = Buffer.from(token, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, IV_LEN));
    decipher.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN));
    const text = Buffer.concat([decipher.update(raw.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString('utf8');
    const data = JSON.parse(text) as { v?: unknown; k?: unknown; d?: unknown; l?: unknown };
    if (data.v !== 1 || !Number.isSafeInteger(data.k) || (data.k as number) < 0 || !Array.isArray(data.l)) return fresh;
    const profile = newProfile();
    profile.kills = data.k as number;
    // Смерти начали считать позже — в старых токенах их нет
    if (Number.isSafeInteger(data.d) && (data.d as number) >= 0) profile.deaths = data.d as number;
    STATS.forEach((s, i) => {
      const lvl: unknown = (data.l as unknown[])[i];
      if (!Number.isInteger(lvl) || (lvl as number) < 0 || (lvl as number) > maxLevel(s)) throw new Error('level');
      profile.levels[s] = lvl as number;
    });
    return pointsLeft(profile) >= 0 ? profile : fresh;
  } catch {
    return fresh;
  }
}
