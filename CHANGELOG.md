# Changes

## 0.3.0 - 2026-10-12

- Recover file operations after process crashes at move/restore publication boundaries; serialize recovery across processes and prevent concurrent stale-lock reclamation.
- Protect new Windows recovery stores with private ACLs and exclude custom application storage from temporary-file cleanup. Existing permissive stores are preserved and refused for new moves.
- Serialize and flush activity records, recover from incomplete trailing writes, retain job IDs, reject hard-linked logs and bound reads of enlarged logs.
- Deduplicate browser mutation retries, recover jobs after reload, guard rapid double launches, and separate task completion from view-refresh failures. Browser and terminal views share an operation slot.
- Verify native changes where the OS exposes their result; preserve partial/uncertain outcomes and restoration guidance after cancellation. Bind audio changes to the reviewed default output device.
- Check Defender executable identity and trusted ancestors before scans. Keep secret disclosure failures out of retained logs/results.
- Isolate built-in Windows helpers from incompatible inherited PowerShell 7 modules and PATH shadowing; enforce recovery ACLs through native .NET APIs.
- Verify the actual npm archive through an isolated offline consumer installation, both command aliases, library imports, browser assets/authentication and Windows native status reads. Add pinned six-environment CI gates and versioned archive/checksum artifacts.

Known limits: package publication to the npm registry is separate. Native hardware-changing paths still require disposable Windows device/policy qualification. In-memory request identities do not survive server restart. Recovery is not a backup or a power-loss guarantee; Windows directory fsync is unavailable. POSIX folder move/recovery remains unsupported where atomic no-overwrite moves are unavailable. Donation fields remain deliberate placeholders.
