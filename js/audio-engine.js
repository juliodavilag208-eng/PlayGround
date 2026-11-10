import { clamp } from './data.js'

let audioContext = null
let masterGain = null
let muted = false

export async function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) throw new Error('Tu navegador no soporta Web Audio.')
    audioContext = new AudioContextClass({ latencyHint: 'interactive' })
    masterGain = audioContext.createGain()
    masterGain.gain.value = muted ? 0 : 0.9
    masterGain.connect(audioContext.destination)
  }
  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }
  return audioContext
}

export function getAudioContext() {
  return audioContext
}

export function getMasterGain() {
  return masterGain
}

export function setMuted(value) {
  muted = Boolean(value)
  if (masterGain && audioContext) {
    masterGain.gain.setTargetAtTime(muted ? 0 : 0.9, audioContext.currentTime, 0.02)
  }
  return muted
}

export function isMuted() {
  return muted
}

export function playHitPing(lane, quality = 'perfect') {
  if (!audioContext || !masterGain || muted || audioContext.state !== 'running') return
  const now = audioContext.currentTime
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  const base = [392, 523.25, 659.25, 783.99][lane] || 440
  const qualityLift = quality === 'perfect' ? 2 : quality === 'great' ? 1.5 : 1
  oscillator.type = quality === 'perfect' ? 'sine' : 'triangle'
  oscillator.frequency.setValueAtTime(base * qualityLift, now)
  oscillator.frequency.exponentialRampToValueAtTime(base * qualityLift * 1.014, now + 0.08)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.035, now + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13)
  oscillator.connect(gain)
  gain.connect(masterGain)
  oscillator.start(now)
  oscillator.stop(now + 0.15)
}

export function playHoldPing(lane) {
  if (!audioContext || !masterGain || muted || audioContext.state !== 'running') return
  const now = audioContext.currentTime
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = ([196, 261.63, 329.63, 392][lane] || 220) * 2
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.025, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
  oscillator.connect(gain)
  gain.connect(masterGain)
  oscillator.start(now)
  oscillator.stop(now + 0.24)
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function downsample(buffer, targetRate) {
  const ratio = buffer.sampleRate / targetRate
  const length = Math.max(1, Math.floor(buffer.length / ratio))
  const mono = new Float32Array(length)
  const channels = []
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    channels.push(buffer.getChannelData(channel))
  }
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(buffer.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
    let sum = 0
    for (const data of channels) {
      for (let j = start; j < end; j += 1) sum += data[j]
    }
    mono[i] = sum / ((end - start) * channels.length)
  }
  return mono
}

function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length
    const wLenRe = Math.cos(angle)
    const wLenIm = Math.sin(angle)
    const half = length >> 1
    for (let start = 0; start < n; start += length) {
      let wRe = 1
      let wIm = 0
      for (let j = 0; j < half; j += 1) {
        const uRe = re[start + j]
        const uIm = im[start + j]
        const vRe = re[start + j + half] * wRe - im[start + j + half] * wIm
        const vIm = re[start + j + half] * wIm + im[start + j + half] * wRe
        re[start + j] = uRe + vRe
        im[start + j] = uIm + vIm
        re[start + j + half] = uRe - vRe
        im[start + j + half] = uIm - vIm
        const nextWRe = wRe * wLenRe - wIm * wLenIm
        wIm = wRe * wLenIm + wIm * wLenRe
        wRe = nextWRe
      }
    }
  }
}

