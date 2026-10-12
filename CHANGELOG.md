# Changes

## 0.4.0-beta.1 - 2026-10-12

- Redesign the browser workspace with an indigo/cyan palette, restrained gradients, consistent cards, accessible controls and responsive layouts. Refresh the terminal visual hierarchy and palette.
- Improve overview task shortcuts, screen descriptions and unavailable-value presentation.
- Add Inside your PC: an interactive browser component map and a keyboard-driven terminal inspector covering CPU, memory, motherboard/BIOS, graphics, storage, battery, network, ports and cooling.
- Add bounded, read-only Windows inventory and sensor observations, partial results, explicit unavailable readings, device findings and related-tool links. Add portable basic observations and `jarvis hardware [--json]`.
- Share/cache browser hardware reads for 15 seconds, cancel on server shutdown, and record summary-only activity events.
- Resolve Windows socket-owner PIDs to process names in one bounded read, keeping port rows available when an owner cannot be identified.
- Fix Toolbox opening with a click event as its category (`[object PointerEvent]`).

Hardware observations depend on firmware, drivers and OS permissions. The schematic is illustrative; unavailable sensors and normal status codes cannot rule out physical faults. This release uses the npm beta channel. Hardware-changing Windows actions still require device/policy qualification; donation details remain placeholders.

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
