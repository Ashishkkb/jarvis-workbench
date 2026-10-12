# Security policy

Jarvis Workbench runs with the current user's filesystem and process permissions. It is not a security sandbox, an antivirus scanner, or a substitute for a backup.

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
