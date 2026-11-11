// Звук: выстрелы, взрывы и сигналы синтезируются через Web Audio.
import type { WeaponId } from '../../shared/protocol.js';
import { settings } from './settings.js';

export let audio: AudioContext | null = null;

export let master: GainNode | null = null;

export function initAudio(): void {
  if (audio) return;
  try {
    audio = new AudioContext();
    master = audio.createGain();
    master.gain.value = settings.volume;
    master.connect(audio.destination);
  } catch { /* без звука */ }
}

const SOUND: Record<WeaponId | 'boom' | 'slide', { dur: number; freq: number; gain: number; high?: boolean }> = {
  pistol: { dur: 0.18, freq: 1800, gain: 0.35 },
  shotgun: { dur: 0.35, freq: 900, gain: 0.35 },
  rifle: { dur: 0.14, freq: 2600, gain: 0.35 },
  smg: { dur: 0.1, freq: 3000, gain: 0.3 },
  lmg: { dur: 0.16, freq: 1700, gain: 0.4 },
  grenade: { dur: 0.12, freq: 2500, gain: 0.25, high: true },
  sniper: { dur: 0.5, freq: 1300, gain: 0.55 },
  knife: { dur: 0.12, freq: 2500, gain: 0.25, high: true },
  rocket: { dur: 0.35, freq: 600, gain: 0.35 },
  boom: { dur: 0.8, freq: 350, gain: 0.9 },
  slide: { dur: 0.5, freq: 1200, gain: 0.15, high: true },
};

export function shotSound(w: WeaponId | 'boom' | 'slide', volume = 1): void {
  if (!audio || !master || volume <= 0.01) return;
  const snd = SOUND[w];
  const dur = snd.dur;
  const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * dur), audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  const src = audio.createBufferSource();
  src.buffer = buf;
  const filter = audio.createBiquadFilter();
  filter.type = snd.high ? 'highpass' : 'lowpass';
  filter.frequency.value = snd.freq;
  const gain = audio.createGain();
  gain.gain.value = snd.gain * volume;
  src.connect(filter).connect(gain).connect(master);
  src.start();
}

export function beep(freq: number, dur: number, volume = 0.15): void {
  if (!audio || !master) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(volume, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(audio.currentTime + dur);
}
