# Contributing to Jarvis Workbench

Jarvis Workbench is maintained by Ashish / [Ashishkkb](https://github.com/Ashishkkb) and released under Apache-2.0. Contributions should make everyday command-line work clearer while preserving explicit scope and recoverable behavior.

## Local development

Use a standalone checkout, such as `D:\jarvis-workbench` on Windows, with Node.js 22 or 24. There are no npm runtime dependencies.

```sh
npm test
npm run check
node ./bin/jarvis.js --demo
node ./bin/jarvis.js --web --demo
npm run test:package
```

`npm run test:package` builds a real archive, installs it offline into a unique temporary prefix, exercises both commands, library imports and the local browser, then uninstalls it. It leaves your normal global installation untouched. To test source installation separately, run `npm install -g .` and then `jarvis --demo`. The registry package is `@ashishkkb/jarvis-workbench`. Use the version or beta channel documented in the README to test a published build; keep source and registry installations distinct when reporting issues.

## Change expectations

- Explain the user-visible problem and the resulting behavior in the pull request. Include the relevant tests and any platform limitations.
- Keep the terminal and browser controls consistent. Demonstrate important empty, loading, cancelled, partial, and error states, as well as the successful case.
- Preserve keyboard navigation, readable narrow layouts, terminal escape sanitization, and accessible browser labels.
- Use literal argument arrays for executable invocation. Do not build shell commands from filenames, queries, or untrusted project text.
- Keep scans bounded and cancellable. Show when results are incomplete; do not silently describe partial totals as whole-drive measurements.
- Keep mutations separate from discovery. A cleanup review must show its target paths and clearly distinguish quarantine, restore, and irreversible purge.
- Do not add telemetry, external assets, background services, or new dependencies without explaining the need and discussing the change first.

## Testing safely

Use generated temporary fixtures for Git mutations, cleanup, link handling, interrupted operations, and restore conflicts. Never make a test depend on deleting personal files, changing global Git configuration, or scanning a user's entire disk.

For storage changes, cover changed-file checks, containment, symbolic links/junctions, confirmation, partial cancellation, persistent manifest recovery, no-overwrite restoration, and refusal of unsafe purge entries. Test both native ripgrep and the built-in search fallback when changing search behavior.

CI runs the test suite, syntax checks, and a real offline tarball install, consumer smoke test and uninstall on Node 22 and 24 across Ubuntu, Windows, and macOS. On Windows it also parses every packaged native PowerShell helper and probes native read-only status without executing system changes. Explicit hardware or policy unavailability is recorded separately from failures. Native OS checks still matter: a mocked parser test alone does not establish that an external utility is present or behaves identically on every machine.

## Releases

Follow [RELEASING.md](RELEASING.md). Before publishing, verify the supported CI matrix, browser and terminal smoke tests, package contents, version, license, security notes, and install/uninstall behavior from the generated tarball. Confirm ownership of the npm scope and GitHub destination. Publishing a registry release is a separate authorized action; `npm pack` only creates a local archive.

Maintain accurate claims: metadata scans are not malware detection, quarantine does not free disk space, and there is no guaranteed amount of space to recover. Leave donation destinations unset until the owner supplies and verifies them. Report security issues using [SECURITY.md](SECURITY.md).
