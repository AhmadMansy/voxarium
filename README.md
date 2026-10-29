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

The first launch opens the model chooser. Installing Phonon 31M downloads its verified
Q8 weights and default voice into `%APPDATA%\Voxarium`; after that, no network connection
is required to generate speech. The build is unsigned, so Windows SmartScreen may ask for
confirmation before the installer runs.

Upgrading from Phonon Studio? Voxarium adopts the existing `%APPDATA%\Phonon Studio`
folder on first launch, so models, voices, settings and history carry over.

## Features

- **Studio** — write a script, pick a voice, tune temperature and seed, and generate
  speech with live streaming playback.
- **Model registry** - 15 curated TTS models with license, capability, hardware-fit
  and quality scores. Phonon 31M is installable today; every other model stays
  visible and explains its runtime or license gate instead of disappearing.
- **First-run model chooser** - the setup assistant lists every model, shows fit,
  license and runtime status, and installs the chosen engine with verified downloads.
  Missing runtime packs stay clearly marked instead of pretending to install.
- **103 voices** — 102 downloadable voices plus the built-in default, with search,
  accent/gender filters, favorites, previews, and one-click casting into the studio.
  Voices are grouped by model compatibility so unsupported files cannot be used.
- **History** — every take is saved with its model, license and capabilities, and can
  be replayed, renamed, favorited, reused, exported, opened, or shown in its folder.
- **Batch** — render up to 50 lines in one pass, casting a different voice per line with
  `[Voice Name]` prefixes, validate the queue against the active model, then export
  every result at once.
- **Export** — save any take as WAV or MP3, with a configurable filename template and
  default export folder.
- **Voice controls** — quantization (Q8/F32), device selection (Auto/CPU/WebGPU), thread
  count, language normalization, rewrite rules, speaking conditions, pronunciation
  overrides, and reproducible seeds. Unsupported controls are disabled with a reason.
- **Polished shell** — dark and light themes, four accent colors, a global player with
  speed and volume controls, persistent window state, and keyboard shortcuts for every
  page.
- **Privacy gates** — checked SHA-256 downloads, atomic per-model installs, restricted
  license acknowledgments, loopback-only sidecars, and explicit consent before cloud
  voice cloning.

All model files are pinned to specific Hugging Face revisions and verified by size and
SHA-256 before use. The local model server binds only to `127.0.0.1`.

See [`docs/model-support.md`](docs/model-support.md) for the shipped model matrix,
runtime limits, license/capability gates and test coverage.

## Development

```powershell
npm.cmd install
npm.cmd run dev        # Vite renderer + Electron
npm.cmd run typecheck  # TypeScript only
npm.cmd run build      # typecheck + production bundle
npm.cmd test           # model registry/fit/license/preference checks
npm.cmd run test:e2e   # Electron model lifecycle (requires a built app)
npm.cmd run pack       # build + NSIS installer
```

The renderer is React 19 + Vite. The Electron main process serves the model and voice
files from a tiny localhost HTTP server so the Rust/WASM worker can fetch them with range
support, then serves the app itself over the isolated `app://` protocol.

### Project layout

```
electron/        Electron main process, preload bridge, local model server
src/             React renderer
  pages/         Studio, Models, Voices, History, Batch, Settings
  components/    Player bar, setup wizard, shared UI
  lib/           Engine, ONNX/sidecar clients, audio encoding, catalog, utilities
  models/        Registry, fit, license, compatibility and preference logic
  styles/        Stylesheet partials
public/phonon/   Pinned Phonon runtime copied in by scripts/sync-phonon.mjs
public/ort/      Pinned ONNX Runtime Web assets copied in by scripts/sync-ort.mjs
scripts/         Build-time asset scripts and the unit/E2E test runners
```

### Local data

| Path | Contents |
| --- | --- |
| `%APPDATA%\Voxarium\models\<id>` | Verified model weights, tokenizer, config and default voice |
| `%APPDATA%\Voxarium\voices` | Downloaded voice embeddings |
| `%APPDATA%\Voxarium\voices\custom` | Imported or cloned custom voices |
| `%APPDATA%\Voxarium\audio` | Generated WAV recordings |
| `%APPDATA%\Voxarium\history.json` | Recording metadata |

Model and voice downloads can be cleared from Settings without touching your recordings.

## Credits

Phonon 31M by [Gradium](https://gradium.ai/phonon), Apache-2.0. Voice embeddings from
[gradium/phonon-voices](https://huggingface.co/gradium/phonon-voices).
