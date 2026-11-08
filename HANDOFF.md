# Project Handoff · Windows Browser Tools for Coding Agents

**Prepared for**: Project Owner & Codex Reviewers\
**Project**: `university-browser-demo`\
**Date**: November 6, 2026\
**Final Release & Verification Status**:
- **Local Demo Preview (`northbridge-browser`)**: **Ready for independent review** (100% verified across MCP and PowerShell CLI)
- **Scopus Local Fixture (`scopus-fixture.mjs` / `scopus-workflow.mjs`)**: **Fixture Verified** (22/22 checks pass, collision & tab audit issues resolved)
- **External Chrome Attachment (`validateCdpEndpoint` / `verifyCdpAttachment`)**: **Attachment Verified** (rejection of `{}` empty metadata, loopback enforcement, process & tab isolation, active tab target ID/URL verification)
- **External Chrome CLI (`bin/northbridge-scopus.mjs`)**: **CLI Verified** (clean exit code 0, 4 parsed CSV records, pre-existing collision preservation, unrelated tab untouched, external Chrome remains open)
- **Live Authenticated Scopus (`northbridge-scopus.mjs`)**: **Pending Live Pilot** (Protocol, CDP attach, and prompt ready for user-selected route; RTU, other institutions, and direct accounts unverified until tested live)
- **Public Distribution (`northbridge-browser-research` & VS Code 1-Click)**: **Blocked / Pending** (Withheld on connection-time IP gap; install link pending npm registry release)

---

## 1. Executive Summary & Component Status

This handoff documents the release verification of the Windows browser tools in `university-browser-demo`, including the verified Scopus systematic literature search and CSV export capability designed for thesis research blocks.

### Scope & Evaluation Clarifications
- **Local Demo Preview**: The admissions demo is documented as a **local preview** of single-session browser interaction through structured accessibility trees and stable element references (`@ref`), not an end-to-end multi-agent evaluation.
- **Desktop Browser Traces**: Full browser tool traces and session metrics are retained as concrete evidence of a working local connection.
- **Token Cost Hypothesis**: Lower token cost compared to visual coordinate clicking remains a **hypothesis pending a matched `@Chrome` benchmark run** with an LLM in the loop; normalized UTF-8 byte reduction (~97.8%) serves solely as an observation payload size proxy.
- **Default Setup Policy**: The public research server (`northbridge-browser-research`) is kept **out of the default setup** (`.vscode/mcp.json`) while the upstream connection-time private-network IP gap remains open.

### Status Matrix

| Component | Status | Verification Summary |
|---|---|---|
| **Local Demo Preview** (`northbridge-browser`) | **Ready for independent review** | 100% verified across both MCP stdio and PowerShell CLI fallback. Automated scripted lookup (`npm.cmd run test:lookup`), 14-action full acceptance (`npm.cmd run test:mcp`), and 14-invocation CLI acceptance (`npm.cmd run test:cli`) all pass with **0 failures**, **0 retries**, and exact value `"Draft"`. Mock portal (`portal.html`, `server.mjs`) and baseline benchmarks (`BENCHMARK.md`) are preserved intact. |
| **Scopus Local Fixture** (`scopus-fixture.mjs` / `scopus-workflow.mjs`) | **Fixture Verified (Ready for review)** | 100% verified on a dedicated local Scopus fixture (`scopus-fixture.mjs`). Real query shape **Block D3** executed without query modification. Preprints isolated from main count and export. Control paper (*Decision quality using ranked attribute weights*) confirmed in block. Fresh CSV download verified via attempt-specific filename capture and RFC 4180 parsing with multiline abstract support. Atomic candidate naming (`COPYFILE_EXCL`) preserves existing files byte-for-byte on successful collisions. All 22 regression tests pass (`npm.cmd run test:scopus`). |
| **External Chrome Attachment** (`validateCdpEndpoint` / `verifyCdpAttachment`) | **Attachment Verified (Ready for review)** | Verified against an externally launched Chrome instance on loopback port 9223 with an isolated profile. Successfully attaches, validates loopback address (`127.0.0.1` / `localhost`), strictly validates debugger metadata (rejects `{}` empty objects and requires valid `Browser` string), performs pre-flight HTTP probe to `/json/version` (halting cleanly on unavailable or non-loopback endpoints without launching replacement browsers), verifies `agent_browser_tab_switch` success, re-reads active tab to verify target ID and URL before typing/clicking, and executes dedicated `verifyCdpAttachment` on a harmless target tab (`/scopus/harmless`) without search/export shortcuts. |
| **External Chrome CLI** (`bin/northbridge-scopus.mjs`) | **CLI Verified (Ready for review)** | Tested against an externally launched Chrome instance with child process execution capture. Conforms to documented CLI flags (`--cdp`, `--tab`, `--block`, `--query`, `--control`, `--export`). Exits cleanly with code `0`, exports 4 parsed CSV records, preserves existing same-name files byte-for-byte under atomic candidate naming (`Ch3_34_SC_D3_cli_acceptance (1).csv`), leaves unrelated tabs completely untouched at their original URL and target ID, and leaves the external Chrome process running. |
| **Live Authenticated Scopus** (`northbridge-scopus.mjs`) | **Pending Live Pilot** | Protocol designed for explicit, user-initiated authentication through user-selected routes (RTU library ORTUS / EZproxy, other institutions, or direct personal accounts) via pre-authenticated tab via CDP (port 9222). Credentials, passwords, MFA codes, and session tokens remain strictly out of prompts, logs, and exports. **RTU, other institutions, and direct personal accounts remain individually unverified until tested live with the owner**. |
| **Public Distribution** (`northbridge-browser-research` & VS Code 1-Click) | **Blocked / Pending** | **Public Research (`northbridge-browser-research`) is BLOCKED**: Pre-navigation URL validation and session isolation pass all tests (9/9), but the upstream engine (`agent-browser: 0.41.2`) filters strictly by hostname string in Chrome DevTools Protocol (`Fetch.enable` / `Fetch.requestPaused`) without connection-time IP verification, allowing connections if an approved hostname points to loopback during redirects (2 hits recorded). Kept out of default setup. **VS Code 1-Click Link is PENDING**: Marked pending publication of the npm package or clean-setup verification; local workspace configuration is used instead. |

