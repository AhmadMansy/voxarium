// SPDX-License-Identifier: AGPL-3.0-or-later
// Stage 7 of the install pipeline: a real test synthesis. A model is only called
// verified once it has turned a fixed sentence into plausible audio on this machine.
// `analyzePcm` is pure; `goldenSynthesis` talks to a running loopback sidecar.

const TEST_SENTENCE = 'Voxarium is ready to speak.';

// Plausibility limits for a ~2 second sentence. Deliberately loose: the goal is to
// catch silence, garbage and truncated output, not to judge quality.
const LIMITS = {
  minSeconds: 0.4,
  maxSeconds: 30,
  minPeak: 0.02,
  maxPeak: 4,
  minRms: 0.004,
  maxClippedFraction: 0.2,
};

/**
 * Checks mono float32 samples. Returns `{ ok, reasons, durationSec, peak, rms, clippedFraction }`.
 */
function analyzePcm(pcm, sampleRate = 24000) {
  const reasons = [];
  const length = pcm?.length || 0;
  if (!length) {
    return { ok: false, reasons: ['The model returned no audio.'], durationSec: 0, peak: 0, rms: 0, clippedFraction: 0 };
  }
  let peak = 0;
  let sumSquares = 0;
  let clipped = 0;
  let bad = 0;
  for (let index = 0; index < length; index += 1) {
    const value = pcm[index];
    if (!Number.isFinite(value)) {
      bad += 1;
      continue;
    }
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
    if (magnitude >= 0.999) clipped += 1;
    sumSquares += value * value;
  }
  const durationSec = length / sampleRate;
  const rms = Math.sqrt(sumSquares / length);
  const clippedFraction = clipped / length;

  if (bad) reasons.push(`The audio contains ${bad} invalid samples (NaN or infinity).`);
  if (durationSec < LIMITS.minSeconds) reasons.push(`The audio is too short (${durationSec.toFixed(2)} s).`);
  if (durationSec > LIMITS.maxSeconds) reasons.push(`The audio is unexpectedly long (${durationSec.toFixed(1)} s).`);
  if (peak < LIMITS.minPeak || rms < LIMITS.minRms) reasons.push('The audio is silent or nearly silent.');
  if (peak > LIMITS.maxPeak) reasons.push('The audio is far too loud and is probably corrupt.');
  if (clippedFraction > LIMITS.maxClippedFraction) reasons.push('The audio is heavily clipped.');
  return { ok: reasons.length === 0, reasons, durationSec, peak, rms, clippedFraction };
}

function decodeBase64Float32(value) {
  const buffer = Buffer.from(value, 'base64');
  const aligned = buffer.byteOffset % 4 === 0 ? buffer : Buffer.from(buffer);
  return new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 4));
}

/** Reads the sidecar's /synthesize reply (JSON with base64 float32 PCM). */
function parseSynthesisBody(body) {
  if (!body || typeof body !== 'object') throw new Error('The sidecar returned an unreadable reply.');
  let pcm = null;
  if (typeof body.pcm === 'string') pcm = decodeBase64Float32(body.pcm);
  else if (Array.isArray(body.pcm)) pcm = Float32Array.from(body.pcm);
  if (!pcm || !pcm.length) throw new Error('The sidecar returned no audio.');
  return { pcm, sampleRate: Number(body.sampleRate) || 24000 };
}

/**
 * Runs the test sentence through a ready sidecar and analyzes the result.
 * Never throws: a failure is returned as `{ ok: false, error }`.
 */
async function goldenSynthesis({ url, token, text = TEST_SENTENCE, voice = null, timeoutMs = 120000, fetchImpl = fetch } = {}) {
  const started = Date.now();
  try {
    if (!url || !token) throw new Error('The sidecar is not running.');
    const host = new URL(url).hostname;
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
      throw new Error('Refusing to test a sidecar that is not on this machine.');
    }
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, voice, temperature: 0.3, seed: '1234', format: 'f32' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.error || detail?.detail || `${response.status} ${response.statusText}`);
    }
    const { pcm, sampleRate } = parseSynthesisBody(await response.json());
    const analysis = analyzePcm(pcm, sampleRate);
    return {
      ok: analysis.ok,
      error: analysis.ok ? null : analysis.reasons.join(' '),
      durationSec: Math.round(analysis.durationSec * 100) / 100,
      peak: Math.round(analysis.peak * 1000) / 1000,
      rms: Math.round(analysis.rms * 10000) / 10000,
      sampleRate,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), durationSec: 0, peak: 0, rms: 0, sampleRate: 0, elapsedMs: Date.now() - started };
  }
}

module.exports = { TEST_SENTENCE, LIMITS, analyzePcm, parseSynthesisBody, goldenSynthesis };
