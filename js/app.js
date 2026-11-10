import {
  BUILT_IN_TRACKS,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  formatTime,
  clamp,
  hashString,
} from './data.js'
import { createChart, getTravelTime } from './chart.js'
import { buildComposition, renderTrackAudio } from './composition.js'
import {
  analyzeAudioFile,
  ensureAudioContext,
  isMuted,
  setMuted,
} from './audio-engine.js'
import { RhythmGame } from './game.js'

const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => Array.from(document.querySelectorAll(selector))

const IMPORT_COLORS = [
  ['#70f5cf', '#45a7ff'],
  ['#ffd166', '#ff7a59'],
  ['#c59bff', '#ff78c8'],
  ['#8eff9b', '#43cfd1'],
]

const state = {
  tracks: [...BUILT_IN_TRACKS],
  trackId: BUILT_IN_TRACKS[0].id,
  difficulty: 'normal',
  muted: false,
  pendingUpload: null,
  activePointerLanes: [new Set(), new Set(), new Set(), new Set()],
  keyboardLanes: new Set(),
  currentResult: null,
  screen: 'home',
  starting: false,
}

const elements = {
  homeScreen: $('#homeScreen'),
  gameScreen: $('#gameScreen'),
  trackGrid: $('#trackGrid'),
  trackCount: $('#trackCount'),
  diffGrid: $('#diffGrid'),
  diffBadge: $('#diffBadge'),
  summaryTrack: $('#summaryTrack'),
  summaryMeta: $('#summaryMeta'),
  summarySpeed: $('#summarySpeed'),
  playButton: $('#playButton'),
  importButton: $('#importButton'),
  importModal: $('#importModal'),
  importModalCard: $('#importModalCard'),
  dropZone: $('#dropZone'),
  fileInput: $('#fileInput'),
  importError: $('#importError'),
  chooseStep: $('#chooseStep'),
  analyzeStep: $('#analyzeStep'),
  successStep: $('#successStep'),
  analyzeName: $('#analyzeName'),
  analyzeStatus: $('#analyzeStatus'),
  analyzeProgress: $('#analyzeProgress'),
  importTitle: $('#importTitle'),
  detectBpm: $('#detectBpm'),
  detectDuration: $('#detectDuration'),
  detectOnsets: $('#detectOnsets'),
  detectConfidence: $('#detectConfidence'),
  addAndPlay: $('#addAndPlay'),
  addOnly: $('#addOnly'),
  importAgain: $('#importAgain'),
  closeImport: $('#closeImport'),
  loadingOverlay: $('#loadingOverlay'),
  loadingTitle: $('#loadingTitle'),
  loadingText: $('#loadingText'),
  pauseOverlay: $('#pauseOverlay'),
  resultsOverlay: $('#resultsOverlay'),
  helpOverlay: $('#helpOverlay'),
  toast: $('#toast'),
  countdown: $('#countdown'),
  countdownNumber: $('#countdownNumber'),
  gameTrackTitle: $('#gameTrackTitle'),
  gameTrackArtist: $('#gameTrackArtist'),
  gameDiffPill: $('#gameDiffPill'),
  keyPads: $$('.key-pad'),
  soundButtons: $$('.sound-toggle'),
  helpButton: $('#helpButton'),
}

const game = new RhythmGame(
  {
    canvas: $('#gameCanvas'),
    stage: $('#stage'),
    countdown: elements.countdown,
    countdownNumber: elements.countdownNumber,
    score: $('#scoreValue'),
    combo: $('#comboValue'),
    accuracy: $('#accuracyValue'),
    time: $('#timeValue'),
    progress: $('#progressFill'),
    hudCombo: $('#hudCombo'),
  },
  {
    onFinish: showResults,
  },
)

const audioCache = new Map()

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function currentTrack() {
  return state.tracks.find((track) => track.id === state.trackId) || state.tracks[0]
}