---

## 2. Changed and Created Files

| File | Status | Purpose |
|---|---|---|
| `scopus-fixture.mjs` | **Updated** | Dedicated Scopus test fixture server listening on port 4318. Serves Advanced search, synthetic documents matching real Block D3 query, separate preprints counter, search-within-results, export modal with Citation info and Abstract & keywords, simulated auth/bot challenge gates, and harmless test target (`/scopus/harmless`). |
| `scopus-workflow.mjs` | **Updated** | Reusable 5-step Scopus automation engine. Connects to `agent-browser` MCP over stdio or external Chrome via CDP. Enforces loopback-only CDP endpoints (`validateCdpEndpoint`) with pre-flight `/json/version` probe and strict debugger metadata validation (rejecting `{}` empty responses), verifies `tab_switch` success, re-reads active tab to verify target ID and URL before typing/clicking, exports dedicated `verifyCdpAttachment` without search shortcuts, implements atomic candidate naming (`fs.constants.COPYFILE_EXCL`) preserving existing files on collision byte-for-byte, strict attempt download matching, exact query execution, preprint separation, control paper indexing verification, and reproducible search logs. |
| `bin/northbridge-scopus.mjs` | **Updated** | CLI and desktop agent executable entrypoint (`northbridge-scopus`). Auto-starts fixture when testing locally, accepts CLI options (`--block`, `--claim`, `--query`, `--control`, `--export`, `--cdp`, `--attach-chrome`, `--tab`, `--verify-attachment`), requires `--tab` under CDP, guarantees explicit `process.exit(0)` on success, and prints standard search logs. |
| `test-scopus-acceptance.mjs` | **Expanded** | 22-test automated acceptance suite for Scopus workflow (`npm.cmd run test:scopus`) covering fresh download capture, preservation of existing files on failure, bounded wait, multiline parsing, count checks, traversal, rejected/rewritten/missing queries, filter restoration, missed controls, strict unique/missing/ambiguous tab selection, institutional auth pause, bot challenge stop, disk persistence, successful export collision preservation byte-for-byte (Test 17), external Chrome attachment to harmless page and real block execution (Test 18), empty metadata `{}`, unavailable, and non-loopback CDP rejection (Test 19), missing, ambiguous, failed switch, and active tab mismatch handling on external Chrome (Test 20), pinned engine rejection of `--cdp` combined with `--allowed-domains` (Test 21), and standalone CLI execution against external Chrome via child process exiting cleanly with code `0`, 4 records, and same-name collision preservation (Test 22). |
| `exports/Ch3_34_SC_D3.csv` | **Created** | Verified generated Scopus CSV export for Block D3 (4 records + header row, 4,258 bytes). |
| `exports/Ch3_34_SC_D3_missed.csv`| **Created** | Verified generated Scopus CSV export for missed-control test case (2 records + header row, 2,261 bytes). |
| `bin/northbridge-research.js` | **Maintained** | Session-isolated, read-only research MCP server with pre-navigation domain and DNS checks. |
| `test-research-policy.mjs` | **Maintained** | 9-check automated regression suite covering session isolation and private fixture request checks. |
| `test-site-block.mjs` | **Maintained** | Automated test verifying remote site security / WAF block handling on `https://mbzuai.ac.ae/`. |
| `package.json` | **Updated** | Added `northbridge-scopus` to `bin`, and `start:scopus`, `test:scopus` scripts. |
| `README.md` | **Updated** | Updated documentation covering Scopus search and CSV export, atomic collision preservation, external Chrome attachment architecture, and allowlist boundaries. |
| `HANDOFF.md` | **Updated** | Complete documentation of Scopus workflow verification, fixture request counts, tool traces, CDP attachment, and live pilot protocol. |
| `bin/northbridge-browser.js` | **Preserved** | Loopback demo MCP entrypoint strictly confined to `127.0.0.1`. |
| `test-mcp-lookup.mjs` | **Preserved** | Scripted MCP lookup test with zero hardcoded date/URL fallbacks. |
| `test-mcp-acceptance.mjs` | **Preserved** | Full MCP acceptance test (14 actions to human review checkpoint). |
| `test-cli-acceptance.ps1` | **Preserved** | PowerShell CLI fallback acceptance test. |
| `portal.html` | **Unchanged** | Shipped mock admissions portal frontend strictly preserved. |
| `server.mjs` | **Unchanged** | Shipped loopback HTTP server strictly preserved. |
| `package-lock.json` | **Unchanged** | Pinned baseline strictly maintained (`agent-browser: 0.41.2`). |
| `BENCHMARK.md` | **Maintained** | Original baseline pilot benchmark and 3x repeatability benchmark preserved intact. |

