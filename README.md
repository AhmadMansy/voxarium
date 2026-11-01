<div align="center">

<img src="public/icon.png" alt="Voxarium" width="96" height="96" />

# Voxarium

**A private, on-device text-to-speech studio for Windows.**

Write a script, cast a voice and render natural speech, all on your own machine.
No cloud service, no account and no upload.

![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%C2%B7%20Linux%20%C2%B7%20macOS-555)
![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![Models](https://img.shields.io/badge/TTS%20models-15-8B5CF6)
![Voices](https://img.shields.io/badge/voices-103-8B5CF6)

[Features](#features) · [Screenshots](#screenshots) · [Install](#install) ·
[Integrations](#use-it-from-other-apps) · [Development](#development)

<br />

<img src="docs/screenshots/studio.png" alt="The Voxarium Studio, with a script, the Phonon 31M voice model, voice and delivery controls" width="900" />

</div>

## Why Voxarium

- **Local by default.** Speech generation, voice files, history and exports never leave
  your computer. After the one-time model download, Voxarium works fully offline.
- **Many engines, one app.** Choose from 15 curated TTS models. Each one shows its
  license, capabilities and how well it fits your hardware before you download anything.
- **Built for real work.** Use batch scripts with per-line voices, reproducible seeds,
  pronunciation rules, WAV/MP3 export, and an OpenAI-compatible API for your other tools.

## Features

| | |
| --- | --- |
| 🎙️ **Studio** | Write a script, pick a voice, tune temperature and seed, and hear the speech as it streams in. |
| 🧩 **Model registry** | 15 curated TTS models with license, capability, hardware-fit and quality scores. Phonon runs inside the app. The others run in a local Python sidecar whose environment (uv, CPython, CUDA or CPU PyTorch) is built on your computer from a pinned recipe. |
| 🧭 **First-run chooser** | The setup assistant lists every model with its fit, license and runtime status, then installs the one you pick with verified downloads. Gated models (Phonon 40M, OpenAudio) need a Hugging Face token in Settings. |
| 🗣️ **103 voices** | Search, filter by accent and gender, star favorites, preview and cast with one click. Voices are grouped by model compatibility, so you can't select one the active model doesn't support. |
| 📚 **History** | Every take is saved with its model, license and generation stats. You can replay, rename, favorite, reuse, export or reveal any take in its folder. |
| 📜 **Batch** | Render up to 50 lines in one pass. Cast a voice per line with a `[Voice Name]` prefix, check the queue against the active model, then export every result at once. |
| 🎛️ **Voice controls** | Q8/F32 precision, Auto/CPU/WebGPU device, thread count, language normalization, rewrite rules, speaking conditions, pronunciation overrides and reproducible seeds. Controls a model doesn't support are disabled, with the reason shown. |
| 💾 **Export** | WAV or MP3, with a configurable filename template and default export folder. |
| 🔌 **API, MCP and CLI** | An OpenAI-compatible API on `127.0.0.1`, an MCP server for AI agents, and a command line, all using the same engine as the Studio. Optional tray mode keeps it running in the background. |
| 🎨 **Polished shell** | Dark and light themes, four accent colors, a global player with speed and volume controls, remembered window state, and a keyboard shortcut for every page (<kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>7</kbd>). |
| 🔒 **Privacy gates** | SHA-256-verified downloads, atomic per-model installs, acknowledgments for restricted licenses, loopback-only sidecars, and explicit consent before cloud voice cloning. |

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/models.png" alt="Models page with runtime packs and install status" /><br /><sub><b>Models</b>: install and switch engines; every runtime is verified before use.</sub></td>
    <td width="50%"><img src="docs/screenshots/voices.png" alt="Voice library grid with previews and filters" /><br /><sub><b>Voices</b>: audition, filter, favorite and cast the 103-voice library.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/history.png" alt="History page with takes, waveform and generation details" /><br /><sub><b>History</b>: every take, with its settings and generation stats.</sub></td>
    <td><img src="docs/screenshots/batch.png" alt="Batch page with a multi-voice script and queue" /><br /><sub><b>Batch</b>: cast a voice per line and render a whole script.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/integrations.png" alt="Integrations page with API connection and client setup" /><br /><sub><b>Integrations</b>: an OpenAI-compatible API, MCP and CLI on localhost.</sub></td>
    <td><img src="docs/screenshots/settings.png" alt="Settings page with appearance and engine options" /><br /><sub><b>Settings</b>: themes, accents, precision, device and storage.</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="docs/screenshots/studio-light.png" alt="The Studio in the light theme" width="75%" /><br /><sub>The Studio in the <b>Daylight</b> theme.</sub></td>
  </tr>
</table>

## Install

**Requirements:** Windows 10/11 (x64), Linux (x64) or macOS. A GPU is optional. Phonon 31M
runs on the CPU or through WebGPU, and the sidecar models use CUDA when it's available.

### Platform support

Installers for all three systems are built by GitHub Actions on every release. How much works on
each system today:

| | Windows | Linux | macOS |
| --- | --- | --- | --- |
| App, Studio, History, Batch, API, CLI | ✅ | 🧪 builds, not yet tested by CI | 🧪 builds, not yet tested by CI |
| Phonon models (in-app, no Python) | ✅ | 🧪 | 🧪 |
| Python models (Kokoro, Supertonic, …) | ✅ Kokoro and Supertonic proven end to end; the other 11 have recipes but are not run end to end (shown as *Experimental*) | 🧪 *Experimental*: the runtime packs exist but have not been run yet | 🧪 *Experimental* on Apple Silicon (CPU); Intel Macs only get models that don't need PyTorch |

✅ verified · 🧪 expected to work, being verified. Each model card shows its tier for your system (*Builds*, *Experimental* or *Unsupported*). Progress is tracked in
[`docs/milestone-1-plan.md`](docs/milestone-1-plan.md).

### Download

Get the latest installer from [GitHub Releases](https://github.com/AhmadMansy/voxarium/releases)
(Windows `.exe`, Linux `.AppImage` / `.deb`, macOS `.dmg`) and verify it against `SHA256SUMS.txt`.
Builds may be unsigned: Windows SmartScreen or macOS Gatekeeper can ask you to confirm before the
first launch.

### Build from source

You need Node.js 22 or newer.

```bash
git clone https://github.com/AhmadMansy/voxarium.git
cd voxarium
npm install
npm run icon
npm run pack         # installer for your current OS, written to release/
```

Use `pack:win`, `pack:linux` or `pack:mac` to target a system explicitly (each must run on that
system). On Windows PowerShell use `npm.cmd` if script execution is restricted.

**First launch.** The model chooser opens. Installing Phonon 31M downloads its verified
Q8 weights and default voice into `%APPDATA%\Voxarium`. After that, generating speech
doesn't need a network connection.

> **Upgrading from Phonon Studio?** On first launch, Voxarium adopts the existing
> `%APPDATA%\Phonon Studio` folder, so your models, voices, settings and history carry over.

## Use it from other apps

Turn on the local API on the **Integrations** page. Then any OpenAI-compatible client
can generate speech with the same engine and active model as the Studio:

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:7849/v1", api_key="<token>")
client.audio.speech.create(
    model="phonon-31m-en",
    voice="",  # empty: the current voice
    input="Hello from Voxarium",
).write_to_file("hello.mp3")
```

The Integrations page also has copy-ready setup for **Claude Code**, **Claude Desktop**,
**Cursor**, **curl** and the **command line**. The API listens on `127.0.0.1` only, and
every request needs the token. See [`docs/integrations.md`](docs/integrations.md) for the
full reference.

## Models and trust

All model files are pinned to specific Hugging Face revisions. Before use, each file is
checked against its expected size and SHA-256 hash. The local model server binds only to
`127.0.0.1`. See [`docs/model-support.md`](docs/model-support.md) for the shipped model
matrix, runtime limits, license and capability gates, and test coverage.

### Local data

| Path | Contents |
| --- | --- |
| `%APPDATA%\Voxarium\models\<id>` | Verified model weights, tokenizer, config and default voice |
| `%APPDATA%\Voxarium\voices` | Downloaded voice embeddings |
| `%APPDATA%\Voxarium\voices\custom` | Imported or cloned custom voices |
| `%APPDATA%\Voxarium\audio` | Generated WAV recordings |
| `%APPDATA%\Voxarium\history.json` | Recording metadata |

You can clear model and voice downloads from Settings without touching your recordings.

## Development

```powershell
npm install
npm run dev        # Vite renderer + Electron
npm run typecheck  # TypeScript only
npm run build      # typecheck + production bundle
npm test           # model registry/fit/license/preference checks
npm run test:e2e   # Electron model lifecycle (requires a built app)
npm run pack       # build + installer for the current OS
```

The renderer is React 19 + Vite. The Electron main process serves the model and voice
files from a small localhost HTTP server, so the Rust/WASM worker can fetch them with
range requests. The app itself is served over the isolated `app://` protocol.

### Project layout

```
electron/        Electron main process, preload bridge, local model server
src/             React renderer
  pages/         Studio, Models, Voices, History, Batch, Integrations, Settings
  components/    Player bar, setup wizard, shared UI
  lib/           Engine, ONNX/sidecar clients, audio encoding, catalog, utilities
  models/        Registry, fit, license, compatibility and preference logic
  styles/        Stylesheet partials
public/phonon/   Pinned Phonon runtime copied in by scripts/sync-phonon.mjs
public/ort/      Pinned ONNX Runtime Web assets copied in by scripts/sync-ort.mjs
scripts/         Build-time asset scripts and the unit/E2E test runners
docs/            Integration guide, model support matrix, screenshots
```

## Credits

Phonon 31M by [Gradium](https://gradium.ai/phonon), Apache-2.0. Voice embeddings from
[gradium/phonon-voices](https://huggingface.co/gradium/phonon-voices). Each additional
model keeps its own license, which Voxarium shows before install.

## License and contributing

Voxarium is free software under the **GNU Affero General Public License v3.0 or later**
(see [`LICENSE`](LICENSE)). The app stays open source. Third-party components are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The AGPL applies to Voxarium's own code. **Each model keeps its own license**, shown in the app
before you install it: some are permissive, some are non-commercial, and you accept each one
yourself. Voxarium never redistributes model weights; they are downloaded from their original
hosts.

Contributions are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first: you will be asked to
sign a [CLA](CLA.md) once, which keeps the project open source and lets the maintainer license it
in additional ways later. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report
security problems privately (see [`SECURITY.md`](SECURITY.md)).
