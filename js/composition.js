import { hashString, mulberry32 } from './data.js'

const cache = new Map()

function scaleMidi(root, scale, degree, octave = 0) {
  const length = scale.length
  const octaveShift = Math.floor(degree / length)
  const index = ((degree % length) + length) % length
  return root + scale[index] + (octaveShift + octave) * 12
}

function chordDegrees(degree) {
  return [degree, degree + 2, degree + 4]
}

const DRUM_STYLES = {
  'aurora-drive': {
    kick: [0, 2],
    snare: [1, 3],
    hatStep: 0.5,
    ghostKick: [],
    sparkle: 0.1,
  },
  'glass-horizon': {
    kick: [0, 1.5, 2.5],
    snare: [1, 3],
    hatStep: 0.25,
    ghostKick: [3.75],
    sparkle: 0.18,
  },
  'night-circuit': {
    kick: [0, 0.75, 2, 2.75],
    snare: [1, 3],
    hatStep: 0.25,
    ghostKick: [1.75, 3.5],
    sparkle: 0.22,
  },
  'thunder-crown': {
    kick: [0, 1, 2, 3],
    snare: [1, 3],
    hatStep: 0.25,
    ghostKick: [0.5, 2.5],
    sparkle: 0.3,
  },
}

/**
 * A deterministic miniature arrangement. The generated chart is based on the
 * same melody/accent data that the synthesizer receives, so audio and tiles
 * always share a pulse without shipping any binary music files.
 */
