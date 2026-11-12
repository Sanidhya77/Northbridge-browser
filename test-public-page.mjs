import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { readPublicPage, extractSectionFromSnapshot, isHostAllowed, extractHtmlLinks, extractDocxText } from './public-page.mjs';

const publicAddress = '1.1.1.1';

function mockRequest(responses, visited = []) {
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

test('rendered fallback runs only when enabled and triggers on unsupported_content or no_text', async () => {
  let browserCalled = false;
  const mockClientFactory = ({ allowedDomains, namespace }) => ({
    init: async () => {},
    callTool: async (name, args) => {
      browserCalled = true;
      assert.ok(namespace, 'namespace must be defined');
      if (name === 'agent_browser_open') {
        return { raw: { isError: false, structuredContent: { response: { data: { url: args.url, title: 'Rendered Title' } } } } };
      }
      if (name === 'agent_browser_snapshot') {
        return {
          raw: { isError: false },
          text: '- heading "Fall 2027 Admission" [level=2]\n- columnheader "Activity"\n- columnheader "Date"\n- cell "Round 2 application deadline"\n- cell "3 January 2027"'
        };
      }
      if (name === 'agent_browser_close') {
        return { raw: { isError: false } };
      }
      return { raw: {} };
    },
    close: async () => {}
  });

  // 1. Fallback disabled (default): returns unsupported_content directly without calling browser
  const disabled = await readPublicPage({ url: 'https://source.org/page' }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{ headers: { 'content-type': 'application/pdf' } }], []),
    allowedDomains: 'source.org',
    createMcpClient: mockClientFactory
  });
  assert.equal(disabled.status, 'unsupported_content');
  assert.equal(browserCalled, false);

  // 2. Fallback enabled: triggers on unsupported_content and returns rendered browser evidence
  const enabledUnsupported = await readPublicPage({
    url: 'https://source.org/page',
    section: 'Fall 2027 Admission',
    rendered_fallback: true
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{ headers: { 'content-type': 'application/pdf' } }], []),
    allowedDomains: 'source.org',
    createMcpClient: mockClientFactory
  });
  assert.equal(browserCalled, true);
  assert.equal(enabledUnsupported.status, 'readable');
  assert.equal(enabledUnsupported.evidence, 'rendered browser');
  assert.equal(enabledUnsupported.label, 'rendered browser');
  assert.equal(enabledUnsupported.directStatus, 'unsupported_content');
  assert.equal(enabledUnsupported.fallbackRan, true);
  assert.match(enabledUnsupported.excerpt, /Round 2 application deadline/);

  // 3. Fallback enabled on no_text
  browserCalled = false;
  const enabledNoText = await readPublicPage({
    url: 'https://source.org/empty',
    rendered_fallback: true
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{ headers: { 'content-type': 'text/plain' }, body: '' }], []),
    allowedDomains: 'source.org',
    createMcpClient: mockClientFactory
  });
  assert.equal(browserCalled, true);
  assert.equal(enabledNoText.status, 'readable');
  assert.equal(enabledNoText.directStatus, 'no_text');
});

test('rendered fallback is skipped when direct result is already readable', async () => {
  let browserCalled = false;
  const result = await readPublicPage({
    url: 'https://source.org/readable',
    rendered_fallback: true
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{ body: '<title>Direct</title><body><p>Direct readable text</p></body>' }], []),
    allowedDomains: 'source.org',
    createMcpClient: () => {
      browserCalled = true;
      return { init: async () => {}, callTool: async () => ({ raw: {} }), close: async () => {} };
    }
  });
  assert.equal(browserCalled, false, 'Browser runner must not be called when direct result is readable');
  assert.equal(result.status, 'readable');
  assert.equal(result.title, 'Direct');
  assert.equal(result.evidence, undefined);
});

test('rendered fallback is skipped on HTTP 401, 403, and 429', async () => {
  for (const status of [401, 403, 429]) {
    let browserCalled = false;
    const result = await readPublicPage({
      url: 'https://source.org/blocked',
      rendered_fallback: true
    }, {
      resolve4: async () => [publicAddress],
      request: mockRequest([{ status }], []),
      allowedDomains: 'source.org',
      createMcpClient: () => {
        browserCalled = true;
        return { init: async () => {}, callTool: async () => ({ raw: {} }), close: async () => {} };
      }
    });
    assert.equal(browserCalled, false, `Browser runner must not be called on HTTP ${status}`);
    assert.equal(result.status, 'blocked');
    assert.equal(result.httpStatus, status);
  }
});