---

## 3. Scopus Paper Search & CSV Export Workflow (Fixture Verified)

### Workflow Specification: Block D3
- **BLOCK**: `D3`
- **CLAIM**: `Weights can be derived from a rank order.`
- **QUERY**: `TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )`
- **CONTROL**: `Decision quality using ranked attribute weights`
- **EXPORT FILE**: `Ch3_34_SC_D3.csv`
- **DEDICATED OUTPUT FOLDER**: `./exports`

### 5-Step Execution Trace via Browser Tools

1. **Step 1 · Navigation & Exact Query Execution**:
   - `agent_browser_open` -> Opened `http://127.0.0.1:4318/`.
   - `agent_browser_snapshot` -> Located navigation link/tab `Advanced document search` (`@ref`).
   - `agent_browser_click` -> Navigated to Advanced Search.
   - `agent_browser_snapshot` -> Located query input `textbox "Enter query string:"` and search button `button "Search"`.
   - `agent_browser_fill` -> Entered query exactly as supplied without filters or sort changes: `TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )`.
   - `agent_browser_click` -> Executed search.
   - `agent_browser_snapshot` -> Observed results header: `4 document results`, date of search `6 Nov 2026`, and executed query string.
2. **Step 2 · Preprints Isolation**:
   - `agent_browser_snapshot` -> Observed preprints tab `button "Preprints (1)"`.
   - Recorded `totalPreprints = 1`. Preprints are kept strictly separate from the main count (`4`) and excluded from the CSV export.
3. **Step 3 · Control Paper Verification**:
   - In results view, located `textbox "Search within results (e.g. control title)..."` and `button "Search within"`.
   - `agent_browser_fill` -> Entered exact control title: `"Decision quality using ranked attribute weights"`.
   - `agent_browser_click` -> Filtered results.
   - `agent_browser_snapshot` -> Heading confirmed `1 document results` and observed title matching control paper.
   - Status marked: `FOUND in block` and `INDEXED`.
4. **Step 4 · Fresh Download, Non-Destructive Collision Placement, & Disk Verification**:
   - Navigated back to full block results (4 documents).
   - `agent_browser_click` on `button "Export"`.
   - `agent_browser_snapshot` of Export dialog modal -> Verified format `CSV (Excel)`, checkbox `Citation information` (checked), checkbox `Abstract & keywords` (checked).
   - Filled target filename: `Ch3_34_SC_D3.csv`.
   - `agent_browser_click` on `button "Confirm Export"`.
   - **Strict Attempt Download Capture**: Identifies fresh download strictly by attempt-specific filename (`${baseName}.attempt-${attemptId}.csv`) or exact attempt ID. Loose prefix matching (`file.startsWith('scopus')`) is eliminated.
   - **Pre-Placement CSV Validation**: Parses CSV using RFC 4180 state machine. Verifies required columns (`Authors`, `Title`, `Year`, `Source title`, `DOI`, `Abstract`, `Author Keywords`) and verifies document row count matches observed results count (4 records + header) *before* touching `exports/`.
   - **Atomic Non-Destructive Collision Placement**: If the target filename already exists in `exports/`, Northbridge never overwrites it. Using `fs.copyFileSync(..., fs.constants.COPYFILE_EXCL)`, it places the verified file under an incremental unique candidate filename (`${base} (${counter})${ext}`). Existing files are preserved byte-for-byte, and both the actual placed path and confirmation of preservation are reported in the search log and last line.
5. **Step 5 · Reproducible Search Log**:
   - Clean session teardown (`agent_browser_close`).
   - Formatted and returned reproducible search log.

### Observed Search Execution Log (Block D3)

