# Architecture & Windows Setup Trade-Offs: Dedicated CDP Adapter vs. Manifest V3 (`activeTab` + Native Messaging)

When automated research only needs isolated web sessions and explicit logins, Northbridge starts with a **visible, dedicated Chrome research profile** (`%LOCALAPPDATA%\Northbridge\ResearchProfile`) paired with a loopback Control Console and the pinned Agent Browser / Chrome DevTools Protocol (CDP) adapter.

If controlling tabs inside a researcher's **everyday Chrome browser** (default `User Data` profile with existing cookies, password manager, and bookmarks) is needed later, there are two candidate architectures. Compare their Windows permissions, security boundaries, and setup trade-offs below **before choosing**.

---

## Side-by-Side Comparison

| Dimension | Existing Agent Browser / CDP Adapter (Dedicated Profile) | Manifest V3 Extension (`activeTab` + Native Messaging) |
| --- | --- | --- |
| **Target Browser** | Dedicated research profile (`--user-data-dir`) — isolated from everyday cookies & saved passwords. | User's everyday signed-in Chrome profile (no Chromium launch flags required). |
| **User Consent Model** | Out-of-band grant via Northbridge loopback Control Console UI (`uiToken`) or desktop host prompt; pinned to selected `targetId`. | Chrome browser-native gesture: clicking the extension action icon grants `activeTab` only for that tab. |
| **Permission Scope** | Full CDP access across that dedicated profile; Northbridge adds application-level tab pinning, control-tab isolation, and pause/revoke checks. | Narrow per-tab origin permission under `activeTab` (revoked automatically when tab navigates to another origin or closes; persistent multi-step search requires optional `<all_urls>` host permissions or re-click). |
| **Chrome 136+ Default Profile Guard** | Chrome 136+ restricts `--remote-debugging-port` on the default `User Data` directory (`DEDICATED_PROFILE_REQUIRED` also blocks it in Northbridge). Cannot attach to everyday Chrome without restarting Chrome with a non-default `--user-data-dir`. | Works natively in everyday Chrome without `--remote-debugging-port` or closing existing windows. |
| **Downloads & Popups Attribution** | Strong: CDP `Browser.setDownloadBehavior` (`allowAndName`) + `targetId` frame tracking attributes exact tab downloads. | Uses `chrome.downloads` API (does not require CDP); harder to match cross-frame redirects without `webNavigation` permission. |
| **Accessibility Tree / Snapshots** | Built-in Playwright / Agent Browser compact ARIA snapshots and `@ref` element targeting without injecting page scripts. | Requires `chrome.scripting.executeScript` (injected DOM/ARIA walker) or `chrome.debugger` (which displays Chrome's prominent `"started debugging this browser"` infobar on every action). |
| **Offline / Air-Gapped Portability** | Self-contained inside repo (`npm ci` + Chrome); zero Windows Registry changes. | Requires Native Messaging host manifest + `HKCU` Windows Registry entry + unpacked Extension Mode (or Chrome Web Store / Policy). |

---

## Windows Permissions & Setup Trade-Offs (Manifest V3 + Native Messaging)

Before choosing the MV3 extension route for everyday Chrome tabs, evaluate these Windows-specific constraints:

1. **Windows Registry & UAC Permissions (`HKCU` vs. `HKLM`)**:
   - **Per-user install (`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.northbridge.host`)**: Runs without administrator (UAC) prompts. Must match Microsoft Edge separately (`HKCU\Software\Microsoft\Edge\NativeMessagingHosts\...`) if Edge is supported.
   - **Machine-wide install (`HKLM`)**: Requires local administrator elevation during installer setup.

2. **Native Messaging Manifest & Windows Batch Wrapper**:
   - Chrome cannot pass stdin directly to `node.exe script.mjs` in the Native Messaging manifest `"path"` field (the manifest `"path"` takes no CLI arguments!).
   - On Windows, `"path"` must point to either a `.cmd`/`.bat` launcher (`"node.exe" "%~dp0native-host.mjs"`) or a compiled `.exe` wrapper. Note that `.cmd` launchers can flash a console window unless compiled/hosted cleanly, and Defender/SmartScreen can flag unsigned custom `.exe` binaries in enterprise Windows environments.

3. **Extension ID Pinning & Distribution Friction**:
   - Without Chrome Web Store publication, researchers must enable **Chrome Developer Mode** and click **Load unpacked**; Chrome then generates a path-dependent Extension ID unless a fixed `"key"` field is committed into `manifest.json`.
   - Managed enterprise laptops often disable Developer Mode or block unpacked extensions via Windows Group Policy (`ExtensionInstallBlocklist` = `*`), requiring formal IT allowlisting (`ExtensionInstallAllowlist` / Store listing).

4. **`activeTab` Friction Across Multi-Step Navigation**:
   - Strict `activeTab` permission covers the active tab **only on the current origin** after a user click on the toolbar icon. If the workflow navigates from `scholar.google.com` $\rightarrow$ publisher `link.springer.com` $\rightarrow$ CDN PDF URL, `activeTab` expires on origin change unless the user grants broader host permissions or confirms an in-page extension side-panel continuation.

5. **MV3 Service Worker Lifecycle**:
   - Manifest V3 background service workers terminate after ~30 seconds of inactivity, closing `chrome.runtime.connectNative` pipes unless maintained intentionally during an active control grant and cleanly re-established.

---

## Recommendation

- **Now (Implemented)**: Keep the **visible, dedicated Chrome research profile + Northbridge Control Console + CDP/Agent Browser adapter** for active research runs. It requires zero Windows Registry writes, preserves `agent-browser` ARIA snapshots and `@ref` precision, enforces `DEDICATED_PROFILE_REQUIRED`, and isolates institutional/research cookies from personal banking/email sessions.
- **Later (When Everyday Tabs Are Required)**: Add a thin MV3 side-panel extension paired with `HKCU` Native Messaging (`northbridge-native-host`) using `activeTab` + explicit side-panel site grant rather than weakening default Chrome `User Data` debugging protections.