test('rendered fallback respects access restrictions and allowlists', async () => {
  assert.equal(isHostAllowed('admissions.kaust.edu.sa', '127.0.0.1,admissions.kaust.edu.sa'), true);
  assert.equal(isHostAllowed('admissions.kaust.edu.sa', '127.0.0.1,*.kaust.edu.sa'), true);
  assert.equal(isHostAllowed('other.org', '127.0.0.1,kaust.edu.sa'), false);
  assert.equal(isHostAllowed('evil.com', ''), false);

  let browserCalled = false;
  const blocked = await readPublicPage({
    url: 'https://unallowed.org/page',
    rendered_fallback: true
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{ headers: { 'content-type': 'application/pdf' } }], []),
    allowedDomains: '127.0.0.1,allowed.org',
    createMcpClient: () => {
      browserCalled = true;
      return { init: async () => {}, callTool: async () => ({ raw: {} }), close: async () => {} };
    }
  });
  assert.equal(browserCalled, false, 'Browser runner must not be called when host is outside allowlist');
  assert.equal(blocked.status, 'policy_blocked');
  assert.equal(blocked.fallbackRan, false);
  assert.match(blocked.reason, /not in the allowed domains list/);
});

test('mock MCP transport: snapshot error returns browser_error and preserves directStatus', async () => {
  const calls = [];
  const clientFactory = ({ allowedDomains, namespace }) => ({
    init: async () => {},
    callTool: async (name, args) => {
      calls.push({ name, args, namespace });
      if (name === 'agent_browser_open') {
        return { raw: { isError: false, structuredContent: { response: { data: { url: args.url } } } } };
      }
      if (name === 'agent_browser_snapshot') {
        return { raw: { isError: true, content: [{ text: 'Snapshot timed out after 30000ms' }] } };
      }
      if (name === 'agent_browser_close') {
        return { raw: { isError: false } };
      }
      return { raw: {} };
    },
    close: async () => {}
  });

  const result = await readPublicPage({
    url: 'https://source.org/failsnap',
    rendered_fallback: true
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{ headers: { 'content-type': 'application/pdf' } }], []),
    allowedDomains: 'source.org',
    createMcpClient: clientFactory
  });

  assert.equal(result.status, 'browser_error');
  assert.equal(result.directStatus, 'unsupported_content');
  assert.equal(result.fallbackRan, true);
  assert.match(result.reason, /snapshot timed out/i);

  const closeCall = calls.find(c => c.name === 'agent_browser_close');
  assert.ok(closeCall, 'agent_browser_close must be called after error');
  assert.ok(closeCall.args.namespace, 'close must specify namespace');
  assert.equal(closeCall.args.namespace, closeCall.namespace);
  assert.equal(closeCall.args.session, closeCall.namespace);
});

test('mock MCP transport: empty snapshot returns no_text with no excerpt and preserves directStatus', async () => {
  const clientFactory = ({ allowedDomains, namespace }) => ({
    init: async () => {},
    callTool: async (name, args) => {
      if (name === 'agent_browser_open') {
        return { raw: { isError: false, structuredContent: { response: { data: { url: args.url, title: 'Blank' } } } } };
      }
      if (name === 'agent_browser_snapshot') {
        return { raw: { isError: false }, text: '' };
      }
      return { raw: { isError: false } };
    },
    close: async () => {}
  });

  const result = await readPublicPage({
    url: 'https://source.org/emptysnap',
    section: 'Fall 2027',
    rendered_fallback: true
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{ headers: { 'content-type': 'application/pdf' } }], []),
    allowedDomains: 'source.org',
    createMcpClient: clientFactory
  });

  assert.equal(result.status, 'no_text');
  assert.equal(result.directStatus, 'unsupported_content');
  assert.equal(result.fallbackRan, true);
  assert.equal(result.excerpt, undefined);
  assert.equal(result.evidence, 'rendered browser');
});

