import { spawn } from 'node:child_process';
import path from 'node:path';

async function runSiteBlockTest() {
  console.log('Testing remote site security / anti-bot block (MBZUAI)...');
  const clientPath = path.resolve('bin/northbridge-research.js');
  const proc = spawn(process.execPath, [clientPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      NORTHBRIDGE_APPROVED_DOMAINS: 'mbzuai.ac.ae'
    }
  });

  let buffer = '';
  const pending = new Map();
  let msgId = 0;

  proc.stdout.on('data', d => {
    buffer += d.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const msg = JSON.parse(l);
        if (msg.id !== undefined && pending.has(msg.id)) {
          const { resolve } = pending.get(msg.id);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch (e) {}
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  await send('initialize', {
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'block-test', version: '1.0' },
    capabilities: {}
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

  console.log('Navigating to https://mbzuai.ac.ae/ ...');
  const session = 'test-mbzuai-block';
  const openResp = await send('tools/call', {
    name: 'agent_browser_open',
    arguments: { url: 'https://mbzuai.ac.ae/', session }
  });
  console.log('Open result:', JSON.stringify(openResp.result, null, 2));

  console.log('Taking snapshot of MBZUAI response...');
  const snapResp = await send('tools/call', {
    name: 'agent_browser_snapshot',
    arguments: { session }
  });
  console.log('Snapshot result:', JSON.stringify(snapResp.result, null, 2));

  await send('tools/call', {
    name: 'agent_browser_close',
    arguments: { session }
  });

  proc.stdin.end();
  proc.kill();
  process.exit(0);
}

runSiteBlockTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