function setAccent(track) {
  document.documentElement.style.setProperty('--accent', track.color)
  document.documentElement.style.setProperty('--accent-2', track.color2 || track.color)
}

function checkIcon() {
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.4 3.1 3.1L13 4.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
}

function renderTracks() {
  elements.trackGrid.innerHTML = state.tracks
    .map((track) => {
      const selected = track.id === state.trackId
      return `
        <button class="track-card${selected ? ' is-selected' : ''}" type="button" data-track-id="${escapeHtml(track.id)}" aria-pressed="${selected}" style="--track-a:${track.color};--track-b:${track.color2 || track.color};">
          <span class="track-art art-${escapeHtml(track.art || 'imported')}" aria-hidden="true"><i></i><b></b><em></em></span>
          <span class="track-copy">
            <strong>${escapeHtml(track.title)}</strong>
            <small>${escapeHtml(track.artist)} <span>·</span> ${track.bpm} BPM</small>
          </span>
          <span class="track-check">${selected ? checkIcon() : ''}</span>
        </button>
      `
    })
    .join('')
  elements.trackCount.textContent = `${state.tracks.length} ${state.tracks.length === 1 ? 'pista' : 'pistas'}`
}

function renderDifficulties() {
  elements.diffGrid.innerHTML = DIFFICULTY_ORDER.map((id) => {
    const diff = DIFFICULTIES[id]
    const selected = id === state.difficulty
    return `
      <button class="diff-card${selected ? ' is-selected' : ''}" type="button" data-diff="${id}" aria-pressed="${selected}" style="--diff-color:${diff.color};--diff-soft:${diff.soft};">
        <span class="diff-topline">
          <span class="diff-tier">${diff.tier}</span>
          <span class="diff-check">${selected ? checkIcon() : ''}</span>
        </span>
        <span class="diff-name">${diff.name}</span>
        <span class="diff-tagline">${diff.tagline}</span>
        <span class="diff-metrics">
          <span class="speed-bars" aria-hidden="true">${[1, 2, 3, 4]
            .map((bar) => `<i style="height:${4 + bar * 2 + diff.bars * 1.6}px;${bar <= diff.bars ? '' : 'opacity:.22'}"></i>`)
            .join('')}</span>
          <span>${diff.speedLabel}</span>
          <span class="metric-dot"></span>
          <span>${diff.densityLabel}</span>
        </span>
      </button>
    `
  }).join('')
}

function updateSummary() {
  const track = currentTrack()
  const diff = DIFFICULTIES[state.difficulty]
  const chart = createChart(track, state.difficulty)
  const travel = getTravelTime(track, state.difficulty)
  elements.summaryTrack.textContent = track.title
  elements.summaryMeta.textContent = `${chart.notes.length} notas · ${chart.holdCount} holds`
  elements.summarySpeed.textContent = `Caída ${travel.toFixed(2)} s`
  elements.diffBadge.textContent = diff.name
  elements.diffBadge.style.color = diff.color
  elements.diffBadge.style.borderColor = diff.soft
  elements.diffBadge.style.background = diff.soft
  elements.playButton.style.setProperty('--play-color', diff.color)
  elements.playButton.style.setProperty('--play-soft', diff.soft)
  setAccent(track)
}

function refreshSelection() {
  renderTracks()
  renderDifficulties()
  updateSummary()
}

function showScreen(screen) {
  state.screen = screen
  const isGame = screen === 'game'
  elements.homeScreen.hidden = isGame
  elements.gameScreen.hidden = !isGame
  document.body.classList.toggle('is-playing', isGame)
  if (isGame) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo(0, 0))
    })
  } else {
    window.scrollTo(0, 0)
  }
}

function setGameHeader(track, diff) {
  elements.gameTrackTitle.textContent = track.title
  elements.gameTrackArtist.textContent = track.artist
  elements.gameDiffPill.textContent = diff.name
  elements.gameDiffPill.style.setProperty('--diff-color', diff.color)
  elements.gameDiffPill.style.setProperty('--diff-soft', diff.soft)
}

