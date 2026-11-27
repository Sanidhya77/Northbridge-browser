#!/usr/bin/env node

/**
 * Northbridge Opt-In Chrome Control MCP Server (stdio JSON-RPC 2.0).
 *
 * Launches or attaches to a visible, dedicated Chrome research profile with an
 * original Northbridge Control Console UI. All interactive actions (`snapshot`,
 * `navigate`, `click`, `search_input`, `scroll`, `tab_switch`) require a real
 * user grant in the browser Control Console (or desktop host) before acting.
 * Model-supplied `approved: true` alone is rejected.
 *
 * Note: Read-only summarization remains preserved in `bin/northbridge-summarize-mcp.mjs`.
 */

import readline from 'node:readline';
import path from 'node:path';
import { createControlManager } from '../chrome-control.mjs';

const allowLoopback = process.env.NORTHBRIDGE_CONTROL_ALLOW_LOOPBACK === '1';
const defaultProfileDir = process.env.NORTHBRIDGE_RESEARCH_PROFILE_DIR
  ? path.resolve(process.env.NORTHBRIDGE_RESEARCH_PROFILE_DIR)
  : undefined;

const manager = createControlManager({
  profileDir: defaultProfileDir,
  headless: process.env.NORTHBRIDGE_CONTROL_HEADLESS === '1',
  allowLoopbackForTests: allowLoopback
});

const TOOLS = [
  {
    name: 'northbridge_control_start',
    description:
      'Launch or attach to a visible, dedicated Chrome research profile and open the Northbridge Chrome Control Console. ' +
      'Returns the list of selectable research tabs. The user must click "Select & Grant Control" in Chrome (or confirm in the desktop host) before actions can execute.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        initialUrl: {
          type: 'string',
          description: 'Optional initial public HTTP/HTTPS URL to open in a tab alongside the Control Console.'
        },
        cdp: {
          type: ['string', 'integer'],
          description: 'Optional loopback CDP port if dedicated research Chrome is already running.'
        }
      }
    }
  },
  {
    name: 'northbridge_control_status',
    description:
      'Check the current Chrome control grant status (`none`, `active`, `paused`, `paused_for_user`, `revoked`), ' +
      'which tab is controlled, selectable tabs, and any recorded Google automation blocks.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: 'northbridge_control_act',
    description:
      'Execute an interactive action on the user-granted Chrome tab: `snapshot`, `navigate`, `click`, `search_input`, `scroll`, or `tab_switch`. ' +
      'Requires a genuine user grant in the Control Console UI or desktop host (passing `approved: true` alone is rejected). ' +
      'Automatically hands control back to the user on sign-in or CAPTCHA and logs Google blocks with scholarly fallbacks.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['snapshot', 'navigate', 'click', 'search_input', 'scroll', 'tab_switch'],
          description: 'Action to run on the currently controlled tab.'
        },
        url: { type: 'string', description: 'Target HTTP/HTTPS URL for `navigate`.' },
        ref: { type: 'string', description: 'Element @ref (e.g. `@e5`) for `click` or `search_input`.' },
        selector: { type: 'string', description: 'CSS selector fallback for `click`, `search_input`, or `scroll`.' },
        text: { type: 'string', description: 'Search text for `search_input` (never used for passwords).' },
        submit: { type: 'boolean', default: false, description: 'Press Enter after filling search box.' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], default: 'down' },
        amount: { type: 'integer', minimum: 50, maximum: 5000, default: 700 },
        tab: { type: 'string', description: 'Approved tab title, URL substring, or targetId for `tab_switch`.' },
        section: { type: 'string', description: 'Optional filter substring for compact snapshot output.' },
        maxChars: { type: 'integer', minimum: 200, maximum: 12000, default: 2200 },
        queryHint: { type: 'string', description: 'Optional search query string for block logging.' },
        approved: {
          type: 'boolean',
          description: 'Ignored for self-approval: real user grant in browser/host UI is mandatory.'
        }
      }
    }
  }
];

function writeJsonRpc(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleToolCall(id, params) {
  const name = params?.name;
  const args = params?.arguments || {};

  try {
    let result;
    if (name === 'northbridge_control_start') {
      result = await manager.start({
        initialUrl: args.initialUrl || null,
        cdp: args.cdp || null
      });
    } else if (name === 'northbridge_control_status') {
      result = await manager.status();
    } else if (name === 'northbridge_control_act') {
      result = await manager.act(args);
    } else {
      writeJsonRpc({
        jsonrpc: '2.0',
        id,
        result: { isError: true, content: [{ type: 'text', text: `Unknown tool "${name}".` }] }
      });
      return;
    }

    const prefix = result.ok ? '[UNTRUSTED EXTERNAL DATA] ' : '';
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: !result.ok,
        structuredContent: result,
        content: [{ type: 'text', text: prefix + JSON.stringify(result) }]
      }
    });
  } catch (err) {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: { isError: true, content: [{ type: 'text', text: `CHROME CONTROL ERROR: ${err.message}` }] }
    });
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

async function shutdown() {
  try { await manager.close({ closeBrowser: false }); } catch {}
  process.exit(0);
}

rl.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = req;
  if (id === undefined) return;

  if (method === 'initialize') {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'northbridge-chrome-control', version: '1.0.0' }
      }
    });
    return;
  }

  if (method === 'ping') {
    writeJsonRpc({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'tools/list') {
    writeJsonRpc({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    await handleToolCall(id, params);
    return;
  }

  writeJsonRpc({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  });
});