```text
SEARCH ROWS
SITE | BLOCK | ROW TYPE | STRING AS EXECUTED | FILTERS | TOTAL | DATE | FILE | MESSAGES
Scopus | D3 | MAIN | TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" ) | None | 4 | 2026-11-06 | exports/Ch3_34_SC_D3.csv | None
Scopus | D3 | PREPRINTS | TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" ) | None | 1 | 2026-11-06 | None | Excluded from main count and export

CONTROL ROWS
SITE | BLOCK | TITLE | FOUND / NOT FOUND / UNCLEAR | INDEXED / NOT INDEXED / UNCLEAR
Scopus | D3 | Decision quality using ranked attribute weights | FOUND | INDEXED

LAST LINE
OK: 4 main records exported to exports/Ch3_34_SC_D3.csv; control paper confirmed in block; 1 preprint excluded.
```

### Generated CSV Verification & Record Counts

| Metric | Expected | Actual Observed | Status |
|---|:---:|:---:|---|
| **Total Main Document Records** | 4 | 4 | **MATCH** |
| **Total Preprints** | 1 (isolated) | 1 (isolated) | **MATCH** |
| **CSV File Path** | `exports/Ch3_34_SC_D3.csv` | `exports/Ch3_34_SC_D3.csv` | **VERIFIED ON DISK** |
| **CSV File Size** | ~4.2 KB | 4,258 bytes | **VERIFIED** |
| **CSV Total Lines** | 5 lines (1 header + 4 records) | 5 lines | **MATCH** |
| **Control Paper Present in CSV** | Yes (Butler et al., 1997) | Present on Line 2 | **CONFIRMED** |
| **Citation Information Fields** | Authors, Title, Year, Source, Vol, Issue, Pages, DOI | Present | **CONFIRMED** |
| **Abstract & Keywords Fields** | Abstract, Author Keywords, Index Keywords | Present | **CONFIRMED** |

### Institutional & Environmental Compatibility Matrix

| Route / Account Type | Status | Supported Behaviors & Fallbacks |
|---|:---:|---|
| **Local Fixture** (`scopus-fixture.mjs`) | **Verified** | 100% automated regression pass (21/21 checks). Fresh browser download verified, multiline abstracts parsed via RFC 4180, path traversal blocked, exact query comparison verified, and search-within filter clearing proven. |
| **External Chrome Attachment** (CDP Port 9222 / 9223) | **Verified** | Tested on external Chrome with isolated profile and harmless local page (`/scopus/harmless`). Enforces loopback endpoints (`validateCdpEndpoint`), pre-flight HTTP probe to `/json/version` preventing silent browser fallback, strict unique tab matching, and leaves unrelated tabs and browser processes untouched. Pinned engine incompatibility between `--cdp` and `--allowed-domains` proved and documented. |
| **Riga Technical University (RTU)** | **Pending Live Pilot** | Full integration protocol ready via EZproxy/ORTUS (`*.scopus.com`, `*.rtu.lv`). Supports user-selected route with zero credential exposure. **Unverified until tested live with the owner**. |
| **Other Institutions** (e.g. UL, Tartu, Consortium) | **Pending Live Pilot (Simulated)** | Verified via simulated institutional proxy route (`/scopus/other-institution`). Pauses for institutional login and MFA. Checks and clearly reports if institutional subscription lacks Advanced Search or Export permissions. **Individually unverified until tested live**. |
| **Direct Personal Account** | **Pending Live Pilot (Simulated)** | Verified via direct login route (`/scopus/direct`). Pauses for user credentials. **Individually unverified until tested live**. |

### Automated Edge Case & Regression Suite (`test-scopus-acceptance.mjs`)

The automated suite executes all 21 required regression checks (`npm.cmd run test:scopus`):

