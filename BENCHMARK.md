# Benchmark Results

## Original Pilot Benchmark (Model-Driven with Codex)

*Note: The table and summary below represent the original baseline benchmark runs recorded by the project team with Codex. They reflect model-driven agent turns where an LLM reasoned between observations and dispatched tool calls. They are preserved intact for historical reference.*

Same Codex chat and model, same portal and synthetic applicant, fresh isolated browser session per run. Both used Agent Browser 0.41.2 and Chrome for Testing 157.0.8103.38 on Windows with a 900 × 700 viewport. The structure run came first. The visual run used unannotated screenshots, coordinate clicks, Tab, and keyboard typing for page interactions.

| Measure | Structure and refs | Screenshots and coordinates |
| --- | ---: | ---: |
| Task completed and verified | Yes | Yes |
| Elapsed time (model-driven) | 28.7 s | 33.4 s |
| Agent tool calls (model turns) | 6 | 6 |
| Underlying tool calls | 6 shell | 6 shell + 6 image reads |
| Browser CLI invocations | 15 | 28 |
| Page observations | 6 text snapshots | 6 PNG screenshots |
| Observation payload size (proxy) | 2,397 UTF-8 bytes | 110,488 PNG bytes |
| Browser command failures or action retries | 0 | 0 |

Elapsed time runs from dispatching the first browser command through the final observation, including time between agent calls. Installation, server startup, artifact directory creation and cleanup are outside that interval. One agent tool call grouped commands for each observed state. The structure run scoped five snapshots to the main content and the filled-state snapshot to the form. Text payload size counts the snapshot tree with normalized line endings and excludes command acknowledgements. Image payload size counts the PNG file bytes and excludes command acknowledgements and transport encoding. The runtime tools did not provide token usage attributable to each run. These byte counts describe observation size only. Text and image bytes are processed differently by the model.

### Verified in both pilot runs

1. Found MSc Applied Data Science and read its deadline, 21 May 2027.
2. Entered Avery Example, avery@example.test, and BSc Statistics in the matching fields and verified them before saving.
3. Saved once and observed **Draft saved.** and the record link in **My drafts**.
4. Followed the link to **Review saved draft** and verified the programme, Draft status and all three stored values. That page is the review checkpoint.

Both runs passed on the first attempt. One run per mode, with the same agent already familiar with the task by the second run, cannot establish a reliability or token advantage. The screenshot mode used three commands for a coordinate click, which accounts for part of the difference in CLI invocations. The scoped snapshots were sufficient for this task. Keep the direct CLI integration. If shell overhead becomes material on longer tasks, measure Agent Browser's built-in batching before adding a wrapper.

---

## Scripted Acceptance Repeatability Benchmark (Windows x64 Release Verification)

*Note: The measurements below are from automated scripted runs executed in the Windows environment on `http://127.0.0.1:4317/` with synthetic data and fresh isolated sessions. These test runs execute without a language model in the loop, measuring raw transport throughput, deterministic element resolution, and observation payload size across 3 independent runs per transport.*

**Test Environment**:
- **Operating System**: Windows 11 Enterprise/Pro x64 (Build 26300.0)
- **Node.js**: v24.13.0
- **npm**: 11.6.2
- **Agent Browser**: 0.41.2 (pinned lockfile baseline)
- **Browser Engine**: Google Chrome 157.0.8103.39 x64
- **Working Directory**: Path containing spaces and Unicode (`C:\Users\...\OneDrive - Rīgas Tehniskā Universitāte\...`)

### 3x Repeatability Run Results

#### Built-in MCP Server (`stdio`, `--tools core`)

| Run # | In-Script Tool Time | Process Wall-Clock | Calls to Review | Cleanup Calls | Total Calls | Payload Size (Proxy) | Exit Code | Result |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Run 1** | 5.43 s | 21.73 s | 14 | 1 | 15 | 2,397 UTF-8 bytes | 0 | **Pass** |
| **Run 2** | 5.86 s | 16.58 s | 14 | 1 | 15 | 2,397 UTF-8 bytes | 0 | **Pass** |
| **Run 3** | 5.38 s | 12.96 s | 14 | 1 | 15 | 2,397 UTF-8 bytes | 0 | **Pass** |
| **Average** | **5.56 s** | **17.09 s** | **14** | **1** | **15** | **2,397 UTF-8 bytes** | **0** | **100% Pass** |

