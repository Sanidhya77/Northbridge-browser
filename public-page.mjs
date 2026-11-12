import { lookup as systemLookup } from 'node:dns/promises';
import { get } from 'node:https';
import { BlockList, isIPv4 } from 'node:net';
import crypto from 'node:crypto';
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
const MAX_REDIRECTS = 4;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const ACCESS_CODES = new Set([401, 403, 407, 429, 451]);
const TEXT_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain']);
const CHALLENGE = /\bWAF\s*\||access denied|verify (?:that )?you are human|checking your browser|you can['’]t access this page right now|enable javascript and cookies to continue/i;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };

function plainText(value) {
  return value.replace(/<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'"<>])*>/g, ' ')
    .replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, name) => {
      if (!name.startsWith('#')) {
        const key = name.toLowerCase();
        return Object.hasOwn(ENTITIES, key) ? ENTITIES[key] : entity;
      }
      const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/\s+/g, ' ').trim();
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
  directResult
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

    if (!cleanExcerpt) {
      return {
        status: 'no_text',
        fallbackRan: true,
        evidence: 'rendered browser',
        label: 'rendered browser',
        directStatus,
        finalUrl: sanitizeUrl(finalUrl),
        title: pageTitle.slice(0, 220),
        ...(section?.trim() ? { sectionFound } : {})
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
      ...(section?.trim() ? { sectionFound } : {})
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

function readResponse(url, address, signal, request = get) {
  return new Promise((resolve, reject) => {
    // Keep the hostname for TLS certificate verification and pin the socket to the validated address.
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
        Accept: 'text/html, application/xhtml+xml, text/plain',
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
      if (page.challenge || status < 200 || status >= 300 || !TEXT_TYPES.has(type)) {
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
      try {
        for await (const chunk of response) {
          size += chunk.length;
          if (size > MAX_BYTES) {
            resolve({ ...page, tooLarge: true });
            return;
          }
          chunks.push(chunk);
        }
        resolve({ ...page, body: Buffer.concat(chunks).toString('utf8') });
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
  renderedFallback = false
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
    !Number.isInteger(maxChars) || maxChars < 200 || maxChars > 2000) {
    return result('invalid_input', { reason: 'Provide an HTTPS URL and an excerpt limit of 200–2000 characters.' });
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
      const page = await readResponse(target, addresses[0], signal, request);
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
            directResult: http
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
            directResult: { ...http, title: title.slice(0, 220) }
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

      return result('readable', {
        ...http, title: title.slice(0, 220), excerpt: excerptText.slice(0, maxChars),
        ...(section?.trim() ? { sectionFound } : {})
      });
    } catch (error) {
      const reason = typeof error.code === 'string' ? error.code : (error.name ?? String(error.code ?? ''));
      return result(signal.aborted ? 'timeout' : 'network_error', { reason });
    }
  }
}
