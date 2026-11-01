#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Voxarium command line. Talks to the running app's local API (and starts it in
// the tray if needed), so it uses the same engine, models and voices as the Studio.
const fs = require('node:fs');
const path = require('node:path');
const { connect, call, VoxariumError } = require('./client.cjs');

const HELP = `Voxarium CLI

Usage:
  voxarium say <text>      Speak text (plays it unless -o is given)
  voxarium say -           Read the text from stdin
  voxarium models          List models (installed, active, license)
  voxarium voices [-m id]  List voices for a model (default: the active one)
  voxarium status          Show the engine status

Options for "say":
  -m, --model <id>         Model id or name (switches the app's active model)
  -v, --voice <id>         Voice id or name
  -l, --language <code>    Language code, e.g. en, fr, ar
  -o, --output <file>      Write audio to a file (.wav, .mp3 or .pcm)
      --play               Also play it when writing a file
      --save               Add the take to Voxarium's History
      --seed <n>           Reproducible seed
      --speed <x>          Speaking rate (models that support it)
      --style <text>       Voice/delivery instruction (VoxCPM2, Breeze, OmniVoice)
      --intensity <x>      Expressiveness (Chatterbox exaggeration)
      --json               Print the result as JSON

Environment:
  VOXARIUM_API_URL, VOXARIUM_API_TOKEN override the discovered endpoint.`;

function parse(argv) {
  const args = { _: [] };
  const valued = { m: 'model', model: 'model', v: 'voice', voice: 'voice', l: 'language', language: 'language', o: 'output', output: 'output', seed: 'seed', speed: 'speed', style: 'style', intensity: 'intensity' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const match = /^--?([a-z]+)(?:=(.*))?$/i.exec(arg);
    if (!match || arg === '-') {
      args._.push(arg);
      continue;
    }
    const name = match[1];
    if (valued[name]) args[valued[name]] = match[2] ?? argv[(i += 1)];
    else args[name] = true;
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function table(rows, columns) {
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => String(row[column] ?? '').length)));
  const line = (values) => values.map((value, index) => String(value ?? '').padEnd(widths[index])).join('  ').trimEnd();
  return [line(columns), line(widths.map((width) => '-'.repeat(width))), ...rows.map((row) => line(columns.map((column) => row[column])))].join('\n');
}

async function main() {
  const args = parse(process.argv.slice(2));
  const [command, ...rest] = args._;
  if (!command || args.help || args.h || command === 'help') {
    console.log(HELP);
    return;
  }
  const target = await connect({ log: (message) => console.error(message) });

  if (command === 'status') {
    const status = await call('GET', '/v1/health', null, target);
    console.log(args.json ? JSON.stringify(status, null, 2) : `${status.activeModel.name} · engine ${status.engine.status}${status.engine.busy ? ' (busy)' : ''} · ${target.url}`);
    return;
  }
  if (command === 'models') {
    const { data } = await call('GET', '/v1/models', null, target);
    if (args.json) return console.log(JSON.stringify(data, null, 2));
    console.log(
      table(
        data.map((model) => ({
          id: model.id,
          name: model.name,
          state: model.active ? 'active' : model.runnable ? 'ready' : model.installed ? 'installed' : '',
          license: `${model.license.id}${model.license.commercial === false ? ' (NC)' : ''}`,
          languages: model.languages.length,
        })),
        ['id', 'name', 'state', 'license', 'languages'],
      ),
    );
    return;
  }
  if (command === 'voices') {
    const query = args.model ? `?model=${encodeURIComponent(args.model)}` : '';
    const result = await call('GET', `/v1/voices${query}`, null, target);
    if (args.json) return console.log(JSON.stringify(result, null, 2));
    if (result.note) console.error(result.note);
    console.log(table(result.voices.map((voice) => ({ id: voice.id, name: voice.name, language: voice.language, default: voice.default ? '*' : '' })), ['id', 'name', 'language', 'default']));
    return;
  }
  if (command === 'say') {
    let text = rest.join(' ');
    if (!text || text === '-') text = process.stdin.isTTY ? '' : await readStdin();
    if (!text.trim()) throw new VoxariumError('There is no text to speak. Pass it as an argument or pipe it in.', 0);
    const output = args.output ? path.resolve(args.output) : null;
    const format = output ? (path.extname(output).slice(1).toLowerCase() || 'wav') : 'wav';
    const result = await call(
      'POST',
      '/v1/speak',
      {
        text,
        model: args.model,
        voice: args.voice,
        language: args.language,
        seed: args.seed,
        speed: args.speed == null ? undefined : Number(args.speed),
        instruction: args.style,
        intensity: args.intensity == null ? undefined : Number(args.intensity),
        format,
        save: Boolean(args.save),
        play: !output || Boolean(args.play),
        return_audio: Boolean(output),
      },
      target,
    );
    if (output) fs.writeFileSync(output, Buffer.from(result.audio_base64, 'base64'));
    delete result.audio_base64;
    if (args.json) console.log(JSON.stringify({ ...result, output }, null, 2));
    else console.log(`${result.duration.toFixed(2)}s · ${result.model} · ${result.voice}${output ? ` → ${output}` : ''}${result.license && result.commercial === false ? ` · ${result.license} (non-commercial)` : ''}`);
    return;
  }
  throw new VoxariumError(`Unknown command "${command}". Run "voxarium help".`, 0);
}

main().catch((error) => {
  console.error(`voxarium: ${error.message}`);
  process.exitCode = 1;
});