test('mock MCP transport: concurrent calls use distinct namespaces and snapshot failure closes only that call session', async () => {
  const openCalls = [];
  const snapshotCalls = [];
  const closeCalls = [];
  const activeSessions = new Set();

  const clientFactory = ({ allowedDomains, namespace }) => ({
    init: async () => {},
    callTool: async (name, args) => {
      if (name === 'agent_browser_open') {
        openCalls.push({ namespace, args });
        activeSessions.add(namespace);
        return { raw: { isError: false, structuredContent: { response: { data: { url: args.url } } } } };
      }
      if (name === 'agent_browser_snapshot') {
        snapshotCalls.push({ namespace, args });
        if (args.url?.includes('page2') || snapshotCalls.length === 2) {
          return { raw: { isError: true, content: [{ text: 'Snapshot failed for call 2' }] } };
        }
        return {
          raw: { isError: false },
          text: '- heading "Fall 2027 Admission" [level=2]\n- columnheader "Activity"\n- columnheader "Date"\n- cell "Round 2 application deadline"\n- cell "3 January 2027"'
        };
      }
      if (name === 'agent_browser_close') {
        closeCalls.push({ namespace, args });
        activeSessions.delete(args.namespace);
        return { raw: { isError: false } };
      }
      return { raw: {} };
    },
    close: async () => {}
  });

  const [res1, res2] = await Promise.all([
    readPublicPage({ url: 'https://source.org/page1', section: 'Fall 2027', rendered_fallback: true }, {
      resolve4: async () => [publicAddress],
      request: mockRequest([{ headers: { 'content-type': 'application/pdf' } }], []),
      allowedDomains: 'source.org',
      createMcpClient: clientFactory
    }),
    readPublicPage({ url: 'https://source.org/page2', section: 'Fall 2027', rendered_fallback: true }, {
      resolve4: async () => [publicAddress],
      request: mockRequest([{ headers: { 'content-type': 'application/pdf' } }], []),
      allowedDomains: 'source.org',
      createMcpClient: clientFactory
    })
  ]);

  // 1. Two concurrent calls use distinct namespaces
  assert.equal(openCalls.length, 2);
  const ns1 = openCalls[0].namespace;
  const ns2 = openCalls[1].namespace;
  assert.ok(ns1 && ns2);
  assert.notEqual(ns1, ns2, 'Concurrent calls must use distinct namespaces');

  // 2. Each call open, snapshot, close targets its own session
  assert.equal(openCalls[0].args.namespace, ns1);
  assert.equal(openCalls[0].args.session, ns1);
  assert.equal(openCalls[1].args.namespace, ns2);
  assert.equal(openCalls[1].args.session, ns2);

  const snap1 = snapshotCalls.find(s => s.namespace === ns1);
  const snap2 = snapshotCalls.find(s => s.namespace === ns2);
  assert.equal(snap1.args.namespace, ns1);
  assert.equal(snap1.args.session, ns1);
  assert.equal(snap2.args.namespace, ns2);
  assert.equal(snap2.args.session, ns2);

  // 3. A snapshot failure still closes only that call session
  const close1 = closeCalls.find(c => c.namespace === ns1);
  const close2 = closeCalls.find(c => c.namespace === ns2);
  assert.ok(close1, 'Call 1 must close its session');
  assert.ok(close2, 'Call 2 (with failed snapshot) must still close its session');
  assert.equal(close1.args.namespace, ns1);
  assert.equal(close1.args.session, ns1);
  assert.equal(close2.args.namespace, ns2);
  assert.equal(close2.args.session, ns2);

  // 4. Status and directStatus checks
  assert.equal(res1.status, 'readable');
  assert.equal(res1.directStatus, 'unsupported_content');
  assert.equal(res2.status, 'browser_error');
  assert.equal(res2.directStatus, 'unsupported_content');
  assert.match(res2.reason, /Snapshot failed for call 2/);
});

