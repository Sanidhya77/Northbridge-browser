#!/usr/bin/env node

/**
 * Northbridge Scopus Export MCP Server (stdio JSON-RPC 2.0).
 * Exposes a single high-level tool `northbridge_export_scopus_results` so connected MCP clients
 * can handle plain-language requests ("Use Northbridge to export the first 20 Scopus results")
 * without naming browser engines, selectors, or element refs.
 *
 * Security & Permission Boundaries:
 * - Strictly export-only from an already-open, uniquely matched Scopus results tab.
 * - Requires explicit `approved: true` confirmation; `approved: false` or omitted halts before browser access.
 * - Never executes arbitrary navigation, login/MFA bypass, or public research browsing.
 */

import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { exportScopusResultsTab } from '../scopus-workflow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'pilot-exports');

const TOOLS = [
  {
    name: 'northbridge_export_scopus_results',
    description:
      'Export a bounded batch of records as CSV from an already-open, user-approved Scopus search results tab ' +
      '(drives Export -> CSV, sets document range, enables Abstract & keywords, attributes ONLY the fresh download ' +
      'from this click, verifies required columns separately from blank cells, and saves into an ignored export directory ' +
      'preserving existing files). Never bypasses login/MFA/CAPTCHA or rewrites queries.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: {
          type: 'integer',
          minimum: 1,
          default: 1,
          description: 'First record index to export (1-based, default: 1).'
        },
        to: {
          type: 'integer',
          minimum: 1,
          default: 20,
          description: 'Last record index to export (inclusive, default: 20 unless count is provided).'
        },
        count: {
          type: 'integer',
          minimum: 1,
          description: 'Alternative to "to": number of records to export starting from "from".'
        },
        tab: {
          type: 'string',
          default: 'Scopus',
          description: 'Title, URL substring, or tab ID uniquely identifying the open Scopus results tab (default: "Scopus").'
        },
        expectedQuery: {
          type: 'string',
          description: 'Optional exact Scopus query expected on the results tab; halts before export if mismatched.'
        },
        block: {
          type: 'string',
          description: 'Optional search block identifier (e.g. "D3") used in the default CSV filename.'
        },
        exportFile: {
          type: 'string',
          description: 'Optional target CSV filename inside outputDir (must be a plain filename without path separators).'
        },
        outputDir: {
          type: 'string',
          description: 'Optional destination folder (defaults to project pilot-exports/, which is gitignored).'
        },
        approved: {
          type: 'boolean',
          description: 'Must be true to confirm the user explicitly approved connecting to their open Scopus tab and running one CSV export.'
        },
        cdp: {
          type: ['string', 'integer'],
          description: 'Optional loopback Chrome debugging port or URL fallback (e.g. 9222). Omit to use dynamic auto-connect discovery.'
        },
        autoConnect: {
          type: 'boolean',
          default: true,
          description: 'Use dynamic Chrome DevTools auto-connect discovery (default: true when cdp is omitted).'
        },
        pinTab: {
          type: 'boolean',
          default: true,
          description: 'Pin browser session strictly to the matched tab without fallback (default: true).'
        },
        profileDir: {
          type: 'string',
          description: 'Optional Chrome User Data directory override for DevToolsActivePort discovery.'
        }
      },
      required: ['approved']
    }
  }
];

let inFlight = false;

function writeJsonRpc(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleToolCall(id, params) {
  const toolName = params?.name;
  const args = params?.arguments || {};

  if (toolName !== 'northbridge_export_scopus_results') {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool "${toolName}". Available tool: northbridge_export_scopus_results.` }]
      }
    });
    return;
  }

  if (args.approved === false) {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [{ type: 'text', text: 'APPROVAL ERROR: Browser connection denied by user. Halting before accessing Chrome.' }]
      }
    });
    return;
  }

  if (args.approved !== true) {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [{
          type: 'text',
          text: 'APPROVAL ERROR: Explicit user approval is required before attaching to the open Scopus browser tab and triggering CSV export. Ask the user to confirm and pass approved: true.'
        }]
      }
    });
    return;
  }

  if (inFlight) {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [{ type: 'text', text: 'BUSY: Another Scopus export operation is already in progress.' }]
      }
    });
    return;
  }

  inFlight = true;
  try {
    const from = args.from != null ? Number(args.from) : 1;
    const count = args.count != null ? Number(args.count) : null;
    const to = args.to != null ? Number(args.to) : (count != null ? from + count - 1 : 20);
    const hasCdp = args.cdp !== undefined && args.cdp !== null && String(args.cdp).trim() !== '';
    const autoConnect = args.autoConnect !== undefined ? Boolean(args.autoConnect) : !hasCdp;
    const outputDir = args.outputDir ? path.resolve(String(args.outputDir)) : DEFAULT_OUTPUT_DIR;
    const exportFile = args.exportFile
      ? String(args.exportFile)
      : (args.block
        ? `Ch3_34_SC_${String(args.block).replace(/[^A-Za-z0-9_-]/g, '')}_${from}-${to}.csv`
        : `scopus_export_${from}-${to}.csv`);

    const res = await exportScopusResultsTab({
      from,
      to,
      count,
      expectedQuery: args.expectedQuery || null,
      outputDir,
      exportFile,
      tab: args.tab || 'Scopus',
      cdp: hasCdp ? args.cdp : null,
      autoConnect,
      approved: true,
      pinTab: args.pinTab !== false,
      profileDir: args.profileDir ? path.resolve(String(args.profileDir)) : null
    });

    const summaryLines = res.ok
      ? [
          `Scopus CSV Export Succeeded (${res.status})`,
          `Displayed Query: ${res.displayedQuery}`,
          `Total Results Observed: ${res.totalMain}`,
          `Exported Batch: ${res.effectiveRange.from}-${res.effectiveRange.to} (${res.parsedRowCount} rows verified)`,
          `Saved File: ${res.exportFilePath}`,
          `Existing File Preserved: ${res.preservedExistingFile ? 'Yes (collision saved to unique filename)' : 'N/A (new file)'}`,
          `Columns Verified: ${JSON.stringify(res.presentColumns)}`,
          `Blank Cells Within Valid Rows: ${JSON.stringify(res.blankCells)}`,
          `Download Attribution: ${res.downloadAttribution?.method || 'unknown'}`,
          `Metrics: browserActionMs=${res.metrics?.browserActionMs}, totalWallMs=${res.metrics?.totalWallMs}, toolCalls=${res.metrics?.toolCalls}`
        ]
      : [
          `Scopus CSV Export Halted (${res.status || 'ERROR'})`,
          res.error
        ];

    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: !res.ok,
        structuredContent: res,
        content: [{ type: 'text', text: summaryLines.join('\n') }]
      }
    });
  } catch (err) {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        isError: true,
        content: [{ type: 'text', text: `EXPORT ERROR: ${err.message}` }]
      }
    });
  } finally {
    inFlight = false;
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('close', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch (err) {
    console.error('[northbridge-scopus-mcp] Invalid JSON:', err.message);
    return;
  }

  const { id, method, params } = req;
  if (id === undefined) return; // Notification

  if (method === 'initialize') {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'northbridge-scopus-export', version: '1.0.0' }
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
