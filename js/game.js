import { clamp, formatTime } from './data.js'
import { getAudioContext, getMasterGain, playHitPing, playHoldPing } from './audio-engine.js'
import { getTravelTime } from './chart.js'

const LANE_COLORS = [
  { main: '#43d9ff', light: '#b7f6ff', shadow: 'rgba(67, 217, 255, 0.52)', soft: 'rgba(67, 217, 255, 0.14)' },
  { main: '#a7ff66', light: '#e0ffc2', shadow: 'rgba(167, 255, 102, 0.48)', soft: 'rgba(167, 255, 102, 0.13)' },
  { main: '#b391ff', light: '#e9ddff', shadow: 'rgba(179, 145, 255, 0.5)', soft: 'rgba(179, 145, 255, 0.14)' },
  { main: '#ff7cbb', light: '#ffd6e9', shadow: 'rgba(255, 124, 187, 0.5)', soft: 'rgba(255, 124, 187, 0.13)' },
]

const GRADES = {
  perfect: { points: 1000, weight: 1, color: '#b9f8ff', label: 'PERFECT' },
  great: { points: 700, weight: 0.8, color: '#caff9b', label: 'GREAT' },
  good: { points: 400, weight: 0.55, color: '#ffdf8e', label: 'GOOD' },
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}

function formatScore(score) {
  return Math.max(0, Math.round(score)).toLocaleString('es-ES')
}

