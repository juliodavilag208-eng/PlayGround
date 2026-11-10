(() => {
  const $ = (s) => document.querySelector(s);
  const homeView = $('#homeView'), gameView = $('#gameView'), input = $('#audioInput');
  const canvas = $('#gameCanvas'), ctx = canvas.getContext('2d');
  const field = $('#playfield');
  const state = { audio: null, ctx: null, source: null, playing: false, paused: false, started: false, ended: false, countdown: false, startAt: 0, offset: 0, duration: 62, title: 'Neon Dreams', artist: 'PULSO ORIGINAL', bpm: 128, difficulty: 'easy', chart: [], hits: 0, misses: 0, score: 0, combo: 0, bestCombo: 0, lastFrame: 0, effects: [], toastTimer: 0, demo: true };
  const diffInfo = { easy: { label: 'SUAVE', subdiv: 1, color: '#d8ff70' }, normal: { label: 'RITMO', subdiv: 2, color: '#ff9b72' }, hard: { label: 'ÉPICO', subdiv: 2, color: '#a99aff' } };
  const laneColors = ['#d8ff70', '#a99aff', '#ff9a76', '#78e4d3'];
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function showToast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
  function formatTime(s) { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function seeded(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  function makeDemo() {
    const sr = 22050, duration = 62, buffer = new Float32Array(sr * duration);
    const bpm = 128, beat = 60 / bpm;
    for (let b = 0; b < duration / beat; b++) {
      const t = b * beat, bar = Math.floor(b / 4), step = b % 4;
      addTone(buffer, sr, t, [130.81, 146.83, 164.81, 174.61][bar % 4], .32, .16, 'sine');
      addTone(buffer, sr, t, step === 0 ? 55 : 82, step === 0 ? .55 : .18, step === 0 ? .23 : .13, 'kick');
      if (step === 1 || step === 3) addTone(buffer, sr, t, 190, .12, .07, 'snare');
      if (b % 2 === 0) {
        const notes = [[523.25,659.25,783.99],[587.33,698.46,880],[493.88,587.33,739.99],[440,554.37,659.25]][bar % 4];
        addTone(buffer, sr, t + .025, notes[(b / 2) % 3 | 0], .38, .19, 'sine');
      }
      if (step === 2) addTone(buffer, sr, t, 1450, .04, .035, 'hat');
    }
    const ac = getAudioContext();
    state.audio = ac.createBuffer(1, buffer.length, sr); state.audio.copyToChannel(buffer, 0); state.duration = duration;
    state.title = 'Neon Dreams'; state.artist = 'PULSO ORIGINAL'; state.bpm = bpm; state.demo = true;
    state.chart = buildChart(null); updateSongUI();
  }
  function addTone(data, sr, time, freq, length, volume, type) {
    const start = Math.floor(time * sr), end = Math.min(data.length, start + Math.floor(length * sr));
    for (let i = start; i < end; i++) {
      const t = (i - start) / sr, fade = Math.exp(-t * (type === 'kick' ? 13 : type === 'hat' ? 52 : 8));
      let wave;
      if (type === 'kick') { const f = freq * (1 + 1.8 * Math.exp(-t * 18)); wave = Math.sin(2 * Math.PI * f * t); }
      else if (type === 'snare' || type === 'hat') wave = (Math.random() * 2 - 1) * (type === 'snare' ? .7 : .36) + Math.sin(2 * Math.PI * freq * t) * .25;
      else wave = Math.sin(2 * Math.PI * freq * t) + .25 * Math.sin(4 * Math.PI * freq * t);
      data[i] += wave * fade * volume;
    }
  }
  function getAudioContext() { if (!state.ctx) state.ctx = new (window.AudioContext || window.webkitAudioContext)(); return state.ctx; }

  function buildChart(onsets) {
    const beat = 60 / state.bpm, events = [];
    let steps = [];
    if (!onsets) {
      const total = Math.floor(state.duration / beat);
      for (let i = 1; i < total; i++) {
        const base = i * beat, strong = i % 4 === 0 || i % 4 === 2;
        if (state.difficulty === 'easy') { if (i % 2 === 0 || i % 4 === 1) steps.push(base); }
        else if (state.difficulty === 'normal') { steps.push(base); if (strong && i % 2 === 0) steps.push(base + beat / 2); }
        else { steps.push(base); if (i % 2 === 0) steps.push(base + beat / 2); if (i % 4 === 3) steps.push(base + beat / 4); }
      }
    } else {
      const unit = beat / (state.difficulty === 'easy' ? 1 : 2);
      const energies = onsets.filter(o => o.time > .35 && o.time < state.duration - .2);
      if (!energies.length) return buildChart(null);
      const snapped = new Map();
      energies.forEach((o, ix) => {
        const time = Math.max(unit, Math.round(o.time / unit) * unit);
        const key = time.toFixed(3), old = snapped.get(key);
        if (!old || o.strength > old.strength) snapped.set(key, { time, strength: o.strength, ix });
      });
      let chosen = [...snapped.values()].sort((a,b) => a.time-b.time);
      if (state.difficulty === 'easy') chosen = chosen.filter(o => o.strength > .11);
      if (state.difficulty === 'normal') {
        for (let t = beat; t < state.duration; t += beat) if (!chosen.some(o => Math.abs(o.time-t) < .07)) chosen.push({time:t,strength:.08,ix:Math.round(t/beat)});
      }
      if (state.difficulty === 'hard') {
        for (let t = beat/2; t < state.duration; t += beat/2) if (!chosen.some(o => Math.abs(o.time-t) < .07) && seeded(Math.round(t*10)) > .42) chosen.push({time:t,strength:.08,ix:Math.round(t/beat*2)});
      }
      steps = chosen.sort((a,b)=>a.time-b.time).map(o=>o.time);
    }
    steps.forEach((time, i) => {
      let lane = (Math.floor(i * .71 + seeded(i + (state.difficulty === 'hard' ? 41 : 13)) * 3) + (i % 4)) % 4;
      if (events.length && events[events.length-1].lane === lane && i % 3 !== 0) lane = (lane + 1 + (i % 2)) % 4;
      events.push({ time, lane, hit: false, missed: false, id: i });
    });
    return events;
  }

  function analyzeAudio(audioBuffer) {
    const channelCount = audioBuffer.numberOfChannels, samples = audioBuffer.length, sr = audioBuffer.sampleRate;
    const hop = Math.max(256, Math.floor(sr * .02)), mono = new Float32Array(Math.ceil(samples / hop));
    let idx = 0;
    for (let start = 0; start < samples; start += hop) {
      let sum = 0, count = Math.min(hop, samples - start);
      for (let c = 0; c < channelCount; c++) { const channel = audioBuffer.getChannelData(c); for (let j = 0; j < count; j += 4) sum += channel[start + j] * channel[start + j]; }
      mono[idx++] = Math.sqrt(sum / (Math.ceil(count / 4) * channelCount));
    }
    const novelty = new Float32Array(mono.length); let mean = 0, variance = 0;
    for (let i = 4; i < mono.length; i++) {
      const base = (mono[i-1] + mono[i-2] + mono[i-3] + mono[i-4]) / 4;
      novelty[i] = Math.max(0, mono[i] - base); mean += novelty[i]; variance += novelty[i] * novelty[i];
    }
    mean /= Math.max(1, mono.length); const sd = Math.sqrt(Math.max(0, variance / Math.max(1, mono.length) - mean * mean));
    const candidates = [];
    for (let i=5; i<novelty.length-2; i++) if (novelty[i] > mean + sd * .72 && novelty[i] >= novelty[i-1] && novelty[i] >= novelty[i+1]) candidates.push({time:i*hop/sr, strength:novelty[i]});
    let peaks = [];
    candidates.sort((a,b)=>b.strength-a.strength).forEach(p => { if (!peaks.some(q=>Math.abs(p.time-q.time)<.105)) peaks.push(p); });
    peaks.sort((a,b)=>a.time-b.time);
    let bestLag=0,best=-1; const minLag=Math.floor(60/180*sr/hop),maxLag=Math.ceil(60/70*sr/hop);
    for(let lag=minLag;lag<=maxLag;lag++) { let corr=0; for(let i=0;i<novelty.length-lag;i+=2)corr+=novelty[i]*novelty[i+lag]; if(corr>best){best=corr;bestLag=lag;} }
    let bpm=bestLag?60/(bestLag*hop/sr):120; while(bpm<85)bpm*=2; while(bpm>170)bpm/=2;
    return { onsets: peaks, bpm: Math.round(bpm) };
  }

  function updateSongUI() {
    $('#playingTitle').textContent=state.title; $('#gameSongTitle').innerHTML=state.title.replace(/\s+/g,'<br>'); $('#gameSongArtist').textContent=state.artist.toUpperCase(); $('#bpmValue').textContent=state.bpm;
    $('#timeLabel').innerHTML=`0:00 <i>/</i> ${formatTime(state.duration)}`;
  }
  function enterGame() { stopAudio(); homeView.classList.add('hidden'); gameView.classList.remove('hidden'); updateSongUI(); resetRound(); resizeCanvas(); window.scrollTo(0,0); }
  function exitGame() { stopAudio(); gameView.classList.add('hidden'); homeView.classList.remove('hidden'); }
  function resetRound() {
    stopAudio(); state.started=false;state.paused=false;state.ended=false;state.countdown=false;state.hits=0;state.misses=0;state.score=0;state.combo=0;state.bestCombo=0;state.offset=0;state.effects=[];
    state.chart=buildChart(state.demo ? null : state.onsets); $('#tapHint').classList.remove('hidden'); $('#pauseOverlay').classList.add('hidden'); $('#resultOverlay').classList.add('hidden'); $('#countdown').classList.add('hidden'); $('#pauseButton').textContent='Ⅱ'; updateStats(); $('#progressFill').style.width='0%'; $('#timeLabel').innerHTML=`0:00 <i>/</i> ${formatTime(state.duration)}`; state.chart.forEach(n=>{n.hit=false;n.missed=false});
    document.querySelectorAll('.difficulty').forEach(b=>b.classList.toggle('active',b.dataset.difficulty===state.difficulty)); $('#fieldDifficulty').textContent=diffInfo[state.difficulty].label;
    drawIdle();
  }
  function startCountdown() {
    if(state.started||state.countdown)return; const audio=getAudioContext(); audio.resume(); state.countdown=true; $('#tapHint').classList.add('hidden'); const el=$('#countdown'); el.classList.remove('hidden'); let n=3;el.textContent=n;
    const timer=setInterval(()=>{n--;if(n>0)el.textContent=n;else{clearInterval(timer);el.textContent='GO!';setTimeout(()=>{el.classList.add('hidden');state.countdown=false;startSong();},350)}},650);
  }
  function startSong(offset=0) {
    const ac=getAudioContext(); if(!state.audio){showToast('No se pudo cargar el audio.');return}
    state.source=ac.createBufferSource();state.source.buffer=state.audio;state.source.connect(ac.destination);state.source.start(0,offset);state.offset=offset;state.startAt=ac.currentTime;state.playing=true;state.paused=false;state.started=true;state.ended=false;$('#pauseButton').textContent='Ⅱ'; $('#tapHint').classList.add('hidden');
    state.source.onended=()=>{if(state.playing&&!state.paused&&currentTime()>=state.duration-.1)finishRound()};
  }
  function currentTime(){return state.playing?state.offset+(getAudioContext().currentTime-state.startAt):state.offset}
  function stopAudio(){if(state.source){try{state.source.onended=null;state.source.stop()}catch(_){}state.source.disconnect();state.source=null}state.playing=false}
  function togglePause(){if(!state.started&&!state.countdown){startCountdown();return}if(state.ended)return;if(state.countdown){state.countdown=false;$('#countdown').classList.add('hidden')}
    if(state.paused){startSong(state.offset);$('#pauseOverlay').classList.add('hidden')}else{state.offset=currentTime();stopAudio();state.paused=true;$('#pauseOverlay').classList.remove('hidden');$('#pauseButton').textContent='▶'} }
  function hitLane(lane){ if(!state.started){startCountdown();return} if(state.paused||state.ended)return;const now=currentTime(), hitWindow=state.difficulty==='easy'?.22:state.difficulty==='normal'?.18:.145;
    const targets=state.chart.filter(n=>!n.hit&&!n.missed&&n.lane===lane&&Math.abs(n.time-now)<=hitWindow).sort((a,b)=>Math.abs(a.time-now)-Math.abs(b.time-now));
    if(targets.length){const note=targets[0],delta=Math.abs(note.time-now),grade=delta<.065?'PERFECT':delta<hitWindow*.68?'GREAT':'GOOD';note.hit=true;state.hits++;state.combo++;state.bestCombo=Math.max(state.bestCombo,state.combo);state.score+=grade==='PERFECT'?1000:grade==='GREAT'?700:450;state.effects.push({lane,grade,until:now+.48,color:laneColors[lane]});updateStats();}
    else{state.misses++;state.combo=0;state.effects.push({lane,grade:'MISS',until:now+.4,color:'#ff796d'});updateStats()}
  }
  function updateStats(){ $('#score').textContent=String(state.score).padStart(6,'0');$('#combo').textContent=state.combo;const total=state.hits+state.misses;$('#accuracy').textContent=total?`${Math.round(state.hits/total*100)}%`:'—%'; }
  function finishRound(){if(state.ended)return;state.ended=true;state.playing=false;state.paused=false;state.offset=state.duration;$('#pauseOverlay').classList.add('hidden');$('#resultOverlay').classList.remove('hidden');$('#resultScore').textContent=String(state.score).padStart(6,'0');const acc=state.hits+state.misses?Math.round(state.hits/(state.hits+state.misses)*100):0;$('#resultMessage').textContent=acc>92?'¡Ritmo impecable!':acc>70?'¡Buen ritmo! Sigue así.':'¡Buen intento! Una más.';$('#progressFill').style.width='100%';$('#timeLabel').innerHTML=`${formatTime(state.duration)} <i>/</i> ${formatTime(state.duration)}`;stopAudio()}

  function resizeCanvas(){const r=field.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.floor(r.width*dpr);canvas.height=Math.floor(r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}
  function drawIdle(){const w=field.clientWidth,h=field.clientHeight;if(!w||!h)return;ctx.clearRect(0,0,w,h);for(let i=0;i<4;i++){const x=i*w/4;ctx.fillStyle=i%2?'#ffffff04':'#ffffff08';ctx.fillRect(x,0,w/4,h);ctx.fillStyle='#ffffff0b';ctx.fillRect(x+w/4-1,0,1,h)} }
  function render(){requestAnimationFrame(render);if(gameView.classList.contains('hidden'))return;const w=field.clientWidth,h=field.clientHeight;if(!w||!h)return;const t=state.started&&!state.paused?currentTime():state.offset;
    ctx.clearRect(0,0,w,h);const laneW=w/4,hitY=h-50,approach=1.65;
    for(let lane=0;lane<4;lane++){ctx.fillStyle=lane%2?'#ffffff04':'#ffffff08';ctx.fillRect(lane*laneW,0,laneW,h);if(lane>0){ctx.fillStyle='#ffffff0b';ctx.fillRect(lane*laneW-1,0,1,h)}}
    const beat=60/state.bpm,first=Math.floor((t-approach)/beat);for(let b=first;b<(t+2)/beat;b++){const y=hitY-(b*beat-t)/approach*(hitY+20);if(y>0&&y<h){ctx.strokeStyle=b%4===0?'#ffffff13':'#ffffff08';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}}
    if(state.started&&!state.paused){for(const n of state.chart){if(n.hit||n.missed)continue;if(n.time<t-.24){n.missed=true;state.misses++;state.combo=0;updateStats();state.effects.push({lane:n.lane,grade:'MISS',until:t+.35,color:'#ff796d'})}}}
    state.chart.forEach(n=>{if(n.hit||n.missed)return;const dt=n.time-t;if(dt>approach||dt<-.25)return;const y=hitY-dt/approach*(hitY+28),x=n.lane*laneW+laneW*.14,ww=laneW*.72,hh=13,c=laneColors[n.lane];ctx.shadowColor=c;ctx.shadowBlur=15;ctx.fillStyle=c;roundRect(ctx,x,y-hh/2,ww,hh,hh/2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#ffffffad';roundRect(ctx,x+ww*.12,y-hh/2+3,ww*.45,2,2);ctx.fill()});
    state.effects=state.effects.filter(e=>e.until>t);state.effects.forEach(e=>{const alpha=Math.min(1,(e.until-t)*3);ctx.globalAlpha=alpha;ctx.fillStyle=e.color;ctx.shadowColor=e.color;ctx.shadowBlur=18;ctx.font='700 11px DM Sans';ctx.textAlign='center';ctx.fillText(e.grade,(e.lane+.5)*laneW,hitY-14);ctx.beginPath();ctx.arc((e.lane+.5)*laneW,hitY,12+(1-alpha)*17,0,Math.PI*2);ctx.strokeStyle=e.color;ctx.lineWidth=2;ctx.stroke();ctx.shadowBlur=0;ctx.globalAlpha=1});
    if(state.started&&!state.paused&&!state.ended){const p=clamp(t/state.duration,0,1);$('#progressFill').style.width=`${p*100}%`;$('#timeLabel').innerHTML=`${formatTime(t)} <i>/</i> ${formatTime(state.duration)}`;if(t>=state.duration)finishRound()}
  }
  function roundRect(c,x,y,w,h,r){c.beginPath();c.roundRect(x,y,w,h,r)}

  async function importTrack(file){
    if(!file)return;
    if(!file.type.startsWith('audio/')&&!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)){showToast('Elige un archivo de audio compatible.');return}
    showToast('Analizando el ritmo de tu canción…');
    try{
      const ac=getAudioContext();await ac.resume();const data=await file.arrayBuffer();const decoded=await ac.decodeAudioData(data);
      if(decoded.duration>600){showToast('La canción es demasiado larga (máximo 10 minutos).');return}
      state.audio=decoded;state.duration=decoded.duration;state.title=file.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').slice(0,42)||'Mi canción';state.artist='TU BIBLIOTECA';state.demo=false;
      const result=analyzeAudio(decoded);state.onsets=result.onsets;state.bpm=result.bpm;state.chart=buildChart(state.onsets);updateSongUI();enterGame();showToast(`¡Listo! Detectamos aproximadamente ${state.bpm} BPM.`);
    }catch(err){console.error(err);showToast('No pudimos leer este audio. Prueba con MP3 o WAV.');}
  }
  function pickFile(){input.click()}
  $('#playDemo').addEventListener('click',enterGame);$('#demoCard').addEventListener('click',enterGame);$('#uploadButton').addEventListener('click',pickFile);$('#browseUpload').addEventListener('click',pickFile);$('#emptyUpload').addEventListener('click',pickFile);input.addEventListener('change',e=>{importTrack(e.target.files[0]);e.target.value=''});
  $('#backHome').addEventListener('click',exitGame);$('#pauseButton').addEventListener('click',togglePause);$('#resumeButton').addEventListener('click',togglePause);$('#againButton').addEventListener('click',resetRound);$('#tipDifficulty').addEventListener('click',()=>showToast('Suave: beat principal · Ritmo: más notas · Épico: subdivisiones y más velocidad.'));
  document.querySelectorAll('.difficulty').forEach(button=>button.addEventListener('click',()=>{
    if(state.started&&!state.ended){showToast('Termina o reinicia la partida para cambiar el nivel.');return}
    state.difficulty=button.dataset.difficulty;$('#fieldDifficulty').textContent=diffInfo[state.difficulty].label;state.chart=buildChart(state.demo?null:state.onsets);document.querySelectorAll('.difficulty').forEach(b=>b.classList.toggle('active',b===button));
  }));
  field.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;e.preventDefault();const rect=field.getBoundingClientRect();hitLane(clamp(Math.floor((e.clientX-rect.left)/rect.width*4),0,3));});
  window.addEventListener('keydown',e=>{if(e.repeat||gameView.classList.contains('hidden'))return;const lanes={d:0,f:1,j:2,k:3,' ':null};const key=e.key.toLowerCase();if(Object.prototype.hasOwnProperty.call(lanes,key)){e.preventDefault();if(key===' ')togglePause();else hitLane(lanes[key])}if(key==='escape')exitGame()});
  window.addEventListener('resize',resizeCanvas);document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.playing)togglePause()});
  makeDemo();requestAnimationFrame(render);
})();
