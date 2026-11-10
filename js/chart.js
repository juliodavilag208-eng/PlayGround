import { DIFFICULTIES, clamp, hashString, mulberry32 } from './data.js'
import { buildComposition } from './composition.js'

const chartCache = new Map()

function sourceEvents(track) {
  if (track.builtIn) {
    return buildComposition(track).events.map((event) => ({
      time: event.time,
      strength: event.strength,
      laneHint: event.laneHint,
      sustain: event.sustain,
    }))
  }
  return track.events || []
}

function groupClusters(events) {
  const clusters = []
  for (const event of events) {
    const last = clusters[clusters.length - 1]
    if (last && event.time - last.time <= 0.055) {
      last.events.push(event)
      last.time = (last.time * (last.events.length - 1) + event.time) / last.events.length
      last.strength = Math.max(last.strength, event.strength)
    } else {
      clusters.push({
        time: event.time,
        strength: event.strength,
        events: [event],
      })
    }
  }
  return clusters
}

function pickLane(cluster, freeAt, time, maxChord, random, difficulty) {
  const desired = []
  const ordered = [...cluster.events].sort((a, b) => b.strength - a.strength)

  for (const event of ordered) {
    if (desired.length >= maxChord) break
    const preferred = Number.isInteger(event.laneHint) ? event.laneHint : null
    if (preferred !== null && !desired.includes(preferred) && time >= freeAt[preferred]) {
      desired.push(preferred)
    }
  }

  let target = 1
  if (maxChord > 1) {
    const factor = 0.46 + cluster.strength * 0.75
    while (target < maxChord && random() < DIFFICULTIES[difficulty].chordChance * factor) {
      target += 1
    }
  }
  target = Math.max(target, Math.min(maxChord, cluster.events.length))

  if (desired.length < target) {
    const available = [0, 1, 2, 3].filter(
      (lane) => !desired.includes(lane) && time >= freeAt[lane],
    )
    while (desired.length < target && available.length) {
      const index = Math.floor(random() * available.length)
      desired.push(available.splice(index, 1)[0])
    }
  }

  return desired
}

function addFallbackClusters(clusters, track, difficulty, random) {
  const difficultyData = DIFFICULTIES[difficulty]
  const minCount = Math.floor(track.duration * (difficulty === 'normal' ? 0.55 : 0.85))
  if (clusters.length >= minCount) return clusters
  const beat = 60 / track.bpm
  const extra = []
  const step = difficulty === 'normal' ? beat : beat / 2
  for (let time = 1.1; time < track.duration - 1; time += step) {
    if (clusters.some((cluster) => Math.abs(cluster.time - time) < 0.11)) continue
    extra.push({
      time,
      strength: 0.42,
      events: [
        {
          time,
          strength: 0.42,
          laneHint: Math.floor(random() * 4),
          sustain: difficultyData.holdChance * 0.5,
        },
      ],
    })
  }
  return [...clusters, ...extra].sort((a, b) => a.time - b.time)
}

export function createChart(track, difficultyId) {
  const cacheKey = `${track.id}:${difficultyId}:${track.chartVersion || 0}`
  if (chartCache.has(cacheKey)) return chartCache.get(cacheKey)
  const difficulty = DIFFICULTIES[difficultyId]
  const random = mulberry32(hashString(`${track.id}:${difficultyId}:${track.seed || 0}`))
  const clusters = addFallbackClusters(
    groupClusters(sourceEvents(track)),
    track,
    difficultyId,
    random,
  )
  const notes = []
  const laneFreeAt = [0, 0, 0, 0]
  const firstAllowed = Math.max(0.85, Math.min(1.8, 60 / track.bpm))
  let lastTime = -999
  let selected = 0
  let noteCounter = 0

  for (const cluster of clusters) {
    const time = cluster.time
    if (time < firstAllowed || time > track.duration - 0.75) continue
    const gap = time - lastTime
    if (gap < difficulty.minGap) continue

    let accept = gap >= difficulty.gap
    if (!accept) {
      const pressure = gap / difficulty.gap
      const lucky = cluster.strength > 0.78 && random() < (pressure - 0.38) * 1.6
      if (!lucky) continue
      accept = true
    }
    if (!accept) continue

    const lanes = pickLane(
      cluster,
      laneFreeAt,
      time,
      difficulty.maxChord,
      random,
      difficultyId,
    )
    if (!lanes.length) continue

    let clusterAdded = 0
    for (const lane of lanes) {
      noteCounter += 1
      const candidates = cluster.events.filter((event) => event.laneHint === lane)
      const best = candidates.sort((a, b) => b.strength - a.strength)[0] || cluster.events[0]
      const forceHold =
        (noteCounter > 8 && noteCounter % (difficultyId === 'normal' ? 9 : 13) === 0) ||
        (selected === 2 && difficultyId !== 'demon')
      const wantsHold = best.sustain > 0.2 || difficultyId !== 'demon'
      const holdRoll = random()
      const shouldHold =
        forceHold ||
        (wantsHold &&
          holdRoll < difficulty.holdChance * (0.58 + cluster.strength * 0.7))
      let endTime = time
      if (shouldHold) {
        const natural = Math.max(0.62, Math.min(2.2, best.sustain || 0.8))
        const targetLength = Math.min(
          difficulty.holdMax,
          Math.max(0.56, natural * (difficultyId === 'normal' ? 1.08 : 0.9)),
        )
        endTime = Math.min(
          track.duration - 0.2,
          time + targetLength,
        )
        if (endTime - time >= 0.5) {
          laneFreeAt[lane] = endTime + 0.09
        } else {
          endTime = time
        }
      }
      if (endTime === time) {
        laneFreeAt[lane] = time + Math.max(0.09, difficulty.minGap * 0.7)
      }

      notes.push({
        id: `${track.id}-${difficultyId}-${notes.length}`,
        lane,
        time,
        type: endTime > time ? 'hold' : 'tap',
        endTime: endTime > time ? endTime : null,
        length: Math.max(0, endTime - time),
        strength: best.strength || cluster.strength,
        judged: false,
        active: false,
        broken: false,
        done: false,
        grade: null,
      })
      clusterAdded += 1
    }

    if (clusterAdded > 0) {
      selected += 1
      lastTime = time
    }
  }

  notes.sort((a, b) => a.time - b.time || a.lane - b.lane)
  const chart = {
    track,
    difficulty: difficultyId,
    difficultyData: difficulty,
    notes,
    firstNote: notes[0]?.time ?? 0,
    lastNote: notes.reduce((max, note) => Math.max(max, note.endTime || note.time), 0),
    tapCount: notes.filter((note) => note.type === 'tap').length,
    holdCount: notes.filter((note) => note.type === 'hold').length,
  }
  chart.duration = track.duration
  chartCache.set(cacheKey, chart)
  return chart
}

export function getTravelTime(track, difficultyId) {
  const tempoFactor = clamp(120 / track.bpm, 0.67, 1.3)
  return DIFFICULTIES[difficultyId].fallTime * tempoFactor
}

export function getSpeedFactor(track, difficultyId) {
  return 2.3 / getTravelTime(track, difficultyId)
}