export class RhythmGame {
  constructor(elements, callbacks = {}) {
    this.canvas = elements.canvas
    this.stage = elements.stage
    this.context = this.canvas.getContext('2d')
    this.countdown = elements.countdown
    this.countdownNumber = elements.countdownNumber
    this.scoreEl = elements.score
    this.comboEl = elements.combo
    this.accuracyEl = elements.accuracy
    this.timeEl = elements.time
    this.progressEl = elements.progress
    this.hudCombo = elements.hudCombo
    this.callbacks = callbacks
    this.running = false
    this.paused = false
    this.notes = []
    this.activeHolds = [null, null, null, null]
    this.pressedLanes = [false, false, false, false]
    this.laneFlash = [0, 0, 0, 0]
    this.bursts = []
    this.judgements = []
    this.beats = []
    this.metrics = null
    this.lastFrame = 0
    this.dpr = 1
    this.width = 0
    this.height = 0
    this.animationFrame = 0
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.stage)
    this.resize()
  }

  resize() {
    if (!this.stage) return
    const rect = this.stage.getBoundingClientRect()
    const width = Math.floor(rect.width)
    const height = Math.floor(rect.height)
    if (width <= 0 || height <= 0) return
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.width = width
    this.height = height
    this.canvas.width = Math.floor(width * this.dpr)
    this.canvas.height = Math.floor(height * this.dpr)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.padding = clamp(width * 0.032, 10, 30)
    this.laneWidth = (width - this.padding * 2) / 4
    this.judgeY = Math.round(height - clamp(height * 0.22, 96, 160))
    this.hitZoneAbove = Math.round(clamp(height * 0.16, 64, 132))
    this.hitZoneBelow = Math.round(clamp(height * 0.1, 48, 76))
    this.travelDistance = this.judgeY + 90
    this.calculateSpeed()
    if (this.running) this.draw()
  }

  calculateSpeed() {
    if (!this.track || !this.difficulty) return
    this.travelTime = getTravelTime(this.track, this.difficulty.id)
    this.speed = this.travelDistance / this.travelTime
  }

  async start({ track, chart, buffer }) {
    this.stopSource()
    const audio = getAudioContext()
    if (!audio) throw new Error('El audio no está listo.')
    this.track = track
    this.chart = chart
    this.buffer = buffer
    this.difficulty = this.chart.difficultyData
    this.notes = chart.notes.map((note) => ({
      ...note,
      judged: false,
      headJudged: false,
      active: false,
      broken: false,
      missed: false,
      done: false,
      grade: null,
      headGrade: null,
      headScore: 0,
    }))
    this.activeHolds = [null, null, null, null]
    this.pressedLanes = [false, false, false, false]
    this.laneFlash = [0, 0, 0, 0]
    this.bursts = []
    this.judgements = []
    this.beats = []
    this.metrics = {
      score: 0,
      combo: 0,
      maxCombo: 0,
      perfect: 0,
      great: 0,
      good: 0,
      miss: 0,
      holdComplete: 0,
      holdBreak: 0,
      judged: 0,
      weighted: 0,
      total: this.notes.length,
    }
    this.lastFrame = performance.now()
    this.running = true
    this.paused = false
    this.finalSongTime = 0
    this.pausedSongTime = 0
    this.audio = audio
    this.master = getMasterGain()
    this.startDelay = 3.15
    this.anchorSongTime = 0
    this.anchorContextTime = audio.currentTime + this.startDelay
    this.source = this.createSource(0)
    this.source.start(this.anchorContextTime, 0)
    this.resize()
    this.updateHud(true)
    this.countdown.classList.remove('is-hidden')
    this.countdownNumber.textContent = '3'
    this.countdown.classList.remove('is-go')
    this.animationFrame = requestAnimationFrame((time) => this.loop(time))
  }

  createSource(offset) {
    const source = this.audio.createBufferSource()
    source.buffer = this.buffer
    source.connect(this.master)
    this.source = source
    return source
  }

  stopSource() {
    if (this.source) {
      try {
        this.source.stop()
      } catch {
        // Already stopped.
      }
      try {
        this.source.disconnect()
      } catch {
        // Already disconnected.
      }
      this.source = null
    }
  }

  getSongTime() {
    if (!this.running) return this.finalSongTime || 0
    if (this.paused) return this.pausedSongTime
    return this.anchorSongTime + (this.audio.currentTime - this.anchorContextTime)
  }

  pause() {
    if (!this.running || this.paused) return
    this.pausedSongTime = this.getSongTime()
    this.paused = true
    this.stopSource()
    this.pressedLanes = [false, false, false, false]
    this.laneFlash = [0, 0, 0, 0]
    this.updateHud(true)
    this.draw()
    cancelAnimationFrame(this.animationFrame)
  }

  async resume() {
    if (!this.running || !this.paused) return
    const audio = await getAudioContext()
    this.audio = audio
    this.master = getMasterGain()
    this.paused = false
    const songTime = this.pausedSongTime
    const countdown = Math.max(0, -songTime)
    this.anchorSongTime = songTime
    this.anchorContextTime = audio.currentTime + Math.max(0.08, countdown)
    const offset = Math.max(0, Math.min(this.buffer.duration - 0.02, songTime))
    const source = this.createSource(offset)
    try {
      source.start(this.anchorContextTime, offset)
    } catch {
      // If the source can't resume, finish cleanly rather than freezing.
      this.finish()
      return
    }
    this.lastFrame = performance.now()
    this.animationFrame = requestAnimationFrame((time) => this.loop(time))
  }

  stop() {
    this.running = false
    this.paused = false
    this.stopSource()
    cancelAnimationFrame(this.animationFrame)
    this.notes = []
    this.bursts = []
    this.judgements = []
  }

  loop(time) {
    if (!this.running || this.paused) return
    const delta = clamp((time - this.lastFrame) / 1000, 0, 0.05)
    this.lastFrame = time
    const songTime = this.getSongTime()
    this.update(songTime, delta)
    if (!this.running) return
    this.draw()
    this.updateHud()
    this.animationFrame = requestAnimationFrame((next) => this.loop(next))
  }

  update(songTime, delta) {
    if (songTime >= this.track.duration + 0.18) {
      this.finish()
      return
    }

    this.updateCountdown(songTime)

    for (let lane = 0; lane < 4; lane += 1) {
      this.laneFlash[lane] = Math.max(0, this.laneFlash[lane] - delta * 4.4)
    }

    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i]
      burst.age += delta
      for (const particle of burst.particles) {
        particle.x += particle.vx * delta
        particle.y += particle.vy * delta
        particle.vy += 190 * delta
        particle.vx *= 0.985
      }
      if (burst.age > burst.life) this.bursts.splice(i, 1)
    }
    for (let i = this.judgements.length - 1; i >= 0; i -= 1) {
      this.judgements[i].age += delta
      if (this.judgements[i].age > this.judgements[i].life) this.judgements.splice(i, 1)
    }

    for (const note of this.notes) {
      if (note.done) continue
      if (!note.headJudged && !note.missed && songTime > note.time + this.difficulty.good) {
        this.missNote(note)
      }
      if (note.active && songTime >= note.endTime - 0.025) {
        this.completeHold(note)
      }
    }
  }

  updateCountdown(songTime) {
    if (songTime < -0.08) {
      const value = String(clamp(Math.ceil(-songTime), 1, 3))
      if (this.countdownNumber.textContent !== value) {
        this.countdownNumber.textContent = value
        this.countdownNumber.animate(
          [
            { transform: 'scale(0.7)', opacity: 0.2 },
            { transform: 'scale(1.04)', opacity: 1, offset: 0.35 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' },
        )
      }
      this.countdown.classList.remove('is-hidden', 'is-go')
    } else if (songTime < 0.55) {
      if (this.countdownNumber.textContent !== 'GO') {
        this.countdownNumber.textContent = 'GO'
        this.countdown.classList.add('is-go')
        this.countdownNumber.animate(
          [
            { transform: 'scale(0.65)', opacity: 0 },
            { transform: 'scale(1.12)', opacity: 1, offset: 0.4 },
            { transform: 'scale(1)', opacity: 0.9 },
          ],
          { duration: 500, easing: 'cubic-bezier(.16,1,.3,1)' },
        )
      }
      this.countdown.classList.remove('is-hidden')
    } else {
      this.countdown.classList.add('is-hidden')
    }
  }

  pressLane(lane) {
    if (!this.running || this.paused) return
    if (this.pressedLanes[lane]) return
    this.pressedLanes[lane] = true
    this.laneFlash[lane] = 1
    const songTime = this.getSongTime()
    let best = null
    let bestDifference = Infinity

    for (const note of this.notes) {
      if (note.lane !== lane || note.headJudged || note.missed || note.done) continue
      const difference = Math.abs(note.time - songTime)
      if (difference <= this.difficulty.good && difference < bestDifference) {
        best = note
        bestDifference = difference
      }
    }

    if (!best) {
      if (this.activeHolds[lane]) return
      return
    }

    const grade =
      bestDifference <= this.difficulty.perfect
        ? 'perfect'
        : bestDifference <= this.difficulty.great
          ? 'great'
          : 'good'
    this.resolveHead(best, grade)
  }

  releaseLane(lane) {
    this.pressedLanes[lane] = false
    if (!this.running || this.paused) return
    const hold = this.activeHolds[lane]
    if (!hold || !hold.active) return
    const songTime = this.getSongTime()
    if (songTime < hold.endTime - 0.14) {
      this.breakHold(hold)
    } else {
      this.completeHold(hold)
    }
  }

  resolveHead(note, grade) {
    note.headJudged = true
    note.headGrade = grade
    note.grade = grade
    const gradeData = GRADES[grade]
    const multiplier = 1 + Math.min(60, this.metrics.combo) * 0.018
    const points = Math.round(gradeData.points * multiplier)
    note.headScore = points
    this.metrics.score += points
    this.metrics.combo += 1
    this.metrics.maxCombo = Math.max(this.metrics.maxCombo, this.metrics.combo)
    this.spawnHit(note.lane, grade, note.type === 'hold')
    playHitPing(note.lane, grade)

    if (note.type === 'hold') {
      note.active = true
      this.activeHolds[note.lane] = note
      playHoldPing(note.lane)
    } else {
      this.finalizeTap(note, grade)
    }
    this.pulseCombo()
  }

  finalizeTap(note, grade) {
    note.done = true
    const gradeData = GRADES[grade]
    this.metrics.judged += 1
    this.metrics.weighted += gradeData.weight
    this.metrics[grade] += 1
  }

  completeHold(note) {
    if (!note.active) return
    note.active = false
    note.done = true
    note.judged = true
    this.activeHolds[note.lane] = null
    const grade = note.headGrade || 'good'
    this.metrics.judged += 1
    this.metrics.weighted += GRADES[grade].weight
    this.metrics[grade] += 1
    this.metrics.holdComplete += 1
    const bonus = Math.round(420 * (1 + Math.min(40, this.metrics.combo) * 0.012))
    this.metrics.score += bonus
    this.spawnHoldComplete(note.lane)
    this.pulseCombo()
  }

  breakHold(note) {
    if (!note.active) return
    note.active = false
    note.done = true
    note.broken = true
    note.missed = true
    this.activeHolds[note.lane] = null
    this.metrics.judged += 1
    this.metrics.weighted += 0.08
    this.metrics.miss += 1
    this.metrics.holdBreak += 1
    this.metrics.combo = 0
    this.spawnMiss(note.lane)
    this.pulseCombo()
  }

  missNote(note) {
    note.missed = true
    note.headJudged = true
    note.done = true
    note.active = false
    if (this.activeHolds[note.lane] === note) this.activeHolds[note.lane] = null
    this.metrics.judged += 1
    this.metrics.miss += 1
    this.metrics.combo = 0
    this.spawnMiss(note.lane)
    this.pulseCombo()
  }

  pulseCombo() {
    if (!this.hudCombo) return
    this.hudCombo.classList.remove('is-pulsing')
    void this.hudCombo.offsetWidth
    this.hudCombo.classList.add('is-pulsing')
  }

  accuracy() {
    if (!this.metrics || !this.metrics.judged) return 100
    return (this.metrics.weighted / this.metrics.judged) * 100
  }

  spawnHit(lane, grade, isHold) {
    const color = isHold ? '#bff8ff' : LANE_COLORS[lane].main
    const x = this.laneCenter(lane)
    const y = this.judgeY
    const count = window.innerWidth < 680 ? 8 : 13
    const particles = []
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4
      const speed = 80 + Math.random() * (grade === 'perfect' ? 240 : 150)
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 65,
        size: 1.5 + Math.random() * 3.2,
      })
    }
    this.bursts.push({
      x,
      y,
      age: 0,
      life: grade === 'perfect' ? 0.52 : 0.4,
      color,
      particles,
    })
    this.judgements = this.judgements.filter((item) => item.lane !== lane)
    this.judgements.push({
      x,
      lane,
      y: y - 84,
      text: GRADES[grade].label,
      color: GRADES[grade].color,
      age: 0,
      life: 0.62,
    })
  }

  spawnHoldComplete(lane) {
    const x = this.laneCenter(lane)
    this.bursts.push({
      x,
      y: this.judgeY,
      age: 0,
      life: 0.4,
      color: LANE_COLORS[lane].light,
      particles: Array.from({ length: 8 }, () => ({
        x,
        y: this.judgeY,
        vx: (Math.random() - 0.5) * 120,
        vy: -Math.random() * 180,
        size: 2 + Math.random() * 2,
      })),
    })
    this.judgements = this.judgements.filter((item) => item.lane !== lane)
    this.judgements.push({
      x,
      lane,
      y: this.judgeY - 116,
      text: 'HOLD',
      color: LANE_COLORS[lane].light,
      age: 0,
      life: 0.52,
    })
  }

  spawnMiss(lane) {
    this.judgements = this.judgements.filter((item) => item.lane !== lane)
    this.judgements.push({
      x: this.laneCenter(lane),
      lane,
      y: this.judgeY - 78,
      text: 'MISS',
      color: '#ff716c',
      age: 0,
      life: 0.52,
    })
  }

  laneCenter(lane) {
    return this.padding + this.laneWidth * (lane + 0.5)
  }

  laneAtPoint(clientX, clientY) {
    if (!this.canvas || !this.width) return -1
    const rect = this.canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    if (y < this.judgeY - this.hitZoneAbove || y > this.judgeY + this.hitZoneBelow) {
      return -1
    }
    if (x < this.padding || x > this.width - this.padding) return -1
    const lane = Math.floor((x - this.padding) / this.laneWidth)
    return lane >= 0 && lane < 4 ? lane : -1
  }

  laneMetrics(lane) {
    const width = this.laneWidth
    const center = this.laneCenter(lane)
    return {
      x: center - width * 0.5,
      center,
      width,
    }
  }

  updateHud(force = false) {
    if (!this.metrics) return
    const now = performance.now()
    if (!force && this.lastHudUpdate && now - this.lastHudUpdate < 55) return
    this.lastHudUpdate = now
    const songTime = clamp(this.getSongTime(), 0, this.track.duration)
    this.scoreEl.textContent = formatScore(this.metrics.score)
    this.comboEl.textContent = this.metrics.combo
    this.accuracyEl.textContent = `${this.accuracy().toFixed(1)}%`
    this.timeEl.textContent = `${formatTime(songTime)} / ${formatTime(this.track.duration)}`
    this.progressEl.style.width = `${clamp((songTime / this.track.duration) * 100, 0, 100)}%`
  }

  draw() {
    const context = this.context
    if (!this.width || !this.height || !this.context) return
    const width = this.width
    const height = this.height
    const songTime = this.getSongTime()
    context.clearRect(0, 0, width, height)
    this.drawLaneBackground(context, width, height)
    this.drawBeatGrid(context, songTime)
    this.drawLaneGlows(context, height)
    this.drawHitZone(context)

    const visible = []
    for (const note of this.notes) {
      if (note.done && !note.broken) continue
      if (note.done && note.broken && note.missed) {
        // Broken holds fade away with the chart.
      }
      const headY = this.judgeY - (note.time - songTime) * this.speed
      const tailY = note.endTime
        ? this.judgeY - (note.endTime - songTime) * this.speed
        : headY
      if (headY < -160 || tailY > height + 180) continue
      visible.push({ note, headY, tailY })
    }

    for (const item of visible) {
      if (item.note.type === 'hold') this.drawHoldBody(context, item)
    }
    for (const item of visible) {
      this.drawNoteCap(context, item)
    }

    this.drawJudgeLine(context, width)
    this.drawEffects(context)
    this.drawStageEdge(context, width, height)
  }

  drawLaneBackground(context, width, height) {
    const laneWidth = this.laneWidth
    for (let lane = 0; lane < 4; lane += 1) {
      const x = this.padding + lane * laneWidth
      context.fillStyle = lane % 2 === 0 ? 'rgba(255,255,255,0.017)' : 'rgba(255,255,255,0.006)'
      context.fillRect(x, 0, laneWidth, height)
      if (lane > 0) {
        context.fillStyle = 'rgba(255,255,255,0.045)'
        context.fillRect(x - 0.5, 0, 1, height)
      }
      context.fillStyle = 'rgba(255,255,255,0.025)'
      context.fillRect(x + 0.5, 0, 1, height)
    }
    const edge = context.createLinearGradient(0, 0, width, 0)
    edge.addColorStop(0, 'rgba(4,7,14,0.76)')
    edge.addColorStop(0.14, 'rgba(4,7,14,0)')
    edge.addColorStop(0.86, 'rgba(4,7,14,0)')
    edge.addColorStop(1, 'rgba(4,7,14,0.76)')
    context.fillStyle = edge
    context.fillRect(0, 0, width, height)
  }

  drawBeatGrid(context, songTime) {
    if (!this.track) return
    const beat = 60 / this.track.bpm
    const spacing = beat * this.speed
    let step = 1
    while (spacing * step < 30) step *= 2
    const beatOffset = this.track.beatOffset || 0
    const first = Math.floor((songTime - 0.5) / beat)
    const last = Math.ceil((songTime + this.travelTime + 0.5) / beat)
    context.save()
    for (let index = first; index <= last; index += step) {
      const time = beatOffset + index * beat
      const y = this.judgeY - (time - songTime) * this.speed
      if (y < -2 || y > this.height + 2) continue
      const isBar = index % 4 === 0
      context.strokeStyle = isBar ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.026)'
      context.lineWidth = isBar ? 1.2 : 1
      context.beginPath()
      context.moveTo(this.padding + 2, y)
      context.lineTo(this.width - this.padding - 2, y)
      context.stroke()
    }
    context.restore()
  }

  drawHitZone(context) {
    const top = this.judgeY - this.hitZoneAbove
    const bottom = this.judgeY + this.hitZoneBelow
    const gradient = context.createLinearGradient(0, top, 0, bottom)
    gradient.addColorStop(0, 'rgba(86, 230, 255, 0)')
    gradient.addColorStop(0.7, 'rgba(86, 230, 255, 0.035)')
    gradient.addColorStop(1, 'rgba(86, 230, 255, 0.012)')
    context.save()
    context.fillStyle = gradient
    context.fillRect(this.padding, top, this.width - this.padding * 2, bottom - top)
    context.restore()
  }

  drawLaneGlows(context, height) {
    for (let lane = 0; lane < 4; lane += 1) {
      const strength = Math.max(this.laneFlash[lane], this.pressedLanes[lane] ? 0.8 : 0)
      if (strength <= 0.01) continue
      const x = this.padding + lane * this.laneWidth
      const gradient = context.createLinearGradient(0, this.judgeY - 280, 0, height)
      gradient.addColorStop(0, 'rgba(0,0,0,0)')
      gradient.addColorStop(1, LANE_COLORS[lane].soft.replace(/0\.\d+\)/, `${0.22 * strength})`))
      context.fillStyle = gradient
      context.fillRect(x, this.judgeY - 280, this.laneWidth, height - this.judgeY + 280)
    }
  }

  noteWidth(lane) {
    const metrics = this.laneMetrics(lane)
    return Math.max(24, metrics.width * this.difficulty.noteWidth - 6)
  }

  noteHeight() {
    return Math.max(38, Math.min(this.difficulty.noteHeight, this.laneWidth * 1.14))
  }

  capRadius(lane) {
    return Math.min(this.noteWidth(lane) * 0.22, 17)
  }

  drawHoldBody(context, item) {
    const { note, headY, tailY } = item
    const width = this.noteWidth(note.lane)
    const color = LANE_COLORS[note.lane]
    const x = this.laneCenter(note.lane) - width * 0.36
    const bodyWidth = width * 0.72
    const top = Math.min(tailY, headY)
    const height = Math.max(4, headY - tailY)
    const active = note.active
    const broken = note.broken
    context.save()
    if (note.done && note.missed) context.globalAlpha = 0.18
    else if (broken) context.globalAlpha = 0.35
    const gradient = context.createLinearGradient(0, tailY, 0, headY)
    if (active) {
      gradient.addColorStop(0, color.main)
      gradient.addColorStop(1, color.light)
    } else {
      gradient.addColorStop(0, color.main)
      gradient.addColorStop(1, color.main)
    }
    context.shadowColor = active ? color.shadow : 'rgba(0,0,0,0)'
    context.shadowBlur = active ? 28 : 0
    context.globalAlpha *= active ? 0.58 : 0.32
    roundRect(context, x, top, bodyWidth, height, bodyWidth / 2)
    context.fillStyle = gradient
    context.fill()

    context.shadowBlur = 0
    context.strokeStyle = active ? color.light : color.main
    context.globalAlpha = Math.min(1, context.globalAlpha + 0.22)
    context.lineWidth = 1
    roundRect(context, x + 0.5, top, bodyWidth - 1, height, bodyWidth / 2)
    context.stroke()

    if (height > 26) {
      context.save()
      roundRect(context, x, top, bodyWidth, height, bodyWidth / 2)
      context.clip()
      context.strokeStyle = 'rgba(255,255,255,0.2)'
      context.lineWidth = 1
      const spacing = 18
      const shift = (this.getSongTime() * this.speed * 0.55) % spacing
      for (let y = top + shift; y < headY; y += spacing) {
        context.beginPath()
        context.moveTo(x + bodyWidth * 0.2, y)
        context.lineTo(x + bodyWidth * 0.8, y)
        context.stroke()
      }
      context.restore()
    }
    context.restore()
  }

  drawNoteCap(context, item) {
    const { note, headY } = item
    const width = this.noteWidth(note.lane)
    const height = this.noteHeight()
    const x = this.laneCenter(note.lane) - width / 2
    const y = headY - height / 2
    const color = LANE_COLORS[note.lane]
    const broken = note.broken
    const isHold = note.type === 'hold'
    context.save()
    if (note.done && note.missed) {
      context.globalAlpha = 0.2
    } else if (broken) {
      context.globalAlpha = 0.32
    }
    context.shadowColor = broken ? 'rgba(255,80,80,0.18)' : color.shadow
    context.shadowBlur = this.pressedLanes[note.lane] ? 28 : 17
    const gradient = context.createLinearGradient(0, y, 0, y + height)
    if (broken) {
      gradient.addColorStop(0, '#6d5157')
      gradient.addColorStop(1, '#382a31')
    } else {
      gradient.addColorStop(0, color.light)
      gradient.addColorStop(0.42, color.main)
      gradient.addColorStop(1, color.main)
    }
    roundRect(context, x, y, width, height, this.capRadius(note.lane))
    context.fillStyle = gradient
    context.fill()
    context.shadowBlur = 0
    context.strokeStyle = 'rgba(255,255,255,0.34)'
    context.lineWidth = 1.2
    roundRect(context, x + 0.6, y + 0.6, width - 1.2, height - 1.2, this.capRadius(note.lane))
    context.stroke()

    context.globalAlpha *= isHold ? 0.7 : 0.5
    context.fillStyle = 'rgba(255,255,255,0.4)'
    roundRect(context, x + width * 0.16, y + 7, width * 0.68, 2, 1)
    context.fill()
    context.globalAlpha = 1

    if (isHold) {
      context.strokeStyle = 'rgba(10,15,22,0.28)'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(x + width * 0.3, y + height * 0.72)
      context.lineTo(x + width * 0.5, y + height * 0.5)
      context.lineTo(x + width * 0.7, y + height * 0.72)
      context.stroke()
    }
    if (note.active) {
      context.globalAlpha = 0.55
      context.strokeStyle = '#ffffff'
      context.lineWidth = 1.4
      roundRect(context, x - 3, y - 3, width + 6, height + 6, this.capRadius(note.lane) + 2)
      context.stroke()
    }
    context.restore()
  }

  drawJudgeLine(context, width) {
    const gradient = context.createLinearGradient(0, 0, width, 0)
    gradient.addColorStop(0, 'rgba(255,255,255,0)')
    gradient.addColorStop(0.08, 'rgba(255,255,255,0.5)')
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.96)')
    gradient.addColorStop(0.92, 'rgba(255,255,255,0.5)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.save()
    context.shadowColor = 'rgba(170,235,255,0.7)'
    context.shadowBlur = 16
    context.fillStyle = gradient
    context.fillRect(this.padding, this.judgeY - 1, width - this.padding * 2, 2)
    context.shadowBlur = 0
    for (let lane = 0; lane < 4; lane += 1) {
      const x = this.laneCenter(lane)
      context.fillStyle = this.pressedLanes[lane]
        ? LANE_COLORS[lane].light
        : 'rgba(255,255,255,0.65)'
      context.beginPath()
      context.arc(x, this.judgeY, this.pressedLanes[lane] ? 4 : 2.2, 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
  }

  drawStageEdge(context, width, height) {
    const topFade = context.createLinearGradient(0, 0, 0, 74)
    topFade.addColorStop(0, 'rgba(5,8,15,0.9)')
    topFade.addColorStop(1, 'rgba(5,8,15,0)')
    context.fillStyle = topFade
    context.fillRect(0, 0, width, 74)
    const bottomFade = context.createLinearGradient(0, height - 30, 0, height)
    bottomFade.addColorStop(0, 'rgba(5,8,15,0)')
    bottomFade.addColorStop(1, 'rgba(5,8,15,0.8)')
    context.fillStyle = bottomFade
    context.fillRect(0, height - 30, width, 30)
  }

  drawEffects(context) {
    context.save()
    context.globalCompositeOperation = 'lighter'
    for (const burst of this.bursts) {
      const progress = burst.age / burst.life
      const alpha = 1 - progress
      context.globalAlpha = alpha * 0.9
      context.strokeStyle = burst.color
      context.lineWidth = 2
      context.beginPath()
      context.arc(burst.x, burst.y, 8 + progress * 42, 0, Math.PI * 2)
      context.stroke()
      for (const particle of burst.particles) {
        context.fillStyle = burst.color
        context.globalAlpha = alpha
        context.beginPath()
        context.arc(particle.x, particle.y, particle.size * (1 - progress * 0.7), 0, Math.PI * 2)
        context.fill()
      }
    }
    context.restore()

    for (const judgement of this.judgements) {
      const progress = judgement.age / judgement.life
      context.save()
      context.globalAlpha = Math.sin((1 - progress) * Math.PI * 0.86)
      context.fillStyle = judgement.color
      context.font = `700 ${clamp(this.width * 0.018, 10, 14)}px "Space Mono", monospace`
      context.textAlign = 'center'
      context.letterSpacing = '0.08em'
      context.shadowColor = judgement.color
      context.shadowBlur = 12
      context.fillText(judgement.text, judgement.x, judgement.y - progress * 24)
      context.restore()
    }
  }

  finish() {
    if (!this.running) return
    this.finalSongTime = clamp(this.getSongTime(), 0, this.track.duration)
    this.running = false
    this.paused = false
    this.stopSource()
    cancelAnimationFrame(this.animationFrame)
    this.countdown.classList.add('is-hidden')
    const accuracy = this.accuracy()
    const {
      perfect,
      great,
      good,
      miss,
      maxCombo,
      holdComplete,
      holdBreak,
      total,
    } = this.metrics
    let grade = 'D'
    let gradeLabel = 'Sigue intentando'
    if (miss === 0 && accuracy >= 99) {
      grade = 'S+'
      gradeLabel = 'Pulso absoluto'
    } else if (accuracy >= 96 && miss <= 2) {
      grade = 'S'
      gradeLabel = 'Impecable'
    } else if (accuracy >= 90) {
      grade = 'A'
      gradeLabel = 'Gran control'
    } else if (accuracy >= 80) {
      grade = 'B'
      gradeLabel = 'Buen pulso'
    } else if (accuracy >= 66) {
      grade = 'C'
      gradeLabel = 'En progreso'
    }
    const result = {
      track: this.track,
      difficulty: this.difficulty,
      score: Math.round(this.metrics.score),
      accuracy,
      maxCombo,
      perfect,
      great,
      good,
      miss,
      holdComplete,
      holdBreak,
      total,
      grade,
      gradeLabel,
    }
    this.draw()
    if (this.callbacks.onFinish) this.callbacks.onFinish(result)
  }
}
