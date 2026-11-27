# Workflows, Demos & Troubleshooting

## 1. Read-Only Research Workflows (`northbridge-summarize`)

### Search and verify a live source
Prompt:
> Use Northbridge to find the FlexInfer paper. Read the abstract from the original page and report the final URL and what you could verify.

- Use `northbridge_search_web` (`indexed_excerpts: true` returns at most two labelled indexed excerpts per query) to locate candidate URLs.
- Always verify claims directly against the original page with `northbridge_read_public_page` (pass `section` to target a heading and `maxChars` to cap output).

### Access boundaries on read-only tools
- **Direct public reads** (`northbridge_read_public_page`) use HTTPS on port `443`, resolve and validate public IPv4 addresses (including redirects), and send no cookies or auth headers. HTML and plain text work by default; set `attachment` for link filtering and `extract_docx: true` for DOCX extraction.
- **Rendered fallback** (`rendered_fallback: true`) runs Agent Browser accessibility snapshots only if direct reading hits `unsupported_content` or empty text. Domain checks evaluate `AGENT_BROWSER_ALLOWED_DOMAINS`, then `NORTHBRIDGE_APPROVED_DOMAINS`, defaulting to loopback (`127.0.0.1`). Blocked HTTP status codes (`401`, `403`, `429`) remain blocked.
- **Browser summaries** (`northbridge_summarize_page`) require server-configured `NORTHBRIDGE_APPROVED_DOMAINS` for `url` mode, or explicit `approved: true` + `tab` for approved-tab mode in a dedicated Chrome profile.

---

## 2. Opt-In Dedicated Chrome Control (`northbridge-control`)

Available from the GitHub source today (`bin/northbridge-control-mcp.mjs` and CLI `bin/northbridge-control.mjs`).

1. **Launch a visible dedicated research profile** (`%LOCALAPPDATA%\Northbridge\ResearchProfile` by default; shared default Chrome `User Data` profiles are rejected):
   - Via MCP: call `northbridge_control_start` (with optional `initialUrl` or `cdp` port).
   - Via CLI:
     ```powershell
     node bin/northbridge-control.mjs --url https://arxiv.org/
     ```
2. **Approve a tab in the Control Console**:
   - Northbridge opens the loopback **Chrome Opt-In Control Console** (`http://127.0.0.1:<port>/control`) protected by a per-launch `uiToken` withheld from MCP outputs.
   - Select the target tab and click **Select & Grant Control**. Passing `approved: true` from a model call alone is rejected (`HOST_GRANT_REQUIRED`).
3. **Interactive actions on the granted tab** (`northbridge_control_act`):
   - Supports `snapshot`, `navigate`, `click`, `search_input`, `scroll`, and `tab_switch`.
   - Controlled tabs show a read-only Shadow DOM status pill (`Northbridge Controlling`).
4. **Pause, handback & revoke**:
   - Click **Pause Control** / **Resume Control** in the Console (or type `pause` / `resume` in CLI).
   - Sign-in prompts, password fields, and CAPTCHAs automatically set status to `paused_for_user`, hand control back without touching credentials or bypassing challenges, and wait for manual completion + **Resume Control**.
   - Google / Google Scholar automation blocks (`/sorry/index`, unusual-traffic checks) stop cleanly, log block diagnostics, and return keyless scholarly fallbacks (`openalex`, `crossref`, `datacite`, `semantic_scholar`).
   - Click **Revoke Control** (or `revoke` in CLI) to terminate control permanently for that grant.

For controlling everyday signed-in Chrome tabs later, review the Windows Registry and permission trade-offs in [docs/chrome-extension-vs-cdp-tradeoffs.md](chrome-extension-vs-cdp-tradeoffs.md).

---

## 3. Optional Mock Portal & Scopus Demos

* **Mock university portal**: Start the fixture server (`npm.cmd start`, serving `http://127.0.0.1:4317/`) and test with the loopback `northbridge-browser` MCP server or `npm.cmd run test:mcp` / `npm.cmd run test:lookup`. See [BENCHMARK.md](../BENCHMARK.md).
* **Scopus pilot workflow**: Start the fixture (`npm.cmd run start:scopus` on port `4318`) and run:
  ```powershell
  node bin/northbridge-scopus.mjs --block D3
  ```
  For live institutional Scopus tabs, attach `northbridge-scopus` (`bin/northbridge-scopus-mcp.mjs`) strictly to an explicitly approved dedicated Chrome profile. See [HANDOFF.md](../HANDOFF.md) for acceptance limits.

---

## 4. Verify Locally

```powershell
npm.cmd test
npm.cmd run test:control
npm.cmd run test:summary
npm.cmd run test:scopus
npm.cmd run test:mcp
```

For `npm.cmd run test:research`, start the mock portal (`npm.cmd start`) in a separate terminal first so `http://127.0.0.1:4317/` is reachable.

---

## 5. Troubleshooting

* **Server missing or failed to start**: Confirm `node` (`>= 24.0.0`) is on `PATH`, `npm.cmd ci` completed cleanly, and your client MCP config uses `"command": "node"` with the `.mjs` path in `"args"`.
* **Windows `EPERM unlink` on `agent-browser-win32-x64.exe` during `npm.cmd ci`**: An active MCP server session is holding `node_modules\agent-browser\bin\agent-browser-win32-x64.exe` open. Close the MCP sessions using that checkout cleanly before rerunning `npm.cmd ci`, or test from a clean copy under `%TEMP%` excluding `.git`, `node_modules`, `.agent-browser`, `.agent-browser-runtime`, `exports`, and `pilot-exports`.
* **`SEARCH_NOT_CONFIGURED`**: `NORTHBRIDGE_BRAVE_SEARCH_API_KEY` is missing or was updated without restarting the `northbridge-summarize` MCP server.
* **`blocked`, `policy_blocked`, `APPROVAL_REQUIRED`, or `HOST_GRANT_REQUIRED`**:
  * `APPROVAL_REQUIRED`: Add public hostnames to `NORTHBRIDGE_APPROVED_DOMAINS` (for `northbridge-summarize`) or pass explicit open-tab consent where supported.
  * `HOST_GRANT_REQUIRED`: Open the Control Console tab in Chrome and click **Select & Grant Control** (`approved: true` from an agent call cannot self-approve).
  * `blocked` / `policy_blocked`: Remote challenge or loopback/private network protection stopped the request; respect the stop rather than retrying automatically.