test('extractSectionFromSnapshot formats tables with headers and matching rows', () => {
  const snapshot = `- heading "Fall 2027 Admission" [level=2]
- paragraph
  - StaticText "Fall 2027 admission is open to MS, MS/PhD, and PhD applicants."
- columnheader "Activity"
- columnheader "Date"
- cell "Round 2 application open"
- cell "28 September 2026"
- cell "Round 2 application deadline"
- cell "3 January 2027"
- cell "Round 2 decisions released"
- cell "25 February 2027"
- heading "Other Heading" [level=2]`;

  const parsed = extractSectionFromSnapshot(snapshot, 'Fall 2027 Admission');
  assert.equal(parsed.sectionFound, true);
  assert.match(parsed.excerpt, /### Fall 2027 Admission/);
  assert.match(parsed.excerpt, /\| Activity \| Date \|/);
  assert.match(parsed.excerpt, /\| Round 2 application deadline \| 3 January 2027 \|/);
  assert.doesNotMatch(parsed.excerpt, /Other Heading/);

  // Empty snapshot text returns empty excerpt and sectionFound false
  const empty = extractSectionFromSnapshot('', 'Fall 2027 Admission');
  assert.equal(empty.excerpt, '');
  assert.equal(empty.sectionFound, false);
});

test('mock MCP transport: prefers document title over first accessibility heading', async () => {
  const clientFactory = ({ allowedDomains, namespace }) => ({
    init: async () => {},
    callTool: async (name, args) => {
      if (name === 'agent_browser_open') {
        return {
          raw: {
            isError: false,
            structuredContent: {
              response: {
                data: {
                  url: args.url,
                  title: 'Admission Timeline'
                }
              }
            }
          }
        };
      }
      if (name === 'agent_browser_snapshot') {
        return {
          raw: { isError: false },
          text: [
            '- heading "Search KAUST course directory" [level=4]',
            '- heading "Admission Timeline" [level=1]',
            '- heading "Fall 2027 Admission" [level=2]',
            '- columnheader "Activity"',
            '- columnheader "Date"',
            '- cell "Round 2 application open"',
            '- cell "28 September 2026"',
            '- cell "Round 2 application deadline"',
            '- cell "3 January 2027"',
            '- cell "Round 2 decisions released"',
            '- cell "25 February 2027"',
            '- cell "Fall semester starts"',
            '- cell "29 August 2027"'
          ].join('\n')
        };
      }
      if (name === 'agent_browser_close') {
        return { raw: { isError: false } };
      }
      return { raw: {} };
    },
    close: async () => {}
  });

  const result = await readPublicPage({
    url: 'https://source.org/timelines',
    section: 'Fall 2027 Admission',
    rendered_fallback: true
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{ headers: { 'content-type': 'application/pdf' } }], []),
    allowedDomains: 'source.org',
    createMcpClient: clientFactory
  });

  assert.equal(result.status, 'readable');
  assert.equal(result.title, 'Admission Timeline');
  assert.equal(result.sectionFound, true);
  assert.match(result.excerpt, /### Fall 2027 Admission/);
  assert.match(result.excerpt, /\| Round 2 application deadline \| 3 January 2027 \|/);
  assert.doesNotMatch(result.excerpt, /Search KAUST course directory/);
});

function createMockDocxBuffer(xmlContent, filename = 'word/document.xml', uncompOverride = null) {
  const contentBuf = Buffer.from(xmlContent, 'utf8');
  const compressed = zlib.deflateRawSync(contentBuf);
  const nameBuf = Buffer.from(filename, 'utf8');
  const uncompSize = uncompOverride !== null ? uncompOverride : contentBuf.length;

  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(uncompSize, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBuf.copy(localHeader, 30);

  const cdHeader = Buffer.alloc(46 + nameBuf.length);
  cdHeader.writeUInt32LE(0x02014b50, 0);
  cdHeader.writeUInt16LE(20, 4);
  cdHeader.writeUInt16LE(20, 6);
  cdHeader.writeUInt16LE(0, 8);
  cdHeader.writeUInt16LE(8, 10);
  cdHeader.writeUInt16LE(0, 12);
  cdHeader.writeUInt16LE(0, 14);
  cdHeader.writeUInt32LE(0, 16);
  cdHeader.writeUInt32LE(compressed.length, 20);
  cdHeader.writeUInt32LE(uncompSize, 24);
  cdHeader.writeUInt16LE(nameBuf.length, 28);
  cdHeader.writeUInt16LE(0, 30);
  cdHeader.writeUInt16LE(0, 32);
  cdHeader.writeUInt16LE(0, 34);
  cdHeader.writeUInt16LE(0, 36);
  cdHeader.writeUInt32LE(0, 38);
  cdHeader.writeUInt32LE(0, 42);
  nameBuf.copy(cdHeader, 46);

  const cdOffset = localHeader.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdHeader.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, compressed, cdHeader, eocd]);
}

