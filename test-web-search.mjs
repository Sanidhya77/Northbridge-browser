import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { searchWeb, searchWebWithContext } from './web-search.mjs';

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
        web: {
          results: [
            { title: 'Invalid', url: 'file:///C:/private.txt' },
            { title: 'Credentials', url: 'https://user:secret@example.com' },
            faculty, faculty,
            { title: 'FlexInfer', url: 'https://arxiv.org/html/2503.03777v1', description: 'X'.repeat(900) },
            { title: 'Extra', url: 'https://example.com' }
          ]
        }
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
  assert.deepEqual(listing.tools.map(tool => tool.name), [
    'northbridge_summarize_page', 'northbridge_search_web', 'northbridge_read_public_page'
  ]);
  const discovered = await request('tools/call', { name: 'northbridge_search_web', arguments: { query: 'FlexInfer' } });
  assert.match(discovered.content[0].text, /UNTRUSTED EXTERNAL DATA/);
  const [{ url }] = discovered.structuredContent.results;
  const read = await request('tools/call', { name: 'northbridge_summarize_page', arguments: { url } });
  assert.equal(read.structuredContent.status, 'APPROVAL_REQUIRED');
  const publicRead = await request('tools/call', { name: 'northbridge_read_public_page', arguments: { url: 'https://127.0.0.1/' } });
  assert.equal(publicRead.content.length, 1);
  assert.equal(publicRead.structuredContent, undefined);
  assert.match(publicRead.content[0].text, /"status":"policy_blocked"/);
});

test('searchWebWithContext returns labelled indexed excerpts from LLM Context API', async () => {
  const result = await searchWebWithContext({ query: 'Chun Jason Xue MBZUAI FlexInfer' }, {
    apiKey: 'fixture-key',
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, 'https://api.search.brave.com');
      assert.equal(url.pathname, '/res/v1/llm/context');
      assert.equal(url.searchParams.get('q'), 'Chun Jason Xue MBZUAI FlexInfer');
      assert.equal(options.headers['X-Subscription-Token'], 'fixture-key');
      const profile = 'https://mbzuai.ac.ae/study/faculty/chun-jason-xue/';
      return Response.json({
        grounding: { generic: [
          {
            title: 'Prof. Chun Jason Xue | MBZUAI',
            url: profile,
            snippets: ['Chun Jason Xue is a Professor at MBZUAI. ' + 'A'.repeat(700)]
          },
          {
            title: 'FlexInfer paper',
            url: 'https://arxiv.org/abs/2503.03777',
            snippets: ['FlexInfer explores flexible inference strategies for language models.']
          },
          { title: 'Extra', url: 'https://extra.example.com/', snippets: ['Should not appear (capped at 2).'] }
        ] },
        sources: { [profile]: { fetched_content_timestamp: Date.parse('2026-10-01T00:00:00Z') / 1000 } }
      });
    }
  });
  assert.equal(result.ok, true, `Expected ok:true, got ${JSON.stringify(result)}`);
  assert.equal(result.provider, 'Brave LLM Context');
  assert.equal(result.status, 'OK');
  assert.equal(result.sources.length, 2, 'Must cap at MAX_SOURCES=2');
  for (const src of result.sources) {
    assert.equal(src.label, 'indexed excerpt');
    assert.ok(src.title, 'Each source must have a title');
    assert.ok(src.url.startsWith('https://'), 'URL must be sanitized https');
    assert.ok(src.excerpt.length > 0, 'Excerpt must be non-empty');
    assert.ok(src.excerpt.length <= 600, 'Excerpt must be capped at 600 chars');
  }
  assert.equal(result.sources[0].providerFetchedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(result.sources[1].providerFetchedAt, undefined);
});

