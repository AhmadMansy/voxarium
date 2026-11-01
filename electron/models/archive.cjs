// SPDX-License-Identifier: AGPL-3.0-or-later
// Safe archive extraction for runtime packs.
//
// Runtime packs are plain .zip or .tar.gz downloads. They are installed into a
// user-writable folder, so every entry is validated before it is written:
// absolute paths, drive letters and `..` segments are rejected. Links are allowed
// only on POSIX systems and only when relative and contained in the install
// folder; device and FIFO entries are rejected. Nothing here executes an archive
// or trusts it beyond its declared SHA-256.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');

// 1.5 GB is far above the Python base pack and keeps tar extraction bounded.
const MAX_TAR_GZ_BYTES = 1536 * 1024 * 1024;

function safePath(root, entryName) {
  const name = String(entryName || '').replace(/\\/g, '/');
  if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
    throw new Error(`Archive entry has an absolute path: ${JSON.stringify(name)}`);
  }
  const segments = name.split('/').filter((segment) => segment && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`Archive entry escapes the install folder: ${JSON.stringify(name)}`);
  }
  if (!segments.length) return path.resolve(root);
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, ...segments);
  const relative = path.relative(rootPath, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Archive entry escapes the install folder: ${JSON.stringify(name)}`);
  }
  return target;
}

function tarString(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function tarNumber(buffer, start, length) {
  const raw = tarString(buffer, start, length).trim();
  if (!raw) return 0;
  const value = parseInt(raw, 8);
  return Number.isFinite(value) ? value : 0;
}

function parsePax(buffer) {
  const fields = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number(buffer.subarray(offset, space).toString('utf8'));
    if (!Number.isFinite(length) || length <= 0 || offset + length > buffer.length) break;
    const body = buffer.subarray(space + 1, offset + length - 1).toString('utf8');
    const equals = body.indexOf('=');
    if (equals > 0) fields[body.slice(0, equals)] = body.slice(equals + 1);
    offset += length;
  }
  return fields;
}

/** Throws unless `target` (after following any links) is still inside `rootReal`. */
async function assertInside(rootReal, target) {
  const real = await fsp.realpath(target).catch(() => null);
  if (!real) return;
  const relative = path.relative(rootReal, real);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Archive entry resolves outside the install folder: ${JSON.stringify(target)}`);
  }
}

/** Applies permission bits on POSIX systems (the executable bit matters for uv and Python). */
async function applyMode(target, mode) {
  if (process.platform === 'win32' || !mode) return;
  await fsp.chmod(target, mode).catch(() => {});
}

/**
 * Creates a symbolic link only when it is relative and its target, resolved from
 * the link's own folder, stays inside the install folder.
 */
