# Jarvis Workbench

A local terminal and browser dashboard for finding text, understanding Git, managing files and storage, and controlling Windows networking, sound, security and power. Start with the task you want to finish; Jarvis supplies the controls and explains the command-line concepts behind them.

**Version 0.2.0 / Node.js 22 or 24 Â· Zero npm dependencies Â· Apache-2.0 Â· No API key Â· No telemetry**

Created by **Ashish / [Ashishkkb](https://github.com/Ashishkkb)**. This is an independent, open-source project. Voice integration is separate and is not included.

## Install from source

The standalone Windows checkout is `D:\jarvis-workbench`. In a source checkout on any supported platform:

```sh
cd jarvis-workbench
npm install -g .
jarvis
```

`jarvis` and its short alias `jv` open the current folder. Select a different project with `jarvis --path ../my-project`.

If PowerShell blocks the generated `.ps1` launchers, use `npm.cmd install -g .` and `jarvis.cmd` instead. Changing the machine's execution policy is not required.

You can also run the source without a global installation:

```sh
node ./bin/jarvis.js --path ../my-project
node ./bin/jarvis.js --web --path ../my-project
node ./bin/jarvis.js --demo
```

The planned npm package is `@ashishkkb/jarvis-workbench`. **It has not been published to the npm registry.** `npm install -g .` installs this local checkout; it does not download a registry release.

## Two ways to work

**Terminal:** run `jarvis`. Use the sidebar numbers, keyboard shortcuts, and task palette. The interface works in PowerShell, Bash, Zsh, and other terminals that support interactive Node programs.

**Browser:** run `jarvis --web`, or press **B** in the terminal dashboard. Jarvis starts a local server and opens your browser. Keep the terminal running; closing the Jarvis session stops its server. Use `--no-open` to print the URL or `--port 4177` to choose a port.

The browser server binds only to `127.0.0.1`. Its launch URL contains a random session token, and every API request requires that token. No external service or account is involved. Git operations and project scripts still use your existing credentials and may contact their configured services.

## Terminal controls

| Key | Tool | Main actions |
| --- | --- | --- |
| `1` | Overview | Workspace, machine, and Git summary. |
| `2` | Files | Browse, preview, copy, move, rename, create folders and restore removed items. |
| `3` | Search | Find phrases, regular expressions, and selected file types. |
| `4` | Git & upload | Review changes, commit, fetch, push, and pull. |
| `5` | Processes | Inspect and filter running programs. |
| `6` | Ports | Inspect TCP listeners and bound UDP sockets. |
| `7` | Storage | Compare folder sizes, choose drive scans, and review cleanup. |
| `8` | Project tasks | Review and run named npm scripts. |
| `9` | Toolbox | Choose a practical task and learn its command equivalent. |
| `0` | Control Center | Windows Wi-Fi, sound, Defender, power plans and settings. |

**Ctrl+P** opens the task palette. **Tab** switches tools; **Up/Down** selects an item; **Enter** opens it; **R** refreshes; **Esc** dismisses a prompt or cancels a task; **Q** exits. **B** opens the browser dashboard and **A** opens activity history. **$** opens Support/About from any screen.

| Screen | Additional controls |
| --- | --- |
| Files | `Backspace`: parent. `/`: filter/find. `T`: preview tail. `N`: new folder. `C`: copy. `M`: move. `E`: rename. `X`: move to recovery. `H`: restore from file recovery. |
| Search | `/`: enter a query. `M`: literal/regex. `C`: case matching. `G`: filename glob. |
| Git | `C`: save a commit. `P`: push. `L`: fast-forward pull. `F`: fetch. |
| Processes | `/`: filter. `S`: memory/CPU sorting. `K`: review and stop the selected process. |
| Ports | `/`: filter by port, PID, or address. |
| Storage | `S`: select a workspace, drive, home, or temporary-folder scan. `C`: review eligible cleanup. `H`: recovery history. |
| Project tasks | `Enter`: review and run the selected script. |
| Toolbox | `Enter`: open the tool. `E`: explanation and command examples. |
| Control Center | `Enter`: category actions. `W`: Wi-Fi/network. `V`: sound. `S`: security. `P`: power plan. `O`: Windows Settings. |

Terminal confirmation dialogs require **Y**. Enter, N, or Esc cancels. Use `--ascii` for plain borders or `--no-color` to disable color. Redirected dashboard output produces a static frame; keyboard interaction needs an interactive terminal.

## Windows Control Center

Press **0** in the terminal or use the browser's Network, Sound, Security and Settings screens. These controls use Windows APIs and installed tools. Linux/macOS show an explicit availability message; search, Git, storage and other cross-platform tools continue to work. Missing devices, OS restrictions and permission failures are reported rather than replaced by sample readings.

- **Network:** inspect adapters, addresses and DNS; connect to an existing saved Wi-Fi profile; disconnect Wi-Fi; set one to four IPv4 DNS servers or restore automatic DNS. Each connection/DNS change is reviewed and confirmed, with the adapter checked again before applying it. IPv6 DNS and IP-address configuration are left to Windows Settings. Network changes can interrupt calls, downloads and remote sessions.
- **Saved Wi-Fi password:** choose one profile, then explicitly confirm disclosure. The terminal hides the password after 45 seconds or Esc. Passwords bypass operation/activity logging. Displaying a secret can expose it to screen sharing, screenshots or terminal recording.
- **Sound:** adjust the default output's volume and mute state after confirmation. Enumerated devices can be inspected in the browser; switching the default device opens Windows Sound settings instead of using undocumented audio APIs.
- **Power:** select an existing Windows power plan. Jarvis rechecks the reviewed state, applies the selected plan and verifies the result. Select the former plan again to undo the choice.
- **Settings:** confirmed shortcuts open Windows Security, updates, storage, installed apps, startup apps, display, sound, network, privacy and power. These open Windows' own interface; they do not silently change settings.

Security shows Microsoft Defender status and recent protection history, including unavailable or unknown readings. Quick, full and custom scans require a separate review. **Defender may quarantine or remove detected threats under the PC's protection policy.** Administrator access may be required; Jarvis never automatically elevates itself.

Scan completion comes from the installed `MpCmdRun` process. Code 0 means no threats were found **or** detections were remediated; code 2 means remediation needs attention or scanning encountered an error. Neither a blank history nor a successful command guarantees a malware-free PC. Open Windows Security to review findings. **Esc / Stop monitoring stops Jarvis monitoring, not the Defender engine.** Monitoring is bounded to eight hours, after which the scan may continue. Jarvis does not send Defender's global cancellation command because it could affect another scan. Custom targets are canonical local files/folders with identity checks before launch.

The implementation follows Microsoft's [Defender command reference](https://learn.microsoft.com/en-us/defender-endpoint/command-line-arguments-microsoft-defender-antivirus), [powercfg reference](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options) and [Windows Settings URI reference](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings). Defender/Windows policies remain authoritative.

## Reviewed file management

Files supports new folders, copy, move, rename and **move to recovery**, with explicit source/destination review. Destinations must be inside the selected workspace, their parents must exist, and existing entries are never intentionally overwritten. Linked paths, Git metadata, Jarvis runtime files and recovery storage are protected. Reviews are bounded to 20,000 entries or 15 seconds; choose a smaller selection if needed. Plans expire after 60 seconds and recheck the selected files before execution.

Move to recovery keeps the selection recoverable and **does not free disk space**. Use **H** in Files or the browser's file recovery list to restore its original location. This is separate from old temporary-file cleanup under Storage. File recovery offers restore; it has no permanent-delete action. Existing original paths are not overwritten. Keep recovery data and manifests together. Partly completed operations report their errors and remaining destination/recovery information.

File-manager recovery normally lives under the activity data directory in `file-recovery/<workspaceHash>`. For a Windows workspace on another drive, it uses `<drive>\.jarvis-workbench-recovery\<userHash>\<workspaceHash>` so the move remains on the same volume. The store stays outside your project and is protected from file actions.

Windows supports folder moves, renames and recovery. On Linux/macOS these folder operations are unavailable where an atomic no-overwrite directory move cannot be guaranteed; use copy instead. Regular-file actions, folder creation and folder copying remain available. Cross-filesystem moves are rejected; copy first, verify the result, then review moving the original to recovery. Cancellation can leave a reported partial copy if safely removing only Jarvis-created items is impossible.

## Storage: inspect, review, recover

The quick workspace view measures up to **30,000 entries or 8 seconds**. A selected drive/folder scan measures up to **250,000 entries or 120 seconds** by default. Both report incomplete scans; skipped or inaccessible folders are not counted as empty. Drive discovery includes local fixed and removable Windows drives, plus home and temporary locations; Unix-like systems also offer `/`.

A storage scan reads **file metadata only**: names, sizes, and timestamps. It includes dependencies, caches, and Git metadata, skips symbolic links/junctions, and lists the largest measured files and top-level folders. Figures are logical file bytes, which can differ from allocated disk space because of compression, sparse files, hard links, and filesystem overhead. Scanning is not an antivirus or malware check, and the amount of recoverable space depends on your files.

Cleanup follows a separate review:

1. Only regular files in the operating system's temporary folder, unmodified for at least **7 days**, are eligible. Large documents, downloads, and arbitrary folders are informational results, not cleanup targets. Runtime and recovery files are excluded.
2. Jarvis prepares a plan with exact paths and sizes. Review it and confirm. Plans expire after 15 minutes, and each file's identity, size, and timestamps are checked again immediately before moving it. Changed, linked, inaccessible, or locked files are left alone and reported.
3. Confirmed files move to a private recovery folder with a persistent transaction manifest. **Quarantining files does not free space:** it moves them on the same volume and reports zero reclaimed bytes.
4. In recovery history, **Restore** returns files to their original locations without overwriting existing destinations. **Permanently empty** requires a separate confirmation and deletes only the validated files in that transaction. Permanent deletion cannot be undone by Jarvis.

The terminal currently reviews up to 500 candidates per action. It shows the complete path-and-size list in a scrollable view; press **Enter** to proceed to a separate confirmation, then **Y** to move the reviewed files. Use the browser to select individual candidates. Recovery history also lets you review all files in a transaction before restoring or permanently emptying it. The backend preserves successful moves when a job is cancelled or partially fails, and recovery can resume recorded operations after an interrupted session.

Recovery storage defaults to:

| Platform | Recovery folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Jarvis\quarantine` |
| Linux/macOS | `~/.local/share/jarvis/quarantine` |

Moves across volumes are skipped; Jarvis does not replace them with copy-and-delete. Restore also requires the original parent folder to exist, remain accessible, and contain no links. Its exclusive restore operation requires filesystem hard-link support. Retain the manifests and recovery files together until you restore or deliberately empty them. Reported deletion bytes represent removed file data; operating-system free-space figures may differ or update later.

## Git: saved and uploaded are separate

**Save snapshot** stages and commits all changed files in the Git repository, including deletions and non-ignored new files. This covers the entire Git root even when the workspace is a subfolder. Review the repository and change list first; use Git directly to select individual files or hunks. Git hooks may run during a commit.

A commit is local. **Upload commits** pushes the current branch using your configured remote and Git credentials. Jarvis does not create hosting repositories, configure authentication, force-push, or resolve merge conflicts. Pull requires a clean working tree and allows fast-forward updates only.

Ahead/behind counts use the last fetched remote reference. Fetch before judging synchronization. A clean working tree means there are no uncommitted changes; it does not establish that every commit was uploaded.

## Commands and library usage

```sh
jarvis status --path ../my-project
jarvis search "TODO" --glob "*.js"
jarvis search "^ERROR|^WARN" --regex --case-sensitive --glob "*.log"
jarvis files --json
jarvis disk --json
jarvis locations --json
jarvis scan --path /path/to/folder --json
jarvis processes --json
jarvis ports --json
jarvis network --json
jarvis sound --json
jarvis security --json
jarvis settings --json
jarvis doctor
jarvis --demo --snapshot --screen git --width 110
```

`status`, `search`, `files`, `disk`, `locations`, `scan`, `processes`, `ports`, `network`, `sound`, `security`, and `settings` support `--json`. The `disk` command is the quick workspace summary; `locations` lists scan choices and `scan --path folder` performs the longer metadata scan. On Windows, a drive can be selected with `jarvis scan --path C:\ --json`. Recovery actions are available in the dashboards and storage API. `doctor` checks Node, Git, and optional ripgrep. Use `--` before a search phrase that starts with a dash. Run `jarvis --help` for the complete command list.

Before a registry release, ES modules can import the checkout directly:

```js
import { searchContent, getGitStatus } from './src/index.js';
import { scanStorage } from './src/storage.js';

const search = await searchContent(process.cwd(), 'TODO', {
  glob: '*.js', maxResults: 100,
});
console.log(search.matches, { partial: search.truncated });

const git = await getGitStatus(process.cwd());
console.log({ clean: git.clean, ahead: git.ahead, behind: git.behind });

const storage = await scanStorage(process.cwd(), {
  maxEntries: 50000,
  timeBudgetMs: 15000,
  onProgress: progress => console.log(progress.totalFiles),
});
console.log(storage.totalBytes, { partial: storage.truncated });
```

Storage exports include `listScanLocations`, `scanStorage`, `planCleanup`, `executeCleanup`, `listCleanupHistory`, `restoreCleanup`, and `purgeCleanup`. Execute the exact object returned by `planCleanup`; plans cannot be reconstructed from JSON. Mutating library functions do not display dashboard dialogs. Calling applications must present the scope and obtain confirmation; cleanup and purge additionally require `confirmed: true`.

## Other limits

- **Search:** literal and case-insensitive by default, using optional ripgrep or an isolated JavaScript worker. Supports `*`, `?`, and `**` filename globs. Skips binary files, files over 2 MiB, links, `.git`, dependencies, caches, and common build folders. Other hidden files are included; `.gitignore` does not define search scope. Defaults to 250 matching lines and an 8-second budget per backend. Partial results are labeled. Regexes are validated as JavaScript; unsupported native patterns use the fallback.
- **Previews:** read at most 512 KiB. The library defaults to 160 lines; initial dashboard previews allow up to 1,000. Large tails have no invented absolute line numbers. Following a tail uses refreshed snapshots. Project browsing and previews remain inside the workspace.
- **Processes:** view and filter running programs, then use **K** in the terminal or **Stop** in the browser to review the exact name, PID, owner, and start time before confirming. Only eligible processes owned by the current user can be stopped; Jarvis, its ancestors, and protected system processes are refused. Windows termination is immediate and can lose unsaved work. Linux/macOS send SIGTERM; a program can ignore it, in which case Jarvis reports that the request was sent and the process is still running. No force escalation or process-tree termination occurs. A reviewed identity expires after 60 seconds and is rechecked before use. Demo mode never stops a real process.
- **Ports:** read-only inspection. Windows CPU values are cumulative seconds; Linux/macOS use percentages. Permissions can hide socket owners. Missing tools produce a readable error; Jarvis does not install system utilities.
- **Project tasks:** reads the workspace's `package.json`. Confirming a script runs project code and npm lifecycle hooks with your environment. Output is bounded to 256 KiB, and Esc cancels the process tree. Use a normal terminal for programs that require interactive input.

## Activity and privacy

Activity history stores local action names, outcomes, timestamps, and target paths. The default log is `activity.jsonl` under:

| Platform | Activity folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\JarvisWorkbench` |
| Linux/macOS | `$XDG_STATE_HOME/jarvis-workbench`, or `~/.local/state/jarvis-workbench` |

`JARVIS_DATA_DIR` overrides the activity folder. The log rotates at approximately 2 MiB, keeping the current file plus `.1` and `.2`. Common credential patterns are redacted, but paths and error messages can still be sensitive. Review logs before sharing them. Demo mode uses sample data and does not write real cleanup transactions or activity history.

There is no telemetry, analytics service, or external account requirement. See [SECURITY.md](SECURITY.md) for the local server and filesystem trust boundaries.

## Contribute and support

Use Node.js **22 or 24**; Node 20 is not a supported release target. Run:

```sh
npm test
npm run check
npm pack --dry-run
```

Tests use temporary fixtures. CI is configured for Node 22 and 24 on Windows, Ubuntu, and macOS. A configured matrix is not a claim that a hosted run has already passed; verify those results before publishing a release. `npm pack` creates a local archive and does not publish it. See [CONTRIBUTING.md](CONTRIBUTING.md).

The About view and persistent **$ Support** shortcut credit Ashish / Ashishkkb. `support.json` names account holder **Ashish** and includes `YOUR_ACCOUNT_NUMBER` and `YOUR_IFSC_CODE` placeholders. These are not usable payment instructions. Replace them with verified public donation details before accepting donations.

Licensed under [Apache-2.0](LICENSE).