function setPlayLoading(active, title = 'Preparando pista', text = 'Sincronizando notas con el audio…') {
  elements.loadingOverlay.hidden = !active
  elements.loadingTitle.textContent = title
  elements.loadingText.textContent = text
}

async function getTrackAudio(track) {
  if (track.builtIn) {
    if (!audioCache.has(track.id)) {
      const promise = (async () => {
        if (track.audio) {
          try {
            const response = await fetch(track.audio)
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const data = await response.arrayBuffer()
            const context = await ensureAudioContext()
            return await context.decodeAudioData(data)
          } catch (error) {
            console.warn('No se pudo cargar el audio pre-renderizado, sintetizando en vivo.', error)
          }
        }
        return renderTrackAudio(track)
      })()
      audioCache.set(track.id, promise)
    }
    return audioCache.get(track.id)
  }
  return track.audioBuffer
}

async function startRun() {
  if (!state.tracks.length || state.starting) return
  state.starting = true
  const track = currentTrack()
  const diff = DIFFICULTIES[state.difficulty]
  const chart = createChart(track, state.difficulty)
  setPlayLoading(true, track.builtIn ? 'Preparando pista' : 'Cargando pista', 'Sincronizando notas con el audio…')
  try {
    await ensureAudioContext()
    const buffer = await getTrackAudio(track)
    if (!buffer) throw new Error('No se pudo preparar el audio de esta pista.')
    hideOverlays()
    setGameHeader(track, diff)
    elements.pauseOverlay.hidden = true
    elements.resultsOverlay.hidden = true
    showScreen('game')
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    setPlayLoading(false)
    await game.start({ track, chart, buffer })
  } catch (error) {
    console.error(error)
    setPlayLoading(false)
    showScreen('home')
    toast(error.message || 'No se pudo iniciar la partida.', true)
  } finally {
    state.starting = false
  }
}

function openPause() {
  if (!game.running || game.paused) return
  game.pause()
  clearPressedPads()
  elements.pauseOverlay.hidden = false
  elements.pauseOverlay.querySelector('[data-pause-resume]')?.focus({ preventScroll: true })
}

async function resumeGame() {
  if (!game.running) return
  elements.pauseOverlay.hidden = true
  await game.resume()
}

function restartRun() {
  const track = currentTrack()
  const diff = DIFFICULTIES[state.difficulty]
  elements.pauseOverlay.hidden = true
  elements.resultsOverlay.hidden = true
  game.stop()
  setGameHeader(track, diff)
  showScreen('game')
  startRun()
}

function goHome() {
  game.stop()
  clearPressedPads()
  hideOverlays()
  elements.countdown.classList.add('is-hidden')
  showScreen('home')
}

function hideOverlays() {
  elements.pauseOverlay.hidden = true
  elements.resultsOverlay.hidden = true
  elements.helpOverlay.hidden = true
  elements.importModal.hidden = true
}

function showResults(result) {
  state.currentResult = result
  const isNewBest = saveBest(result)
  const gradeCopy = {
    'S+': 'Ritmo perfecto.',
    S: 'Impecable.',
    A: 'Buen pulso.',
    B: 'Vas tomando el ritmo.',
    C: 'Sigue el compás.',
    D: 'El pulso te ganó.',
  }
  const resultsCard = elements.resultsOverlay.querySelector('.results-card')
  resultsCard.style.setProperty('--accent', result.difficulty.color)
  resultsCard.style.setProperty('--accent-2', result.difficulty.color)
  $('#resultTitle').textContent = gradeCopy[result.grade] || 'Run completa.'
  $('#resultGrade').textContent = result.grade
  $('#resultGrade').dataset.grade = result.grade
  $('#resultGradeLabel').textContent = result.gradeLabel
  $('#resultTrack').textContent = result.track.title
  $('#resultSubline').textContent = `${result.difficulty.name} · ${result.track.artist}`
  $('#resultScore').textContent = Math.round(result.score).toLocaleString('es-ES')
  $('#resultAccuracy').textContent = `${result.accuracy.toFixed(1)}%`
  $('#resultCombo').textContent = `x${result.maxCombo}`
  $('#resultHolds').textContent = `${result.holdComplete}/${result.holdComplete + result.holdBreak}`
  $('#resultPerfect').textContent = result.perfect
  $('#resultGreat').textContent = result.great
  $('#resultGood').textContent = result.good
  $('#resultMiss').textContent = result.miss
  const record = getBest(result.track.id, result.difficulty.id)
  $('#resultBest').textContent = record
    ? `MEJOR · ${Math.round(record.score).toLocaleString('es-ES')} · ${record.accuracy.toFixed(1)}%`
    : 'PRIMERA RUN'
  $('#newRecord').hidden = !isNewBest
  elements.resultsOverlay.hidden = false
  $('#resultRetry').focus({ preventScroll: true })
}

