# Security policy

Jarvis Workbench runs with the current user's filesystem and process permissions. It is not a security sandbox, an independent antivirus engine, or a substitute for a backup. Optional Windows malware scans are performed by the installed Microsoft Defender engine after explicit confirmation.

## Supported targets

Security fixes target the current source version on Node.js 22 and 24. Node 20 is not supported. The test matrix covers Windows, Ubuntu, and macOS; review the actual CI results for a release before relying on platform coverage.

## Report a vulnerability

Use this repository's private security advisory or private vulnerability reporting channel when available. If no private channel is enabled, open an issue requesting a private contact without including exploit instructions, private paths, credentials, or sensitive logs. The maintainer is Ashish / [Ashishkkb](https://github.com/Ashishkkb). No security email address or response-time commitment is configured yet.

Useful reports include the affected version, operating system, a minimal reproduction using disposable fixtures, the expected behavior, and the observed result. Do not test destructive reports against another person's files or a real recovery store.

## Local browser server

- The server binds only to `127.0.0.1`; it is not intended for LAN or Internet hosting.
- Each session generates a random bearer token. The launch URL puts the token in its fragment, and API requests require authorization. Host and supplied Origin headers are checked. Static assets are served from an explicit allowlist with a restrictive content security policy.
- Treat the launch URL as a local access credential. Anyone who obtains its token and can reach the local server can exercise its permitted APIs. The token is not a boundary against software already running with your user privileges.
- Keep the browser and terminal local. Do not expose the server through port forwarding, tunnels, or reverse proxies. Closing its Jarvis session stops the server.
- Mutating routes require explicit confirmation fields. The browser's review dialogs are an additional user interface safeguard, not a substitute for endpoint validation.

## Filesystem and cleanup boundaries

Project browsing and previews enforce workspace containment and reject links that escape it. Storage scanning reads metadata, skips links/junctions and inaccessible entries, and reports bounded or cancelled scans as partial. It does not decide that a large file is safe to delete.

Cleanup planning accepts only selected regular files beneath the operating system's temporary directory that are at least seven days old. Runtime, recovery, linked, and changed files are excluded or rejected. Plans are process-issued, immutable, and expire after 15 minutes. Execution rechecks file identity, size, timestamps, and path containment.

Quarantine uses same-volume moves and persistent per-transaction manifests. It does not reclaim space. Cross-volume moves are skipped, and an interruption can leave a partial transaction that remains in recovery history. Restore avoids overwriting an existing destination and requires an accessible original parent folder and filesystem hard-link support. Permanent purge requires separate confirmation and validates each manifest entry before deleting an individual quarantined regular file. It never recursively removes an arbitrary selected directory.

These checks address accidental scope changes and common link/path attacks. Node filesystem calls cannot make every check-and-operation sequence atomic against an actively malicious process racing with the same user privileges. Do not run cleanup against untrusted concurrently manipulated directory trees. Recovery is also not a backup: external deletion, disk failure, manual manifest changes, or removal of recovery storage can prevent restoration.

## Commands and logs

Git and system commands use executable-plus-argument invocation without evaluating user text as shell syntax. Confirmed npm scripts intentionally execute the selected project's code, including its lifecycle hooks. Git hooks and credential helpers may also execute code. Only run these actions in projects you trust.

There is no telemetry. Activity logs remain local, rotate around 2 MiB per file, and retain two older files. They include target paths and status/error messages. Common credential patterns are redacted on a best-effort basis; redaction is not a guarantee that arbitrary secrets are removed. Inspect logs before sharing them.

Recovery manifests contain original file paths and metadata. The program requests private directory/file modes where supported; Windows access control follows the user's filesystem permissions. Protect both activity and recovery folders as personal data.

## Process control

Stopping a process is separate from inspecting it. A review plan is issued for one eligible PID, owner, and creation identity, expires after 60 seconds, and can be used once with explicit confirmation. The browser retains the exact plan server-side. Jarvis refuses other users' processes, its own process and ancestors, and protected system targets; it does not request administrator privileges or stop a whole process tree.

Windows uses a verified native process handle for identity checks and immediate termination. Linux and macOS send SIGTERM after rechecking the process identity; no automatic SIGKILL follows. POSIX PID checks and signaling cannot be fully atomic with Node's built-in APIs, so a narrow PID-reuse race remains. Unsaved application work may be lost, especially on Windows. Cancellation after a stop request was delivered cannot undo it. Tests terminate only disposable child processes created by the test itself.


## Native Windows controls

Network connection/DNS and power-plan changes use exact, expiring, process-issued review objects and recheck the reviewed OS state. Inputs are limited to supported action schemas, known adapter/profile identities, IPv4 addresses and existing power-plan GUIDs. Sound changes validate volume/mute values and require confirmation. Settings links use a fixed URI allowlist. Native helpers receive literal arguments; they do not accept arbitrary shell commands, scripts, URLs or registry changes. OS permissions and organization policies can refuse any operation; Jarvis does not automatically elevate or change those policies.

Saved Wi-Fi passwords require explicit disclosure confirmation for a selected existing profile. They are returned directly to an ephemeral view and bypass activity and operation logs. Terminal display is hidden after 45 seconds or Esc; browser handling also clears its disclosure view. This is display hygiene, not a guarantee against memory inspection, browser extensions, screen recording or other same-user software. Do not reveal secrets while sharing your screen.

Defender scan plans identify quick, full or canonical custom-file/folder scope, expire after two minutes, and require the exact issued object plus confirmation. The installed scanner's Microsoft signature is checked when selecting the executable. Custom targets are checked for links and identity changes before launch. Defender's own protection policy can quarantine or remove threats. Scan output/history may include sensitive file paths. Command status is reported without claiming that successful execution establishes a malware-free system.

Cancellation stops the Jarvis scanner client/monitor, not the Defender service. A cancelled or timed-out monitor explicitly reports that scanning may continue; no global Defender cancellation is sent. Permission failures, incomplete status and unknown protection flags remain visible. Tests mock Defender execution and settings mutations; development checks do not launch real antivirus scans or change the developer machine's settings.

## File-manager operations

Reviewed operations stay inside their workspace, reject links and protected metadata/runtime paths, and refuse existing destinations. File review is bounded and execution rechecks the source snapshot. Recovery is per-workspace, retains original paths and does not reclaim space. Copies track newly created destination items; cancellation or errors clean up only those items and report anything that cannot be removed safely. A partial result must not be presented as successful completion.

Windows uses native no-overwrite directory moves. Platforms without a supported atomic no-overwrite directory operation refuse folder moves, renames and folder recovery rather than exposing an overwrite race. Regular-file operations and bounded folder copies have their documented filesystem limitations. An actively malicious process with the same user privileges can still race path checks; neither file recovery nor quarantine is a backup or security boundary against that actor.
