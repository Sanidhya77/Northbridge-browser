import { lookup as systemLookup } from 'node:dns/promises';
import { get } from 'node:https';
import { BlockList, isIPv4 } from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { sanitizeUrl } from './page-summary.mjs';
import { createMcpClient } from './scopus-workflow.mjs';

const nonPublic = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3]
]) nonPublic.addSubnet(network, prefix);

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DOCX_BYTES = 4 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const ACCESS_CODES = new Set([401, 403, 407, 429, 451]);
const TEXT_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain']);
const DOCX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed'
]);
const CHALLENGE = /\bWAF\s*\||access denied|verify (?:that )?you are human|checking your browser|you can['’]t access this page right now|enable javascript and cookies to continue/i;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };

function unescapeEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, name) => {
    if (!name.startsWith('#')) {
      const key = name.toLowerCase();
      return Object.hasOwn(ENTITIES, key) ? ENTITIES[key] : entity;
    }
    const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  });
}

function plainText(value) {
  return unescapeEntities(value.replace(/<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'"<>])*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

export function extractHtmlLinks(html, targetUrl, attachmentQuery) {
  if (!html || typeof html !== 'string') return [];
  const cleanHtml = html.replace(/<!--[\s\S]*?-->|<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const links = [];
  const seen = new Set();
  const linkRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(cleanHtml)) !== null) {
    const attrs = match[1];
    const linkInner = match[2];
    const hrefMatch = attrs.match(/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = (hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || '').trim();
    if (!rawHref || /^(?:javascript|data|mailto|tel):/i.test(rawHref) || rawHref.startsWith('#')) continue;

    const unescapedHref = unescapeEntities(rawHref);
    let resolved;
    try {
      resolved = new URL(unescapedHref, targetUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'https:') continue;

    const cleanUrl = sanitizeUrl(resolved.href);
    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);

    const label = plainText(linkInner).slice(0, 140) || cleanUrl;

    const lastLinkEnd = cleanHtml.lastIndexOf('</a>', match.index);
    const start = Math.max(0, lastLinkEnd !== -1 ? lastLinkEnd + 4 : match.index - 200);
    const context = plainText(cleanHtml.slice(start, match.index));

    const preHtml = cleanHtml.slice(Math.max(0, match.index - 500), match.index);
    const isUnderAnnex = /\bannex\b/i.test(preHtml);
    const numMatch = label.match(/^(\d+)\./);
    const annexAlias = isUnderAnnex && numMatch ? `annex ${numMatch[1]}` : '';

    links.push({
      text: label,
      url: cleanUrl,
      context,
      annexAlias
    });
  }

  if (typeof attachmentQuery === 'string' && attachmentQuery.trim()) {
    const q = attachmentQuery.toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);
    return links.filter(l => {
      const textLower = l.text.toLowerCase();
      const urlLower = l.url.toLowerCase();
      const ctxLower = l.context.toLowerCase();
      const aliasLower = (l.annexAlias || '').toLowerCase();
      return textLower.includes(q) ||
             urlLower.includes(q) ||
             aliasLower === q ||
             aliasLower.includes(q) ||
             ctxLower.includes(q) ||
             (words.length > 1 && words.every(w => textLower.includes(w) || ctxLower.includes(w) || urlLower.includes(w) || aliasLower.includes(w)));
    }).map(({ text, url }) => ({ text, url })).slice(0, 10);
  }

  return links.map(({ text, url }) => ({ text, url })).slice(0, 10);
}

export function extractDocxText(buffer, { maxChars = 2000, section = '', maxDecompressedSize = MAX_DECOMPRESSED_BYTES } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    return { ok: false, status: 'invalid_docx', reason: 'Buffer is too small to be a valid DOCX file' };
  }

  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    return { ok: false, status: 'invalid_docx', reason: 'Invalid or corrupt DOCX archive: missing End of Central Directory' };
  }

  const cdCount = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (cdOffset + cdSize > buffer.length) {
    return { ok: false, status: 'invalid_docx', reason: 'Invalid or corrupt DOCX archive: central directory out of bounds' };
  }

  let xml = null;
  let offset = cdOffset;

  for (let i = 0; i < cdCount; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      return { ok: false, status: 'invalid_docx', reason: 'Invalid or corrupt DOCX archive: invalid central directory header' };
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const uncompSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);

    if (offset + 46 + nameLen > buffer.length) {
      return { ok: false, status: 'invalid_docx', reason: 'Invalid or corrupt DOCX archive: filename out of bounds' };
    }

    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if (name === 'word/document.xml') {
      if (uncompSize > maxDecompressedSize) {
        return { ok: false, status: 'too_large', reason: `DOCX uncompressed size ${uncompSize} exceeds limit ${maxDecompressedSize}` };
      }
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
        return { ok: false, status: 'invalid_docx', reason: 'Invalid or corrupt DOCX archive: invalid local file header' };
      }
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      if (dataStart + compSize > buffer.length) {
        return { ok: false, status: 'invalid_docx', reason: 'Invalid or corrupt DOCX archive: compressed stream out of bounds' };
      }
      const compressed = buffer.subarray(dataStart, dataStart + compSize);

      let decompressed;
      try {
        if (method === 0) {
          decompressed = compressed;
        } else if (method === 8) {
          decompressed = zlib.inflateRawSync(compressed, { maxOutputLength: maxDecompressedSize });
        } else {
          return { ok: false, status: 'invalid_docx', reason: `Unsupported compression method in DOCX: ${method}` };
        }
      } catch (err) {
        if (err.code === 'ERR_BUFFER_TOO_LARGE' || /output length/i.test(err.message)) {
          return { ok: false, status: 'too_large', reason: `DOCX decompressed size exceeds limit ${maxDecompressedSize}` };
        }
        return { ok: false, status: 'invalid_docx', reason: `Failed to decompress DOCX document.xml: ${err.message}` };
      }

      if (decompressed.length > maxDecompressedSize) {
        return { ok: false, status: 'too_large', reason: `DOCX decompressed size ${decompressed.length} exceeds limit ${maxDecompressedSize}` };
      }
      xml = decompressed.toString('utf8');
      break;
    }
  }

  if (!xml) {
    return { ok: false, status: 'invalid_docx', reason: 'Archive missing word/document.xml' };
  }

  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i);
  if (!bodyMatch) {
    return { ok: true, status: 'readable', title: '', text: '', excerpt: '' };
  }
  const body = bodyMatch[1];
  const blocks = [];
  let docTitle = '';

  const blockRegex = /<w:(p|tbl)\b[^>]*>([\s\S]*?)<\/w:\1>/gi;
  let match;
  while ((match = blockRegex.exec(body)) !== null) {
    const type = match[1];
    const content = match[2];

    if (type === 'p') {
      const pStyle = content.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i)?.[1] || '';
      const textPieces = [];
      const pieceRegex = /<w:(?:t\b[^>]*>([^<]*)<\/w:t|tab\b[^>]*\/?>|br\b[^>]*\/?>)/gi;
      let pm;
      while ((pm = pieceRegex.exec(content)) !== null) {
        if (pm[1] !== undefined) textPieces.push(pm[1]);
        else if (pm[0].includes('tab')) textPieces.push('\t');
        else if (pm[0].includes('br')) textPieces.push('\n');
      }
      const rawText = unescapeEntities(textPieces.join('')).replace(/[ \t]+/g, ' ').trim();
      if (rawText) {
        const isHeading = /heading|title/i.test(pStyle) || /^([I|V|X\d]+\.|\d+\.)\s+[A-Z]/i.test(rawText);
        if (isHeading) {
          blocks.push('### ' + rawText);
          if (!docTitle) docTitle = rawText;
        } else {
          blocks.push(rawText);
          if (!docTitle) docTitle = rawText.slice(0, 80);
        }
      }
    } else if (type === 'tbl') {
      const rows = [];
      const trRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi;
      let trm;
      while ((trm = trRegex.exec(content)) !== null) {
        const cells = [];
        const tcRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi;
        let tcm;
        while ((tcm = tcRegex.exec(trm[1])) !== null) {
          const cellPieces = [];
          const pieceRegex = /<w:(?:t\b[^>]*>([^<]*)<\/w:t|tab\b[^>]*\/?>|br\b[^>]*\/?>)/gi;
          let pm;
          while ((pm = pieceRegex.exec(tcm[1])) !== null) {
            if (pm[1] !== undefined) cellPieces.push(pm[1]);
            else if (pm[0].includes('tab')) cellPieces.push(' ');
            else if (pm[0].includes('br')) cellPieces.push(' ');
          }
          cells.push(unescapeEntities(cellPieces.join('')).replace(/\s+/g, ' ').trim());
        }
        if (cells.some(c => c.length > 0)) {
          rows.push('| ' + cells.join(' | ') + ' |');
        }
      }
      if (rows.length > 0) {
        blocks.push(rows.join('\n'));
      }
    }
  }

  const fullText = blocks.join('\n\n');
  const terms = section ? section.toLowerCase().trim() : '';
  let excerptText = fullText;
  let sectionFound = false;

  if (terms) {
    const lines = fullText.split('\n');
    const headingIdx = lines.findIndex(l => l.startsWith('###') && l.toLowerCase().includes(terms));
    if (headingIdx !== -1) {
      sectionFound = true;
      let endIdx = lines.length;
      for (let j = headingIdx + 1; j < lines.length; j++) {
        if (lines[j].startsWith('###')) {
          endIdx = j;
          break;
        }
      }
      excerptText = lines.slice(headingIdx, endIdx).join('\n').trim();
    } else {
      const matchIdx = lines.findIndex(l => l.toLowerCase().includes(terms));
      if (matchIdx !== -1) {
        sectionFound = true;
        excerptText = lines.slice(matchIdx).join('\n').trim();
      }
    }
  }

  return {
    ok: true,
    status: 'readable',
    title: docTitle.slice(0, 220),
    text: fullText,
    excerpt: excerptText.slice(0, maxChars),
    ...(section ? { sectionFound } : {})
  };
}

