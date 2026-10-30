// Local HTTP API. Other apps, scripts and agent tools send text here and get audio
// back from the same engine the Studio uses (see bridge.cjs). It listens on the
// loopback interface only, requires a bearer token, and refuses browser requests
// (any Origin header, or a Host that is not this loopback address) so a website
// cannot drive it.
const http = require('node:http');

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TEXT_CHARS = 20000;
// OpenAI voice names that clients send by default. They map to the model's default voice.
const OPENAI_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']);
const OPENAI_MODELS = new Set(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']);
const FORMATS = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  pcm: 'audio/pcm',
};

class ApiError extends Error {
  constructor(status, message, code = 'invalid_request_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
}

function sendError(res, error) {
  // Engine errors carry an HTTP status too (400 bad voice, 409 not installed, 503 not running).
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error instanceof ApiError ? error.code : status < 500 ? 'invalid_request_error' : 'server_error';
  sendJson(res, status, { error: { message: error instanceof Error ? error.message : String(error), type: code, code } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError(413, 'The request body is too large (1 MB maximum).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, 'The request body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function text(value, name, { required = false, max = 200 } = {}) {
  if (value == null || value === '') {
    if (required) throw new ApiError(400, `"${name}" is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ApiError(400, `"${name}" must be a string.`);
  if (value.length > max) throw new ApiError(400, `"${name}" is too long (${max} characters maximum).`);
  return value;
}

function number(value, name, min, max) {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new ApiError(400, `"${name}" must be a number from ${min} to ${max}.`);
  return parsed;
}

/** Normalizes a speech request from either the OpenAI or the native schema. */
function speechRequest(body, { openai }) {
  const input = text(openai ? body.input : body.text ?? body.input, openai ? 'input' : 'text', { required: true, max: MAX_TEXT_CHARS });
  if (!input.trim()) throw new ApiError(400, 'There is no text to speak.');
  let model = text(body.model, 'model');
  if (model && OPENAI_MODELS.has(model)) model = undefined;
  let voice = text(body.voice, 'voice');
  if (voice && OPENAI_VOICES.has(voice.toLowerCase())) voice = undefined;
  const format = (text(openai ? body.response_format : body.format, 'format') || (openai ? 'mp3' : 'wav')).toLowerCase();
  if (!FORMATS[format]) {
    throw new ApiError(400, `Unsupported format "${format}". Use ${Object.keys(FORMATS).join(', ')}.`, 'unsupported_format');
  }
  const seed = body.seed == null ? undefined : String(body.seed);
  if (seed != null && !/^\d{1,20}$/.test(seed)) throw new ApiError(400, '"seed" must be a non-negative integer.');
  return {
    text: input,
    model,
    voice,
    language: text(body.language, 'language', { max: 16 }),
    temperature: number(body.temperature, 'temperature', 0, 2),
    speed: number(body.speed, 'speed', 0.25, 4),
    seed,
    format,
    save: Boolean(body.save),
    play: Boolean(body.play),
  };
}

const ACTIVITY_LIMIT = 100;

/** A short label for whoever sent the request, for the activity log. */
function clientLabel(req) {
  const declared = String(req.headers['x-voxarium-client'] || '').trim();
  if (declared) return declared.slice(0, 40);
  const agent = String(req.headers['user-agent'] || '').trim();
  if (!agent) return 'unknown';
  // "OpenAI/Python 1.54.0" stays readable; long browser-style strings are cut.
  return agent.split(/\s+/)[0].slice(0, 40);
}

function createApiServer({ bridge, getToken, encodeWav, encodePcm16, onActivity, log = console.log, version = '1.0.0' }) {
  let server = null;
  let port = null;
  const activity = [];

  function record(entry) {
    activity.unshift(entry);
    if (activity.length > ACTIVITY_LIMIT) activity.length = ACTIVITY_LIMIT;
    try {
      onActivity?.(entry);
    } catch {}
  }

  const authorized = (req) => {
    const token = getToken();
    const header = String(req.headers.authorization || '');
    return Boolean(token) && header === `Bearer ${token}`;
  };

  async function handle(req, res, entry) {
    // Browsers always send Origin on cross-site requests; local clients do not.
    if (req.headers.origin) throw new ApiError(403, 'Browser requests are not accepted by the Voxarium API.', 'forbidden');
    const host = String(req.headers.host || '');
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      throw new ApiError(403, 'Unexpected Host header.', 'forbidden');
    }
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const route = `${req.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;
    entry.route = route;

    if (route === 'GET /' || route === 'GET /v1') {
      return sendJson(res, 200, { name: 'Voxarium local API', version, docs: 'GET /v1/models, GET /v1/voices, POST /v1/audio/speech, POST /v1/speak' });
    }
    if (!authorized(req)) throw new ApiError(401, 'Missing or invalid API token. Send "Authorization: Bearer <token>".', 'invalid_api_key');

    switch (route) {
      case 'GET /v1/health': {
        const status = await bridge.request('status', {}, { timeoutMs: 15000 });
        return sendJson(res, 200, { ok: true, version, ...status, queue: bridge.pending() });
      }
      case 'GET /v1/models': {
        const models = await bridge.request('models', {}, { timeoutMs: 15000 });
        return sendJson(res, 200, { object: 'list', data: models.map((model) => ({ object: 'model', owned_by: 'voxarium', ...model })) });
      }
      case 'GET /v1/voices': {
        const voices = await bridge.request('voices', { model: url.searchParams.get('model') || undefined }, { timeoutMs: 120000 });
        return sendJson(res, 200, voices);
      }
      case 'POST /v1/audio/speech': {
        const request = speechRequest(await readBody(req), { openai: true });
        entry.chars = request.text.length;
        const result = await bridge.request('synthesize', request);
        Object.assign(entry, { model: result.modelId, voice: result.voiceId, duration: result.duration });
        const audio = request.format === 'mp3' ? Buffer.from(result.mp3) : request.format === 'pcm' ? encodePcm16(result.pcm) : encodeWav(result.pcm, result.sampleRate);
        res.writeHead(200, {
          'content-type': FORMATS[request.format],
          'content-length': audio.length,
          'x-voxarium-model': result.modelId,
          'x-voxarium-voice': result.voiceId,
          'x-voxarium-license': result.license,
          'x-voxarium-duration': String(result.duration),
        });
        return res.end(audio);
      }
      case 'POST /v1/speak': {
        const body = await readBody(req);
        const request = speechRequest(body, { openai: false });
        entry.chars = request.text.length;
        const result = await bridge.request('synthesize', request);
        Object.assign(entry, { model: result.modelId, voice: result.voiceId, duration: result.duration, saved: Boolean(result.historyId), played: Boolean(result.played) });
        const audio = request.format === 'mp3' ? Buffer.from(result.mp3) : request.format === 'pcm' ? encodePcm16(result.pcm) : encodeWav(result.pcm, result.sampleRate);
        const payload = {
          model: result.modelId,
          voice: result.voiceId,
          license: result.license,
          commercial: result.commercial,
          duration: result.duration,
          sample_rate: result.sampleRate,
          format: request.format,
          history_id: result.historyId || null,
          file: result.filePath || null,
          played: Boolean(result.played),
        };
        // Clients that only want a side effect (save or play) can skip the audio bytes.
        if (body.return_audio !== false) payload.audio_base64 = audio.toString('base64');
        return sendJson(res, 200, payload);
      }
      default:
        throw new ApiError(404, `No route for ${route}.`, 'not_found');
    }
  }

  async function start(requestedPort) {
    await stop();
    port = requestedPort;
    server = http.createServer((req, res) => {
      const started = Date.now();
      const entry = { id: `${started}-${Math.random().toString(36).slice(2, 8)}`, at: started, client: clientLabel(req), route: `${req.method} ${req.url}`, status: 200 };
      const finish = (status, error) => {
        // Health checks run before every CLI/MCP command; only log them when they fail.
        if (status < 400 && /\/v1\/health$/.test(entry.route)) return;
        record({ ...entry, status, error: error || null, ms: Date.now() - started });
      };
      handle(req, res, entry).then(
        () => finish(res.statusCode),
        (error) => {
          if (!Number.isInteger(error?.status)) log(`[voxarium] api error: ${error instanceof Error ? error.stack : error}`);
          const status = Number.isInteger(error?.status) ? error.status : 500;
          finish(status, error instanceof Error ? error.message : String(error));
          if (!res.headersSent) sendError(res, error);
          else res.destroy();
        },
      );
    });
    // Synthesis on large models can take minutes; never time out an active request.
    server.requestTimeout = 0;
    server.headersTimeout = 30000;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    port = server.address().port;
    log(`[voxarium] local API on http://127.0.0.1:${port}`);
    return port;
  }

  async function stop() {
    if (!server) return;
    const closing = server;
    server = null;
    await new Promise((resolve) => {
      closing.close(() => resolve());
      closing.closeAllConnections?.();
    });
  }

  return {
    start,
    stop,
    running: () => Boolean(server),
    activity: () => activity.slice(),
    port: () => (server ? port : null),
    url: () => (server ? `http://127.0.0.1:${port}` : null),
  };
}

module.exports = { createApiServer, ApiError, speechRequest };
