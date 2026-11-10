(() => {
  const $ = (id) => document.getElementById(id);
  const home = $('home'), setup = $('setup'), game = $('game');
  const fileInput = $('fileInput');
  const difficultySettings = {
    easy: { label: 'TRANQUILO', lanes: 2, subdivisions: 1, speed: 1.55, window: .24 },
    normal: { label: 'EN MARCHA', lanes: 3, subdivisions: 2, speed: 1.85, window: .20 },
    hard: { label: 'A TOPE', lanes: 4, subdivisions: 2, speed: 2.15, window: .17 }
  };
  let selectedDifficulty = 'easy';
  let track = null;
  let audioContext = null;
  let sourceNode = null;
  let audioElement = null;
  let soundEnabled = true;
  let isDemo = false;
  let bpm = 120, duration = 60, beatTimes = [];
  let active = false, paused = false, startAt = 0, pauseAt = 0, animation = 0;
  let notes = [], nextSpawn = 0, score = 0, combo = 0, bestCombo = 0, hits = 0, misses = 0, perfect = 0;
  let laneCount = 2, noteSequence = 0, lastJudgementTimer;
  let toastTimer;

  function show(view) { [home, setup, game].forEach(el => el.classList.add('hidden')); view.classList.remove('hidden'); }
  function formatTime(s) { const n = Math.max(0, Math.ceil(s)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
  function formatScore(n) { return String(n).padStart(6, '0'); }
  function toast(message) { const t = $('toast'); t.textContent = message; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
  function setStatus(message, ok = true) { $('statusText').textContent = message; $('analysisStatus').classList.toggle('analyzing', !ok); document.querySelector('.status-check').textContent = ok ? '✓' : ''; }

  $('uploadBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) { toast('Elige un archivo de audio compatible.'); return; }
    $('trackName').textContent = file.name.replace(/\.[^.]+$/, '');
    $('trackMeta').innerHTML = 'Analizando audio… <span>·</span> esto puede tardar un momento';
    show(setup); setStatus('Analizando ritmo…', false);
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
      duration = decoded.duration;
      const analysis = detectBeats(decoded);
      bpm = analysis.bpm; beatTimes = analysis.beats;
      track = { file, duration, decoded, name: file.name.replace(/\.[^.]+$/, '') };
      isDemo = false;
      $('trackMeta').innerHTML = `Tu canción <span>·</span> ${bpm} BPM <span>·</span> ${formatTime(duration)}`;
      setStatus(analysis.confidence ? `Ritmo detectado · ${analysis.confidence}% de confianza` : 'Ritmo estimado · puedes jugar');
    } catch (error) {
      console.error(error);
      track = { file, duration: 60, decoded: null, name: file.name.replace(/\.[^.]+$/, '') };
      duration = 60; bpm = 120; beatTimes = makeRegularBeats(duration, bpm, 0);
      isDemo = false;
      $('trackMeta').innerHTML = 'No se pudo analizar <span>·</span> 120 BPM estimados <span>·</span> 1:00';
      setStatus('Ritmo estimado · archivo no compatible con el análisis');
      toast('No se pudo analizar el ritmo. Se usará un pulso constante.');
    }
    fileInput.value = '';
  });

  function detectBeats(buffer) {
    const sampleRate = buffer.sampleRate;
    const hop = Math.max(256, Math.floor(sampleRate * .01));
    const frames = Math.floor(buffer.length / hop);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const energy = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0, start = f * hop, end = Math.min(start + hop, buffer.length);
      for (let c = 0; c < channels.length; c++) {
        const data = channels[c];
        for (let i = start; i < end; i += 4) sum += data[i] * data[i];
      }
      energy[f] = Math.sqrt(sum / Math.max(1, channels.length * ((end - start) / 4)));
    }
    const novelty = new Float32Array(frames);
    for (let i = 2; i < frames; i++) novelty[i] = Math.max(0, energy[i] - (energy[i - 1] * .72 + energy[i - 2] * .28));
    for (let i = 2; i < frames - 2; i++) novelty[i] = (novelty[i - 2] + novelty[i - 1] + novelty[i] * 2 + novelty[i + 1] + novelty[i + 2]) / 6;
    let bestLag = 50, bestScore = -1, runnerUp = 0;
    for (let lag = 33; lag <= 86; lag++) {
      let scoreAtLag = 0, count = 0;
      for (let i = lag; i < frames; i++) { scoreAtLag += novelty[i] * novelty[i - lag]; count++; }
      scoreAtLag /= Math.max(1, count);
      if (scoreAtLag > bestScore) { runnerUp = bestScore; bestScore = scoreAtLag; bestLag = lag; }
      else if (scoreAtLag > runnerUp) runnerUp = scoreAtLag;
    }
    let detectedBpm = Math.round(6000 / bestLag);
    if (detectedBpm < 70) detectedBpm *= 2;
    if (detectedBpm > 180) detectedBpm = Math.round(detectedBpm / 2);
    detectedBpm = Math.max(70, Math.min(180, detectedBpm));
    const interval = 60 / detectedBpm;
    const lag = interval * 100;
    let phase = 0, phaseScore = -1;
    const scan = Math.min(lag, frames - 2);
    for (let p = 0; p < scan; p += 2) {
      let sum = 0;
      for (let i = p; i < frames; i += lag) {
        const idx = Math.round(i);
        if (idx < frames) sum += novelty[idx];
      }
      if (sum > phaseScore) { phaseScore = sum; phase = p / 100; }
    }
    // Snap the regular beat grid to nearby onset peaks while preserving a playable tempo.
    const beats = [];
    for (let t = phase; t < buffer.duration; t += interval) {
      let best = t, strength = -1;
      const center = Math.round(t * 100), radius = Math.round(interval * 100 * .18);
      for (let f = Math.max(0, center - radius); f <= Math.min(frames - 1, center + radius); f++) {
        if (novelty[f] > strength) { strength = novelty[f]; best = f / 100; }
      }
      beats.push(beats.length ? Math.max(beats[beats.length - 1] + interval * .72, best) : best);
    }
    const confidence = bestScore > 0 ? Math.max(0, Math.min(99, Math.round(42 + (bestScore / Math.max(.0000001, runnerUp) - 1) * 35))) : 0;
    return { bpm: detectedBpm, beats, confidence };
  }
  function makeRegularBeats(length, tempo, phase = 0) { const arr = []; for (let t = phase; t < length; t += 60 / tempo) arr.push(t); return arr; }

  $('demoBtn').addEventListener('click', () => {
    isDemo = true; duration = 60; bpm = 120; beatTimes = makeRegularBeats(duration, bpm, .15);
    track = { name: 'Midnight Drive', duration, decoded: createDemoBuffer() };
    $('trackName').textContent = track.name;
    $('trackMeta').innerHTML = `Demo original <span>·</span> ${bpm} BPM <span>·</span> 1:00`;
    setStatus('Ritmo detectado · 100% de confianza');
    show(setup);
  });

  function createDemoBuffer() {
    const context = audioContext || (audioContext = new (window.AudioContext || window.webkitAudioContext)());
    const sr = context.sampleRate, len = Math.floor(sr * duration), buffer = context.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      // A soft original synth groove, generated locally (no bundled music or network request).
      for (let i = 0; i < len; i++) {
        const t = i / sr, beat = t * 2, beatPhase = beat % 1;
        const kickPhase = (t * 2) % 1;
        const kick = Math.sin(2 * Math.PI * (48 + 80 * Math.exp(-kickPhase * 28)) * t) * Math.exp(-kickPhase * 10) * .28;
        const bass = Math.sin(2 * Math.PI * 55 * t) * (.09 + .08 * Math.max(0, Math.sin(2 * Math.PI * 2 * t))) * (1 - beatPhase * .4);
        const chordNotes = [220, 261.63, 329.63, 392];
        const melodic = chordNotes[Math.floor((t * 1.5) % chordNotes.length)];
        const synth = Math.sin(2 * Math.PI * melodic * t) * .045 * (0.5 + .5 * Math.sin(2 * Math.PI * .23 * t));
        const hatPulse = Math.max(0, 1 - ((t * 4) % 1) * 16);
        const hat = (Math.random() * 2 - 1) * hatPulse * .035;
        data[i] = (kick + bass + synth + hat) * Math.min(1, t * 3, (duration - t) * 2);
      }
    }
    return buffer;
  }

  document.querySelectorAll('.difficulty-card').forEach(button => button.addEventListener('click', () => {
    selectedDifficulty = button.dataset.difficulty;
    document.querySelectorAll('.difficulty-card').forEach(card => card.classList.toggle('selected', card === button));
  }));
  $('backBtn').addEventListener('click', () => { stopAudio(); show(home); });
  $('soundToggle').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    $('soundToggle').classList.toggle('active', soundEnabled);
    $('soundToggle').setAttribute('aria-label', soundEnabled ? 'Silenciar' : 'Activar sonido');
    if (!soundEnabled && audioElement) audioElement.muted = true;
    if (soundEnabled && audioElement) audioElement.muted = false;
  });

  $('startBtn').addEventListener('click', async () => {
    if (!track) { toast('Importa una canción o prueba la demo.'); return; }
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    try { await audioContext.resume(); } catch (_) {}
    startGame();
  });
  function startGame() {
    stopAudio();
    const settings = difficultySettings[selectedDifficulty];
    laneCount = settings.lanes;
    notes = buildNotes(settings); nextSpawn = 0; score = 0; combo = 0; bestCombo = 0; hits = 0; misses = 0; perfect = 0; noteSequence = 0; active = true; paused = false;
    $('score').textContent = formatScore(0); $('combo').textContent = '× 0'; $('accuracy').innerHTML = '100<span>%</span>'; $('perfectCount').textContent = '0'; $('missCount').textContent = '0'; $('accuracyFill').style.width = '100%'; $('progressFill').style.width = '0%'; $('playingTitle').textContent = track.name; $('playingDifficulty').textContent = settings.label; $('bpmDisplay').innerHTML = `${bpm} <span>BPM</span>`; $('remaining').textContent = `${formatTime(duration)} RESTANTES`;
    $('gameLanes').innerHTML = ''; $('gameTiles').innerHTML = ''; $('laneKeys').innerHTML = '';
    $('gameLanes').style.gridTemplateColumns = `repeat(${laneCount}, minmax(0, 1fr))`;
    $('laneKeys').style.gridTemplateColumns = `repeat(${laneCount}, minmax(0, 1fr))`;
    for (let i = 0; i < laneCount; i++) { const lane = document.createElement('div'); lane.className = 'game-lane'; $('gameLanes').appendChild(lane); const key = document.createElement('div'); key.className = 'lane-key'; key.textContent = ['A', 'S', 'D', 'F'][i]; $('laneKeys').appendChild(key); }
    show(game);
    startAt = performance.now() / 1000 + 3.2;
    $('countdown').classList.remove('hidden'); $('countdown').textContent = '3';
    launchAudio();
    animation = requestAnimationFrame(tick);
  }
  function buildNotes(settings) {
    const events = [];
    const interval = 60 / bpm;
    const maxLength = duration;
    const grid = beatTimes.length ? beatTimes : makeRegularBeats(duration, bpm, 0);
    grid.forEach((beat, idx) => {
      if (beat >= maxLength) return;
      events.push({ time: beat, accent: true });
      if (settings.subdivisions === 2) {
        // Expert puts a note on every offbeat; normal adds a syncopated note on alternate bars.
        if (selectedDifficulty === 'hard' || (selectedDifficulty === 'normal' && idx % 4 === 2)) {
          events.push({ time: beat + interval * .5, accent: false });
        }
      }
    });
    events.sort((a, b) => a.time - b.time);
    return events.map((note, i) => ({ ...note, lane: laneFor(i, settings.lanes), spawned: false, judged: false, el: null }));
  }
  function laneFor(index, count) { const pattern = [0, Math.min(1, count - 1), Math.min(2, count - 1), Math.min(1, count - 1), 0, Math.min(2, count - 1), Math.min(1, count - 1), Math.min(3, count - 1)]; let lane = pattern[(index + Math.floor(index / 5)) % pattern.length]; if (count === 4 && index % 8 === 7) lane = 3; return lane; }

  function launchAudio() {
    if (!soundEnabled) return;
    if (isDemo || track.decoded) {
      try {
        sourceNode = audioContext.createBufferSource(); sourceNode.buffer = track.decoded; sourceNode.connect(audioContext.destination); sourceNode.start(audioContext.currentTime + 3.2);
      } catch (e) { console.warn('Audio playback unavailable', e); }
    } else if (track.file) {
      audioElement = new Audio(URL.createObjectURL(track.file)); audioElement.volume = .8; audioElement.muted = !soundEnabled;
      audioElement.oncanplay = () => { audioElement.currentTime = 0; audioElement.play().catch(() => toast('Toca la pantalla para activar el audio.')); };
      audioElement.onerror = () => toast('No se pudo reproducir este archivo de audio.');
      audioElement.load();
    }
  }
  function stopAudio() { if (sourceNode) { try { sourceNode.stop(); } catch (_) {} sourceNode.disconnect(); sourceNode = null; } if (audioElement) { audioElement.pause(); audioElement.src = ''; audioElement = null; } }
  function gameTime(now) { return now - startAt; }

  function tick() {
    if (!active) return;
    const now = performance.now() / 1000;
    if (paused) { animation = requestAnimationFrame(tick); return; }
    const t = gameTime(now);
    if (t < 0) {
      $('countdown').classList.remove('hidden'); $('countdown').textContent = String(Math.max(1, Math.ceil(-t))); animation = requestAnimationFrame(tick); return;
    }
    $('countdown').classList.add('hidden');
    const settings = difficultySettings[selectedDifficulty];
    const field = $('playfield');
    const height = field.clientHeight;
    const hitY = height - 77;
    const travel = settings.speed;
    const speed = (hitY + 75) / travel;
    while (nextSpawn < notes.length && notes[nextSpawn].time <= t + travel + .25) {
      const n = notes[nextSpawn++]; if (n.time < t - .3) { n.judged = true; continue; }
      n.spawned = true;
      const tile = document.createElement('div'); tile.className = `game-tile color-${noteSequence++ % 4}`;
      tile.style.left = `calc(${(n.lane / laneCount) * 100}% + 4px)`; tile.style.width = `calc(${100 / laneCount}% - 8px)`;
      tile.dataset.noteIndex = String(nextSpawn - 1); $('gameTiles').appendChild(tile); n.el = tile;
    }
    notes.forEach(n => {
      if (n.judged || !n.spawned) return;
      const y = hitY - (n.time - t) * speed;
      n.el.style.transform = `translateY(${y}px)`;
      if (t > n.time + settings.window) missNote(n);
    });
    const currentBeat = (t * bpm / 60) % 1;
    document.querySelectorAll('.beat-indicator i').forEach((el, i) => el.classList.toggle('on', i === Math.floor((t * bpm / 60) % 4) && currentBeat < .16));
    const progress = Math.min(1, t / duration);
    $('progressFill').style.width = `${progress * 100}%`;
    $('remaining').textContent = `${formatTime(duration - t)} RESTANTES`;
    if (t >= duration) { finishGame(); return; }
    animation = requestAnimationFrame(tick);
  }
  function laneFromEvent(event) {
    const rect = $('playfield').getBoundingClientRect();
    const x = event.clientX - rect.left;
    return Math.max(0, Math.min(laneCount - 1, Math.floor(x / rect.width * laneCount)));
  }
  function hitLane(lane) {
    if (!active || paused || performance.now() / 1000 < startAt) return;
    const t = gameTime(performance.now() / 1000), settings = difficultySettings[selectedDifficulty];
    const candidates = notes.filter(n => n.spawned && !n.judged && n.lane === lane && Math.abs(t - n.time) <= settings.window).sort((a, b) => Math.abs(t - a.time) - Math.abs(t - b.time));
    const keys = [...$('laneKeys').children], laneEl = [...$('gameLanes').children][lane];
    keys[lane]?.classList.add('active'); laneEl?.classList.add('pressed');
    setTimeout(() => { keys[lane]?.classList.remove('active'); laneEl?.classList.remove('pressed'); }, 110);
    if (!candidates.length) { showJudgement('FUERA DE RITMO', false); return; }
    const n = candidates[0], timing = Math.abs(t - n.time), isPerfect = timing <= settings.window * .38;
    n.judged = true; n.el?.remove();
    score += isPerfect ? 100 : 60; combo++; hits++; if (isPerfect) perfect++; bestCombo = Math.max(bestCombo, combo);
    updateStats(); showJudgement(isPerfect ? 'PERFECT' : 'GOOD', true);
    const line = $('gameHitLine'); line.classList.add('hit-flash'); setTimeout(() => line.classList.remove('hit-flash'), 110);
  }
  function missNote(n) { n.judged = true; n.el?.remove(); misses++; combo = 0; updateStats(); showJudgement('MISS', false); }
  function updateStats() {
    const total = hits + misses, accuracy = total ? Math.round(hits / total * 100) : 100;
    $('score').textContent = formatScore(score); $('combo').textContent = `× ${combo}`; $('accuracy').innerHTML = `${accuracy}<span>%</span>`; $('accuracyFill').style.width = `${accuracy}%`; $('perfectCount').textContent = String(perfect); $('missCount').textContent = String(misses);
    $('mobileScore').textContent = `${formatScore(score)} PTS`; $('mobileCombo').textContent = `× ${combo} RACHA`; $('mobileAccuracy').textContent = `${accuracy}% PRECISIÓN`;
  }
  function showJudgement(text, good) {
    const el = $('judgement'); el.textContent = text; el.style.color = good ? (text === 'PERFECT' ? '#b6a0ff' : '#86e2b6') : '#ff8eaf'; el.style.opacity = '1';
    clearTimeout(lastJudgementTimer); lastJudgementTimer = setTimeout(() => { if (active && !paused) { el.textContent = 'TOCA AL COMPÁS'; el.style.color = '#c1b2e8'; } }, 500);
  }

  function registerPointer(event) {
    if (!game.classList.contains('hidden')) { event.preventDefault(); hitLane(laneFromEvent(event)); }
  }
  $('playfield').addEventListener('pointerdown', registerPointer);
  window.addEventListener('keydown', event => {
    if (!game.classList.contains('hidden')) {
      const map = { a: 0, s: 1, d: 2, f: 3, arrowleft: 0, arrowdown: 1, arrowup: 2, arrowright: 3 };
      const lane = map[event.key.toLowerCase()];
      if (lane !== undefined && lane < laneCount) { event.preventDefault(); hitLane(lane); }
      if (event.key === 'Escape' || event.key.toLowerCase() === 'p') togglePause();
    }
  });
  $('pauseBtn').addEventListener('click', togglePause);
  $('mobilePauseBtn').addEventListener('click', togglePause);
  function togglePause() {
    if (!active) return;
    paused = !paused;
    if (paused) {
      pauseAt = performance.now() / 1000;
      $('pauseBtn').innerHTML = '▶ &nbsp; SEGUIR';
      $('mobilePauseBtn').textContent = '▶';
      $('mobilePauseBtn').setAttribute('aria-label', 'Reanudar juego');
      $('judgement').textContent = 'PAUSA'; $('countdown').classList.remove('hidden'); $('countdown').textContent = 'Ⅱ';
      if (audioContext && audioContext.state === 'running') audioContext.suspend(); if (audioElement) audioElement.pause();
    } else {
      startAt += performance.now() / 1000 - pauseAt;
      $('pauseBtn').innerHTML = 'Ⅱ &nbsp; PAUSA';
      $('mobilePauseBtn').textContent = 'Ⅱ';
      $('mobilePauseBtn').setAttribute('aria-label', 'Pausar juego');
      $('countdown').classList.add('hidden');
      if (audioContext && soundEnabled) audioContext.resume(); if (audioElement && soundEnabled) audioElement.play().catch(() => {});
    }
  }
  $('quitBtn').addEventListener('click', () => { active = false; cancelAnimationFrame(animation); stopAudio(); show(setup); });
  function finishGame() {
    active = false; cancelAnimationFrame(animation); stopAudio();
    const accuracy = hits + misses ? Math.round(hits / (hits + misses) * 100) : 100;
    $('finalScore').textContent = formatScore(score); $('finalAccuracy').textContent = `${accuracy}%`; $('finalCombo').textContent = `× ${bestCombo}`; $('finalPerfect').textContent = String(perfect);
    $('resultSong').textContent = `${track.name} · ${difficultySettings[selectedDifficulty].label.toLowerCase()}`;
    $('resultHeadline').textContent = accuracy >= 90 ? '¡Ritmo perfecto!' : accuracy >= 65 ? '¡Buen ritmo!' : '¡Sigue practicando!';
    $('resultModal').classList.remove('hidden');
  }
  $('closeResult').addEventListener('click', () => { $('resultModal').classList.add('hidden'); show(setup); });
  $('homeBtn').addEventListener('click', () => { $('resultModal').classList.add('hidden'); stopAudio(); show(home); });
  $('playAgain').addEventListener('click', () => { $('resultModal').classList.add('hidden'); startGame(); });
})();
