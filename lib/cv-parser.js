/**
 * Applyr – CV / Resume Parser
 * Handles PDF streams with FlateDecode, ASCII85Decode, or both (chained).
 * Uses DecompressionStream API (Chrome 80+) for zlib inflation.
 */

(function () {
  'use strict';

  // ─── Public ───────────────────────────────────────────────────────────────

  async function parseResumeFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i += 8192)
      binary += String.fromCharCode(...uint8.subarray(i, i + 8192));
    const base64 = btoa(binary);

    let text;
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      text = await extractTextFromPdf(arrayBuffer);
    } else if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
      text = await file.text();
    } else {
      throw new Error('Unsupported file type. Please upload a PDF or TXT file.');
    }
    return { text, base64 };
  }

  // ─── PDF Extraction ───────────────────────────────────────────────────────

  async function extractTextFromPdf(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46)
      throw new Error('File does not appear to be a valid PDF.');

    const raw = toL1(bytes);

    // Layer 1: structured BT/ET extraction from decoded streams
    const structured = [];
    const allDecoded = [];
    await processStreams(bytes, raw, structured, allDecoded);
    let result = clean(structured.join(' '));
    if (result.length >= 40) return result;

    // Layer 2: brute-force readable text from decoded streams
    result = clean(bruteForce(allDecoded.join('\n')));
    if (result.length >= 40) return result;

    throw new Error(
      'Could not extract readable text from this PDF. ' +
      'Please paste your resume text directly in the text box below.'
    );
  }

  // ─── Stream Processing ────────────────────────────────────────────────────

  async function processStreams(bytes, raw, textOut, decodedOut) {
    let pos = 0;
    while (pos < raw.length) {
      const si = nextStream(raw, pos);
      if (si === -1) break;

      let dataStart = si + 6;
      if (raw[dataStart] === '\r') dataStart++;
      if (raw[dataStart] === '\n') dataStart++;

      const dict = getStreamDict(raw, si);

      // Skip images
      if (/\/Subtype\s*\/Image/.test(dict)) { pos = dataStart; continue; }

      // Detect filters
      const hasFlate = /\/FlateDecode/.test(dict);
      const hasA85   = /\/ASCII85Decode/.test(dict);
      const hasAHex  = /\/ASCIIHexDecode/.test(dict);
      const hasFilter = /\/Filter/.test(dict);

      // Skip streams with unsupported filters (DCT, JBIG2, etc.)
      if (hasFilter && !hasFlate && !hasA85 && !hasAHex) { pos = dataStart; continue; }

      // Find stream end
      const dataEnd = findEnd(raw, dict, dataStart);
      const streamSlice = raw.slice(dataStart, dataEnd);
      const streamBytes = bytes.slice(dataStart, dataEnd);

      // Decode the stream by applying filters in order
      let decoded;
      try {
        decoded = await decodeStream(streamSlice, streamBytes, hasA85, hasAHex, hasFlate);
      } catch (_) {
        pos = dataEnd + 9;
        continue;
      }

      if (decoded && decoded.length > 0) {
        const text = toL1(decoded);
        decodedOut.push(text);
        scanBTBlocks(text, textOut);
      }

      pos = dataEnd + 9;
    }
  }

  async function decodeStream(textSlice, rawBytes, hasA85, hasAHex, hasFlate) {
    let data;

    // Step 1: ASCII85Decode or ASCIIHexDecode (text → binary)
    if (hasA85) {
      data = decodeASCII85(textSlice);
    } else if (hasAHex) {
      data = decodeASCIIHex(textSlice);
    } else {
      data = rawBytes;
    }

    // Step 2: FlateDecode (binary → binary)
    if (hasFlate) {
      data = await inflate(data);
    }

    return data;
  }

  // ─── ASCII85 Decoder ──────────────────────────────────────────────────────

  function decodeASCII85(text) {
    // Find end-of-data marker ~>
    let end = text.indexOf('~>');
    if (end === -1) end = text.length;
    const input = text.slice(0, end).replace(/\s/g, '');

    const out = [];
    let i = 0;

    while (i < input.length) {
      if (input[i] === 'z') {
        out.push(0, 0, 0, 0);
        i++;
        continue;
      }

      // Collect up to 5 chars
      const group = [];
      while (group.length < 5 && i < input.length && input[i] !== 'z') {
        const c = input.charCodeAt(i) - 33;
        if (c >= 0 && c < 85) group.push(c);
        i++;
      }
      if (group.length === 0) break;

      // Pad short final group with 'u' (84)
      const actual = group.length;
      while (group.length < 5) group.push(84);

      // Decode: big-endian 4-byte integer from base-85 digits
      let val = ((group[0] * 85 + group[1]) * 85 + group[2]) * 85 + group[3];
      val = val * 85 + group[4];

      // Handle overflow for padded groups
      const b = [
        (val >>> 24) & 0xFF,
        (val >>> 16) & 0xFF,
        (val >>> 8)  & 0xFF,
        val & 0xFF
      ];

      // Only emit (actual - 1) bytes for short groups
      const n = actual < 5 ? actual - 1 : 4;
      for (let j = 0; j < n; j++) out.push(b[j]);
    }

    return new Uint8Array(out);
  }

  // ─── ASCIIHex Decoder ─────────────────────────────────────────────────────

  function decodeASCIIHex(text) {
    let end = text.indexOf('>');
    if (end === -1) end = text.length;
    const hex = text.slice(0, end).replace(/\s/g, '');
    const out = new Uint8Array(Math.ceil(hex.length / 2));
    for (let i = 0; i < hex.length; i += 2) {
      out[i / 2] = parseInt(hex.slice(i, i + 2) || (hex[i] + '0'), 16);
    }
    return out;
  }

  // ─── FlateDecode (zlib) ───────────────────────────────────────────────────

  async function inflate(data) {
    for (const fmt of ['deflate', 'deflate-raw']) {
      try { return await decomp(data, fmt); } catch (_) { /* next */ }
    }
    throw new Error('inflate failed');
  }

  async function decomp(data, format) {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(data).catch(() => {});
    writer.close().catch(() => {});

    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
    } catch (_) {
      if (total === 0) throw new Error('no data');
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  // ─── Dictionary / Stream Boundary ─────────────────────────────────────────

  function getStreamDict(raw, streamIdx) {
    const win = raw.slice(Math.max(0, streamIdx - 4096), streamIdx);
    let best = '';
    let i = 0;
    while (i < win.length) {
      const open = win.indexOf('<<', i);
      if (open === -1) break;
      let depth = 1, j = open + 2;
      while (j < win.length - 1 && depth > 0) {
        if (win[j] === '<' && win[j + 1] === '<') { depth++; j += 2; }
        else if (win[j] === '>' && win[j + 1] === '>') { depth--; j += 2; }
        else j++;
      }
      const cand = win.slice(open, j);
      if (/\/Length/.test(cand) || /\/Filter/.test(cand)) best = cand;
      i = open + 2;
    }
    return best;
  }

  function findEnd(raw, dict, dataStart) {
    // Direct /Length only (not indirect X Y R references)
    if (!/\/Length\s+\d+\s+\d+\s+R/.test(dict)) {
      const m = dict.match(/\/Length\s+(\d+)/);
      if (m) { const n = parseInt(m[1], 10); if (n > 0) return dataStart + n; }
    }
    let ei = raw.indexOf('\r\nendstream', dataStart);
    if (ei === -1) ei = raw.indexOf('\nendstream', dataStart);
    if (ei === -1) ei = raw.indexOf('endstream', dataStart);
    return ei > dataStart ? ei : Math.min(dataStart + 500000, raw.length);
  }

  // ─── BT / ET Extraction ───────────────────────────────────────────────────

  function scanBTBlocks(text, out) {
    const re = /BT\b([\s\S]*?)\bET\b/g;
    let m;
    while ((m = re.exec(text)) !== null) parseBT(m[1], out);
  }

  function parseBT(block, out) {
    let m;
    // Literal strings: (text) Tj | ' | "
    const litRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|'|")/g;
    while ((m = litRe.exec(block)) !== null) {
      const s = decodeLit(m[1]); if (s.trim()) out.push(s);
    }
    // Hex strings: <hex> Tj
    const hexRe = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
    while ((m = hexRe.exec(block)) !== null) {
      const s = decodeHex(m[1]); if (s.trim()) out.push(s);
    }
    // TJ arrays: [...] TJ
    const arrRe = /\[([\s\S]*?)\]\s*TJ/g;
    while ((m = arrRe.exec(block)) !== null) extractArr(m[1], out);
  }

  function extractArr(content, out) {
    let m;
    const litRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
    while ((m = litRe.exec(content)) !== null) {
      const s = decodeLit(m[1]); if (s.trim()) out.push(s);
    }
    const hexRe = /<([0-9A-Fa-f\s]+)>/g;
    while ((m = hexRe.exec(content)) !== null) {
      const s = decodeHex(m[1]); if (s.trim()) out.push(s);
    }
  }

  // ─── String Decoders ──────────────────────────────────────────────────────

  function decodeLit(raw) {
    return raw
      .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
      .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  }

  function decodeHex(hex) {
    const h = hex.replace(/\s/g, '');
    let s = '';
    for (let i = 0; i < h.length; i += 2) {
      const c = parseInt(h.slice(i, i + 2), 16);
      s += (c >= 0x20 && c <= 0x7E) ? String.fromCharCode(c) : ' ';
    }
    return s;
  }

  // ─── Brute Force Fallback ─────────────────────────────────────────────────

  function bruteForce(data) {
    // Find word-like sequences (must contain vowels to filter out encoded junk)
    const runs = [];
    const re = /[A-Za-z][A-Za-z0-9 .,'":;!?@()\-\/]{3,}/g;
    let m;
    while ((m = re.exec(data)) !== null) {
      const s = m[0].trim();
      if (/^(obj|endobj|stream|endstream|xref|trailer|startxref|null|true|false)$/i.test(s)) continue;
      // Must contain at least one vowel (filters base85/hex junk)
      if (!/[aeiouAEIOU]/.test(s)) continue;
      if (s.length >= 4) runs.push(s);
    }
    return runs.join(' ');
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function nextStream(raw, from) {
    let i = from;
    while (i < raw.length) {
      const idx = raw.indexOf('stream', i);
      if (idx === -1) return -1;
      if (idx >= 3 && raw.slice(idx - 3, idx) === 'end') { i = idx + 6; continue; }
      const ch = raw[idx + 6];
      if (ch === '\n' || ch === '\r') return idx;
      i = idx + 6;
    }
    return -1;
  }

  function toL1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 65536)
      s += String.fromCharCode(...bytes.subarray(i, i + 65536));
    return s;
  }

  function clean(text) {
    return text
      .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[^\x20-\x7E\n]/g, '')
      .trim();
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  const ApplyrCvParser = { parseResumeFile, extractTextFromPdf };
  if (typeof window !== 'undefined') window.ApplyrCvParser = ApplyrCvParser;
  if (typeof globalThis !== 'undefined') globalThis.ApplyrCvParser = ApplyrCvParser;
})();
