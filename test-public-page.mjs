import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { readPublicPage } from './public-page.mjs';

const publicAddress = '1.1.1.1';

function mockRequest(responses, visited) {
  return (url, options, callback) => {
    options.lookup(url.hostname, { all: true }, (error, addresses) => {
      assert.ifError(error);
      visited.push([url.hostname, addresses[0].address]);
    });
    assert.equal(options.agent, false);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.Authorization, undefined);
    const response = responses.shift();
    assert.ok(response, 'Unexpected outbound connection');
    const stream = Readable.from([Buffer.from(response.body ?? '')]);
    stream.statusCode = response.status ?? 200;
    stream.headers = { 'content-type': 'text/html', ...response.headers };
    queueMicrotask(() => callback(stream));
    return new EventEmitter();
  };
}

test('pins the socket lookup, revalidates redirects and extracts a focused excerpt', async () => {
  const visited = [];
  const result = await readPublicPage({ url: 'https://source.org/start', section: 'Abstract', maxChars: 200 }, {
    resolve4: async host => [host === 'source.org' ? publicAddress : '8.8.8.8'],
    request: mockRequest([
      { status: 302, headers: { location: 'https://paper.org/study#private' } },
      { body: '<title>Paper &amp; Methods</title><body><nav>Menu</nav><main><h1>Paper</h1><script>doSomething()</script><h2>Abstract.</h2><p>Actual findings &mdash; verified text.</p><h2>Introduction</h2><p>Other section.</p></main></body>' }
    ], visited)
  });
  assert.deepEqual(visited, [['source.org', publicAddress], ['paper.org', '8.8.8.8']]);
  assert.equal(result.finalUrl, 'https://paper.org/study');
  assert.equal(result.status, 'readable');
  assert.equal(result.title, 'Paper & Methods');
  assert.equal(result.excerpt, 'Abstract. Actual findings — verified text.');
  assert.equal(result.sectionFound, true);
  assert.equal(result.screenshots, 0);
});

test('blocks nonpublic DNS results and redirect destinations before connecting', async () => {
  const visited = [];
  const options = {
    resolve4: async host => host === 'source.org' ? [publicAddress] : [publicAddress, '169.254.169.254'],
    request: mockRequest([{ status: 302, headers: { location: 'https://private-dns.org/' } }], visited)
  };
  const result = await readPublicPage({ url: 'https://source.org/' }, options);
  assert.equal(result.status, 'policy_blocked');
  assert.deepEqual(visited, [['source.org', publicAddress]]);

  for (const url of ['file:///private', 'http://source.org/', 'https://source.org:8443/',
    'https://name:secret@source.org/', 'https://127.0.0.1/', 'https://[::1]/', 'https://machine.home.arpa/']) {
    const denied = await readPublicPage({ url }, options);
    assert.equal(denied.status, 'policy_blocked', url);
    assert.equal(denied.requests, 0);
  }
  for (const address of ['10.1.2.3', '100.64.0.1', '127.0.0.2', '172.31.0.1', '192.168.0.1', '198.18.0.1']) {
    const denied = await readPublicPage({ url: 'https://source.org/' }, { ...options, resolve4: async () => [address] });
    assert.equal(denied.status, 'policy_blocked', address);
    assert.equal(denied.requests, 0);
  }
});

test('distinguishes challenges, unsupported content, empty pages and oversized responses', async () => {
  const run = response => readPublicPage({ url: 'https://source.org/' }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([response], [])
  });
  assert.equal((await run({ status: 403 })).status, 'blocked');
  assert.equal((await run({ status: 503, headers: { 'cf-mitigated': 'challenge' } })).status, 'blocked');
  assert.equal((await run({ body: "<title>WAF | MBZUAI</title><h1>You can't access this page right now</h1>" })).status, 'blocked');
  assert.equal((await run({ headers: { 'content-type': 'application/pdf' } })).status, 'unsupported_content');
  assert.equal((await run({ headers: { 'content-type': 'text/plain' } })).status, 'no_text');
  assert.equal((await run({ body: 'x'.repeat(2 * 1024 * 1024 + 1) })).status, 'too_large');
});

test('returns a timeout without connecting when system DNS stalls', async () => {
  const controller = new AbortController();
  const pending = readPublicPage({ url: 'https://source.org/' }, {
    lookup: () => new Promise(() => {}),
    request: () => assert.fail('A stalled DNS lookup must not start an HTTPS request'),
    signal: controller.signal
  });
  controller.abort(new DOMException('Deadline elapsed', 'TimeoutError'));
  const result = await pending;
  assert.equal(result.status, 'timeout');
  assert.equal(result.reason, 'TimeoutError');
  assert.equal(result.requests, 0);
});