export function buildComposition(track) {
  if (cache.has(track.id)) return cache.get(track.id)

  const beat = 60 / track.bpm
  const barLength = beat * 4
  const eighth = beat / 2
  const bars = track.bars
  const duration = track.duration
  const random = mulberry32((track.seed || hashString(track.id)) >>> 0)
  const style = DRUM_STYLES[track.id] || DRUM_STYLES['aurora-drive']
  const events = []
  const pads = []
  const bass = []
  const drums = []
  const accents = []
  const introBars = 2
  const outroBars = 2

  for (let bar = 0; bar < bars; bar += 1) {
    const barTime = bar * barLength
    const section = bar < introBars ? 0 : bar >= bars - outroBars ? 2 : 1
    const phrase = Math.floor(bar / 4)
    const progressionIndex = bar % track.progression.length
    const degree = track.progression[progressionIndex]
    const chord = chordDegrees(degree)

    pads.push({
      time: barTime,
      duration: barLength * 0.98,
      notes: chord.map((item) => scaleMidi(track.root, track.scale, item, 0)),
      velocity: section === 1 ? 0.9 : 0.6,
    })

    const bassRoot = scaleMidi(track.root, track.scale, degree, -1)
    for (const offset of track.bassPattern) {
      const time = barTime + offset * beat
      if (time >= duration - 0.1) continue
      const octaveLift = offset === 0 ? 0 : 0
      bass.push({
        time,
        duration: offset === 0 ? beat * 0.9 : beat * 0.4,
        midi: bassRoot + octaveLift,
        velocity: offset === 0 ? 0.95 : 0.7,
      })
    }

    for (const offset of style.kick) {
      drums.push({
        type: 'kick',
        time: barTime + offset * beat,
        velocity: offset === 0 ? 1 : 0.8,
      })
    }
    for (const offset of style.ghostKick) {
      if (random() < 0.34 + style.sparkle) {
        drums.push({ type: 'kick', time: barTime + offset * beat, velocity: 0.42 })
      }
    }
    for (const offset of style.snare) {
      drums.push({ type: 'snare', time: barTime + offset * beat, velocity: 0.78 })
    }

    if (section > 0) {
      for (let step = 0; step < 4; step += style.hatStep) {
        const accentHat = step % 1 === 0
        drums.push({
          type: 'hat',
          time: barTime + step * beat,
          velocity: accentHat ? 0.55 : 0.3,
        })
      }
    }

    const activeLead = track.leadPattern.map((value) => Boolean(value))
    if (section === 0) {
      for (let step = 0; step < 8; step += 1) {
        if (step % 4 === 0) activeLead[step] = true
        else activeLead[step] = false
      }
    } else if (section === 2) {
      for (let step = 0; step < 8; step += 1) {
        if (step === 0 || step === 4) activeLead[step] = true
        else activeLead[step] = false
      }
    }

    for (let step = 0; step < 8; step += 1) {
      if (!activeLead[step]) continue
      if (section === 1 && random() < 0.12) continue

      const noteTime = barTime + step * eighth
      if (noteTime >= duration - 0.18) continue

      const chordTone = chord[Math.floor(random() * chord.length)]
      const colorTone = random() < 0.24 ? 1 : 0
      const degreeIndex = chordTone + colorTone
      const octave = random() < 0.16 ? 2 : 1
      const midi = scaleMidi(track.root, track.scale, degreeIndex, octave)
      const longNote = step === 0 && bar % 8 === 4 && section === 1
      const noteEighthLength = longNote ? 4 : random() < 0.16 ? 2 : 1
      const noteDuration = noteEighthLength * eighth
      const laneHint = (degreeIndex + step + phrase) % 4
      const strength = 0.62 + random() * 0.3 + (step % 2 === 0 ? 0.08 : 0)

      events.push({
        time: noteTime,
        duration: noteDuration,
        midi,
        velocity: 0.65 + random() * 0.2,
        strength: Math.min(1, strength),
        laneHint,
        sustain: noteDuration,
        kind: 'lead',
      })

      if (section === 1 && step % 4 === 0 && random() < 0.32) {
        const harmonyMidi = scaleMidi(track.root, track.scale, degreeIndex + 2, octave)
        events.push({
          time: noteTime + 0.004,
          duration: noteDuration * 0.8,
          midi: harmonyMidi,
          velocity: 0.46,
          strength: 0.66,
          laneHint: (laneHint + 2) % 4,
          sustain: noteDuration * 0.8,
          kind: 'harmony',
        })
      }

      if (track.bpm >= 140 && section === 1 && random() < 0.09) {
        const fillTime = noteTime + eighth * 0.5
        const fillMidi = scaleMidi(track.root, track.scale, degreeIndex + 1, octave)
        events.push({
          time: fillTime,
          duration: eighth * 0.7,
          midi: fillMidi,
          velocity: 0.42,
          strength: 0.54,
          laneHint: (laneHint + 1) % 4,
          sustain: eighth * 0.7,
          kind: 'fill',
        })
      }
    }

    if (section === 1 && bar % 4 === 0) {
      accents.push({ time: barTime, strength: 1 })
    }
  }

  const lastLead = events.reduce((max, event) => Math.max(max, event.time + event.duration), 0)
  const composition = {
    trackId: track.id,
    beat,
    barLength,
    duration,
    events: events
      .filter((event) => event.time < duration - 0.2)
      .sort((a, b) => a.time - b.time),
    pads,
    bass,
    drums: drums.filter((drum) => drum.time < duration - 0.05),
    accents,
    musicalEnd: Math.max(lastLead, duration - 0.5),
  }
  cache.set(track.id, composition)
  return composition
}

function makeNoiseBuffer(context, seconds = 2) {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  let seed = 90210
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    data[i] = (seed / 4294967296) * 2 - 1
  }
  return buffer
}

function envelope(context, destination, time, duration, peak, attack = 0.008, release = 0.12) {
  const gain = context.createGain()
  const safePeak = Math.max(0.0001, peak)
  gain.gain.setValueAtTime(0.0001, time)
  gain.gain.exponentialRampToValueAtTime(safePeak, time + Math.max(0.002, attack))
  gain.gain.exponentialRampToValueAtTime(safePeak * 0.52, time + Math.max(attack + 0.01, duration * 0.55))
  gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(attack + 0.03, duration + release))
  gain.connect(destination)
  return gain
}