test('searchWebWithContext distinguishes missing key, upstream errors and no results', async () => {
  const noFetch = async () => assert.fail('Unexpected provider request');
  assert.equal((await searchWebWithContext({ query: '' }, { fetchImpl: noFetch })).status, 'INVALID_INPUT');
  assert.equal((await searchWebWithContext({ query: 'x' }, { apiKey: '', fetchImpl: noFetch })).status, 'SEARCH_NOT_CONFIGURED');
  const run = fetchImpl => searchWebWithContext({ query: 'FlexInfer' }, { apiKey: 'fixture-key', fetchImpl });
  assert.equal((await run(async () => new Response('err', { status: 429 }))).status, 'PROVIDER_ERROR');
  assert.equal((await run(async () => Response.json({ grounding: { generic: [] } }))).status, 'NO_RESULTS');
});

test('MCP exposes indexed_excerpts opt-in and keeps indexed vs live read distinct', { timeout: 10_000 }, async t => {
  const mockFetch = `globalThis.fetch = async (url) => {
    const u = typeof url === 'string' ? new URL(url) : url;
    if (u.pathname === '/res/v1/llm/context') {
      if (!u.searchParams.get('q').startsWith('site:arxiv.org ')) throw new Error('Expected scoped query');
      const source = 'https://arxiv.org/abs/2503.03777';
      return Response.json({
        grounding: { generic: [{
          title: 'FlexInfer arXiv',
          url: source,
          snippets: ['FlexInfer indexed content from Brave.']
        }] },
        sources: { [source]: { fetched_content_timestamp: Date.parse('2026-10-15T00:00:00Z') / 1000 } }
      });
    }
    return Response.json({
      type: 'search', web: { results: [{ title: 'FlexInfer', url: 'https://arxiv.org/html/2503.03777v1', description: 'arXiv HTML' }] }
    });
  };`;
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
    return JSON.parse(line).result;
  }
  const listing = await request('tools/list');
  const searchTool = listing.tools.find(tool => tool.name === 'northbridge_search_web');
  assert.ok(searchTool?.inputSchema?.properties?.indexed_excerpts, 'indexed_excerpts must be in schema');
  assert.equal(searchTool.inputSchema.properties.indexed_excerpts.type, 'boolean');
  assert.equal(searchTool.inputSchema.properties.site.type, 'string');

  const withCtx = await request('tools/call', {
    name: 'northbridge_search_web',
    arguments: { query: 'FlexInfer', indexed_excerpts: true, site: 'arxiv.org' }
  });
  assert.match(withCtx.content[0].text, /UNTRUSTED EXTERNAL DATA/, 'Must include UNTRUSTED DATA header');
  const indexed = JSON.parse(withCtx.content[0].text.replace(/^\[UNTRUSTED EXTERNAL DATA\] /, ''));
  assert.equal(indexed.sources[0].label, 'indexed excerpt');
  assert.equal(indexed.sources[0].providerFetchedAt, '2026-10-15T00:00:00.000Z');
  assert.equal(withCtx.structuredContent, undefined);

  const noCtx = await request('tools/call', {
    name: 'northbridge_search_web',
    arguments: { query: 'FlexInfer' }
  });
  assert.equal(noCtx.structuredContent.results[0].title, 'FlexInfer');
});

test('indexed discovery scopes results to the requested site and its subdomains', async () => {
  const result = await searchWebWithContext({ query: 'Graduate funding', site: 'Example.edu', limit: 2 }, {
    apiKey: 'fixture-key',
    fetchImpl: async url => {
      assert.equal(url.searchParams.get('q'), 'site:example.edu Graduate funding');
      assert.equal(url.searchParams.get('operators_fallback'), 'false');
      const urls = ['https://notexample.edu/funding', 'https://example.edu.other.org/funding',
        'https://admissions.example.edu/funding', 'https://example.edu/graduate'];
      return Response.json({ grounding: { generic: urls.map(url => ({ url, title: 'Funding', snippets: ['Funding information.'] })) } });
    }
  });
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.sources.map(source => source.url), [
    'https://admissions.example.edu/funding', 'https://example.edu/graduate'
  ]);
  const invalid = await searchWebWithContext({ query: 'Funding', site: 'https://example.edu/path' }, {
    apiKey: 'fixture-key',
    fetchImpl: async () => assert.fail('Invalid hostname must not make a provider request')
  });
  assert.equal(invalid.status, 'INVALID_INPUT');
});

