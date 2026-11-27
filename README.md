# Northbridge Browser

Northbridge is a local Windows Model Context Protocol (MCP) server for web research (`Node.js >= 24.0.0`). It helps AI agents discover public pages, extract readable text and Word attachments, and assist inside a visible, user-controlled Chrome research profile using accessibility snapshots rather than screenshots by default.

## What is in 1.1.0

- **Public research** — read known HTTPS URLs and extract DOCX attachments with `northbridge-summarize-mcp`. Web search through Brave requires a Brave Search API key.
- **Opt-in Chrome control** — use `northbridge-control-mcp` or the `northbridge-control` launcher to work in a dedicated research profile with tab approval, pause and revoke controls.
- **Windows MCP fixes** — report child-process startup and exit errors promptly and check domain approval before launching the browser engine.

## Quickest Setup

### Option A — From GitHub

```powershell
git clone https://github.com/Sanidhya77/Northbridge-browser.git
Set-Location Northbridge-browser
npm.cmd ci
.\node_modules\.bin\agent-browser.cmd install
```

### Option B — From npm

```powershell
npm.cmd install @sanidhya77/northbridge-browser@1.1.0
```

Add the stdio server(s) to your MCP client using `"command": "node"` (example for VS Code `.vscode/mcp.json` from a clone):

```json
{
  "servers": {
    "northbridge-summarize": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/bin/northbridge-summarize-mcp.mjs"],
      "env": { "NORTHBRIDGE_APPROVED_DOMAINS": "" }
    },
    "northbridge-control": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/bin/northbridge-control-mcp.mjs"]
    }
  }
}
```

See [docs/client-setup.md](docs/client-setup.md) for Codex CLI, Google Antigravity, Cursor, npm path examples, and optional Brave Search key setup.

---

## Example Workflow (Two-Call Public Attachment to DOCX)

No Brave key or Chrome window is needed to read known public URLs:

> Use Northbridge to open `https://cse.sustech.edu.cn/en/graduate/3796.html` and find Annex 2. Open the returned DOCX with Northbridge and summarize its headings, minimum length, and signature fields with the final URL.

1. Find the attachment URL with `northbridge_read_public_page`:
   ```json
   {"url":"https://cse.sustech.edu.cn/en/graduate/3796.html","attachment":"Annex 2"}
   ```
2. Extract readable text, headings, and tables from the returned DOCX URL:
   ```json
   {"url":"https://gs.sustech.edu.cn/static/upload/file/20261102/17935877682607.docx","extract_docx":true,"maxChars":3000}
   ```

---

## Dedicated Chrome Control: Approve, Pause & Revoke

`northbridge-control` launches a visible Chrome window isolated to `%LOCALAPPDATA%\Northbridge\ResearchProfile` (shared default Chrome `User Data` profiles are rejected) alongside the loopback **Chrome Opt-In Control Console** (`http://127.0.0.1:<port>/control`):

1. **Start**: Call `northbridge_control_start` in MCP (or run `node bin/northbridge-control.mjs --url https://arxiv.org/`).
2. **Approve**: Select a research tab in the Control Console and click **Select & Grant Control**. Agent self-approval (`approved: true` alone) is rejected.
3. **Pause & Handback**: Click **Pause Control** in the Console (or type `pause` in CLI), then **Resume Control** when ready. Sign-in screens, password inputs, and CAPTCHAs automatically pause (`paused_for_user`) so you complete them manually; Google automation blocks log diagnostics and return keyless fallbacks.
4. **Revoke**: Click **Revoke Control** (or type `revoke` in CLI) to end control immediately.

---

## Docs & Local Verification

- [Client Setup (VS Code, Codex, Antigravity, Cursor, Brave)](docs/client-setup.md)
- [Workflows, Demos & Troubleshooting](docs/workflows-and-troubleshooting.md)
- [Windows Permissions & Trade-Offs: MV3 Extension vs. CDP Adapter](docs/chrome-extension-vs-cdp-tradeoffs.md)
- [Pilot handoff](https://github.com/Sanidhya77/Northbridge-browser/blob/main/HANDOFF.md) and [benchmark notes](https://github.com/Sanidhya77/Northbridge-browser/blob/main/BENCHMARK.md)
- [MIT license](LICENSE)

Verify locally via PowerShell:

```powershell
npm.cmd test
npm.cmd run test:control
```
