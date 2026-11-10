# Pulse Tiles

A dependency-free, four-lane rhythm game that runs entirely in the browser. Pick one of four built-in tracks or import your own audio, choose a difficulty, and tap or hold the tiles as they cross the judgement line.

## Play

No build step or package install is required. Serve the repository root with any static server:

```bash
python3 -m http.server 3002
```

Then open `http://localhost:3002`.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Lane 1 | `D` | Tap the left lane near the line |
| Lane 2 | `F` | Tap the second lane near the line |
| Lane 3 | `J` | Tap the third lane near the line |
| Lane 4 | `K` | Tap the right lane near the line |
| Pause / resume | `Esc` | Pause button |
| Hold notes | Keep the key pressed | Keep the finger on the lane |

## Features

- **Tap and hold notes.** Holds must stay pressed until the body finishes crossing the line.
- **Adaptive fall speed.** Travel time scales with each track's BPM, so slower songs stay readable and faster songs stay reaction-heavy.
- **Automatic charting.** Built-in tracks are composed procedurally; imported audio is analyzed locally with Web Audio/FFT onset detection and autocorrelation tempo estimation.
- **Local-only imports.** Audio is decoded and charted in the browser. The file is never uploaded, and imported tracks live for the current session.
- **Persistent best scores.** Best score and accuracy per track/difficulty are stored in `localStorage`.
- **Desktop and mobile.** Tap directly around the judgement line on touch screens, with a safe-area-aware layout, responsive HUD, pause, retry, and results screens.

## Difficulties

| Difficulty | Note size | Fall time* | Max simultaneous | Density |
| --- | --- | --- | --- | --- |
| Normal | Large | 2.46 s | 1 note | Relaxed |
| Hard | Medium | 1.91 s | 2 notes | Syncopated |
| Extreme | Small | 1.43 s | 3 notes | Constant chords |
| Demon | Tiny | 1.06 s | 4 notes | Maximum pressure |

\*For the 112 BPM built-in track. Charts also adapt to each song's tempo.

## Project Structure

- `index.html` — app shell, menu, game screen, overlays.
- `css/style.css` — layout, theme, responsive and safe-area rules.
- `js/data.js` — difficulties, built-in track metadata, helpers.
- `js/composition.js` — procedural composition and fallback synthesis.
- `js/chart.js` — chart generation for taps, holds, chords, and travel time.
- `js/audio-engine.js` — AudioContext, decoding, onset/tempo analysis, hit SFX.
- `js/game.js` — canvas renderer, loop, input, scoring, pause, results.
- `js/app.js` — UI state, track/difficulty selection, import flow, best scores.
- `assets/audio/` — pre-rendered built-in tracks.
- `assets/fonts/` — local Sora and Space Mono subsets, with their OFL licenses.

## Assumptions

- Modern browser with Web Audio, ES modules, and Canvas 2D support.
- Imported tracks are intentionally session-only (no persistent IndexedDB storage).
- Charts are generated deterministically from each track's seed or detected events, so replaying the same track and difficulty produces the same chart.

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Created using [OMGithub.com](https://go.ondev.store/).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://go.ondev.store/juliodavilag208-eng/PlayGround)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/juliodavilag208-eng/PlayGround)

- 🎮 [Open the project](https://go.ondev.store/juliodavilag208-eng/PlayGround).
- ✨ [Remix this project](https://go.ondev.store/juliodavilag208-eng/PlayGround?remix=1).
- 💻 [Explore the source](https://github.com/juliodavilag208-eng/PlayGround).
- 🛠️ [Check build runs](https://github.com/juliodavilag208-eng/PlayGround/actions).
- 🐛 [Report an issue](https://github.com/juliodavilag208-eng/PlayGround/issues).
- 👤 [Explore the creator's projects](https://go.ondev.store/juliodavilag208-eng).
- 🌍 [Create with OMGithub](https://go.ondev.store/).
<!-- omgithub:readme:end -->