test('extractHtmlLinks resolves relative attachment URLs to HTTPS and excludes non-HTTPS/javascript', () => {
  const html = `
    <html>
      <body>
        <p><strong>Annex:</strong></p>
        <p><a href="/downloads/annex2.docx">2. Research Proposal Template.docx</a></p>
        <p><a href="relative/handbook.pdf">Student Handbook</a></p>
        <p><a href="http://insecure.org/plain.docx">Insecure Link</a></p>
        <p><a href="javascript:void(0)">JS Link</a></p>
        <p><a href="#section">Anchor Link</a></p>
      </body>
    </html>
  `;
  const baseUrl = new URL('https://source.org/en/guide.html');
  const allLinks = extractHtmlLinks(html, baseUrl);
  assert.equal(allLinks.length, 2);
  assert.deepEqual(allLinks[0], {
    text: '2. Research Proposal Template.docx',
    url: 'https://source.org/downloads/annex2.docx'
  });
  assert.deepEqual(allLinks[1], {
    text: 'Student Handbook',
    url: 'https://source.org/en/relative/handbook.pdf'
  });

  // Test attachment query filtering
  const matching = extractHtmlLinks(html, baseUrl, 'Annex 2');
  assert.equal(matching.length, 1);
  assert.equal(matching[0].text, '2. Research Proposal Template.docx');
  assert.equal(matching[0].url, 'https://source.org/downloads/annex2.docx');
});

test('extractHtmlLinks ignores script anchors and data-href, resolves spaced href with HTML entities', async () => {
  const html = `
    <html>
      <head>
        <script>
          const fakeAnchor = '<a href="https://source.org/script-fake.docx">Script Fake</a>';
        </script>
      </head>
      <body>
        <p>
          <a data-href="https://source.org/data-fake.docx" href  =  "https://source.org/download.docx?id=42&amp;type=template">Proposal Template</a>
        </p>
        <p>
          <a data-href="https://source.org/only-data.docx">Only Data Href</a>
        </p>
      </body>
    </html>
  `;
  const baseUrl = new URL('https://source.org/en/guide.html');
  const links = extractHtmlLinks(html, baseUrl);
  assert.equal(links.length, 1);
  assert.equal(links[0].text, 'Proposal Template');
  assert.equal(links[0].url, 'https://source.org/download.docx?id=42&type=template');

  const pageRes = await readPublicPage({
    url: 'https://source.org/guide',
    attachment: 'Proposal'
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{ body: html }], [])
  });
  assert.equal(pageRes.status, 'readable');
  assert.equal(pageRes.attachments.length, 1);
  assert.equal(pageRes.attachments[0].text, 'Proposal Template');
  assert.equal(pageRes.attachments[0].url, 'https://source.org/download.docx?id=42&type=template');
});

test('extractHtmlLinks and readPublicPage cap direct HTML attachment results at 10 unique matches', async () => {
  const anchors = [];
  for (let i = 1; i <= 15; i++) {
    anchors.push(`<p><a href="https://source.org/files/doc_${i}.docx">Document ${i}.docx</a></p>`);
  }
  anchors.push(`<p><a href="https://source.org/files/doc_1.docx">Duplicate Doc 1</a></p>`);
  const html = `<html><body>${anchors.join('\n')}</body></html>`;

  const baseUrl = new URL('https://source.org/guide');
  const links = extractHtmlLinks(html, baseUrl, 'docx');
  assert.equal(links.length, 10, 'Must cap results at 10 unique matches');
  assert.equal(links[0].text, 'Document 1.docx');
  assert.equal(links[9].text, 'Document 10.docx');

  const pageRes = await readPublicPage({
    url: 'https://source.org/guide',
    attachment: 'docx'
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{ body: html }], [])
  });
  assert.equal(pageRes.status, 'readable');
  assert.equal(pageRes.attachments.length, 10, 'readPublicPage must cap attachments at 10 unique matches');
  assert.equal(pageRes.attachments[0].url, 'https://source.org/files/doc_1.docx');
  assert.equal(pageRes.attachments[9].url, 'https://source.org/files/doc_10.docx');
});

