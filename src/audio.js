// Chiptune sound effects and music, synthesized live with the Web Audio API.
// Square/triangle oscillators and a noise channel, like a 2A03.

const NOTE_INDEX = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

/** "A4" → 440 Hz. "." or "" is a rest. */
export function noteFreq(name) {
  if (!name || name === '.') return 0;
  const m = /^([A-G]#?)(\d)$/.exec(name);
  if (!m) return 0;
  const semis = NOTE_INDEX[m[1]] + (Number(m[2]) + 1) * 12 - 69;
  return 440 * 2 ** (semis / 12);
}

const seq = (s) => s.trim().split(/\s+/);

// Patterns are written in eighth notes. Bass loops under a longer lead line; drums are k/s/h.
const TRACKS = {
  title: {
    bpm: 96,
    bass: seq('A2 . . . A2 . . . F2 . . . F2 . . . D2 . . . D2 . . . E2 . . . E2 . G#2 .'),
    lead: seq(`A4 . . . C5 . B4 . A4 . . . E4 . . . F4 . . . A4 . G4 . E4 . . . . . . .
               A4 . . . C5 . D5 . E5 . . . D5 . C5 . B4 . . . G#4 . . . A4 . . . . . . .`),
    drums: seq('k . . . . . . . s . . . . . . .'),
    leadVol: 0.05,
  },
  level: {
    bpm: 150,
    bass: seq('A2 A2 A3 A2 A2 A3 A2 G2 F2 F2 F3 F2 F2 F3 G2 G3 D2 D2 D3 D2 D2 D3 E2 E3 E2 E2 E3 E2 G#2 G#2 B2 E3'),
    lead: seq(`A4 . C5 . E5 . D5 C5 B4 . G4 . B4 . D5 . A4 . C5 . F5 . E5 D5 E5 . . . G#4 . B4 .
               A4 . E5 . A5 . G5 E5 F5 . D5 . F5 . A5 . G5 . F5 . E5 . D5 . C5 . B4 . G#4 . E4 .`),
    drums: seq('k h s h k k s h k h s h k h s s'),
    leadVol: 0.045,
  },
  boss: {
    bpm: 168,
    bass: seq('E2 E2 E3 E2 F2 F2 F3 F2 E2 E2 E3 E2 A#1 A#1 A#2 B1'),
    lead: seq(`E5 . D#5 E5 . G5 F#5 . E5 . B4 . C5 . B4 . E5 . D#5 E5 . A5 G5 . F#5 . D#5 . E5 . . .
               B5 . A5 G5 . F#5 E5 . F5 . E5 D#5 . C5 B4 . E5 E5 F5 E5 D#5 E5 F#5 G5 A#5 . B5 . . . . .`),
    drums: seq('k h s h k s s h k h s h k k s s'),
    leadVol: 0.045,
  },
  victory: {
    bpm: 132,
    bass: seq('C3 . G2 . C3 . G2 . F2 . C3 . G2 . G2 .'),
    lead: seq('C5 E5 G5 C6 . . G5 . A5 . F5 . G5 . . . E5 G5 C6 E6 . . D6 . C6 . . . . . . .'),
    drums: seq('k . s . k . s .'),
    leadVol: 0.05,
    once: true,
  },
};

export function createAudio() {
  let ctx = null;
  let master;
  let sfxBus;
  let musicBus;
  let noiseBuffer;
  let muted = false;
  try {
    muted = localStorage.getItem('mutant8.muted') === '1';
  } catch {
    /* storage unavailable */
  }

  let track = null;
  let step = 0;
  let nextTime = 0;
  let timer = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.55;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.6;
      musicBus.connect(master);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      // 32-bit sheen: a filtered echo and a synthetic reverb, fed by send levels.
      const fx = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.27;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.3;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2400;
      const echoOut = ctx.createGain();
      echoOut.gain.value = 0.3;
      fx.connect(delay);
      delay.connect(tone).connect(feedback).connect(delay);
      tone.connect(echoOut).connect(master);

      const reverb = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 1.8);
      const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = impulse.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
      }
      reverb.buffer = impulse;
      const reverbOut = ctx.createGain();
      reverbOut.gain.value = 0.28;
      fx.connect(reverb).connect(reverbOut).connect(master);

      const musicSend = ctx.createGain();
      musicSend.gain.value = 0.45;
      musicBus.connect(musicSend).connect(fx);
      const sfxSend = ctx.createGain();
      sfxSend.gain.value = 0.3;
      sfxBus.connect(sfxSend).connect(fx);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function tone({ type = 'square', freq, to = freq, dur = 0.1, vol = 0.2, at = 0, bus = sfxBus }) {
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.1, vol = 0.2, freq = 3000, to = freq, at = 0, bus = sfxBus }) {
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq, t0);
    if (to !== freq) filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(g).connect(bus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const arp = (notes, gap = 0.06, opts = {}) => notes.forEach((n, i) => tone({ freq: noteFreq(n), dur: gap * 1.6, at: i * gap, vol: 0.14, ...opts }));

  const SFX = {
    jump: () => tone({ freq: 280, to: 620, dur: 0.12, vol: 0.12 }),
    jump2: () => tone({ freq: 420, to: 980, dur: 0.12, vol: 0.12 }),
    dash: () => noise({ dur: 0.15, vol: 0.18, freq: 6000, to: 800 }),
    punch: () => noise({ dur: 0.05, vol: 0.18, freq: 2500 }),
    claws: () => {
      noise({ dur: 0.12, vol: 0.2, freq: 8000, to: 1500 });
      tone({ type: 'sawtooth', freq: 900, to: 300, dur: 0.1, vol: 0.06 });
    },
    whip: () => tone({ type: 'sawtooth', freq: 1200, to: 180, dur: 0.18, vol: 0.09 }),
    hit: () => {
      tone({ freq: 180, to: 70, dur: 0.08, vol: 0.2 });
      noise({ dur: 0.06, vol: 0.15, freq: 1800 });
    },
    kill: () => {
      tone({ freq: 300, to: 60, dur: 0.18, vol: 0.15 });
      noise({ dur: 0.15, vol: 0.15, freq: 1200, to: 200 });
    },
    grab: () => tone({ type: 'triangle', freq: 140, to: 320, dur: 0.2, vol: 0.25 }),
    consume: () => arp(['A3', 'C4', 'E4', 'A4', 'C5'], 0.05, { type: 'triangle', vol: 0.22 }),
    disguise: () => arp(['E5', 'G5', 'B5', 'E6'], 0.07),
    alert: () => {
      for (let i = 0; i < 4; i++) tone({ freq: i % 2 ? 660 : 880, dur: 0.14, at: i * 0.15, vol: 0.1 });
    },
    hurt: () => tone({ freq: 420, to: 90, dur: 0.22, vol: 0.16 }),
    death: () => {
      tone({ type: 'triangle', freq: 400, to: 40, dur: 1.0, vol: 0.3 });
      noise({ dur: 0.8, vol: 0.2, freq: 1500, to: 100 });
    },
    shoot: () => noise({ dur: 0.05, vol: 0.09, freq: 7000, to: 2000 }),
    rocket: () => noise({ dur: 0.3, vol: 0.12, freq: 1500, to: 400 }),
    boom: () => {
      noise({ dur: 0.6, vol: 0.32, freq: 900, to: 60 });
      tone({ type: 'triangle', freq: 90, to: 30, dur: 0.5, vol: 0.3 });
    },
    slam: () => {
      noise({ dur: 0.35, vol: 0.3, freq: 600, to: 60 });
      tone({ type: 'triangle', freq: 110, to: 35, dur: 0.3, vol: 0.35 });
    },
    thud: () => tone({ type: 'triangle', freq: 90, to: 40, dur: 0.15, vol: 0.25 }),
    dive: () => tone({ type: 'sawtooth', freq: 300, to: 1200, dur: 0.15, vol: 0.06 }),
    devCharge: () => tone({ type: 'sawtooth', freq: 60, to: 600, dur: 0.35, vol: 0.12 }),
    devastator: () => {
      noise({ dur: 1.2, vol: 0.4, freq: 4000, to: 80 });
      tone({ type: 'square', freq: 55, to: 30, dur: 1.0, vol: 0.25 });
    },
    armor: () => tone({ freq: 110, to: 70, dur: 0.18, vol: 0.2 }),
    select: () => tone({ freq: 880, dur: 0.05, vol: 0.1 }),
    checkpoint: () => arp(['C5', 'E5', 'G5', 'C6'], 0.08),
    heli: () => {
      for (let i = 0; i < 8; i++) noise({ dur: 0.05, vol: 0.12, freq: 400, at: i * 0.07 });
    },
    roar: () => {
      tone({ type: 'sawtooth', freq: 110, to: 45, dur: 1.1, vol: 0.2 });
      noise({ dur: 1.0, vol: 0.2, freq: 700, to: 120 });
    },
    roarSmall: () => tone({ type: 'sawtooth', freq: 160, to: 70, dur: 0.35, vol: 0.12 }),
    bossDeath: () => {
      noise({ dur: 2.0, vol: 0.4, freq: 2000, to: 50 });
      tone({ type: 'sawtooth', freq: 200, to: 25, dur: 2.0, vol: 0.2 });
    },
    menu: () => tone({ freq: 660, dur: 0.04, vol: 0.08 }),
    start: () => arp(['A4', 'E5', 'A5'], 0.07),
    pause: () => arp(['E5', 'A4'], 0.06),
  };

  // One voice through a lowpass filter with an attack/decay envelope.
  function voice({ type, freq, detune = 0, time, dur, vol, cutoff = 3000, cutoffEnd = cutoff, attack = 0.005, vibrato = 0 }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    osc.detune.setValueAtTime(detune, time);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, time);
      depth.gain.linearRampToValueAtTime(vibrato, time + Math.min(dur, 0.25));
      lfo.connect(depth).connect(osc.detune);
      lfo.start(time);
      lfo.stop(time + dur + 0.05);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoffEnd), time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vol, time + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(filter).connect(g).connect(musicBus);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  function drumHit(kind, time) {
    if (kind === 'k') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(170, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);
      g.gain.setValueAtTime(0.55, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
      osc.connect(g).connect(musicBus);
      osc.start(time);
      osc.stop(time + 0.23);
    }
    if (kind === 's' || kind === 'h' || kind === 'k') {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = kind === 's' ? 'bandpass' : 'highpass';
      filter.frequency.value = kind === 'h' ? 8000 : kind === 'k' ? 3000 : 1600;
      const g = ctx.createGain();
      const len = kind === 'h' ? 0.04 : kind === 'k' ? 0.01 : 0.16;
      g.gain.setValueAtTime(kind === 'h' ? 0.07 : kind === 'k' ? 0.12 : 0.26, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + len);
      src.connect(filter).connect(g).connect(musicBus);
      src.start(time, Math.random() * 0.5);
      src.stop(time + len + 0.01);
    }
    if (kind === 's') voice({ type: 'triangle', freq: 190, time, dur: 0.1, vol: 0.12, cutoff: 1200 });
  }

  function scheduleStep(trk, i, time) {
    const eighth = 60 / trk.bpm / 2;

    // Bass: filtered sawtooth over a triangle sub
    const bass = trk.bass[i % trk.bass.length];
    if (bass && bass !== '.') {
      const f = noteFreq(bass);
      voice({ type: 'sawtooth', freq: f, time, dur: eighth * 0.95, vol: 0.13, cutoff: 900, cutoffEnd: 220 });
      voice({ type: 'triangle', freq: f / 2, time, dur: eighth * 0.95, vol: 0.16, cutoff: 400 });
    }

    // Pad: a soft minor chord on the first bass note of every bar
    if (i % 8 === 0 && bass && bass !== '.') {
      const root = noteFreq(bass) * 4;
      for (const [semis, detune] of [[0, -6], [3, 5], [7, -4], [12, 7]]) {
        voice({ type: 'sawtooth', freq: root * 2 ** (semis / 12), detune, time, dur: eighth * 8, vol: 0.018, cutoff: 1400, cutoffEnd: 600, attack: eighth * 2 });
      }
    }

    // Lead: two detuned saws with vibrato
    const lead = trk.lead[i % trk.lead.length];
    if (lead && lead !== '.') {
      const f = noteFreq(lead);
      for (const detune of [-8, 8]) {
        voice({ type: 'sawtooth', freq: f, detune, time, dur: eighth * 1.9, vol: trk.leadVol * 0.75, cutoff: 3600, cutoffEnd: 1200, attack: 0.01, vibrato: 12 });
      }
      voice({ type: 'square', freq: f / 2, time, dur: eighth * 1.5, vol: trk.leadVol * 0.25, cutoff: 1800 });
    }

    const drum = trk.drums[i % trk.drums.length];
    if (drum && drum !== '.') drumHit(drum, time);
  }

  function pump() {
    if (!ctx || !track) return;
    const trk = TRACKS[track];
    const eighth = 60 / trk.bpm / 2;
    const length = Math.max(trk.bass.length, trk.lead.length);
    while (nextTime < ctx.currentTime + 0.15) {
      if (trk.once && step >= length) {
        stopMusic();
        return;
      }
      scheduleStep(trk, step, nextTime);
      step++;
      nextTime += eighth;
    }
  }

  function stopMusic() {
    track = null;
    clearInterval(timer);
    timer = null;
  }

  return {
    /** Call from a user gesture (key press, tap) so the browser allows sound. */
    unlock: () => ensure(),
    sfx(name) {
      if (muted || !ctx || ctx.state !== 'running') return;
      SFX[name]?.();
    },
    music(name) {
      if (track === name) return;
      stopMusic();
      if (!name || !ensure()) return;
      track = name;
      step = 0;
      nextTime = ctx.currentTime + 0.05;
      timer = setInterval(pump, 25);
      pump();
    },
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem('mutant8.muted', muted ? '1' : '0');
      } catch {
        /* ignore */
      }
      if (master) master.gain.value = muted ? 0 : 0.9;
      return muted;
    },
    get muted() {
      return muted;
    },
  };
}
