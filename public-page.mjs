import { lookup as systemLookup } from 'node:dns/promises';
import { get } from 'node:https';
import { BlockList, isIPv4 } from 'node:net';
import { sanitizeUrl } from './page-summary.mjs';

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

export async function readPublicPage({ url, section, maxChars = 1000 } = {}, {
  resolve4, lookup: customLookup, request = get, signal: callerSignal
} = {}) {
  const start = Date.now();
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
      if (!page.body) return result(TEXT_TYPES.has(page.type) && !page.unsupportedEncoding ? 'no_text' : 'unsupported_content', http);

      const { title, text, excerptText = text, sectionFound = false } = page.type === 'text/plain'
        ? { title: '', text: page.body.replace(/\s+/g, ' ').trim() }
        : extractHtml(page.body, section?.trim());
      if (CHALLENGE.test(title) || /^just a moment[.!…\s]*$/i.test(title) || CHALLENGE.test(text.slice(0, 300))) {
        return result('blocked', { ...http, title: title.slice(0, 220) });
      }
      if (!text) return result('no_text', http);
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