function bestKey(trackId, difficulty) {
  return `pulse-tiles-best:${trackId}:${difficulty}`
}

function getBest(trackId, difficulty) {
  try {
    const value = localStorage.getItem(bestKey(trackId, difficulty))
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function saveBest(result) {
  const previous = getBest(result.track.id, result.difficulty.id)
  const better =
    !previous ||
    result.score > previous.score ||
    (result.score === previous.score && result.accuracy > previous.accuracy)
  if (!better) return false
  try {
    localStorage.setItem(
      bestKey(result.track.id, result.difficulty.id),
      JSON.stringify({
        score: result.score,
        accuracy: result.accuracy,
        maxCombo: result.maxCombo,
        grade: result.grade,
        date: Date.now(),
      }),
    )
  } catch {
    // Storage can be unavailable in private mode; the run still finishes.
  }
  return true
}

function toast(message, isError = false) {
  elements.toast.textContent = message
  elements.toast.classList.toggle('is-error', isError)
  elements.toast.classList.add('is-visible')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => elements.toast.classList.remove('is-visible'), 3200)
}

function setImportStep(step) {
  elements.chooseStep.hidden = step !== 'choose'
  elements.analyzeStep.hidden = step !== 'analyze'
  elements.successStep.hidden = step !== 'success'
  elements.importError.textContent = ''
}

function openImport() {
  state.pendingUpload = null
  elements.fileInput.value = ''
  elements.importTitle.value = ''
  setImportStep('choose')
  elements.importModal.hidden = false
  setTimeout(() => elements.dropZone.focus({ preventScroll: true }), 30)
}

function closeImport() {
  if (!elements.analyzeStep.hidden) return
  elements.importModal.hidden = true
}

function cleanTitle(filename) {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 46) || 'Pista local'
}

async function handleFile(file) {
  if (!file) return
  const looksAudio = file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|webm|opus)$/i.test(file.name)
  if (!looksAudio) {
    elements.importError.textContent = 'Ese archivo no parece audio. Usa MP3, WAV, OGG, M4A o FLAC.'
    return
  }
  if (file.size > 40 * 1024 * 1024) {
    elements.importError.textContent = 'El archivo supera los 40 MB. Prueba con una versión más ligera.'
    return
  }
  setImportStep('analyze')
  elements.analyzeName.textContent = file.name
  elements.analyzeStatus.textContent = 'Iniciando análisis…'
  elements.analyzeProgress.style.width = '4%'
  try {
    const result = await analyzeAudioFile(file, (progress, label) => {
      elements.analyzeProgress.style.width = `${clamp(progress * 100, 4, 100)}%`
      elements.analyzeStatus.textContent = label
    })
    state.pendingUpload = {
      file,
      buffer: result.buffer,
      analysis: result.analysis,
      title: cleanTitle(file.name),
    }
    elements.importTitle.value = state.pendingUpload.title
    elements.detectBpm.textContent = `${result.analysis.bpm} BPM`
    elements.detectDuration.textContent = formatTime(result.analysis.duration)
    elements.detectOnsets.textContent = `${result.analysis.onsetCount} ataques`
    elements.detectConfidence.textContent = `${Math.round(result.analysis.confidence * 100)}%`
    setImportStep('success')
    setTimeout(() => elements.importTitle.focus({ preventScroll: true }), 40)
  } catch (error) {
    console.error(error)
    setImportStep('choose')
    elements.importError.textContent = error.message || 'No se pudo analizar este archivo. Prueba con otro formato.'
  }
}