| Test Case | Scenario / Condition | Observed Result | Status |
|---|---|---|:---:|
| **1. Valid Block D3 Execution** | Real block query executed against fixture; downloads CSV to user `Downloads`, moves to `exports/Ch3_34_SC_D3.csv`, parses 4 records + header. | Fresh download captured, control confirmed in block, preprints (1) isolated, CSV columns verified. | **PASS** |
| **2. Failed Export Preservation** | Disposable file placed in `Downloads` and `exports/`; export simulated as failing. | Existing files in Downloads and exports folders preserved byte-for-byte; runner exits with bounded timeout error. | **PASS** |
| **3. Download Timeout (Bounded Wait)** | Download never arrives from browser within timeout limit. | Runner polls for bounded duration (1.5s in test) and exits with `EXPORT FAILED`. No unverified file written. | **PASS** |
| **4. Multiline Abstract Parsing** | Abstract in doc-1 contains 3 paragraphs separated by newlines, internal commas, and escaped quotes (`""`). | RFC 4180 state machine parses exactly 5 rows (1 header + 4 records) without phantom rows or split columns. Newlines and quotes preserved. | **PASS** |
| **5. Count Mismatch Detection** | Database results page shows 4 documents, but downloaded CSV only contains 2 records (`mismatch=1`). | Runner parses CSV, compares row count, flags `EXPORT INCOMPLETE: Expected 4 records, but file contains 2`. | **PASS** |
| **6. Path Traversal Protection** | Export filename supplied as `../outside.csv`. | Runner rejects filename with `REJECTED: Target export filename '../outside.csv' rejected`. Fixture endpoint returns HTTP 400 Bad Request. No outside file written. | **PASS** |
| **7. Rejected Query (Syntax Error)** | Query contains unbalanced parenthesis `TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*"`. | Database error alert captured, marked `NOT EXECUTED: Syntax error in query`, halts before export. | **PASS** |
| **8. Rewritten Query Detection** | Database silently appends `AND (LIMIT-TO (DOCTYPE, "ar"))` to query box. | Observed query compared with submitted query; mismatch detected; marked `NOT EXECUTED: Database rewrote query to '...'`. Halts before export. | **PASS** |
| **9. Missing Query Display** | Results page lacks `#query-executed` element (`missing_query=1`). | Runner detects missing query box; marks `UNCLEAR: Query display missing entirely from database results page`. Halts before export. | **PASS** |
| **10. Search-Within Filter Clearing** | Control search filters results down to 1 document; runner clears filter before export. | Search-within filter cleared; document count restored to 4; exported CSV verified to contain all 4 records. | **PASS** |
| **11. Control Missed but Indexed** | Query `TITLE-ABS-KEY ( "surrogate weight*" )` yields 2 results excluding control. | Search within yields `NOT FOUND`. Title search yields 1 result. Marked `NOT FOUND / INDEXED`. Last line reports `DEVIATION`. | **PASS** |
| **12a. Unique Tab Selection** | User approves/selects existing Scopus tab (`tab: 'Scopus'`). | Runner locates tab in running session, switches to it, verifies Scopus interface, executes search block, leaves unrelated tabs open. | **PASS** |
| **12b. Missing Tab Selection Halts** | Nonexistent tab pattern requested. | Runner halts immediately with `TAB ERROR: Tab not found matching pattern...`; opens no fallback tab. | **PASS** |
| **12c. Ambiguous Tab Selection Halts** | Ambiguous tab pattern matching multiple open tabs. | Runner halts immediately with `TAB ERROR: Ambiguous tab selection: Found 2 tabs... Unique match required`. | **PASS** |
| **13. Institutional Sign-In Pause** | User provides link (`/scopus/login-required`). | Runner opens URL, detects auth gate, pauses with `PAUSED: Workflow paused. User must complete institutional sign-in at ...`. | **PASS** |
| **14. Bot Challenge Detection** | Route returns unusual traffic / bot challenge (`/scopus/bot-challenge`). | Runner identifies bot challenge, halts cleanly with `STOPPED: Bot challenge encountered`. No bypass attempted. | **PASS** |
| **15. Download Cleanup** | Verifies attempt temporary files in `Downloads`. | Attempt downloads cleanly unlinked; no orphan attempt files left behind. | **PASS** |
| **16. Disk Persistence** | Verifies baseline export files on disk. | Baseline Block D3 CSV export verified preserved on disk. | **PASS** |
| **17. Collision File Preservation (Byte-for-Byte)** | Pre-existing disposable file placed at requested export path; successful export executed with same name. | Existing file preserved byte-for-byte; new export verified and atomically saved as `(1).csv`; report and last line cite unique path. | **PASS** |
| **18. External Chrome Attachment (Harmless Page)** | External Chrome started on loopback port 9223 with isolated profile and tabs (`/scopus/harmless`, `/scopus/unrelated`). | Attaches via CDP, validates harmless page, leaves unrelated tab and external Chrome process open and untouched. | **PASS** |
| **19. Unavailable & Non-Loopback CDP Rejection** | Tested against unavailable port (9999) and non-loopback host (`192.168.1.5:9222`). | Both rejected upfront with `ATTACHMENT ERROR` via pre-flight HTTP probe; no unrequested replacement browsers launched. | **PASS** |
| **20. Missing/Ambiguous Tabs on External Chrome** | External Chrome tested with nonexistent tab and duplicate tab patterns. | Halts cleanly with `TAB ERROR` without navigating or disrupting other open tabs. | **PASS** |
| **21. Engine Rejection of `--cdp` with `--allowed-domains`** | Engine launched with both `AGENT_BROWSER_CDP` and `AGENT_BROWSER_ALLOWED_DOMAINS`. | Pinned engine hard rejection reproduced: `--allowed-domains is not supported with --cdp because WebRTC containment cannot be installed before existing page scripts run`. | **PASS** |

---

## 4. Live Handoff Architecture & Live Pilot Protocol

### Objective & Constraints
Live execution against Scopus via user-selected institutional access (e.g. Riga Technical University ORTUS / EZproxy, other institutions, or direct personal subscription) requires:
- Explicit, user-initiated authentication
- Protecting user credentials, MFA codes, and session tokens from AI prompts, logs, and exports
- Strict endpoint and process isolation, avoiding both the known private-network gap in the public research server and accidental replacement browser launches

### Transport Layer Separation & Allowlist Boundary

