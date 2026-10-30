#!/usr/bin/env node
// Voxarium MCP server (stdio). Lets agent tools such as Claude Code, Claude
// Desktop or Cursor speak text aloud or produce audio files with the user's local
// Voxarium models. It talks to the running app's local API and starts the app
// in the tray when needed. No dependencies: newline-delimited JSON-RPC 2.0.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { connect, call, setClientName } = require('./client.cjs');

setClientName('mcp');

const SERVER = { name: 'voxarium', version: '1.0.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'speak',
    title: 'Speak text with Voxarium',
    description:
      "Turn text into speech with the user's local Voxarium text-to-speech models. By default the audio plays on the user's speakers. Pass output_path to also write an audio file (.wav, .mp3 or .pcm). Everything runs on the user's computer.",
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to speak (up to 20,000 characters).' },
        model: { type: 'string', description: 'Model id or name from list_models. Omit to use the active model. Naming another model switches the app to it.' },
        voice: { type: 'string', description: 'Voice id or name from list_voices. Omit for the current voice.' },
        language: { type: 'string', description: 'Language code such as en, fr or ar. Omit for the default.' },
        output_path: { type: 'string', description: 'Write the audio to this file. Relative paths resolve against the server working directory.' },
        play: { type: 'boolean', description: "Play the audio on the user's speakers. Defaults to true when no output_path is given." },
        save_to_history: { type: 'boolean', description: "Also add the take to Voxarium's History. Default false." },
        seed: { type: 'string', description: 'Seed for reproducible output.' },
        speed: { type: 'number', description: 'Speaking rate for models that support it (1 = normal).' },
        instruction: {
          type: 'string',
          description:
            'Voice or delivery instruction for models that accept one (VoxCPM2, Breeze TTS 2: free text such as "a calm, deep male narrator"; OmniVoice: comma-separated attributes such as "female, young adult, british accent"). Ignored by other models. Inline tags like <laugh> or [pause 1.0s] go in the text itself; see list_models.',
        },
        intensity: { type: 'number', description: 'Expressiveness for models with an intensity control (Chatterbox exaggeration, 0.25 to 2; 0.5 is neutral).' },
      },
      required: ['text'],
    },
  },
  {
    name: 'list_models',
    title: 'List Voxarium models',
    description: 'List the text-to-speech models in Voxarium with whether they are installed, active and runnable, their languages and license (some are non-commercial).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_voices',
    title: 'List Voxarium voices',
    description: 'List the voices a model can use. Defaults to the active model.',
    inputSchema: { type: 'object', properties: { model: { type: 'string', description: 'Model id or name.' } } },
  },
  {
    name: 'status',
    title: 'Voxarium status',
    description: 'Show the active model and whether the engine is ready or busy.',
    inputSchema: { type: 'object', properties: {} },
  },
];

/** One line telling an agent what a model accepts beyond plain text. */
function describeExpression(expression) {
  const parts = [];
  if (expression.tags?.length) parts.push(`inline tags ${expression.tags.map((tag) => tag.token).join(' ')}`);
  if (expression.instruction) parts.push(`"instruction" (${expression.instruction.label.toLowerCase()})`);
  if (expression.attributes) parts.push(`"instruction" from attributes: ${expression.attributes.map((group) => group.options.join('/')).join('; ')}`);
  if (expression.intensity) parts.push(`"intensity" ${expression.intensity.min}-${expression.intensity.max}`);
  return parts.join(', ');
}

const log = (message) => process.stderr.write(`[voxarium-mcp] ${message}\n`);
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const text = (value, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });

async function runTool(name, input = {}) {
  const target = await connect({ log });
  if (name === 'status') {
    const status = await call('GET', '/v1/health', null, target);
    return text(`Active model: ${status.activeModel.name} (${status.activeModel.id}). Engine: ${status.engine.status}${status.engine.busy ? ', busy' : ''}.`);
  }
  if (name === 'list_models') {
    const { data } = await call('GET', '/v1/models', null, target);
    const lines = data.map(
      (model) =>
        `- ${model.id} (${model.name}): ${model.active ? 'active' : model.runnable ? 'ready' : model.installed ? 'installed, not runnable yet' : 'not installed'}; ` +
        `${model.languages.length} languages; license ${model.license.id}${model.license.commercial === false ? ' (non-commercial)' : ''}` +
        (model.expression ? `; expression: ${describeExpression(model.expression)}` : ''),
    );
    return text(`Voxarium models:\n${lines.join('\n')}`);
  }
  if (name === 'list_voices') {
    const query = input.model ? `?model=${encodeURIComponent(input.model)}` : '';
    const result = await call('GET', `/v1/voices${query}`, null, target);
    const lines = result.voices.slice(0, 200).map((voice) => `- ${voice.id}: ${voice.name}${voice.language ? ` [${voice.language}]` : ''}${voice.default ? ' (default)' : ''}`);
    return text(`${result.note ? `${result.note}\n` : ''}Voices for ${result.model}:\n${lines.join('\n') || '(none listed yet)'}`);
  }
  if (name === 'speak') {
    if (typeof input.text !== 'string' || !input.text.trim()) return text('"text" is required.', true);
    const output = input.output_path ? path.resolve(String(input.output_path)) : null;
    const format = output ? path.extname(output).slice(1).toLowerCase() || 'wav' : 'wav';
    const result = await call(
      'POST',
      '/v1/speak',
      {
        text: input.text,
        model: input.model,
        voice: input.voice,
        language: input.language,
        seed: input.seed,
        speed: input.speed,
        instruction: input.instruction,
        intensity: input.intensity,
        format,
        save: Boolean(input.save_to_history),
        play: input.play ?? !output,
        return_audio: Boolean(output),
      },
      target,
    );
    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, Buffer.from(result.audio_base64, 'base64'));
    }
    const parts = [
      `Generated ${result.duration.toFixed(2)}s of speech with ${result.model} (voice ${result.voice}).`,
      result.played ? 'Played it on the speakers.' : null,
      output ? `Saved to ${output}.` : null,
      result.history_id ? 'Added to Voxarium History.' : null,
      result.commercial === false ? `Note: ${result.license} is a non-commercial license.` : null,
    ];
    return text(parts.filter(Boolean).join(' '));
  }
  return text(`Unknown tool "${name}".`, true);
}

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        if (params?.clientInfo?.name) setClientName(`mcp · ${params.clientInfo.name}`);
        return write({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOLS.includes(requested) ? requested : PROTOCOLS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER,
            instructions:
              "Use 'speak' to read text aloud to the user or to produce audio files with their local Voxarium voices. Call list_models / list_voices to discover options.",
          },
        });
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined;
      case 'ping':
        return write({ jsonrpc: '2.0', id, result: {} });
      case 'tools/list':
        return write({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      case 'tools/call': {
        try {
          return write({ jsonrpc: '2.0', id, result: await runTool(params?.name, params?.arguments || {}) });
        } catch (error) {
          // Tool failures are reported to the model, not as protocol errors.
          return write({ jsonrpc: '2.0', id, result: text(`Voxarium: ${error.message}`, true) });
        }
      }
      default:
        if (isRequest) write({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
        return undefined;
    }
  } catch (error) {
    if (isRequest) write({ jsonrpc: '2.0', id, error: { code: -32603, message: error.message } });
    return undefined;
  }
}

const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  void handle(message);
});
input.on('close', () => process.exit(0));