function extractHtml(html, section) {
  const content = html.replace(/<!--[\s\S]*?-->|<(script|style|template|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const title = plainText(content.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? '');
  const body = content.match(/<body\b[^>]*>([\s\S]*)/i)?.[1] ??
    content.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, ' ');
  const main = body.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/i)?.[2] ?? body;
  const cleaned = main.replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const text = plainText(cleaned);
  const heading = section && Array.from(cleaned.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi))
    .find(match => plainText(match[2]).toLowerCase().includes(section.toLowerCase()));
  const excerptText = heading
    ? plainText(heading[0] + cleaned.slice(heading.index + heading[0].length).split(/<h[1-6]\b/i, 1)[0])
    : text;
  return { title, text, excerptText, sectionFound: Boolean(heading) };
}

export function isHostAllowed(host, allowedDomainsStr) {
  if (!allowedDomainsStr || typeof allowedDomainsStr !== 'string') return false;
  const list = allowedDomainsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const h = (host || '').toLowerCase().trim();
  if (!h) return false;
  for (const pattern of list) {
    if (pattern === '*' || h === pattern) return true;
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      if (h === base || h.endsWith('.' + base)) return true;
    }
    if (h.endsWith('.' + pattern)) return true;
  }
  return false;
}

export function extractSectionFromSnapshot(snapshotText, section) {
  if (!snapshotText || typeof snapshotText !== 'string') {
    return { title: '', excerpt: '', sectionFound: false };
  }
  const lines = snapshotText.split('\n');
  let title = '';
  for (const line of lines) {
    const headingMatch = line.match(/^[\s-]*heading\s+"([^"]+)"/i);
    if (headingMatch && !title) {
      title = headingMatch[1].trim();
      break;
    }
  }

  const terms = section ? section.toLowerCase().trim() : '';
  let startIndex = 0;
  let endIndex = lines.length;
  let sectionFound = false;

  if (terms) {
    const headingIdx = lines.findIndex(l => {
      const m = l.match(/^[\s-]*heading\s+"([^"]+)"/i);
      return m && m[1].toLowerCase().includes(terms);
    });
    if (headingIdx !== -1) {
      startIndex = headingIdx;
      sectionFound = true;
      const levelMatch = lines[headingIdx].match(/level=([1-6])/i);
      const level = levelMatch ? parseInt(levelMatch[1], 10) : 2;
      for (let i = headingIdx + 1; i < lines.length; i++) {
        const nextHeading = lines[i].match(/^[\s-]*heading\s+"([^"]+)"(?:\s*\[[^\]]*level=([1-6])[^\]]*\])?/i);
        if (nextHeading) {
          const nextLevel = nextHeading[2] ? parseInt(nextHeading[2], 10) : 2;
          if (nextLevel <= level) {
            endIndex = i;
            break;
          }
        }
      }
    } else {
      const lineIdx = lines.findIndex(l => l.toLowerCase().includes(terms));
      if (lineIdx !== -1) {
        startIndex = Math.max(0, lineIdx - 1);
        sectionFound = true;
      }
    }
  }

  const sectionLines = lines.slice(startIndex, endIndex);
  const outputParts = [];
  let currentHeaders = [];
  let currentCells = [];

  function flushTable() {
    if (currentHeaders.length > 0 && currentCells.length > 0) {
      const colCount = currentHeaders.length;
      const tableLines = [];
      tableLines.push('| ' + currentHeaders.join(' | ') + ' |');
      tableLines.push('| ' + currentHeaders.map(() => '---').join(' | ') + ' |');
      for (let i = 0; i < currentCells.length; i += colCount) {
        const row = currentCells.slice(i, i + colCount);
        while (row.length < colCount) row.push('');
        tableLines.push('| ' + row.join(' | ') + ' |');
      }
      outputParts.push(tableLines.join('\n'));
    } else if (currentCells.length > 0) {
      outputParts.push(currentCells.join(' - '));
    }
    currentHeaders = [];
    currentCells = [];
  }

  for (const line of sectionLines) {
    const colMatch = line.match(/^[\s-]*columnheader\s+"([^"]*)"/i);
    if (colMatch) {
      currentHeaders.push(colMatch[1].trim());
      continue;
    }
    const cellMatch = line.match(/^[\s-]*cell\s+"([^"]*)"/i);
    if (cellMatch) {
      currentCells.push(cellMatch[1].trim());
      continue;
    }
    if (currentHeaders.length > 0 && currentCells.length > 0) {
      flushTable();
    }
    const headingMatch = line.match(/^[\s-]*heading\s+"([^"]+)"/i);
    if (headingMatch) {
      outputParts.push(`### ${headingMatch[1].trim()}`);
      continue;
    }
    const textMatch = line.match(/^[\s-]*(?:StaticText|paragraph)\s+"([^"]+)"/i);
    if (textMatch) {
      const text = textMatch[1].trim();
      if (text && !outputParts.includes(text)) outputParts.push(text);
    }
  }
  flushTable();

  return { title, excerpt: outputParts.join('\n\n').trim(), sectionFound };
}

