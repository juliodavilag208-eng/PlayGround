const beatLength = (bpm) => 60 / bpm

export const DIFFICULTY_ORDER = ['normal', 'hard', 'extreme', 'demon']

export const DIFFICULTIES = {
  normal: {
    id: 'normal',
    name: 'Normal',
    tier: '01',
    color: '#56e6ff',
    soft: 'rgba(86, 230, 255, 0.14)',
    tagline: 'Entra en el pulso',
    description: 'Notas grandes, caída pausada y espacio para respirar.',
    fallTime: 2.3,
    noteWidth: 0.8,
    noteHeight: 104,
    gap: 0.62,
    minGap: 0.34,
    maxChord: 1,
    chordChance: 0,
    holdChance: 0.3,
    holdMax: 1.55,
    perfect: 0.095,
    great: 0.17,
    good: 0.25,
    speedLabel: 'Lenta',
    densityLabel: '1 nota',
    bars: 1,
  },
  hard: {
    id: 'hard',
    name: 'Hard',
    tier: '02',
    color: '#a8ff72',
    soft: 'rgba(168, 255, 114, 0.14)',
    tagline: 'Sube el voltaje',
    description: 'Tiles más compactos, más sincopa y reflejos rápidos.',
    fallTime: 1.78,
    noteWidth: 0.65,
    noteHeight: 84,
    gap: 0.35,
    minGap: 0.2,
    maxChord: 2,
    chordChance: 0.28,
    holdChance: 0.24,
    holdMax: 1.3,
    perfect: 0.085,
    great: 0.155,
    good: 0.235,
    speedLabel: 'Rápida',
    densityLabel: '1–2 notas',
    bars: 2,
  },
  extreme: {
    id: 'extreme',
    name: 'Extreme',
    tier: '03',
    color: '#ff8ad8',
    soft: 'rgba(255, 138, 216, 0.14)',
    tagline: 'Ritmo sin descanso',
    description: 'Caída veloz, combinaciones constantes y notas dobles.',
    fallTime: 1.33,
    noteWidth: 0.55,
    noteHeight: 70,
    gap: 0.2,
    minGap: 0.105,
    maxChord: 3,
    chordChance: 0.56,
    holdChance: 0.17,
    holdMax: 1,
    perfect: 0.075,
    great: 0.14,
    good: 0.22,
    speedLabel: 'Muy rápida',
    densityLabel: '2–3 notas',
    bars: 3,
  },
  demon: {
    id: 'demon',
    name: 'Demon',
    tier: '04',
    color: '#ff6e5c',
    soft: 'rgba(255, 110, 92, 0.15)',
    tagline: 'Sin piedad',
    description: 'Caída brutal y acordes de hasta cuatro carriles.',
    fallTime: 0.99,
    noteWidth: 0.46,
    noteHeight: 58,
    gap: 0.115,
    minGap: 0.062,
    maxChord: 4,
    chordChance: 0.84,
    holdChance: 0.1,
    holdMax: 0.72,
    perfect: 0.066,
    great: 0.125,
    good: 0.2,
    speedLabel: 'Extrema',
    densityLabel: 'Hasta 4 notas',
    bars: 4,
  },
}

export const BUILT_IN_TRACKS = [
  {
    id: 'aurora-drive',
    audio: 'assets/audio/aurora-drive.mp3',
    title: 'Aurora Drive',
    artist: 'Pulse Lab',
    bpm: 112,
    bars: 28,
    root: 57,
    scale: [0, 2, 3, 5, 7, 8, 10],
    progression: [0, 5, 3, 7],
    leadPattern: [1, 0, 1, 1, 0, 1, 1, 0],
    bassPattern: [0, 1.5, 2, 3, 3.5],
    seed: 7311,
    tag: 'Synthwave',
    art: 'aurora',
    color: '#56e6ff',
    color2: '#5b7cfa',
    mood: 'Cálido · Nocturno',
    text: 'Arpegios de neón sobre un pulso que respira.',
    builtIn: true,
  },
  {
    id: 'glass-horizon',
    audio: 'assets/audio/glass-horizon.mp3',
    title: 'Glass Horizon',
    artist: 'Pulse Lab',
    bpm: 132,
    bars: 32,
    root: 52,
    scale: [0, 2, 3, 5, 7, 9, 10],
    progression: [0, 3, 5, 4],
    leadPattern: [1, 1, 0, 1, 1, 0, 1, 1],
    bassPattern: [0, 1, 2, 2.5, 3, 3.5],
    seed: 19042,
    tag: 'Future Pop',
    art: 'glass',
    color: '#bb9bff',
    color2: '#ff83cf',
    mood: 'Etéreo · Brillante',
    text: 'Cristales de sintetizador y un horizonte en movimiento.',
    builtIn: true,
  },
  {
    id: 'night-circuit',
    audio: 'assets/audio/night-circuit.mp3',
    title: 'Night Circuit',
    artist: 'Pulse Lab',
    bpm: 152,
    bars: 38,
    root: 45,
    scale: [0, 2, 3, 5, 7, 8, 11],
    progression: [0, 2, 5, 4],
    leadPattern: [1, 1, 1, 0, 1, 1, 0, 1],
    bassPattern: [0, 0.75, 1.5, 2, 3, 3.25, 3.5],
    seed: 55021,
    tag: 'Electro',
    art: 'circuit',
    color: '#ff9b62',
    color2: '#ff4e9f',
    mood: 'Veloz · Magnético',
    text: 'Circuitos encendidos, luces de neón y cero frenos.',
    builtIn: true,
  },
  {
    id: 'thunder-crown',
    audio: 'assets/audio/thunder-crown.mp3',
    title: 'Thunder Crown',
    artist: 'Pulse Lab',
    bpm: 178,
    bars: 40,
    root: 50,
    scale: [0, 1, 3, 5, 7, 8, 10],
    progression: [0, 1, 5, 4],
    leadPattern: [1, 1, 1, 1, 0, 1, 1, 1],
    bassPattern: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    seed: 88410,
    tag: 'Hardcore',
    art: 'thunder',
    color: '#ffd15c',
    color2: '#ff5d3e',
    mood: 'Salvaje · Cinético',
    text: 'Un trono de tormenta para los reflejos más afilados.',
    builtIn: true,
  },
].map((track) => ({
  ...track,
  duration: track.bars * 4 * beatLength(track.bpm),
  imported: false,
}))

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function hashString(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function mulberry32(seed) {
  let state = seed >>> 0
  return function random() {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
