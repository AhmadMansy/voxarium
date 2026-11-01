# Privacy and network use

Voxarium runs on your computer. This page lists everything it can send over the network, when, and
why, so you can check the claims on the project page yourself.

## In short

- **No telemetry.** No analytics, crash reports, usage statistics, advertising or update checks, and no
  account. The app contains no such library (`package.json` and the source have none).
- **Nothing you write is uploaded.** Your scripts, voices, recordings and generated speech stay on this
  computer. The app has no cloud speech service and no cloud voice cloning.
- **Network is used only to download.** The first time you install a model or its runtime, Voxarium
  downloads files from public hosts. After that it works offline.

## What it connects to, and when

| When | Host | What for | What the host can see |
| --- | --- | --- | --- |
| Installing a model | `huggingface.co` | The model's files, pinned to an exact revision and checked against a SHA-256 hash | Your IP address, the file names, and your Hugging Face token if you added one for a gated model |
| Installing a Python-based model | `github.com` | The `uv` installer, a standalone Python build, and pinned source archives for some models | Your IP address and the file names |
| Installing a Python-based model | `pypi.org`, `files.pythonhosted.org` | Python packages for that model's environment | Your IP address and the package names |
| Installing a PyTorch-based model | `download.pytorch.org` | PyTorch wheels | Your IP address and the wheel names |
| A model's first start | The model's own hosts, usually Hugging Face | A few models fetch helper files once, then run offline. The app labels these | Your IP address and the file names |

Nothing is contacted when the app is simply open. Hugging Face's own telemetry is switched off for model
processes (`HF_HUB_DISABLE_TELEMETRY=1`), and `DO_NOT_TRACK=1` is set for them.

## What stays on your computer

| Path (Windows shown) | Contents |
| --- | --- |
| `%APPDATA%\Voxarium\models` | Model files |
| `%APPDATA%\Voxarium\runtimes` | Python and per-model environments |
| `%APPDATA%\Voxarium\voices` | Voice files and reference clips |
| `%APPDATA%\Voxarium\audio` and `history.json` | Generated speech and its settings |
| `%APPDATA%\Voxarium\settings.json` | Preferences |
| `%APPDATA%\Voxarium\huggingface-token.json` | Your Hugging Face token, encrypted with the system keychain when available |

You can clear models and voices from **Settings**, or delete the folder.

## The local API

The optional API, MCP server and command line listen on `127.0.0.1` only. Every request needs a token,
and requests that come from a browser or a foreign host are refused. Model processes also bind to
`127.0.0.1`, use a per-session token, and exit with the app.

## How this was checked

- **Code:** a search of the app source for telemetry, analytics, crash-reporting and auto-update code
  finds none, and the only hosts the app code contacts are the ones in the table above.
- **Runtime:** we launched the built app on Windows with an empty profile, left it idle for 45 seconds,
  and listed every non-local TCP connection of the app and its child processes. There were none.
  This covers Electron's Chromium as well as our own code. It does not cover UDP traffic or DNS lookups.

## What this does not cover

- **Models are third-party code.** Voxarium downloads model code and weights from the hosts above and
  pins them by hash, but it cannot audit what a model's Python libraries do. After a model's first
  start the app sets the offline flags (`HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE`), which makes most
  libraries unable to reach the network.
- **The operating system.** Your OS, antivirus or firewall may do its own checks on downloads.
- **Builds from other sources.** These statements describe the project's own source and releases.

Found something that contradicts this page? Please [open an issue](https://github.com/AhmadMansy/voxarium/issues/new/choose),
or report a security problem privately (see [`SECURITY.md`](../SECURITY.md)).