async function runRenderedFallback({
  targetUrl,
  section,
  maxChars,
  allowedDomains,
  browserRunner,
  createMcpClientImpl = createMcpClient,
  directStatus,
  directResult,
  attachment
}) {
  const host = targetUrl.hostname;
  if (!isHostAllowed(host, allowedDomains)) {
    return {
      status: 'policy_blocked',
      fallbackRan: false,
      directStatus,
      reason: `Domain '${host}' is not in the allowed domains list`
    };
  }

  const namespace = 'nbr_fb_' + crypto.randomBytes(6).toString('hex');

  if (typeof browserRunner === 'function') {
    const runnerRes = await browserRunner({
      url: targetUrl.href,
      section,
      maxChars,
      allowedDomains,
      namespace,
      session: namespace,
      directStatus
    });
    const res = {
      evidence: 'rendered browser',
      label: 'rendered browser',
      directStatus,
      fallbackRan: true,
      ...runnerRes
    };
    if (res.status === 'no_text') {
      delete res.excerpt;
    }
    return res;
  }

  let client = null;
  try {
    client = createMcpClientImpl({ allowedDomains, namespace });
    await client.init();
    const openRes = await client.callTool('agent_browser_open', {
      url: targetUrl.href,
      namespace,
      session: namespace
    });
    if (openRes.raw?.isError || openRes.isError) {
      const errMsg = openRes.raw?.content?.[0]?.text || openRes.error || openRes.text || 'Failed to open page in Agent Browser';
      return {
        status: errMsg.includes('allowed domains') ? 'policy_blocked' : 'browser_error',
        fallbackRan: true,
        directStatus,
        reason: errMsg
      };
    }

    const finalUrl = openRes.raw?.structuredContent?.response?.data?.url || targetUrl.href;
    const finalHost = new URL(finalUrl).hostname;
    if (!isHostAllowed(finalHost, allowedDomains)) {
      return {
        status: 'policy_blocked',
        fallbackRan: true,
        directStatus,
        finalUrl: sanitizeUrl(finalUrl),
        reason: `Domain '${finalHost}' is not in the allowed domains list`
      };
    }

    const snapRes = await client.callTool('agent_browser_snapshot', {
      namespace,
      session: namespace
    });

    if (snapRes.raw?.isError || snapRes.isError) {
      const errMsg = snapRes.raw?.content?.[0]?.text || snapRes.error || snapRes.text || 'Agent Browser snapshot failed';
      return {
        status: 'browser_error',
        fallbackRan: true,
        directStatus,
        evidence: 'rendered browser',
        label: 'rendered browser',
        finalUrl: sanitizeUrl(finalUrl),
        reason: errMsg
      };
    }

    const snapshotText = snapRes.text || snapRes.raw?.content?.[0]?.text || '';
    const { title: snapTitle, excerpt, sectionFound } = extractSectionFromSnapshot(snapshotText, section);
    const docTitle = (
      openRes.raw?.structuredContent?.response?.data?.title ||
      openRes.structuredContent?.response?.data?.title ||
      openRes.data?.title ||
      openRes.title ||
      openRes.raw?.title ||
      ''
    ).trim();
    const pageTitle = docTitle || snapTitle || directResult?.title || '';
    const cleanExcerpt = (excerpt || '').trim().slice(0, maxChars);

    let attachments;
    if (attachment !== undefined) {
      const q = String(attachment).toLowerCase().trim();
      const words = q.split(/\s+/).filter(Boolean);
      const snapLinks = [];
      const seenSnapUrls = new Set();
      const lines = snapshotText.split('\n');
      for (const line of lines) {
        const linkMatch = line.match(/^[\s-]*link\s+"([^"]+)"(?:\s*\[[^\]]*url=([^\s\]]+)[^\]]*\])?/i);
        if (linkMatch) {
          const lText = linkMatch[1];
          const lUrl = linkMatch[2];
          if (lUrl && lUrl.startsWith('https://')) {
            const cleanLUrl = sanitizeUrl(lUrl);
            if (!seenSnapUrls.has(cleanLUrl)) {
              seenSnapUrls.add(cleanLUrl);
              snapLinks.push({ text: lText, url: cleanLUrl });
            }
          }
        }
      }
      attachments = snapLinks.filter(l => {
        const t = l.text.toLowerCase();
        const u = l.url.toLowerCase();
        return t.includes(q) || u.includes(q) || (words.length > 1 && words.every(w => t.includes(w) || u.includes(w)));
      }).slice(0, 10);
    }

    if (!cleanExcerpt) {
      return {
        status: 'no_text',
        fallbackRan: true,
        evidence: 'rendered browser',
        label: 'rendered browser',
        directStatus,
        finalUrl: sanitizeUrl(finalUrl),
        title: pageTitle.slice(0, 220),
        ...(section?.trim() ? { sectionFound } : {}),
        ...(attachments !== undefined ? { attachments } : {})
      };
    }

    return {
      status: 'readable',
      fallbackRan: true,
      evidence: 'rendered browser',
      label: 'rendered browser',
      directStatus,
      finalUrl: sanitizeUrl(finalUrl),
      title: pageTitle.slice(0, 220),
      excerpt: cleanExcerpt,
      ...(section?.trim() ? { sectionFound } : {}),
      ...(attachments !== undefined ? { attachments } : {})
    };
  } catch (err) {
    return {
      status: 'browser_error',
      fallbackRan: true,
      directStatus,
      reason: err.message || 'Browser execution failed'
    };
  } finally {
    if (client) {
      try {
        await client.callTool('agent_browser_close', { namespace, session: namespace });
      } catch {}
      try {
        await client.close();
      } catch {}
    }
  }
}