function addImportedTrack(playNow = false) {
  if (!state.pendingUpload) return
  const { buffer, analysis } = state.pendingUpload
  const title = elements.importTitle.value.trim().slice(0, 46) || state.pendingUpload.title
  const palette = IMPORT_COLORS[state.tracks.filter((track) => track.imported).length % IMPORT_COLORS.length]
  const id = `local-${Date.now()}-${hashString(title).toString(36)}`
  const track = {
    id,
    title,
    artist: 'Archivo local',
    bpm: analysis.bpm,
    duration: analysis.duration,
    beatOffset: analysis.beatOffset,
    confidence: analysis.confidence,
    events: analysis.events,
    audioBuffer: buffer,
    builtIn: false,
    imported: true,
    tag: 'Importada',
    art: 'imported',
    color: palette[0],
    color2: palette[1],
    songFileName: state.pendingUpload.file.name,
  }
  state.tracks.push(track)
  state.trackId = id
  state.pendingUpload = null
  elements.importModal.hidden = true
  refreshSelection()
  toast(`“${title}” añadida al setlist.`)
  if (playNow) startRun()
}

function clearPressedPads() {
  elements.keyPads.forEach((pad) => pad.classList.remove('is-pressed'))
  state.activePointerLanes.forEach((set) => set.clear())
  state.keyboardLanes.clear()
}

function pressPad(lane, pointerId = null) {
  const pad = elements.keyPads[lane]
  if (pointerId !== null) state.activePointerLanes[lane].add(pointerId)
  pad.classList.add('is-pressed')
  game.pressLane(lane)
}

function releasePad(lane, pointerId = null) {
  if (pointerId !== null) state.activePointerLanes[lane].delete(pointerId)
  const stillHeld = state.activePointerLanes[lane].size > 0 || state.keyboardLanes.has(lane)
  if (!stillHeld) {
    elements.keyPads[lane].classList.remove('is-pressed')
    game.releaseLane(lane)
  }
}

function updateSoundButtons() {
  const muted = isMuted() || state.muted
  elements.soundButtons.forEach((button) => {
    button.classList.toggle('is-muted', muted)
    button.setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar sonido')
    button.title = muted ? 'Activar sonido' : 'Silenciar sonido'
  })
}

function toggleSound() {
  state.muted = !state.muted
  setMuted(state.muted)
  updateSoundButtons()
}