function detectOnsets(odf, bandEnergy, energy, frameRate) {
  const n = odf.length
  let globalMax = 0
  for (let i = 0; i < n; i += 1) globalMax = Math.max(globalMax, odf[i])
  if (globalMax <= 0) return []

  const normalized = new Float32Array(n)
  for (let i = 0; i < n; i += 1) normalized[i] = odf[i] / globalMax

  const onsets = []
  let lastPeak = -10
  for (let i = 2; i < n - 2; i += 1) {
    const value = normalized[i]
    if (value < 0.025) continue
    if (!(value >= normalized[i - 1] && value > normalized[i + 1])) continue

    const from = Math.max(0, i - 9)
    const to = Math.min(n - 1, i + 9)
    let localSum = 0
    let localCount = 0
    for (let j = from; j <= to; j += 1) {
      if (j === i) continue
      localSum += normalized[j]
      localCount += 1
    }
    const localMean = localSum / Math.max(1, localCount)
    const threshold = Math.max(0.045, localMean * 1.4 + 0.018)
    if (value < threshold) continue
    if (i - lastPeak < 2) continue

    const bands = [0, 1, 2, 3].map((band) => bandEnergy[i * 4 + band] || 0)
    let dominant = 0
    for (let band = 1; band < 4; band += 1) {
      if (bands[band] > bands[dominant]) dominant = band
    }

    const peakEnergy = energy[i] || 0
    let sustain = 0.12
    const maxLook = Math.min(n - 1, i + Math.round(frameRate * 2.2))
    for (let j = i + 3; j < maxLook; j += 2) {
      if ((energy[j] || 0) < peakEnergy * 0.38) break
      sustain = (j - i) / frameRate
    }
    if (sustain < 0.22) sustain = 0.12

    onsets.push({
      frame: i,
      time: i / frameRate - 0.015,
      strength: clamp((value - threshold) / Math.max(0.08, 1 - threshold), 0.12, 1),
      laneHint: dominant,
      sustain,
    })
    lastPeak = i
  }
  return onsets
}

function estimateTempo(odf, frameRate) {
  const n = odf.length
  const pulse = new Float32Array(n)
  let energy = 0
  for (let i = 0; i < n; i += 1) {
    const value = Math.max(0, odf[i] - 0.035)
    pulse[i] = value
    energy += value * value
  }
  if (!energy) return { bpm: 120, confidence: 0.1, lag: frameRate * 0.5 }

  const minBpm = 55
  const maxBpm = 200
  const minLag = Math.max(2, Math.floor((frameRate * 60) / maxBpm))
  const maxLag = Math.max(minLag + 1, Math.ceil((frameRate * 60) / minBpm))
  const scores = []
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0
    let count = 0
    for (let i = lag; i < n; i += 1) {
      sum += pulse[i] * pulse[i - lag]
      count += 1
    }
    const correlation = count ? sum / count : 0
    const bpm = (60 * frameRate) / lag
    const prior = Math.exp(-0.5 * (Math.log(bpm / 116) / 0.37) ** 2)
    scores.push({ lag, bpm, correlation, score: correlation * prior })
  }
  scores.sort((a, b) => b.score - a.score)
  let best = scores[0]
  if (!best) return { bpm: 120, confidence: 0.1, lag: frameRate * 0.5 }

  const findNear = (bpm) => {
    const target = (60 * frameRate) / bpm
    let local = scores[0]
    for (const candidate of scores) {
      if (Math.abs(candidate.lag - target) <= 1.5) {
        if (candidate.correlation > local.correlation) local = candidate
      }
    }
    return local
  }

  if (best.bpm < 91) {
    const doubled = findNear(best.bpm * 2)
    if (doubled && doubled.bpm <= 195 && doubled.correlation > best.correlation * 0.7) {
      best = doubled
    }
  } else if (best.bpm > 166) {
    const halved = findNear(best.bpm / 2)
    if (halved && halved.bpm >= 76 && halved.correlation > best.correlation * 1.12) {
      best = halved
    }
  }

  const bpm = clamp(Math.round(best.bpm), 60, 200)
  const confidence = clamp(0.35 + (best.correlation / Math.max(0.0001, Math.sqrt(energy / n))) * 0.7, 0.25, 0.98)
  return { bpm, confidence, lag: best.lag, correlation: best.correlation }
}

function estimateBeatOffset(odf, lagFrames) {
  const n = odf.length
  const period = Math.max(2, Math.round(lagFrames))
  let bestOffset = 0
  let bestScore = -1
  for (let offset = 0; offset < period; offset += 1) {
    let score = 0
    for (let i = offset; i < n; i += period) {
      score += odf[i] || 0
      if (i + 1 < n) score += (odf[i + 1] || 0) * 0.4
    }
    if (score > bestScore) {
      bestScore = score
      bestOffset = offset
    }
  }
  return bestOffset
}