async function createSafeSymlink(destination, linkPath, linkname, entryName) {
  if (process.platform === 'win32') {
    throw new Error(`Archive contains a link entry (${entryName}); links are not supported on Windows packs.`);
  }
  const text = String(linkname || '').replace(/\\/g, '/');
  if (!text || text.startsWith('/') || /^[a-zA-Z]:/.test(text)) {
    throw new Error(`Archive link has an absolute or empty target: ${JSON.stringify(entryName)} -> ${JSON.stringify(text)}`);
  }
  const rootPath = path.resolve(destination);
  const resolved = path.resolve(path.dirname(linkPath), text);
  const relative = path.relative(rootPath, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Archive link escapes the install folder: ${JSON.stringify(entryName)} -> ${JSON.stringify(text)}`);
  }
  await fsp.mkdir(path.dirname(linkPath), { recursive: true });
  await fsp.rm(linkPath, { force: true });
  await fsp.symlink(text, linkPath);
}

async function extractTarGz(filePath, destination) {
  const compressed = await fsp.readFile(filePath);
  let data;
  try {
    data = zlib.gunzipSync(compressed, { maxOutputLength: MAX_TAR_GZ_BYTES });
  } catch (error) {
    if (error && error.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error('This .tar.gz runtime pack is too large to extract safely. Publish a .zip pack instead.');
    }
    throw error;
  }

  let offset = 0;
  let pendingName = null;
  let pendingPax = null;
  let pendingLink = null;
  // Once a symlink exists, every later write is checked against the real folder so
  // a chain of links can never lead a file outside the install folder.
  let sawLink = false;
  const rootReal = await fsp.realpath(destination);
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = tarNumber(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > data.length) throw new Error('Archive is truncated.');

    let name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    if (pendingPax && pendingPax.path) name = pendingPax.path;
    if (pendingName) name = pendingName;

    const body = data.subarray(bodyStart, bodyEnd);
    if (type === 'x') {
      pendingPax = parsePax(body);
    } else if (type === 'L') {
      pendingName = body.toString('utf8').replace(/\0+$/g, '');
    } else if (type === 'K') {
      pendingLink = body.toString('utf8').replace(/\0+$/g, '');
    } else if (type === 'g') {
      // Global PAX headers do not change how this app installs a pack.
    } else {
      // Permission bits only: setuid/setgid/sticky are never applied.
      const mode = tarNumber(header, 100, 8) & 0o777;
      if (type === '5') {
        const dir = safePath(destination, name);
        await fsp.mkdir(dir, { recursive: true });
        if (sawLink) await assertInside(rootReal, dir);
      } else if (type === '0' || type === '\0' || type === '7') {
        const target = safePath(destination, name);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        if (sawLink) await assertInside(rootReal, path.dirname(target));
        await fsp.writeFile(target, body);
        await applyMode(target, mode);
      } else if (type === '2') {
        // Symbolic link (python-build-standalone ships many on Linux and macOS).
        const linkname = pendingLink || pendingPax?.linkpath || tarString(header, 157, 100);
        const target = safePath(destination, name);
        await createSafeSymlink(destination, target, linkname, name);
        sawLink = true;
      } else if (type === '1') {
        // Hard link: copy the already-extracted file, never link outside the folder.
        const linkname = pendingLink || pendingPax?.linkpath || tarString(header, 157, 100);
        const source = safePath(destination, linkname);
        const target = safePath(destination, name);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        if (sawLink) {
          await assertInside(rootReal, path.dirname(target));
          await assertInside(rootReal, source);
        }
        await fsp.copyFile(source, target);
        await applyMode(target, mode);
      } else if (type === '3' || type === '4' || type === '6') {
        throw new Error(`Archive contains a device or FIFO entry (${name}); runtime packs must contain files, folders and links only.`);
      }
      pendingName = null;
      pendingPax = null;
      pendingLink = null;
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

async function copyRange(filePath, start, length, target, { inflate = false } = {}) {
  const source = fs.createReadStream(filePath, { start, end: start + length - 1 });
  const output = fs.createWriteStream(target);
  if (inflate) await pipeline(source, zlib.createInflateRaw(), output);
  else await pipeline(source, output);
}

async function extractZip(filePath, destination) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const tailLength = Math.min(stat.size, 65_557);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, stat.size - tailLength);
    const eocd = findEndOfCentralDirectory(tail);
    if (eocd === -1) throw new Error('Archive is not a readable ZIP file.');
    const entryCount = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
      throw new Error('ZIP64 runtime packs are not supported. Republish the pack without ZIP64.');
    }

    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryOffset);

    let cursor = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50) {
        throw new Error('ZIP central directory is malformed.');
      }
      const flags = directory.readUInt16LE(cursor + 8);
      const method = directory.readUInt16LE(cursor + 10);
      const compressedSize = directory.readUInt32LE(cursor + 20);
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const commentLength = directory.readUInt16LE(cursor + 32);
      const localOffset = directory.readUInt32LE(cursor + 42);
      const name = directory.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      cursor += 46 + nameLength + extraLength + commentLength;

      if (flags & 0x1) throw new Error(`Archive entry is encrypted: ${name}`);
      if (!name || name.endsWith('/')) {
        await fsp.mkdir(safePath(destination, name || '.'), { recursive: true });
        continue;
      }
      if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error('ZIP64 runtime packs are not supported.');
      }
      if (method !== 0 && method !== 8) {
        throw new Error(`Archive uses unsupported ZIP compression method ${method}.`);
      }

      const local = Buffer.alloc(30);
      await handle.read(local, 0, 30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP local header is malformed.');
      const localNameLength = local.readUInt16LE(26);
      const localExtraLength = local.readUInt16LE(28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const target = safePath(destination, name);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await copyRange(filePath, dataStart, compressedSize, target, { inflate: method === 8 });
    }
  } finally {
    await handle.close().catch(() => {});
  }
}

async function extractArchive(filePath, destination) {
  await fsp.mkdir(destination, { recursive: true });
  const handle = await fsp.open(filePath, 'r');
  const magic = Buffer.alloc(4);
  try {
    await handle.read(magic, 0, 4, 0);
  } finally {
    await handle.close().catch(() => {});
  }
  if (magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04) {
    await extractZip(filePath, destination);
    return 'zip';
  }
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    await extractTarGz(filePath, destination);
    return 'tar.gz';
  }
  throw new Error('Runtime pack must be a .zip or .tar.gz archive.');
}

module.exports = { extractArchive, extractTarGz, extractZip, safePath };
