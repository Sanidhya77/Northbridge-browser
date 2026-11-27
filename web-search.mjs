import { sanitizeUrl } from './page-summary.mjs';

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const LLM_CONTEXT_ENDPOINT = 'https://api.search.brave.com/res/v1/llm/context';
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_SOURCES = 2;
const MAX_EXCERPT_CHARS = 600;

function compactText(value, limit) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function matchesSite(hostname, site) {
  return hostname === site || hostname.endsWith('.' + site);
}

export function stripTrackingParams(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  try {
    const u = new URL(urlStr);
    u.hash = '';
    const keys = Array.from(u.searchParams.keys());
    for (const k of keys) {
      if (/^(?:utm_[a-z_]+|fbclid|gclid|ref|source|campaign)$/i.test(k)) {
        u.searchParams.delete(k);
      }
    }
    return u.toString();
  } catch {
    return urlStr;
  }
}

export function normalizeUrlForMatch(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  try {
    const u = new URL(urlStr);
    u.hash = '';
    const keys = Array.from(u.searchParams.keys());
    for (const k of keys) {
      if (/^(?:utm_[a-z_]+|fbclid|gclid|ref|source|campaign)$/i.test(k)) {
        u.searchParams.delete(k);
      }
    }
    const cleanSearch = u.searchParams.toString();
    const pathname = u.pathname.replace(/\/+$/, '') || '/';
    return (u.origin + pathname + (cleanSearch ? '?' + cleanSearch : '')).toLowerCase();
  } catch {
    return urlStr.trim().toLowerCase();
  }
}

function extractSmallestRowPassage(snippets, searchTerms) {
  const terms = searchTerms
    .map(t => String(t || '').toLowerCase().trim())
    .filter(t => t.length > 1);

  let bestPassage = null;
  let bestScore = 0;

  for (const snippet of snippets) {
    if (!snippet || typeof snippet !== 'string') continue;
    const lines = snippet.split('\n').map(l => l.trim()).filter(Boolean);
    const tableLines = lines.filter(l => l.startsWith('|') && l.endsWith('|'));

    if (tableLines.length >= 3) {
      const header = tableLines[0];
      const separator = tableLines[1];
      const rows = tableLines.slice(2);

      const scoredRows = rows.map(r => {
        let rowScore = 0;
        for (const t of terms) {
          if (r.toLowerCase().includes(t)) rowScore += 3;
        }
        return { row: r, score: rowScore };
      });

      const matchingRows = scoredRows.filter(sr => sr.score > 0);
      let headerScore = 0;
      for (const t of terms) {
        if (header.toLowerCase().includes(t)) headerScore += 2;
      }

      if (matchingRows.length > 0) {
        const totalScore = matchingRows.reduce((a, b) => a + b.score, 0) + headerScore;
        const passage = [header, separator, ...matchingRows.map(m => m.row)].join('\n');
        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestPassage = passage;
        }
      } else if (headerScore > 0) {
        if (headerScore > bestScore) {
          bestScore = headerScore;
          bestPassage = tableLines.join('\n');
        }
      }
    } else {
      let lineScore = 0;
      for (const t of terms) {
        if (snippet.toLowerCase().includes(t)) lineScore += 1;
      }
      if (lineScore > bestScore && !bestPassage) {
        bestScore = lineScore;
        bestPassage = compactText(snippet, MAX_EXCERPT_CHARS);
      }
    }
  }

  return bestScore > 0 ? bestPassage : null;
}