The pinned engine (`agent-browser: 0.41.2`) enforces a hard rejection if `--allowed-domains` is combined with `--cdp`:
```text
--allowed-domains is not supported with --cdp because WebRTC containment cannot be installed before existing page scripts run
```
Because of this engine limitation, `scopus-workflow.mjs` cleanly separates the two modes at the transport layer:
1. **Local Fixtures and Scripted Demos**: When `--cdp` is not passed, `AGENT_BROWSER_ALLOWED_DOMAINS` is set to `127.0.0.1`, enforcing engine-level request allowlisting.
2. **External Chrome Attachment (`--cdp` / `--attach-chrome`)**: When attaching to an externally launched Chrome instance, `AGENT_BROWSER_ALLOWED_DOMAINS` is removed so the engine attaches cleanly.
3. **Containment Enforcement under CDP**: Because engine-level domain allowlisting is disabled under CDP attachment, attachment containment is strictly enforced through:
   - **Pre-flight loopback validation (`validateCdpEndpoint`)**: Rejects non-loopback hosts and verifies port availability via `/json/version`, preventing silent browser launches.
   - **Strict unique tab matching**: Requires `--tab` and halts with `TAB ERROR` if the tab is missing or ambiguous, leaving unrelated tabs completely untouched.
   - **In-workflow URL checks**: Halts if unexpected external navigations occur.
   - **Boundary Disclosure**: Chrome attachment **cannot** be represented as equivalent to engine-level domain allowlisting.

### Protocol Design: Explicit User-Initiated Connection

```
[User on Windows]
   │
   ├─► 1. Launches Chrome with remote debugging port & dedicated profile:
   │      & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\ScopusProfile"
   │
   ├─► 2. Navigates manually to User-Selected Scopus Route:
   │      - Option A (RTU): https://ortus.rtu.lv -> Library -> Scopus (or https://www-scopus-com.ezproxy.rtu.lv)
   │      - Option B (Other Institution): Institutional library portal / proxy
   │      - Option C (Direct Account): https://www.scopus.com
   │
   ├─► 3. Enters institutional credentials and completes multi-factor authentication (MFA)
   │      (Agent is NOT active; credentials never enter logs, prompts, or tools)
   │
   ├─► 4. User confirms Scopus search home page has loaded in browser:
   │      "Scopus is loaded and signed in. Proceed."
   │
[Northbridge Scopus Runner]
   │
   ├─► 5. Validates loopback endpoint (127.0.0.1:9222) via pre-flight HTTP probe (/json/version)
   │      Attaches to user's existing authenticated browser context via CDP
   │      Locates and switches uniquely to the approved Scopus tab
   │      Leaves all unrelated tabs and the browser process open and untouched
   │      - Enters query exactly as supplied
   │      - Records displayed query, total count, preprints, and date
   │      - Searches within results for control paper
   │      - Initiates native CSV export (Citation info + Abstract & keywords)
   │
   ├─► 6. Pause Condition: Elsevier Personal Sign-In at Export
   │      If Scopus presents an Elsevier account sign-in dialog at export:
   │      - Automation pauses immediately
   │      - Informs user in chat: "PAUSED: Elsevier sign-in required for export. Please complete in browser."
   │      - Resumes once user signs in or dismisses dialog
   │
   ├─► 7. Stop Condition: Bot Challenge / Unusual Traffic Warning
   │      If Scopus presents Cloudflare Turnstile, PerimeterX, or unusual traffic warning:
   │      - Automation halts immediately
   │      - Reports completed findings and stops without attempting bypasses
   │
   └─► 8. Verifies downloaded CSV on disk, places atomically (preserving existing files on collision byte-for-byte), and emits reproducible search log.
```

### What Remains for the Live Pilot
1. **Owner Presence**: The live pilot requires the project owner to be present to log into their institutional portal (such as RTU ORTUS) or direct Scopus account with active credentials and complete MFA.
2. **Individual Unverified Status**: RTU, other institutions, and direct personal accounts remain individually unverified until tested live with the owner.
3. **Single Pilot Block**: The initial live pilot tests one native Scopus CSV export with 1 query and 1 control paper. Alternative export formats (e.g. RIS, BibTeX, or DOM scraping) are separate features requiring separate completeness checks.
4. **Downstream Thesis Steps**: Screening, deduplication, DOI cross-referencing, and PDF full-text retrieval remain strictly in the main thesis chat outside this browser automation milestone.

### Exact Owner Steps & Chat Prompt for Live Pilot

