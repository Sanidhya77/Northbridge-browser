import { spawn } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

async function runMcpWorkflow(options = {}) {
  const binary = path.resolve('node_modules/agent-browser/bin/agent-browser-win32-x64.exe');
  const session = options.session || ('northbridge-' + crypto.randomBytes(4).toString('hex'));
  const port = options.port || Number(process.env.PORT || 4317);
  const targetUrl = `http://127.0.0.1:${port}/`;

  const proc = spawn(binary, ['mcp', '--tools', 'core'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, AGENT_BROWSER_ALLOWED_DOMAINS: '127.0.0.1' }
  });

  let msgId = 0;
  const pending = new Map();
  let buffer = '';
  let sessionStarted = false;
  let sessionClosed = false;

  proc.on('exit', (code, signal) => {
    for (const [id, { timer, reject }] of pending) {
      clearTimeout(timer);
      reject(new Error(`MCP server exited unexpectedly (code: ${code}, signal: ${signal}) while waiting for request id ${id}`));
    }
    pending.clear();
  });

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          const { timer, resolve, reject } = pending.get(msg.id);
          clearTimeout(timer);
          pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`));
          } else {
            resolve(msg.result);
          }
        }
      } catch (err) {
        console.error('JSON parse error from MCP server:', err.message);
      }
    }
  });

  function send(method, params, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request '${method}' (id ${id}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { timer, resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  function notify(method, params) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async function callTool(name, args) {
    const res = await send('tools/call', { name, arguments: args });
    if (res.isError) {
      const errText = res.content?.map(c => c.text).join('\n') || JSON.stringify(res);
      throw new Error(`MCP tool '${name}' reported an error: ${errText}`);
    }
    return res;
  }

  function parseRef(text, regex) {
    const m = text.match(regex);
    if (!m) throw new Error('Could not find ref for pattern: ' + regex);
    return '@' + m[1];
  }

  let observationBytes = 0;
  let toolCallCount = 0;
  let cleanupCount = 0;
  const startTime = Date.now();
  let workflowError = null;

  try {
    // 1. Initialize MCP
    const initRes = await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-acceptance-runner', version: '1.0.0' }
    });
    console.log('MCP Initialized. Server:', initRes.serverInfo);
    notify('notifications/initialized', {});

    // 2. Discover Tools
    const toolsRes = await send('tools/list', {});
    console.log('Discovered tools count:', toolsRes.tools.length);

    // Step 1: Open catalogue
    toolCallCount++;
    console.log('\n--- Tool Call 1: open ---');
    await callTool('agent_browser_open', {
      url: targetUrl,
      session
    });
    sessionStarted = true;

    // Step 1b: Observe catalogue
    toolCallCount++;
    console.log('--- Tool Call 2: snapshot (#main) ---');
    const snap1 = await callTool('agent_browser_snapshot', {
      selector: '#main',
      compact: true,
      interactive: false,
      session
    });
    const text1 = snap1.content[0].text;
    observationBytes += Buffer.byteLength(text1.replace(/\r\n/g, '\n'), 'utf8');
    const refMSc = parseRef(text1, /link "MSc Applied Data Science"[^\n]*\[[^\n]*ref=([a-zA-Z0-9_-]+)/);
    console.log('Target MSc link ref:', refMSc);

    // Step 2: Click MSc Applied Data Science
    toolCallCount++;
    console.log('\n--- Tool Call 3: click MSc ---');
    await callTool('agent_browser_click', { selector: refMSc, session });

    // Step 2b: Observe programme & deadline
    toolCallCount++;
    console.log('--- Tool Call 4: snapshot (#main) ---');
    const snap2 = await callTool('agent_browser_snapshot', {
      selector: '#main',
      compact: true,
      interactive: false,
      session
    });
    const text2 = snap2.content[0].text;
    observationBytes += Buffer.byteLength(text2.replace(/\r\n/g, '\n'), 'utf8');
    if (!text2.includes('21 May 2027')) {
      throw new Error('Application deadline "21 May 2027" not found in programme snapshot');
    }
    console.log('VERIFIED: Application deadline is 21 May 2027');
    const refStartDraft = parseRef(text2, /link "Start a draft application"[^\n]*\[[^\n]*ref=([a-zA-Z0-9_-]+)/);
    console.log('Target Start Draft ref:', refStartDraft);

    // Step 3: Click Start draft application
    toolCallCount++;
    console.log('\n--- Tool Call 5: click Start Draft ---');
    await callTool('agent_browser_click', { selector: refStartDraft, session });

    // Step 3b: Observe empty form
    toolCallCount++;
    console.log('--- Tool Call 6: snapshot (#main) ---');
    const snap3 = await callTool('agent_browser_snapshot', {
      selector: '#main',
      compact: true,
      interactive: false,
      session
    });
    const text3 = snap3.content[0].text;
    observationBytes += Buffer.byteLength(text3.replace(/\r\n/g, '\n'), 'utf8');
    const refName = parseRef(text3, /textbox "Full name"[^\n]*\[[^\n]*ref=([a-zA-Z0-9_-]+)/);
    const refEmail = parseRef(text3, /textbox "Email address"[^\n]*\[[^\n]*ref=([a-zA-Z0-9_-]+)/);
    const refQual = parseRef(text3, /textbox "Previous qualification"[^\n]*\[[^\n]*ref=([a-zA-Z0-9_-]+)/);

    // Step 4: Fill form fields
    toolCallCount += 3;
    console.log('\n--- Tool Calls 7, 8, 9: fill form ---');
    await callTool('agent_browser_fill', { selector: refName, text: 'Avery Example', session });
    await callTool('agent_browser_fill', { selector: refEmail, text: 'avery@example.test', session });
    await callTool('agent_browser_fill', { selector: refQual, text: 'BSc Statistics', session });

    // Step 5: Scoped observation of populated form
    toolCallCount++;
    console.log('--- Tool Call 10: snapshot (form) ---');
    const snap4 = await callTool('agent_browser_snapshot', {
      selector: 'form',
      compact: true,
      interactive: false,
      session
    });
    const text4 = snap4.content[0].text;
    observationBytes += Buffer.byteLength(text4.replace(/\r\n/g, '\n'), 'utf8');

    // Strict field-label and value verification on populated form
    const hasNameField = /textbox "Full name"[^\n]*:\s*Avery Example/.test(text4) ||
                         (/Full name/.test(text4) && text4.includes('Avery Example'));
    const hasEmailField = /textbox "Email address"[^\n]*:\s*avery@example\.test/.test(text4) ||
                          (/Email address/.test(text4) && text4.includes('avery@example.test'));
    const hasQualField = /textbox "Previous qualification"[^\n]*:\s*BSc Statistics/.test(text4) ||
                         (/Previous qualification/.test(text4) && text4.includes('BSc Statistics'));

    if (!hasNameField || !hasEmailField || !hasQualField) {
      throw new Error('Populated form verification failed: labels and values do not match expected inputs');
    }
    console.log('VERIFIED: All three form labels and values verified in populated form.');
    const refSave = parseRef(text4, /button "Save draft"[^\n]*\[[^\n]*ref=([a-zA-Z0-9_-]+)/);
    console.log('Target Save ref:', refSave);

    // Step 6: Save once
    toolCallCount++;
    console.log('\n--- Tool Call 11: click save ---');
    await callTool('agent_browser_click', { selector: refSave, session });

    // Step 6b: Observe My drafts
    toolCallCount++;
    console.log('--- Tool Call 12: snapshot (#main) ---');
    const snap5 = await callTool('agent_browser_snapshot', {
      selector: '#main',
      compact: true,
      interactive: false,
      session
    });
    const text5 = snap5.content[0].text;
    observationBytes += Buffer.byteLength(text5.replace(/\r\n/g, '\n'), 'utf8');
    if (!text5.includes('Draft saved.')) {
      throw new Error('Confirmation "Draft saved." not found in My drafts snapshot');
    }
    console.log('VERIFIED: "Draft saved." confirmed.');
    const refOpenDraft = parseRef(text5, /link "Open MSc Applied Data Science draft"[^\n]*\[[^\n]*ref=([a-zA-Z0-9_-]+)/);
    console.log('Target Open Draft link ref:', refOpenDraft);

    // Step 7: Follow record link to review
    toolCallCount++;
    console.log('\n--- Tool Call 13: click open draft ---');
    await callTool('agent_browser_click', { selector: refOpenDraft, session });

    // Step 7b: Observe Review saved draft page
    toolCallCount++;
    console.log('--- Tool Call 14: snapshot (#main) ---');
    const snap6 = await callTool('agent_browser_snapshot', {
      selector: '#main',
      compact: true,
      interactive: false,
      session
    });
    const text6 = snap6.content[0].text;
    observationBytes += Buffer.byteLength(text6.replace(/\r\n/g, '\n'), 'utf8');
    const elapsed = Date.now() - startTime;

    // Strict status verification: match the ENTIRE line value following "Status:"
    const statusMatch = text6.match(/Status:\s*([^"\r\n]+)/);
    if (!statusMatch) {
      throw new Error('Status field "Status: <value>" not found on review page');
    }
    const observedStatus = statusMatch[1].replace(/["']/g, '').trim();
    if (observedStatus !== 'Draft') {
      throw new Error(`Review status verification failed: expected exactly 'Draft', observed '${observedStatus}'`);
    }

    // Verify programme and field-label associations on review page
    if (!text6.includes('Review saved draft') || !text6.includes('MSc Applied Data Science')) {
      throw new Error('Review page header or programme verification failed');
    }

    const reviewNameMatch = /Full name[\s\S]*?Avery Example/.test(text6);
    const reviewEmailMatch = /Email address[\s\S]*?avery@example\.test/.test(text6);
    const reviewQualMatch = /Previous qualification[\s\S]*?BSc Statistics/.test(text6);

    if (!reviewNameMatch || !reviewEmailMatch || !reviewQualMatch) {
      throw new Error('Review field verification failed: persisted applicant values do not match field labels');
    }

    console.log('\n=============================================');
    console.log('HUMAN REVIEW CHECKPOINT REACHED AND VERIFIED:');
    console.log('- Programme: MSc Applied Data Science');
    console.log(`- Status: ${observedStatus} (verified exact value: Draft)`);
    console.log('- Full name: Avery Example');
    console.log('- Email address: avery@example.test');
    console.log('- Previous qualification: BSc Statistics');
    console.log('=============================================');

    // Normal path cleanup: close session
    cleanupCount++;
    await callTool('agent_browser_close', { session });
    sessionClosed = true;

    console.log('\nMETRICS SUMMARY (MCP Stdio Run):');
    console.log('Elapsed wall-clock time:', elapsed, 'ms (' + (elapsed / 1000).toFixed(2) + ' s)');
    console.log('MCP Tool calls through review checkpoint:', toolCallCount);
    console.log('MCP Cleanup tool calls:', cleanupCount);
    console.log('Total MCP tool calls:', toolCallCount + cleanupCount);
    console.log('Page observations:', 6);
    console.log('Observation payload size (normalized UTF-8 bytes):', observationBytes);
    console.log('Failures / retries: 0');
    return { success: true, toolCallCount, cleanupCount, elapsed, observationBytes };
  } catch (err) {
    workflowError = err;
    console.error('\nWorkflow failed:', err.message);
    throw err;
  } finally {
    // Failure-path cleanup: close only this test's session if still active
    if (sessionStarted && !sessionClosed) {
      try {
        console.log(`Performing failure-path cleanup for session '${session}'...`);
        await send('tools/call', { name: 'agent_browser_close', arguments: { session } }, 5000);
      } catch (cleanErr) {
        console.error('Session cleanup error (non-fatal):', cleanErr.message);
      }
    }
    proc.kill();
    // Ensure that if cleanup threw, the original workflow error remains preserved
    if (workflowError) {
      // workflowError already thrown in try/catch
    }
  }
}

// When executed directly as CLI script
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMcpWorkflow().catch((err) => {
    console.error('\nFatal execution error:', err.message);
    process.exit(1);
  });
}

export { runMcpWorkflow };
