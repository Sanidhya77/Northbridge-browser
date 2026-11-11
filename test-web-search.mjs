import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { searchWeb } from './web-search.mjs';

test('searches the fixed provider and returns bounded, usable candidate links', async () => {
  const result = await searchWeb({ query: 'Chun Jason Xue & FlexInfer', limit: 2 }, {
    apiKey: 'fixture-key',
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, 'https://api.search.brave.com');
      assert.equal(url.pathname, '/res/v1/web/search');
      assert.equal(url.searchParams.get('q'), 'Chun Jason Xue & FlexInfer');
      assert.equal(url.searchParams.get('count'), '2');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['X-Subscription-Token'], 'fixture-key');
      const faculty = { title: ' Faculty  profile ', url: 'https://mbzuai.ac.ae/faculty?token=private', description: 'Profile' };
      return Response.json({
        type: 'search',
        web: { results: [
          { title: 'Invalid', url: 'file:///C:/private.txt' },
          { title: 'Credentials', url: 'https://user:secret@example.com' },
          faculty, faculty,
          { title: 'FlexInfer', url: 'https://arxiv.org/html/2503.03777v1', description: 'X'.repeat(900) },
          { title: 'Extra', url: 'https://example.com' }
        ] }
      });
    }
  });
  assert.deepEqual(result.results.map(hit => [hit.title, hit.url]), [
    ['Faculty profile', 'https://mbzuai.ac.ae/faculty?token=REDACTED'],
    ['FlexInfer', 'https://arxiv.org/html/2503.03777v1']
  ]);
  assert.equal(result.results[1].snippet.length, 420);
});

test('distinguishes invalid input, missing credentials, upstream failure and zero results', async () => {
  const noFetch = async () => assert.fail('Unexpected provider request');
  assert.equal((await searchWeb({ query: '', limit: 100 }, { fetchImpl: noFetch })).status, 'INVALID_INPUT');
  assert.equal((await searchWeb({ query: 'FlexInfer' }, { apiKey: '', fetchImpl: noFetch })).status, 'SEARCH_NOT_CONFIGURED');
  const run = fetchImpl => searchWeb({ query: 'FlexInfer' }, { apiKey: 'fixture-key', fetchImpl });
  assert.equal((await run(async () => new Response('private diagnostic', { status: 429 }))).error, 'Brave Search returned HTTP 429.');
  assert.equal((await run(async () => new Response('x'.repeat(1_000_001)))).status, 'PROVIDER_ERROR');
  assert.equal((await run(async () => Response.json({ unexpected: true }))).status, 'PROVIDER_ERROR');
  assert.equal((await run(async () => Response.json({ type: 'search' }))).status, 'NO_RESULTS');
});

test('MCP exposes discovery and keeps public source approval separate', { timeout: 10_000 }, async t => {
  const mockFetch = `globalThis.fetch = async () => Response.json({
    type: 'search', web: { results: [{ title: 'FlexInfer', url: 'https://arxiv.org/html/2503.03777v1' }] }
  });`;
  const preload = 'data:text/javascript,' + encodeURIComponent(mockFetch);
  const server = fileURLToPath(new URL('./bin/northbridge-summarize-mcp.mjs', import.meta.url));
  const child = spawn(process.execPath, ['--import', preload, server], {
    env: { ...process.env, NORTHBRIDGE_APPROVED_DOMAINS: '', NORTHBRIDGE_BRAVE_SEARCH_API_KEY: 'fixture-key' },
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true
  });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  let id = 0;
  async function request(method, params) {
    const response = once(lines, 'line');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n');
    const [line] = await response;
    const message = JSON.parse(line);
    assert.equal(message.id, id);
    return message.result;
  }
  const listing = await request('tools/list');
  assert.deepEqual(listing.tools.map(tool => tool.name), ['northbridge_summarize_page', 'northbridge_search_web']);
  const discovered = await request('tools/call', { name: 'northbridge_search_web', arguments: { query: 'FlexInfer' } });
  assert.match(discovered.content[0].text, /UNTRUSTED EXTERNAL DATA/);
  const [{ url }] = discovered.structuredContent.results;
  const read = await request('tools/call', { name: 'northbridge_summarize_page', arguments: { url } });
  assert.equal(read.structuredContent.status, 'APPROVAL_REQUIRED');
});