export async function searchWeb({ query, limit = 5 } = {}, {
  apiKey = process.env.NORTHBRIDGE_BRAVE_SEARCH_API_KEY,
  fetchImpl = globalThis.fetch
} = {}) {
  const terms = typeof query === 'string' ? query.trim() : '';
  const fail = (status, error) => ({ ok: false, provider: 'Brave Search', status, error });
  if (!terms || terms.length > 600 || terms.split(/\s+/).length > 75 ||
      !Number.isInteger(limit) || limit < 1 || limit > 10) {
    return fail('INVALID_INPUT', 'Provide a query of 1–600 characters and at most 75 words, with a result limit of 1–10.');
  }
  if (!apiKey?.trim()) {
    return fail('SEARCH_NOT_CONFIGURED', 'Set NORTHBRIDGE_BRAVE_SEARCH_API_KEY in the Northbridge MCP server environment.');
  }

  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ q: terms, count: String(limit), result_filter: 'web', text_decorations: 'false' });
  let body;
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey.trim() },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      await response.body?.cancel();
      return fail('PROVIDER_ERROR', `Brave Search returned HTTP ${response.status}.`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_RESPONSE_BYTES) return fail('PROVIDER_ERROR', 'Brave Search returned an oversized response.');
      chunks.push(chunk);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body?.type !== 'search' || (body.web !== undefined && !Array.isArray(body.web?.results))) {
      return fail('PROVIDER_ERROR', 'Brave Search returned an unexpected response.');
    }
  } catch (err) {
    const status = err.name === 'TimeoutError' ? 'SEARCH_TIMEOUT' : 'PROVIDER_ERROR';
    return fail(status, 'Could not read a valid response from Brave Search.');
  }

  const results = [];
  const seen = new Set();
  for (const hit of body.web?.results ?? []) {
    const title = compactText(hit?.title, 220);
    const target = typeof hit?.url === 'string' && URL.canParse(hit.url) ? new URL(hit.url) : null;
    if (!title || !target || !['https:', 'http:'].includes(target.protocol) ||
        target.username || target.password) continue;
    const source = sanitizeUrl(target.href);
    if (seen.has(source)) continue;
    seen.add(source);
    results.push({ title, url: source, snippet: compactText(hit.description, 420) });
    if (results.length === limit) break;
  }
  return { ok: true, provider: 'Brave Search', status: results.length ? 'OK' : 'NO_RESULTS', results };
}

/**
 * Opt-in indexed-excerpt mode: calls Brave's LLM Context API to get
 * at most two source URLs with one short relevant excerpt per source.
 *
 * Indexed excerpts are leads for verification with northbridge_read_public_page.
 */
