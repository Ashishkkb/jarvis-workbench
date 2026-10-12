# Releasing Jarvis Workbench

The public package identity is `@ashishkkb/jarvis-workbench`. The repository produces an npm-compatible tarball without contacting a registry. Registry publication is a separate, intentional step using the exact validated archive. The release workflow produces downloadable GitHub Actions artifacts; it does not publish to npm or create a public GitHub Release.

## Release gate

Use Node.js 22 or 24 and a standalone checkout. Run:

```sh
npm test
npm run check
npm run test:package
```

The package gate creates its own temporary workspace, npm cache, npm configuration and install prefix. It uses `npm pack` and an offline installation of that exact archive with lifecycle scripts disabled. It checks required files, rejects development files and common credential-file names, exercises the `jarvis` and `jv` command shims, imports the public library entry points, serves the packaged browser assets, checks authenticated API access, and uninstalls the package. Windows also parses the packaged PowerShell helpers and probes the installed network, audio, power and Defender status integrations. Hardware or policy unavailability is reported explicitly; a malformed helper response or internal failure fails the gate. No personal files, global package installation, network settings or security settings are changed.

All six CI jobs (Node 22/24 on Windows, Ubuntu and macOS) must pass for the release commit. OS-specific changes also need native validation on the OS they affect. Mocked Windows tests verify contracts and refusal paths; they do not establish that changing Wi-Fi, audio or Defender settings succeeds on every edition, policy configuration or device.

## Build reviewable artifacts

Keep `package.json`, the root version in `package-lock.json`, and the release notes consistent. To retain the tested archive locally, choose a new output directory:

```sh
node scripts/verify-package.js --output .artifacts/release-candidate
```

The directory receives the `.tgz` archive, `SHA256SUMS`, and `release-manifest.json`. Existing artifact files are never silently replaced. The manifest records package content and the environment where the consumer check ran; it is evidence for that check, not an independent security certification. SHA-256 checksums detect mismatched bytes; download them from the same trusted release destination as the archive.

For a tagged release, the tag must be `v` followed by the exact package version. Pushing such a tag runs the full matrix again before producing an artifact. The **Validate release artifact** workflow can also be dispatched for a release candidate without creating a tag. GitHub retains its Actions artifacts for 90 days; copy the verified archive, checksum and manifest into a public GitHub Release when intentionally publishing a release for long-term distribution.

The workflow uses only read access to the repository and GitHub's built-in artifact service. It needs no stored npm token. Third-party workflow actions are pinned to verified commit hashes. When updating a pin, verify its release in the upstream repository and review the change.

## Manual release checks

1. Check the terminal and browser at narrow and normal widths, using only generated fixture files for destructive operations. Verify loading, errors, cancellation, empty states and keyboard focus.
2. Exercise file copy, rename, removal and restoration in a disposable fixture. Verify conflict refusal and recovery after interruption. The activity log should explain failed and incomplete work.
3. On a suitable Windows test machine, review native status results and permission failures. Perform any network, sound, power or Defender mutation only with an explicit test target and a recovery plan; record the OS version and result. Do not run a scan of a user's whole computer as a CI test.
4. Confirm that Wi-Fi passwords require explicit confirmation and are never included in activity output, job results, URLs, diagnostics or release artifacts.
5. Review the changes and release notes against the actual implemented behavior. State limitations and known issues; do not claim universal device support or a clean malware result from an exit code alone.
6. Confirm ownership of the intended npm scope and GitHub destination. Registry publication is a separate action. If approved, publish the exact validated archive, not a newly packed working directory, and verify its installed version after publication.

## Install a registry version

After publication has been verified, install the exact version with:

```sh
npm install --global @ashishkkb/jarvis-workbench@0.4.0-beta.1
jarvis --version
jarvis doctor
```

This selects version 0.4.0-beta.1 independently of npm distribution tags. Restart running Jarvis sessions after an update. Installing an earlier published version rolls the code back; it does not undo system settings or file changes.

## Install, update and roll back from an archive

After verifying the archive checksum, users can install it with a supported Node.js/npm version:

```sh
npm install --global --offline --ignore-scripts --no-audit --no-fund ./ashishkkb-jarvis-workbench-VERSION.tgz
jarvis --version
jarvis doctor
```

Replace `VERSION` with the real release version. On Windows, forward slashes or quoted paths with spaces work in Git Bash. Restart running Jarvis sessions after an update. Installing a previously validated archive with the same command rolls the code back. It does not undo system settings or file changes made while another version was running.

Uninstall with `npm uninstall --global @ashishkkb/jarvis-workbench`. Uninstalling code intentionally leaves activity and recovery data intact. Recover held files through Jarvis before considering any separate data cleanup. Do not delete recovery folders merely to make an uninstall look complete.

## Security issues

Follow [SECURITY.md](SECURITY.md). Keep release notes factual about the fix and affected versions without exposing personal paths, Wi-Fi profiles/passwords, authentication tokens or unredacted activity logs.

## Local qualification note

On the development Windows host, the complete consumer gate passes with a task-local temporary directory. Runs in that host's profile temporary directory encountered native-helper access/launch failures; the cause is unresolved. This is separate from the PowerShell 7 module-inheritance defect fixed in 0.3. No security protections were changed to obtain a pass. CI continues to test ordinary OS temporary directories. Record which temporary location was used when reproducing an install problem; a pass in one environment does not establish compatibility with every host policy or temporary-folder context.