test('searchWebWithContext targets exact URL, ignores tracking params, and extracts table row from later passage', async () => {
  const result = await searchWebWithContext({
    query: 'The international M.Sc. monthly stipend in AED',
    target_url: 'https://mbzuai.ac.ae/admissions/graduate-masters-admissions?utm_source=chatgpt.com',
    section: 'Student funding and fees'
  }, {
    apiKey: 'fixture-key',
    fetchImpl: async (url, options) => {
      assert.equal(url.origin, 'https://api.search.brave.com');
      assert.equal(url.pathname, '/res/v1/llm/context');
      assert.match(url.searchParams.get('q'), /mbzuai\.ac\.ae\/admissions\/graduate-masters-admissions/);
      assert.equal(url.searchParams.get('maximum_number_of_urls'), '5');
      assert.equal(url.searchParams.get('maximum_number_of_tokens'), '2048');
      assert.equal(options.headers['X-Subscription-Token'], 'fixture-key');
      const targetPageUrl = 'https://mbzuai.ac.ae/admissions/graduate-masters-admissions';
      return Response.json({
        grounding: { generic: [
          {
            title: 'Irrelevant Blog',
            url: 'https://thirdparty.example.com/blog',
            snippets: ['General commentary on scholarships.']
          },
          {
            title: "Graduate master's admissions",
            url: targetPageUrl,
            snippets: [
              '# Graduate master’s admissions\n## Application process\nAll applicants are required to pay the AED 200 fee.',
              '## Student funding and fees\nMBZUAI offers fully funded MSc and PhD programs.',
              '| Student category | M.Sc. (AED) | Ph.D. (AED) |\n| --- | --- | --- |\n| UAE nationals | 37,500 | 43,500 |\n| International students | 15,500 | 17,500 |'
            ]
          }
        ] },
        sources: { [targetPageUrl]: { fetched_content_timestamp: Date.parse('2026-11-06T00:00:00Z') / 1000 } }
      });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'Brave LLM Context');
  assert.equal(result.status, 'OK');
  assert.equal(result.sources.length, 1);
  const src = result.sources[0];
  assert.equal(src.label, 'indexed excerpt');
  assert.equal(src.url, 'https://mbzuai.ac.ae/admissions/graduate-masters-admissions');
  assert.equal(src.title, "Graduate master's admissions");
  assert.match(src.excerpt, /International students \| 15,500/);
  assert.match(src.excerpt, /M\.Sc\. \(AED\)/);
  assert.doesNotMatch(src.excerpt, /AED 200 fee/);
});

test('searchWebWithContext returns "not found in indexed evidence" when requested row is absent', async () => {
  const result = await searchWebWithContext({
    query: 'Nonexistent housing grant',
    target_url: 'https://mbzuai.ac.ae/admissions/graduate-masters-admissions',
    section: 'Housing'
  }, {
    apiKey: 'fixture-key',
    fetchImpl: async () => {
      const targetPageUrl = 'https://mbzuai.ac.ae/admissions/graduate-masters-admissions';
      return Response.json({
        grounding: { generic: [
          {
            title: "Graduate master's admissions",
            url: targetPageUrl,
            snippets: [
              '# Graduate master’s admissions\n## Application process\nGeneral requirements apply.'
            ]
          }
        ] },
        sources: { [targetPageUrl]: { fetched_content_timestamp: Date.parse('2026-11-06T00:00:00Z') / 1000 } }
      });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'NOT_FOUND');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].label, 'indexed excerpt');
  assert.equal(result.sources[0].url, 'https://mbzuai.ac.ae/admissions/graduate-masters-admissions');
  assert.equal(result.sources[0].excerpt, 'not found in indexed evidence');
});