#### PowerShell CLI Fallback (`agent-browser.cmd`)

| Run # | In-Script Tool Time | Process Wall-Clock | Invocations to Review | Cleanup Invocations | Total Invocations | Payload Size (Proxy) | Exit Code | Result |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Run 1** | 7.64 s | 20.14 s | 14 | 1 | 15 | 2,407 UTF-8 bytes | 0 | **Pass** |
| **Run 2** | 9.14 s | 16.44 s | 14 | 1 | 15 | 2,407 UTF-8 bytes | 0 | **Pass** |
| **Run 3** | 7.82 s | 12.74 s | 14 | 1 | 15 | 2,407 UTF-8 bytes | 0 | **Pass** |
| **Average** | **8.20 s** | **16.44 s** | **14** | **1** | **15** | **2,407 UTF-8 bytes** | **0** | **100% Pass** |

---

## Technical Analysis & Metric Explanations

### 1. Difference Between Scripted Execution Time and Model-Driven Time
- **Model-Driven Pilot Times (28.7 s / 33.4 s)**:
  In the original pilot runs, Codex was in the loop as an autonomous agent. Between each browser observation, the model received the accessibility snapshot or screenshot, processed tokens through LLM inference, decided the next action, and emitted tool arguments over the network. Those timings include model thinking time, token generation latency, and API roundtrips across 6 agent turns.
- **Scripted Execution Times (5.56 s in-script MCP / 8.20 s in-script CLI)**:
  The scripted acceptance tests measure raw transport and execution speed on the local machine without model inference overhead. The script immediately dispatches each subsequent tool call upon receiving the previous result.
- **Process Wall-Clock Times (12.7 s – 21.7 s)**:
  Process wall-clock measurements reflect the complete invocation from the PowerShell shell, including Node/npm process startup, Windows file handle initialization, background browser daemon handshake, and clean process termination. Subsequent runs trended faster as disk caches and Chrome socket connections warmed up.

### 2. Invocation Counting: 14 Actions to Checkpoint + 1 Cleanup = 15 Total
Every verified run executes an identical, deterministic sequence of actions:
1. `open http://127.0.0.1:4317/` (Navigate to admissions catalogue)
2. `snapshot -c -s '#main'` (Inspect programmes list)
3. `click @ref` (Select MSc Applied Data Science)
4. `snapshot -c -s '#main'` (Verify application deadline: 21 May 2027)
5. `click @ref` (Select 'Start a draft application')
6. `snapshot -c -s '#main'` (Inspect form structure)
7. `fill @ref 'Avery Example'` (Fill full name)
8. `fill @ref 'avery@example.test'` (Fill email address)
9. `fill @ref 'BSc Statistics'` (Fill qualification)
10. `snapshot -c -s 'form'` (Verify populated form field labels and entered values)
11. `click @ref` (Click 'Save draft' button)
12. `snapshot -c -s '#main'` (Confirm 'Draft saved.' message)
13. `click @ref` (Follow 'Open MSc Applied Data Science draft' record link)
14. `snapshot -c -s '#main'` (Human review checkpoint: verify programme, exact `Draft` status, and all 3 applicant values)
15. `close` (Teardown: close only the named demo session)

Total invocations: exactly **14 actions to checkpoint** plus **1 session cleanup** = **15 total tool calls / CLI process spawns**.

### 3. Observation Size as Proxy (UTF-8 Bytes vs LLM Tokens)
- Local runtimes and headless CLI environments do not report attributable token consumption for individual tool executions.
- Normalized UTF-8 byte counts of the accessibility snapshots are recorded as an objective, model-independent proxy for observation payload size.
- The MCP stdio runner observed exactly **2,397 bytes**, matching the 2,397-byte baseline from the original pilot structure run.
- The CLI runner observed **2,407 bytes** (a 10-byte difference due to CLI console line ending formatting).
- Compared to the pilot screenshot payload (**110,488 bytes**), structured accessibility snapshots represent a **~97.8% reduction** in observation payload size.
- **Token Cost Hypothesis**: While the observation byte payload is reduced by ~97.8%, any lower token cost remains a **hypothesis pending a matched `@Chrome` benchmark run** with an LLM in the loop, as multimodal vision models encode image tiles and text tokens with different tokenisation ratios.