function readResponse(url, address, signal, request = get, { extractDocx = false } = {}) {
  return new Promise((resolve, reject) => {
    // Keep the hostname for TLS certificate verification and pin the socket to the validated address.
    const isDocxAllowed = Boolean(extractDocx);
    const req = request(url, {
      agent: false,
      family: 4,
      signal,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address, family: 4 }]);
        else callback(null, address, 4);
      },
      headers: {
        'User-Agent': 'NorthbridgeBrowser/1.0',
        Accept: isDocxAllowed
          ? 'text/html, application/xhtml+xml, text/plain, application/vnd.openxmlformats-officedocument.wordprocessingml.document, */*'
          : 'text/html, application/xhtml+xml, text/plain',
        'Accept-Encoding': 'identity'
      }
    }, async response => {
      const status = response.statusCode;
      const type = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      const encoding = response.headers['content-encoding'];
      const page = {
        status, location: response.headers.location, type, body: '',
        challenge: response.headers['cf-mitigated'] === 'challenge'
      };
      const isTextType = TEXT_TYPES.has(type);
      const isDocxType = isDocxAllowed && (DOCX_TYPES.has(type) || (typeof url === 'object' && url?.pathname?.toLowerCase().endsWith('.docx')));
      if (page.challenge || status < 200 || status >= 300 || (!isTextType && !isDocxType)) {
        response.destroy();
        resolve(page);
        return;
      }
      if (encoding && encoding !== 'identity') {
        response.destroy();
        resolve({ ...page, unsupportedEncoding: true });
        return;
      }
      const chunks = [];
      let size = 0;
      const maxLimit = isDocxType ? MAX_DOCX_BYTES : MAX_BYTES;
      try {
        for await (const chunk of response) {
          size += chunk.length;
          if (size > maxLimit) {
            resolve({ ...page, tooLarge: true });
            return;
          }
          chunks.push(chunk);
        }
        if (isDocxType) {
          resolve({ ...page, buffer: Buffer.concat(chunks), isDocx: true });
        } else {
          resolve({ ...page, body: Buffer.concat(chunks).toString('utf8') });
        }
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

export async function readPublicPage({
  url,
  section,
  maxChars = 1000,
  rendered_fallback = false,
  renderedFallback = false,
  attachment,
  attachment_name,
  extract_docx = false,
  extractDocx = false
} = {}, {
  resolve4,
  lookup: customLookup,
  request = get,
  signal: callerSignal,
  createMcpClient: createMcpClientImpl = createMcpClient,
  browserRunner,
  allowedDomains = process.env.AGENT_BROWSER_ALLOWED_DOMAINS || process.env.NORTHBRIDGE_APPROVED_DOMAINS || '127.0.0.1'
} = {}) {
  const start = Date.now();
  const fallbackEnabled = Boolean(rendered_fallback || renderedFallback);
  const isDocxAllowed = Boolean(extract_docx || extractDocx);
  const attachmentQuery = attachment ?? attachment_name;
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, AbortSignal.timeout(12_000)])
    : AbortSignal.timeout(12_000);
  const defaultLookup = async hostname => {
    const entries = await systemLookup(hostname, { family: 4, all: true, signal });
    return entries.map(entry => entry.address);
  };
  const lookup = resolve4 ?? customLookup ?? defaultLookup;
  let target = typeof url === 'string' && url.length <= 4096 && URL.canParse(url) ? new URL(url) : null;
  let requests = 0;
  const result = (status, details = {}) => ({
    status, finalUrl: target ? sanitizeUrl(target.href.split('#', 1)[0]) : null,
    requests, elapsedMs: Date.now() - start, screenshots: 0, ...details
  });

  if (!target || (section !== undefined && (typeof section !== 'string' || section.length > 120)) ||
    !Number.isInteger(maxChars) || maxChars < 200 || maxChars > 5000) {
    return result('invalid_input', { reason: 'Provide an HTTPS URL and an excerpt limit of 200–5000 characters.' });
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    target.hash = '';
    const host = target.hostname;
    if (target.protocol !== 'https:' || target.port || target.username || target.password ||
      !/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(host) ||
      /\.(?:local|localhost|internal|lan|test|example|invalid|onion|home\.arpa)$/i.test(host)) {
      return result('policy_blocked', { reason: 'Only public HTTPS hostnames on port 443 are supported.' });
    }
    try {
      const addresses = await new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason ?? new DOMException('This operation was aborted', 'AbortError'));
          return;
        }
        const onAbort = () => reject(signal.reason ?? new DOMException('This operation was aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve()
          .then(() => lookup(host))
          .then(res => {
            signal.removeEventListener('abort', onAbort);
            resolve(res);
          }, err => {
            signal.removeEventListener('abort', onAbort);
            reject(err);
          });
      });
      if (!addresses.length || addresses.some(address => !isIPv4(address) || nonPublic.check(address))) {
        return result('policy_blocked', { reason: 'The hostname did not resolve exclusively to public IPv4 addresses.' });
      }
      signal.throwIfAborted();
      requests++;
      const page = await readResponse(target, addresses[0], signal, request, { extractDocx: isDocxAllowed });
      const http = { httpStatus: page.status };
      if (page.challenge || ACCESS_CODES.has(page.status)) return result('blocked', http);
      if (REDIRECTS.has(page.status) && page.location) {
        if (hop === MAX_REDIRECTS || !URL.canParse(page.location, target)) {
          return result('redirect_error', { httpStatus: page.status });
        }
        target = new URL(page.location, target);
        continue;
      }
      if (page.status < 200 || page.status >= 300) return result('http_error', http);
      if (page.tooLarge) return result('too_large', http);

      if (page.isDocx) {
        const docxRes = extractDocxText(page.buffer, { maxChars, section, maxDecompressedSize: MAX_DECOMPRESSED_BYTES });
        if (!docxRes.ok) {
          return result(docxRes.status, { ...http, reason: docxRes.reason });
        }
        return result('readable', {
          ...http,
          title: docxRes.title,
          format: 'docx',
          excerpt: docxRes.excerpt,
          ...(section?.trim() ? { sectionFound: docxRes.sectionFound } : {})
        });
      }

      const isUnsupported = !page.body && (!TEXT_TYPES.has(page.type) || page.unsupportedEncoding);
      const isNoText = !page.body && TEXT_TYPES.has(page.type) && !page.unsupportedEncoding;

      if (isUnsupported || isNoText) {
        const directStatus = isUnsupported ? 'unsupported_content' : 'no_text';
        if (fallbackEnabled) {
          const fallbackRes = await runRenderedFallback({
            targetUrl: target,
            section: section?.trim(),
            maxChars,
            allowedDomains,
            browserRunner,
            createMcpClientImpl,
            directStatus,
            directResult: http,
            attachment: attachmentQuery
          });
          return result(fallbackRes.status, {
            ...http,
            directStatus,
            fallbackRan: fallbackRes.fallbackRan ?? true,
            ...fallbackRes
          });
        }
        return result(directStatus, http);
      }

      const { title, text, excerptText = text, sectionFound = false } = page.type === 'text/plain'
        ? { title: '', text: page.body.replace(/\s+/g, ' ').trim() }
        : extractHtml(page.body, section?.trim());

      if (CHALLENGE.test(title) || /^just a moment[.!…\s]*$/i.test(title) || CHALLENGE.test(text.slice(0, 300))) {
        return result('blocked', { ...http, title: title.slice(0, 220) });
      }

      if (!text) {
        if (fallbackEnabled) {
          const fallbackRes = await runRenderedFallback({
            targetUrl: target,
            section: section?.trim(),
            maxChars,
            allowedDomains,
            browserRunner,
            createMcpClientImpl,
            directStatus: 'no_text',
            directResult: { ...http, title: title.slice(0, 220) },
            attachment: attachmentQuery
          });
          return result(fallbackRes.status, {
            ...http,
            directStatus: 'no_text',
            fallbackRan: fallbackRes.fallbackRan ?? true,
            ...fallbackRes
          });
        }
        return result('no_text', http);
      }

      const attachments = attachmentQuery !== undefined ? extractHtmlLinks(page.body, target, attachmentQuery) : undefined;

      return result('readable', {
        ...http, title: title.slice(0, 220), excerpt: excerptText.slice(0, maxChars),
        ...(section?.trim() ? { sectionFound } : {}),
        ...(attachments !== undefined ? { attachments } : {})
      });
    } catch (error) {
      const reason = typeof error.code === 'string' ? error.code : (error.name ?? String(error.code ?? ''));
      return result(signal.aborted ? 'timeout' : 'network_error', { reason });
    }
  }
}