#### Step 1: Launch Chrome with Remote Debugging & Dedicated Profile
In PowerShell, launch Google Chrome with remote debugging and a dedicated user data directory derived from your Windows environment:
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\ScopusProfile"
```
*Note*: Modern Chrome requires a dedicated `--user-data-dir` for remote debugging. This isolates the debugging session from your primary Chrome profile, keeping your daily browser, existing tabs, and extensions completely untouched without needing to close your personal browser.

#### Step 2: Confirm Connection Readiness
Before signing in, verify that Chrome is ready and the loopback debugging endpoint is operational. Run in PowerShell:
```powershell
Invoke-RestMethod http://127.0.0.1:9222/json/version
```
Confirm that `Browser` reports a valid Chrome version (e.g. `"Chrome/..."`) and `webSocketDebuggerUrl` points to loopback (`127.0.0.1:9222`).

#### Step 3: Complete Sign-In (Institution-Neutral)
In the opened dedicated Chrome window:
1. Navigate to your institution's portal or direct Scopus login:
   - **Option A (Riga Technical University)**: Go to RTU ORTUS `https://ortus.rtu.lv` -> Library -> Scopus (or directly to `https://www-scopus-com.ezproxy.rtu.lv`).
   - **Option B (Other Academic / Research Institution)**: Go to your university or organizational library portal / EZproxy / SSO.
   - **Option C (Direct Personal / Corporate Account)**: Go directly to `https://www.scopus.com`.
2. Authenticate manually with your institutional credentials and complete any multi-factor authentication (MFA) prompts.
   - **Zero Credential Exposure**: Passwords, MFA codes, session tokens, and cookies remain exclusively inside your browser. Northbridge never requests, logs, or stores credentials.
3. Confirm that the main Scopus search home page (`https://www.scopus.com/search/form.uri?display=advanced` or basic search) is displayed in the tab.

#### Step 4: Trigger Live Block D3 in Desktop Agent Chat
In your desktop agent chat (Antigravity, VS Code Copilot, Codex, etc.), paste the following copy-ready user prompt:

> "Scopus is open and I’m signed in on port 9222. Use Northbridge to run Scopus block D3:
> - Block: D3
> - Claim: Weights can be derived from a rank order.
> - Query: TITLE-ABS-KEY ( "rank order centroid" OR "surrogate weight*" OR "ranked attribute weight*" OR "rank-based weight*" )
> - Control paper: Decision quality using ranked attribute weights
> - Export file: Ch3_34_SC_D3.csv
>
> Run the query exactly as supplied, check the control paper, export the main results as CSV, and return the reproducible search log. Pause if you need me to sign in again or re-authenticate."

Northbridge attaches to your authenticated browser session via CDP (port 9222), verifies the selected tab, executes the search without query modification, isolates preprints, verifies control paper indexing, validates the CSV export on disk before placement (preserving existing files on collision byte-for-byte), and outputs the structured search log.

#### Step 5: Disconnection & Teardown
Once the search block is complete and the verified CSV is saved:
1. Northbridge automatically closes its CDP client connection when the command finishes.
2. Close the dedicated Chrome window manually, or terminate it from PowerShell:
   ```powershell
   Get-Process chrome | Where-Object { $_.CommandLine -like "*ScopusProfile*" } | Stop-Process
   ```

---

## 5. Section A: Network Boundary & Enforcement Result (Approved Hostname Analysis)

### Controlled Fixture Request Counts (Port 4399)

| Subtest | Scenario / Action | Tool Tested | Configured / Approved Domains | Expected Private Behavior | Actual Requests to Private Server | Enforcement Layer & Observed Result |
|---|---|---|---|---|:---:|---|
| **6a** | Direct navigation to approved hostname pointing to loopback (`http://sub.localtest.me:4399/target`) | `agent_browser_open` | `sub.localtest.me` | Block connection to private address | **0** | **PASS**: Pre-flight DNS check in `northbridge-research.js` resolves `127.0.0.1` and halts with `[SECURITY POLICY VIOLATION]` before browser launch. |
| **6b** | Direct read fetch to approved hostname pointing to loopback (`http://sub.localtest.me:4399/target`) | `agent_browser_read` | `sub.localtest.me` | Block connection to private address | **0** | **PASS**: Pre-flight DNS check identifies loopback IP and aborts before fetch. |
| **6c** | HTTP 302 Redirect to unapproved private destination (`http://127.0.0.1:4399/leak-via-redirect`) | `agent_browser_open` | `example.com` | Block redirect destination | **0** | **PASS**: Engine CDP `Fetch.enable` allowlist inspects destination URL `127.0.0.1:4399` and halts request before transmission. |
| **6d** | Page-initiated subresources (`fetch`, `img`) to unapproved private destination (`http://127.0.0.1:4399/private-data`) | `agent_browser_open` | `example.com` | Block subresources | **0** | **PASS**: Engine CDP `Fetch.enable` allowlist halts requests before transmission. |
| **6e** | Connection-Time Gap: Approved hostname pointing to loopback during redirect (`example.com` -> `sub.localtest.me:4399`) | `agent_browser_open` | `example.com, sub.localtest.me` | Prevent private connection at socket time | **2** | **FAIL / GAP**: Engine CDP `Fetch.requestPaused` matches hostname `sub.localtest.me`, issues `Fetch.continueRequest`, and Chrome connects to `127.0.0.1:4399` (hits: GET `/leak-via-redirect`, GET `/favicon.ico`). |
| **8** | Legitimate approved public site navigation (`https://example.com/`) | `agent_browser_open`, `agent_browser_snapshot` | `example.com` | Allow public page, verify snapshot | **0** | **PASS**: Public page opens cleanly; text snapshot verified (28 chars); 0 hits on private fixture. |