export async function searchWebWithContext({
  query,
  limit = MAX_SOURCES,
  site,
  target_url,
  targetUrl,
  section
} = {}, {
  apiKey = process.env.NORTHBRIDGE_BRAVE_SEARCH_API_KEY,
  fetchImpl = globalThis.fetch
} = {}) {
  const terms = typeof query === 'string' ? query.trim() : '';
  const explicitTarget = (target_url || targetUrl || '').trim();
  const explicitSection = (section || '').trim();
  const domain = typeof site === 'string' ? site.trim().toLowerCase() : '';
  const fail = (status, error) => ({ ok: false, provider: 'Brave LLM Context', status, error, sources: [] });
  if ((!terms && !explicitTarget) || terms.length > 600 || terms.split(/\s+/).length > 75 ||
      !Number.isInteger(limit) || limit < 1 || limit > 10) {
    return fail('INVALID_INPUT', 'Provide a query of 1-600 characters and at most 75 words, with a result limit of 1-10.');
  }
  if (site !== undefined && (domain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(domain))) {
    return fail('INVALID_INPUT', 'Provide site as a hostname, such as example.edu.');
  }
  const targetPage = explicitTarget && URL.canParse(explicitTarget) ? new URL(explicitTarget) : null;
  if (domain && explicitTarget && (!targetPage || !matchesSite(targetPage.hostname, domain))) {
    return fail('INVALID_INPUT', 'The target URL must belong to the requested site.');
  }
  if (!apiKey?.trim()) {
    return fail('SEARCH_NOT_CONFIGURED', 'Set NORTHBRIDGE_BRAVE_SEARCH_API_KEY in the Northbridge MCP server environment.');
  }

  const url = new URL(LLM_CONTEXT_ENDPOINT);
  const sourceLimit = Math.min(limit, MAX_SOURCES);

  let braveQuery = domain ? 'site:' + domain + ' ' + terms : terms;
  if (targetPage) {
    const sitePath = (targetPage.hostname + targetPage.pathname).replace(/\/+$/, '');
    const searchKeywords = [explicitSection, terms].filter(Boolean).join(' ').trim();
    if (!terms.includes(sitePath) || domain) {
      braveQuery = ('site:' + sitePath + ' ' + searchKeywords).trim();
    }
  }

  url.search = new URLSearchParams({
    q: (domain ? braveQuery.split(/\s+/).slice(0, 75).join(' ') : braveQuery).slice(0, 600),
    maximum_number_of_urls: explicitTarget ? '5' : String(sourceLimit),
    maximum_number_of_tokens: explicitTarget ? '2048' : '1024',
    maximum_number_of_tokens_per_url: explicitTarget ? '1024' : '512',
    enable_source_metadata: 'true',
    ...(domain ? { operators_fallback: 'false' } : {})
  });
  let body;
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey.trim() },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) {
      await response.body?.cancel();
      return fail('PROVIDER_ERROR', `Brave LLM Context returned HTTP ${response.status}.`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_RESPONSE_BYTES) return fail('PROVIDER_ERROR', 'Brave LLM Context returned an oversized response.');
      chunks.push(chunk);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    const status = err.name === 'TimeoutError' ? 'SEARCH_TIMEOUT' : 'PROVIDER_ERROR';
    return fail(status, 'Could not read a valid response from Brave LLM Context.');
  }

  const items = body?.grounding?.generic;
  if (!Array.isArray(items)) {
    return fail('PROVIDER_ERROR', 'Brave LLM Context returned an unexpected response.');
  }

  if (explicitTarget) {
    const normalizedTarget = normalizeUrlForMatch(explicitTarget);
    const matchedItem = items.find(item => typeof item?.url === 'string' && normalizeUrlForMatch(item.url) === normalizedTarget);
    if (!matchedItem) {
      return {
        ok: true,
        provider: 'Brave LLM Context',
        status: 'NOT_FOUND',
        sources: [{
          label: 'indexed excerpt',
          title: '',
          url: sanitizeUrl(stripTrackingParams(explicitTarget)),
          excerpt: 'not found in indexed evidence'
        }]
      };
    }

    const metadata = matchedItem.url && body.sources && Object.hasOwn(body.sources, matchedItem.url)
      ? body.sources[matchedItem.url] : undefined;
    const title = compactText(matchedItem.title, 220) || compactText(metadata?.title, 220);
    const seconds = metadata?.fetched_content_timestamp;
    const providerFetchedAt = Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 8_640_000_000_000
      ? new Date(seconds * 1000).toISOString() : null;

    const searchKeywords = [
      explicitSection,
      terms,
      ...(explicitSection ? explicitSection.split(/\band\b|\bor\b|,/i) : []),
      ...terms.split(/\s+/).filter(w => w.length >= 3 && !/^(?:for|the|and|with|from|this|that|what|when|how)$/i.test(w))
    ].map(s => s.trim()).filter(Boolean);

    const smallestPassage = extractSmallestRowPassage(matchedItem.snippets || [], searchKeywords);
    const excerpt = smallestPassage || 'not found in indexed evidence';

    return {
      ok: true,
      provider: 'Brave LLM Context',
      status: smallestPassage ? 'OK' : 'NOT_FOUND',
      sources: [{
        label: 'indexed excerpt',
        title,
        url: sanitizeUrl(stripTrackingParams(matchedItem.url || explicitTarget)),
        excerpt,
        ...(providerFetchedAt ? { providerFetchedAt } : {})
      }]
    };
  }

  const seen = new Set();
  const sources = [];
  for (const item of items) {
    const metadata = typeof item?.url === 'string' && body.sources && Object.hasOwn(body.sources, item.url)
      ? body.sources[item.url] : undefined;
    const title = compactText(item?.title, 220) || compactText(metadata?.title, 220);
    const target = typeof item?.url === 'string' && URL.canParse(item.url) ? new URL(item.url) : null;
    if (!title || !target || !['https:', 'http:'].includes(target.protocol) || target.username || target.password) continue;
    if (domain && !matchesSite(target.hostname, domain)) continue;
    const source = sanitizeUrl(target.href);
    if (seen.has(source)) continue;
    const snippet = Array.isArray(item.snippets) && item.snippets.find(text => typeof text === 'string' && text.trim());
    const excerpt = compactText(snippet, MAX_EXCERPT_CHARS);
    if (!excerpt) continue;
    seen.add(source);
    const seconds = metadata?.fetched_content_timestamp;
    const providerFetchedAt = Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 8_640_000_000_000
      ? new Date(seconds * 1000).toISOString() : null;
    sources.push({
      label: 'indexed excerpt',
      title,
      url: source,
      excerpt,
      ...(providerFetchedAt ? { providerFetchedAt } : {})
    });
    if (sources.length === sourceLimit) break;
  }
  return {
    ok: true,
    provider: 'Brave LLM Context',
    status: sources.length ? 'OK' : 'NO_RESULTS',
    sources
  };
}
