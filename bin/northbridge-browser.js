#!/usr/bin/env node

/**
 * Northbridge Browser MCP Server entry point.
 * Launches the pinned agent-browser stdio MCP server with core tools
 * and strict loopback domain restriction (127.0.0.1) by default.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function findAgentBrowser() {
  const localPkg = path.resolve(__dirname, '..', 'node_modules', 'agent-browser', 'bin', 'agent-browser.js');
  if (fs.existsSync(localPkg)) {
    return localPkg;
  }
  const parentPkg = path.resolve(__dirname, '..', '..', 'agent-browser', 'bin', 'agent-browser.js');
  if (fs.existsSync(parentPkg)) {
    return parentPkg;
  }
  return 'agent-browser';
}

const agentBrowserPath = findAgentBrowser();

// Ensure loopback domain confinement by default
if (!process.env.AGENT_BROWSER_ALLOWED_DOMAINS) {
  process.env.AGENT_BROWSER_ALLOWED_DOMAINS = '127.0.0.1';
}

// Forward CLI arguments, defaulting to 'mcp --tools core'
const rawArgs = process.argv.slice(2);
let childArgs;

if (rawArgs.length === 0) {
  childArgs = [agentBrowserPath, 'mcp', '--tools', 'core'];
} else if (rawArgs[0] === 'mcp') {
  if (!rawArgs.includes('--tools')) {
    childArgs = [agentBrowserPath, 'mcp', '--tools', 'core', ...rawArgs.slice(1)];
  } else {
    childArgs = [agentBrowserPath, ...rawArgs];
  }
} else {
  childArgs = [agentBrowserPath, ...rawArgs];
}

const child = spawn(process.execPath, childArgs, {
  stdio: 'inherit',
  env: process.env
});

child.on('error', (err) => {
  console.error(`Failed to launch Northbridge Browser MCP server: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