### Smallest Reproducible Case for Connection-Time Gap
When `NORTHBRIDGE_APPROVED_DOMAINS="example.com,sub.localtest.me"` is supplied to `agent-browser: 0.41.2`, the engine configures CDP `Fetch.enable` with patterns `*://example.com/*` and `*://sub.localtest.me/*`. When a page redirects to `http://sub.localtest.me:4399/...`, the engine's `Fetch.requestPaused` handler only checks if `url.hostname` matches an approved pattern. Because `sub.localtest.me` is approved, the engine calls `Fetch.continueRequest`. Chrome resolves `sub.localtest.me` to `127.0.0.1` at socket connection time and connects, recording 2 hits on the private server. An internal forward proxy workaround cannot be used because it triggers TLS/SNI reset errors (`read ECONNRESET`, `10060`) on modern production CDNs. Public research is therefore **Blocked**.

---

## 6. Full Regression Verification Commands

All automated test suites in `university-browser-demo` pass with exit code 0:

```powershell
# 1. Scopus Search & CSV Export Acceptance Suite (22/22 checks pass):
npm.cmd run test:scopus

# 2. Standalone Scopus Block D3 CLI Execution:
node bin/northbridge-scopus.mjs --block D3

# 3. Admissions Demo Scripted Lookup (observed deadline 21 May 2027, 0 fallbacks):
npm.cmd run test:lookup

# 4. Admissions Demo MCP Stdio Full Acceptance (14 actions to review, Draft, 0 retries):
npm.cmd run test:mcp

# 5. Admissions Demo PowerShell CLI Acceptance (14 invocations to review, Draft, 0 retries):
npm.cmd run test:cli

# 6. Research Access Policy & Isolation Suite (9/9 checks pass, reproduces connection-time gap):
npm.cmd run test:research
```

---

## 7. Stop Condition & Final Status

| Component | Release Status | Actionable Summary |
|---|---|---|
| **Local Demo Preview** (`northbridge-browser`) | **Ready for independent review** | Fully verified across both MCP stdio and PowerShell CLI transports. Deterministic single-session preview; browser traces retained; token reduction treated as hypothesis pending matched `@Chrome` benchmark. |
| **Scopus Local Fixture** (`scopus-fixture.mjs` / `scopus-workflow.mjs`) | **Fixture Verified (Ready for independent review)** | 100% verified across 22 regression checks. Non-destructive download capture preserves pre-existing files on failure; atomic candidate naming (`fs.constants.COPYFILE_EXCL`) preserves existing files byte-for-byte on successful collisions; multiline RFC 4180 parsing verified. |
| **External Chrome Attachment** (`validateCdpEndpoint` / `verifyCdpAttachment`) | **Attachment Verified (Ready for independent review)** | Verified against externally launched Chrome on port 9223 with harmless local target (`/scopus/harmless`). Rejects non-loopback hosts, unavailable ports, and empty metadata (`{}`) upfront without launching silent fallback browsers; checks tab switch success and verifies active tab target ID and URL; leaves unrelated tabs and browser processes open and untouched. Engine allowlist incompatibility boundary (`--allowed-domains` rejected under `--cdp`) documented. |
| **External Chrome CLI** (`bin/northbridge-scopus.mjs`) | **CLI Verified (Ready for independent review)** | Tested against externally launched Chrome via child process capture. Standalone CLI exits cleanly with code `0`, exports 4 parsed CSV records, preserves existing same-name files byte-for-byte under atomic candidate naming (`(1).csv`), leaves unrelated tabs completely untouched at their original target ID and URL, and leaves the external Chrome process open. |
| **Live Authenticated Scopus** (`northbridge-scopus.mjs`) | **Pending Live Pilot** | Architecture and handoff protocol ready for user-selected route (RTU, other institutions, direct personal accounts). Awaits owner presence to sign in to Scopus with credentials/MFA and trigger block D3 via CDP attach. **RTU, other institutions, and direct personal accounts remain individually unverified until tested live**. |
| **Public Distribution** (`northbridge-browser-research` & VS Code 1-Click) | **Blocked / Pending** | Public research is withheld due to upstream engine connection-time IP verification gap on approved hostnames during redirects (kept out of default setup). VS Code one-click install link marked pending npm publication. |

---

### Single Next Action for the Owner

Launch Google Chrome with remote debugging and a dedicated profile:
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\ScopusProfile"
```
Confirm connection readiness via `Invoke-RestMethod http://127.0.0.1:9222/json/version`, sign in to Scopus through your chosen access route (RTU ORTUS `https://ortus.rtu.lv` / `https://www-scopus-com.ezproxy.rtu.lv`, other institutional portal, or direct personal account) and complete MFA until the Scopus search page is visible, then trigger the live pilot block D3 from desktop chat using the copy-ready prompt provided in Section 4.
