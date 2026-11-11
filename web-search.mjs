import { sanitizeUrl } from './page-summary.mjs';

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const MAX_RESPONSE_BYTES = 1_000_000;

function compactText(value, limit) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
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