export async function analyzeBuffer(buffer, onProgress = () => {}) {
  const duration = buffer.duration
  const targetRate = 11025
  onProgress(0.1, 'Preparando forma de onda')
  await yieldToBrowser()
  const mono = downsample(buffer, targetRate)
  const frameRate = targetRate / 256
  const fftSize = 1024
  const hop = 256
  const frames = Math.max(1, Math.floor((mono.length - fftSize) / hop))
  const odf = new Float32Array(frames)
  const bandEnergy = new Float32Array(frames * 4)
  const energy = new Float32Array(frames)
  const window = new Float32Array(fftSize)
  for (let i = 0; i < fftSize; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1))
  }
  const re = new Float32Array(fftSize)
  const im = new Float32Array(fftSize)
  const previous = new Float32Array(fftSize / 2)
  const bandBins = [0, 0, 0, 0]
  for (let bin = 1; bin < fftSize / 2; bin += 1) {
    const frequency = (bin * targetRate) / fftSize
    if (frequency < 160) bandBins[0] += 1
    else if (frequency < 500) bandBins[1] += 1
    else if (frequency < 1500) bandBins[2] += 1
    else bandBins[3] += 1
  }

  onProgress(0.18, 'Leyendo energía del espectro')
  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * hop
    for (let i = 0; i < fftSize; i += 1) {
      re[i] = (mono[start + i] || 0) * window[i]
      im[i] = 0
    }
    fft(re, im)
    let flux = 0
    for (let bin = 1; bin < fftSize / 2; bin += 1) {
      const magnitude = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin])
      const compressed = Math.log1p(magnitude * 52)
      const difference = compressed - previous[bin]
      if (difference > 0) flux += difference * (1 + Math.log1p(bin) * 0.18)
      previous[bin] = compressed
      const frequency = (bin * targetRate) / fftSize
      const value = magnitude * magnitude
      if (frequency < 160) bandEnergy[frame * 4] += value
      else if (frequency < 500) bandEnergy[frame * 4 + 1] += value
      else if (frequency < 1500) bandEnergy[frame * 4 + 2] += value
      else if (frequency < 5000) bandEnergy[frame * 4 + 3] += value
    }
    odf[frame] = flux
    energy[frame] =
      bandEnergy[frame * 4] +
      bandEnergy[frame * 4 + 1] +
      bandEnergy[frame * 4 + 2] +
      bandEnergy[frame * 4 + 3]

    if (frame % 260 === 0) {
      onProgress(0.18 + (frame / frames) * 0.58, 'Detectando ataques y textura')
      await yieldToBrowser()
    }
  }

  onProgress(0.8, 'Midiendo el pulso de la pista')
  await yieldToBrowser()
  const tempo = estimateTempo(odf, frameRate)
  const offsetFrames = estimateBeatOffset(odf, tempo.lag)
  const beatOffset = offsetFrames / frameRate

  onProgress(0.9, 'Construyendo el mapa rítmico')
  await yieldToBrowser()
  const rawOnsets = detectOnsets(odf, bandEnergy, energy, frameRate)
  const events = []
  let previousTime = -1
  for (const onset of rawOnsets) {
    if (onset.time < 0.25 || onset.time > duration - 0.25) continue
    if (onset.time - previousTime < 0.048) continue
    events.push({
      time: onset.time,
      strength: clamp(onset.strength, 0.12, 1),
      laneHint: onset.laneHint,
      sustain: onset.sustain,
    })
    previousTime = onset.time
  }

  const peak = events.reduce((max, event) => Math.max(max, event.strength), 0.5)
  for (const event of events) event.strength = clamp(event.strength / peak, 0.1, 1)

  onProgress(1, 'Listo')
  return {
    bpm: tempo.bpm,
    beatOffset,
    duration,
    events,
    onsetCount: events.length,
    confidence: tempo.confidence,
  }
}

export async function decodeAudioFile(file, onProgress = () => {}) {
  const context = await ensureAudioContext()
  onProgress(0.03, 'Leyendo archivo')
  const arrayBuffer = await file.arrayBuffer()
  onProgress(0.07, 'Decodificando audio')
  const buffer = await context.decodeAudioData(arrayBuffer.slice(0))
  onProgress(0.12, `Pista de ${Math.round(buffer.duration)} s`)
  return buffer
}

export async function analyzeAudioFile(file, onProgress) {
  const buffer = await decodeAudioFile(file, onProgress)
  if (buffer.duration > 12 * 60) {
    throw new Error('La pista supera los 12 minutos. Elige un archivo más corto.')
  }
  const analysis = await analyzeBuffer(buffer, onProgress)
  return { buffer, analysis }
}
