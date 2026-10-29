// A tiny localhost server for model weights and voice embeddings. Keeping these on a
// real HTTP origin means the Phonon wasm worker can fetch them normally (with CORS and
// range support) in both the Vite dev server and the packaged app.
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const MIME = {
  '.json': 'application/json; charset=utf-8',
  '.gguf': 'application/octet-stream',
  '.safetensors': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function startModelServer({ dirs, modelFiles }) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'range, content-type',
    'access-control-expose-headers': 'content-length, content-range, accept-ranges',
    'cross-origin-resource-policy': 'cross-origin',
    'timing-allow-origin': '*',
    'cache-control': 'no-store',
  };

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      sendJson(res, 400, { error: 'bad request' });
      return;
    }

    let filePath = null;
    const modelMatch = url.pathname.match(/^\/model\/([A-Za-z0-9._-]+)$/);
    const voiceMatch = url.pathname.match(/^\/voice\/([A-Za-z0-9_-]+)\.safetensors$/);
    const customVoiceMatch = url.pathname.match(/^\/voice\/custom\/([A-Za-z0-9_-]+)\.safetensors$/);

    if (url.pathname === '/health') {
      sendJson(res, 200, { ok: true, port: server.address().port });
      return;
    }
    if (modelMatch) {
      const name = modelMatch[1];
      if (!Object.prototype.hasOwnProperty.call(modelFiles, name)) {
        sendJson(res, 404, { error: 'unknown model file' });
        return;
      }
      filePath = path.join(dirs.models, name);
    } else if (customVoiceMatch) {
      filePath = path.join(dirs.voices, 'custom', `${customVoiceMatch[1]}.safetensors`);
    } else if (voiceMatch) {
      filePath = path.join(dirs.voices, `${voiceMatch[1]}.safetensors`);
    } else {
      sendJson(res, 404, { error: 'not found' });
      return;
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      sendJson(res, 404, { error: 'file not present', path: path.basename(filePath) });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      ...cors,
      'content-type': MIME[ext] || 'application/octet-stream',
      'accept-ranges': 'bytes',
    };

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        sendJson(res, 416, { error: 'invalid range' });
        return;
      }
      let start = match[1] === '' ? null : Number(match[1]);
      let end = match[2] === '' ? null : Number(match[2]);
      if (start === null && end === null) {
        sendJson(res, 416, { error: 'invalid range' });
        return;
      }
      if (start === null) {
        start = Math.max(0, stat.size - end);
        end = stat.size - 1;
      } else if (end === null) {
        end = stat.size - 1;
      }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      end = Math.min(end, stat.size - 1);
      headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['content-length'] = String(end - start + 1);
      res.writeHead(206, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }

    headers['content-length'] = String(stat.size);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
        setTimeout(resolve, 1500);
      }),
  };
}

module.exports = { startModelServer };