function scheduleOscillator(context, destination, options) {
  const {
    time,
    duration,
    frequency,
    type = 'sine',
    gain = 0.05,
    attack = 0.01,
    release = 0.12,
    detune = 0,
    filterType = 'lowpass',
    filterFrequency = 5000,
    filterQ = 0.7,
    wet = 0,
  } = options
  if (time < 0 || frequency <= 0) return
  const oscillator = context.createOscillator()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, time)
  oscillator.detune.setValueAtTime(detune, time)
  const filter = context.createBiquadFilter()
  filter.type = filterType
  filter.frequency.setValueAtTime(Math.min(18000, filterFrequency), time)
  filter.Q.setValueAtTime(filterQ, time)
  const amp = envelope(context, destination, time, duration, gain, attack, release)
  oscillator.connect(filter)
  filter.connect(amp)
  if (wet > 0 && destination.wetInput) {
    const send = context.createGain()
    send.gain.value = wet
    amp.connect(send)
    send.connect(destination.wetInput)
  }
  oscillator.start(time)
  oscillator.stop(time + duration + release + 0.08)
}

function scheduleKick(context, destination, time, velocity, noiseBuffer) {
  const oscillator = context.createOscillator()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(148, time)
  oscillator.frequency.exponentialRampToValueAtTime(42, time + 0.12)
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, time)
  gain.gain.exponentialRampToValueAtTime(0.7 * velocity, time + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.36)
  const shaper = context.createWaveShaper()
  shaper.curve = makeSoftClip()
  oscillator.connect(gain)
  gain.connect(shaper)
  shaper.connect(destination)
  oscillator.start(time)
  oscillator.stop(time + 0.4)

  const click = context.createBufferSource()
  click.buffer = noiseBuffer
  click.playbackRate.value = 0.8
  const clickFilter = context.createBiquadFilter()
  clickFilter.type = 'lowpass'
  clickFilter.frequency.value = 1200
  const clickGain = context.createGain()
  clickGain.gain.setValueAtTime(0.14 * velocity, time)
  clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045)
  click.connect(clickFilter)
  clickFilter.connect(clickGain)
  clickGain.connect(destination)
  click.start(time)
  click.stop(time + 0.06)
}

function scheduleSnare(context, destination, time, velocity, noiseBuffer) {
  const source = context.createBufferSource()
  source.buffer = noiseBuffer
  source.playbackRate.value = 1.25
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1900
  filter.Q.value = 0.8
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.24 * velocity, time)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.19)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(destination)
  source.start(time)
  source.stop(time + 0.2)

  scheduleOscillator(context, destination, {
    time,
    duration: 0.08,
    frequency: 185,
    type: 'triangle',
    gain: 0.12 * velocity,
    attack: 0.002,
    release: 0.04,
  })
}

function scheduleHat(context, destination, time, velocity, noiseBuffer) {
  const source = context.createBufferSource()
  source.buffer = noiseBuffer
  source.playbackRate.value = 1.8
  const filter = context.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 7000
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.055 * velocity, time)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(destination)
  source.start(time)
  source.stop(time + 0.055)
}

let softClipCurve = null
function makeSoftClip() {
  if (softClipCurve) return softClipCurve
  const samples = 1024
  softClipCurve = new Float32Array(samples)
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1
    softClipCurve[i] = Math.tanh(x * 1.4)
  }
  return softClipCurve
}

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

/**
 * Render a built-in track offline. Returns a stereo AudioBuffer that can be
 * played through the normal imported-audio playback path.
 */
