# Using Voxarium from other apps and agents

Voxarium can serve speech to other programs on the same computer: any app that
speaks the OpenAI speech API, scripts through the CLI, and AI agents through MCP.
Turn it on in **Settings › Local API & integrations**.

Everything goes through **one engine**. API, CLI and MCP requests run on the same
engine as the Studio: the same active model, voices, settings and History. If a
request names another model, Voxarium switches to it, just as if you had clicked
Activate. Requests are queued and run one at a time.

## Running in the background

- **Keep running in the tray**: closing the window hides Voxarium to the tray.
  The model stays loaded, so API requests answer immediately.
- **Start with Windows**: starts hidden in the tray when you sign in.
- **On demand**: if Voxarium is not running, the CLI and MCP server start it
  hidden (`--hidden`) and wait for it. The local API must be enabled.

## Security

- Listens on `127.0.0.1` only (configurable port, default `7849`).
- Every request needs `Authorization: Bearer <token>`. The token is shown in
  Settings and can be regenerated.
- Requests that carry an `Origin` header (browsers) or a foreign `Host` header
  (DNS rebinding) are refused, so websites cannot use it.
- Voices made from your reference clips are off for API clients unless you
  enable **Allow API clients to use your reference voices**.
- License acknowledgments still apply: a restricted model cannot be selected
  through the API until it has been acknowledged in the app. Responses report
  the model's license (`x-voxarium-license`, or `license`/`commercial` in JSON).

## Discovery

While running, Voxarium writes `%APPDATA%\Voxarium\api.json`:

```json
{ "enabled": true, "url": "http://127.0.0.1:7849", "token": "vx_…", "pid": 1234,
  "launch": { "command": "…\\Voxarium.exe", "args": ["--hidden"] } }
```

`VOXARIUM_API_URL` and `VOXARIUM_API_TOKEN` override it for the CLI and MCP server.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/health` | Active model and engine status |
| `GET` | `/v1/models` | All models: installed, active, runnable, languages, license |
| `GET` | `/v1/voices?model=<id>` | Voices for a model (default: the active one) |
| `POST` | `/v1/audio/speech` | **OpenAI-compatible**. Returns audio bytes |
| `POST` | `/v1/speak` | Native. Returns JSON with base64 audio and metadata |

### `POST /v1/audio/speech` (OpenAI-compatible)

`{ "model", "input", "voice", "response_format", "speed" }`. Formats are `mp3`
(default), `wav` and `pcm` (raw 16-bit little-endian mono at 24 kHz). OpenAI names
such as `tts-1` or `alloy` fall back to the active model and its current voice.
Voxarium ids (`kokoro-82m`, `af_heart`) select a specific model and voice.

```powershell
curl http://127.0.0.1:7849/v1/audio/speech `
  -H "Authorization: Bearer $env:VOXARIUM_TOKEN" -H "Content-Type: application/json" `
  -d '{"model":"kokoro-82m","input":"Hello","voice":"af_heart","response_format":"wav"}' -o hello.wav
```

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:7849/v1", api_key="vx_…")
client.audio.speech.create(model="kokoro-82m", voice="af_heart", input="Hello").write_to_file("hello.mp3")
```

### `POST /v1/speak` (native)

```json
{ "text": "Hello", "model": "supertonic-3", "voice": "F1", "language": "en",
  "seed": 42, "speed": 1.0, "format": "wav", "save": true, "play": false, "return_audio": true }
```

`save` adds the take to History (marked as coming from the API); `play` plays it
on the computer's speakers; `return_audio: false` skips the audio bytes. The
response includes `model`, `voice`, `license`, `commercial`, `duration`,
`history_id`, `file` and `audio_base64`.

Model and voice names are matched loosely: ids, short names and display names
all work (`Kokoro`, `af_heart`, `Heart`). Errors use the OpenAI shape
`{ "error": { "message", "type", "code" } }` with 400/401/403/404/409/503 statuses.

## MCP server (agents)

Add to your MCP client configuration (Settings shows the exact paths):

```json
{
  "mcpServers": {
    "voxarium": {
      "command": "C:\\…\\Voxarium.exe",
      "args": ["C:\\…\\resources\\app.asar.unpacked\\electron\\cli\\voxarium-mcp.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

It runs on Voxarium's own runtime, so Node.js is not required. Tools:

- `speak`: text, optional model/voice/language. Plays on the speakers by default,
  or writes `output_path` (.wav, .mp3, .pcm). `save_to_history` is optional.
- `list_models`, `list_voices`, `status`.

## CLI

```text
voxarium say "Hello there"                     # plays it
voxarium say -m kokoro-82m -v af_heart "Hi" -o hi.wav
Get-Content notes.txt | voxarium say -         # read stdin
voxarium models | voxarium voices -m supertonic-3 | voxarium status
```

Run it with Voxarium's runtime (`ELECTRON_RUN_AS_NODE=1 Voxarium.exe …\voxarium.cjs`,
shown in Settings) or with Node.js (`node electron/cli/voxarium.cjs`, or
`npm.cmd run voxarium -- say "Hi"` in a checkout).

## Tests

`npm.cmd run test:integrations` launches the built app with a temporary profile
linked to your installed models and checks authentication and origin/host
rejection, OpenAI speech (MP3), request validation, switching models through
the API (with History tagging), the CLI, the MCP handshake and `speak` tool, tray
survival after closing the window, and on-demand hidden launch.
