# Voxarium

A private, on-device text-to-speech studio for Windows, built with Electron and the
[Phonon 31M](https://huggingface.co/gradium/phonon-31m-en) model. Everything — speech
generation, voice files, history, and exports — runs locally on your machine.

## Install

Run the installer:

```
release\Voxarium Setup 1.0.0.exe
```

Or launch the portable build directly:

```
release\win-unpacked\Voxarium.exe
```

The first launch downloads the Phonon 31M weights (Q8 by default) and the default voice
into `%APPDATA%\Voxarium`. After that, no network connection is required to generate
speech.

Upgrading from Phonon Studio? Voxarium adopts the existing `%APPDATA%\Phonon Studio`
folder on first launch, so models, voices, settings and history carry over.

## Features

- **Studio** — write a script, pick a voice, tune temperature and seed, and generate
  speech with live streaming playback.
- **103 voices** — 102 downloadable voices plus the built-in default, with search,
  accent/gender filters, favorites, previews, and one-click casting into the studio.
- **History** — every take is saved and can be replayed, renamed, favorited, reused,
  exported, opened, or shown in its folder.
- **Batch** — render up to 50 lines in one pass, casting a different voice per line with
  `[Voice Name]` prefixes, then export every result at once.
- **Export** — save any take as WAV or MP3, with a configurable filename template and
  default export folder.
- **Voice controls** — quantization (Q8/F32), device selection (Auto/CPU/WebGPU), thread
  count, language normalization, rewrite rules, speaking conditions, pronunciation
  overrides, and reproducible seeds.
- **Polished shell** — dark and light themes, four accent colors, a global player with
  speed and volume controls, persistent window state, and keyboard shortcuts for every
  page.

All model files are pinned to specific Hugging Face revisions and verified by size before
use. The local model server binds only to `127.0.0.1`.

## Development

```powershell
npm.cmd install
npm.cmd run dev        # Vite renderer + Electron
npm.cmd run typecheck  # TypeScript only
npm.cmd run build      # typecheck + production bundle
npm.cmd run pack       # build + NSIS installer
```

The renderer is React 19 + Vite. The Electron main process serves the model and voice
files from a tiny localhost HTTP server so the Rust/WASM worker can fetch them with range
support, then serves the app itself over the isolated `app://` protocol.

### Project layout

```
electron/        Electron main process, preload bridge, local model server
src/             React renderer
  pages/         Studio, Voices, History, Batch, Settings
  components/    Player bar, setup wizard, shared UI
  lib/           Engine, audio encoding, catalog, utilities
  styles/        Stylesheet partials
public/phonon/   Pinned Phonon runtime copied in by scripts/sync-phonon.mjs
scripts/         Build-time asset scripts
```

### Local data

| Path | Contents |
| --- | --- |
| `%APPDATA%\Voxarium\models` | Model weights, tokenizer, config, default voice |
| `%APPDATA%\Voxarium\voices` | Downloaded voice embeddings |
| `%APPDATA%\Voxarium\audio` | Generated WAV recordings |
| `%APPDATA%\Voxarium\history.json` | Recording metadata |

Model and voice downloads can be cleared from Settings without touching your recordings.

## Credits

Phonon 31M by [Gradium](https://gradium.ai/phonon), Apache-2.0. Voice embeddings from
[gradium/phonon-voices](https://huggingface.co/gradium/phonon-voices).