export async function renderTrackAudio(track) {
  if (!track.builtIn) throw new Error('renderTrackAudio only renders built-in tracks')
  const composition = buildComposition(track)
  const sampleRate = 44100
  const duration = Math.ceil(composition.duration * sampleRate)
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext
  const context = new OfflineContext(2, duration, sampleRate)
  const noise = makeNoiseBuffer(context, 2)

  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = -20
  compressor.knee.value = 18
  compressor.ratio.value = 4
  compressor.attack.value = 0.006
  compressor.release.value = 0.22

  const master = context.createGain()
  master.gain.value = 0.84
  master.connect(compressor)
  compressor.connect(context.destination)

  // A short stereo ping-pong echo gives the leads air without masking the beat.
  const delay = context.createDelay(1.5)
  delay.delayTime.value = composition.beat * 0.75
  const feedback = context.createGain()
  feedback.gain.value = 0.27
  const wetGain = context.createGain()
  wetGain.gain.value = 0.32
  delay.connect(feedback)
  feedback.connect(delay)
  delay.connect(wetGain)
  wetGain.connect(master)

  const dry = context.createGain()
  dry.gain.value = 1
  dry.wetInput = delay
  dry.connect(master)

  const warm = context.createBiquadFilter()
  warm.type = 'lowshelf'
  warm.frequency.value = 180
  warm.gain.value = 2.5
  warm.connect(dry)

  for (const pad of composition.pads) {
    if (pad.time >= composition.duration) continue
    pad.notes.forEach((midi, index) => {
      const pan = context.createStereoPanner()
      pan.pan.value = (index - 1) * 0.28
      pan.connect(warm)
      scheduleOscillator(context, pan, {
        time: pad.time,
        duration: pad.duration,
        frequency: midiToFrequency(midi),
        type: 'sawtooth',
        gain: 0.026 * pad.velocity,
        attack: 0.24,
        release: 0.45,
        detune: index === 1 ? 5 : -5,
        filterFrequency: 1500 + index * 240,
        filterQ: 0.9,
      })
      scheduleOscillator(context, pan, {
        time: pad.time,
        duration: pad.duration * 0.96,
        frequency: midiToFrequency(midi - 12),
        type: 'sine',
        gain: 0.02 * pad.velocity,
        attack: 0.3,
        release: 0.5,
      })
    })
  }

  for (const note of composition.bass) {
    if (note.time >= composition.duration) continue
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(520, note.time)
    filter.frequency.exponentialRampToValueAtTime(190, note.time + note.duration)
    filter.Q.value = 2.2
    filter.connect(dry)
    scheduleOscillator(context, filter, {
      time: note.time,
      duration: note.duration,
      frequency: midiToFrequency(note.midi),
      type: 'sawtooth',
      gain: 0.15 * note.velocity,
      attack: 0.008,
      release: 0.12,
    })
    scheduleOscillator(context, dry, {
      time: note.time,
      duration: note.duration * 0.9,
      frequency: midiToFrequency(note.midi - 12),
      type: 'sine',
      gain: 0.12 * note.velocity,
      attack: 0.006,
      release: 0.1,
    })
  }

  for (const event of composition.events) {
    if (event.kind === 'bass') continue
    const pan = context.createStereoPanner()
    const lane = event.laneHint ?? 0
    pan.pan.value = (lane - 1.5) * 0.24
    pan.connect(dry)
    const frequency = midiToFrequency(event.midi)
    const long = event.duration > composition.beat * 0.8
    scheduleOscillator(context, pan, {
      time: event.time,
      duration: event.duration,
      frequency,
      type: 'triangle',
      gain: (long ? 0.05 : 0.06) * event.velocity,
      attack: 0.005,
      release: long ? 0.28 : 0.16,
      filterFrequency: long ? 3800 : 6200,
      filterQ: 1.1,
      wet: event.kind === 'harmony' ? 0.08 : 0.16,
    })
    scheduleOscillator(context, pan, {
      time: event.time,
      duration: Math.max(0.06, event.duration * 0.7),
      frequency: frequency * 2,
      type: 'sine',
      gain: 0.016 * event.velocity,
      attack: 0.003,
      release: 0.12,
      wet: 0.3,
    })
  }

  const sortedDrums = [...composition.drums].sort((a, b) => a.time - b.time)
  for (const drum of sortedDrums) {
    if (drum.time >= composition.duration) continue
    if (drum.type === 'kick') scheduleKick(context, dry, drum.time, drum.velocity, noise)
    else if (drum.type === 'snare') scheduleSnare(context, dry, drum.time, drum.velocity, noise)
    else scheduleHat(context, dry, drum.time, drum.velocity, noise)
  }

  // Gentle fade in/out prevents clicks when the source starts and ends.
  master.gain.setValueAtTime(0.0001, 0)
  master.gain.exponentialRampToValueAtTime(0.84, 0.08)
  master.gain.setValueAtTime(0.84, Math.max(0.1, composition.duration - 1.2))
  master.gain.exponentialRampToValueAtTime(0.0001, composition.duration - 0.02)

  return context.startRendering()
}