function initEvents() {
  elements.trackGrid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-track-id]')
    if (!card) return
    state.trackId = card.dataset.trackId
    refreshSelection()
  })

  elements.diffGrid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-diff]')
    if (!card) return
    state.difficulty = card.dataset.diff
    refreshSelection()
  })

  elements.playButton.addEventListener('click', startRun)
  elements.importButton.addEventListener('click', openImport)
  elements.closeImport.addEventListener('click', closeImport)
  elements.importAgain.addEventListener('click', () => {
    state.pendingUpload = null
    elements.fileInput.value = ''
    setImportStep('choose')
  })
  elements.addAndPlay.addEventListener('click', () => addImportedTrack(true))
  elements.addOnly.addEventListener('click', () => addImportedTrack(false))

  elements.importModal.addEventListener('click', (event) => {
    if (event.target === elements.importModal) closeImport()
  })

  elements.dropZone.addEventListener('click', () => elements.fileInput.click())
  elements.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      elements.fileInput.click()
    }
  })
  elements.fileInput.addEventListener('change', () => handleFile(elements.fileInput.files?.[0]))
  ;['dragenter', 'dragover'].forEach((type) => {
    elements.dropZone.addEventListener(type, (event) => {
      event.preventDefault()
      elements.dropZone.classList.add('is-dragging')
    })
  })
  ;['dragleave', 'drop'].forEach((type) => {
    elements.dropZone.addEventListener(type, (event) => {
      event.preventDefault()
      elements.dropZone.classList.remove('is-dragging')
    })
  })
  elements.dropZone.addEventListener('drop', (event) => {
    handleFile(event.dataTransfer?.files?.[0])
  })

  elements.soundButtons.forEach((button) => button.addEventListener('click', toggleSound))
  elements.helpButton.addEventListener('click', () => {
    elements.helpOverlay.hidden = false
  })
  elements.helpOverlay.addEventListener('click', (event) => {
    if (event.target === elements.helpOverlay || event.target.closest('[data-close-help]')) {
      elements.helpOverlay.hidden = true
    }
  })

  $('#gamePauseButton').addEventListener('click', openPause)
  $('#gameBackButton').addEventListener('click', openPause)
  $('[data-pause-resume]').addEventListener('click', resumeGame)
  $('[data-pause-restart]').addEventListener('click', restartRun)
  $('[data-pause-home]').addEventListener('click', goHome)
  $('[data-result-retry]').addEventListener('click', restartRun)
  $('[data-result-home]').addEventListener('click', goHome)
  $('[data-pause-sound]').addEventListener('click', (event) => {
    toggleSound()
    event.currentTarget.classList.toggle('is-muted', isMuted())
  })

  elements.keyPads.forEach((pad) => {
    const lane = Number(pad.dataset.lane)
    pad.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      try {
        pad.setPointerCapture?.(event.pointerId)
      } catch {
        // Pointer capture can fail for synthetic or already-released pointers.
      }
      if (state.activePointerLanes[lane].size === 0 && !state.keyboardLanes.has(lane)) {
        pressPad(lane, event.pointerId)
      } else {
        state.activePointerLanes[lane].add(event.pointerId)
      }
    })
    const release = (event) => {
      event.preventDefault()
      releasePad(lane, event.pointerId)
    }
    pad.addEventListener('pointerup', release)
    pad.addEventListener('pointercancel', release)
    pad.addEventListener('contextmenu', (event) => event.preventDefault())
  })

  window.addEventListener('keydown', (event) => {
    if (!elements.importModal.hidden) {
      if (event.key === 'Escape') closeImport()
      return
    }
    if (!elements.helpOverlay.hidden) {
      if (event.key === 'Escape') elements.helpOverlay.hidden = true
      return
    }
    if (!elements.resultsOverlay.hidden) return
    if (event.key === 'Escape') {
      if (state.screen === 'game') {
        event.preventDefault()
        if (game.paused) resumeGame()
        else openPause()
      }
      return
    }
    if (state.screen !== 'game' || game.paused) return
    const lane = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 }[event.code]
    if (lane === undefined || event.repeat) return
    event.preventDefault()
    state.keyboardLanes.add(lane)
    elements.keyPads[lane].classList.add('is-pressed')
    game.pressLane(lane)
  })

  window.addEventListener('keyup', (event) => {
    const lane = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 }[event.code]
    if (lane === undefined) return
    state.keyboardLanes.delete(lane)
    if (!state.activePointerLanes[lane].size) {
      elements.keyPads[lane].classList.remove('is-pressed')
      if (state.screen === 'game' && !game.paused) game.releaseLane(lane)
    }
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.screen === 'game' && game.running && !game.paused) {
      openPause()
    }
  })
}

function boot() {
  state.muted = isMuted()
  updateSoundButtons()
  renderTracks()
  renderDifficulties()
  updateSummary()
  initEvents()
  setImportStep('choose')
  window.__pulse = { game, state }
}

boot()