test('readPublicPage extracts named attachments matching label, context, or URL', async () => {
  const html = `
    <html>
      <head><title>Guide</title></head>
      <body>
        <h1>Admissions</h1>
        <p>Annex:</p>
        <p><a href="https://source.org/files/template.docx">2. Research Proposal Template.docx</a></p>
      </body>
    </html>
  `;
  const result = await readPublicPage({
    url: 'https://source.org/guide',
    attachment: 'Annex 2'
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{ body: html }], [])
  });

  assert.equal(result.status, 'readable');
  assert.ok(Array.isArray(result.attachments));
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].text, '2. Research Proposal Template.docx');
  assert.equal(result.attachments[0].url, 'https://source.org/files/template.docx');
});

test('readPublicPage extracts text, headings, and tables from valid DOCX when extract_docx is true', async () => {
  const docXml = `
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:t>Research Proposal</w:t></w:p>
        <w:p><w:t>Applicant: Alice</w:t></w:p>
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:t>Activity</w:t></w:p></w:tc>
            <w:tc><w:p><w:t>Date</w:t></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:p><w:t>Start</w:t></w:p></w:tc>
            <w:tc><w:p><w:t>Fall 2027</w:t></w:p></w:tc>
          </w:tr>
        </w:tbl>
      </w:body>
    </w:document>
  `;
  const docxBuf = createMockDocxBuffer(docXml);

  // 1. Opt-in: extract_docx: true
  const result = await readPublicPage({
    url: 'https://source.org/template.docx',
    extract_docx: true
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      body: docxBuf
    }], [])
  });

  assert.equal(result.status, 'readable');
  assert.equal(result.format, 'docx');
  assert.equal(result.title, 'Research Proposal');
  assert.match(result.excerpt, /### Research Proposal/);
  assert.match(result.excerpt, /Applicant: Alice/);
  assert.match(result.excerpt, /\| Activity \| Date \|/);
  assert.match(result.excerpt, /\| Start \| Fall 2027 \|/);

  // 2. Default (extract_docx: false) retains unsupported_content
  const defaultResult = await readPublicPage({
    url: 'https://source.org/template.docx',
    extract_docx: false
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      body: docxBuf
    }], [])
  });

  assert.equal(defaultResult.status, 'unsupported_content');
});

test('readPublicPage DOCX extraction returns invalid_docx for corrupted zip or missing document.xml', async () => {
  // Corrupt non-zip buffer
  const corruptRes = await readPublicPage({
    url: 'https://source.org/corrupt.docx',
    extract_docx: true
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      body: Buffer.from('this is not a zip file archive at all')
    }], [])
  });
  assert.equal(corruptRes.status, 'invalid_docx');
  assert.match(corruptRes.reason, /missing End of Central Directory/i);

  // Zip without word/document.xml
  const missingXmlZip = createMockDocxBuffer('<test/>', 'other/file.xml');
  const missingRes = await readPublicPage({
    url: 'https://source.org/missing.docx',
    extract_docx: true
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      body: missingXmlZip
    }], [])
  });
  assert.equal(missingRes.status, 'invalid_docx');
  assert.match(missingRes.reason, /missing word\/document\.xml/i);
});

test('readPublicPage DOCX extraction returns too_large when uncompressed or downloaded size exceeds limit', async () => {
  // Uncompressed size exceeding maxDecompressedSize (15 MB reported in central directory)
  const hugeZip = createMockDocxBuffer('<test/>', 'word/document.xml', 15 * 1024 * 1024);
  const tooLargeRes = await readPublicPage({
    url: 'https://source.org/bomb.docx',
    extract_docx: true
  }, {
    resolve4: async () => [publicAddress],
    request: mockRequest([{
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      body: hugeZip
    }], [])
  });
  assert.equal(tooLargeRes.status, 'too_large');
  assert.match(tooLargeRes.reason, /exceeds limit/i);
});

test('readPublicPage DOCX extraction blocks non-public redirect destinations before connecting', async () => {
  const visited = [];
  const blockedRedirect = await readPublicPage({
    url: 'https://source.org/redirect.docx',
    extract_docx: true
  }, {
    resolve4: async host => host === 'source.org' ? [publicAddress] : ['127.0.0.1'],
    request: mockRequest([
      { status: 302, headers: { location: 'https://internal-host.org/secret.docx' } }
    ], visited)
  });
  assert.equal(blockedRedirect.status, 'policy_blocked');
  assert.deepEqual(visited, [['source.org', publicAddress]]);
});
