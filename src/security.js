import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { run, ToolError } from './run.js';
import { clean } from './format.js';

const helper = fileURLToPath(new URL('./security-status.ps1', import.meta.url));
const failure = (message, code = 'SECURITY_UNAVAILABLE') => new ToolError(message, { code });
const checkAbort = signal => { if (signal?.aborted) throw failure('Operation cancelled.', 'ABORT_ERR'); };
const safe = (value, limit = 500) => clean(value == null ? '' : String(value)).trim().slice(0, limit);
const boolean = value => typeof value === 'boolean' ? value : null;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const unsupported = () => ({ available: false, canScan: false, reason: 'Microsoft Defender controls are available on Windows only.', detections: [], warnings: [] });
const emit = (callback, message) => { try { callback?.(`${message}\n`, 'stdout'); } catch { /* Scan execution must not depend on the display. */ } };

async function inspectTarget(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.length > 4096 || /[\x00-\x1f]/.test(input) || /^[/\\]{2}/.test(input)) throw failure('Choose an absolute local file or folder to scan.', 'INVALID_SCAN_PATH');
  const resolved = path.resolve(input);
  const canonical = await realpath(resolved);
  let cursor = resolved;
  while (true) {
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw failure('Symbolic links and junctions cannot be used as scan targets.', 'INVALID_SCAN_PATH');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const info = await lstat(canonical);
  if (!info.isFile() && !info.isDirectory()) throw failure('Choose a regular file or folder.', 'INVALID_SCAN_PATH');
  return { path: canonical, dev: String(info.dev), ino: String(info.ino), birthtimeMs: info.birthtimeMs, file: info.isFile(), size: info.size, mtimeMs: info.mtimeMs };
}
function sameTarget(a, b) {
  return a.path === b.path && a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs && a.file === b.file && (!a.file || a.size === b.size && a.mtimeMs === b.mtimeMs);
}

/** Native adapter factory keeps destructive scans out of tests. */
export function createSecurityService({ platform = process.platform, execute = run, now = Date.now, inspectPath = inspectTarget,
  pollIntervalMs = 15_000, monitorTimeoutMs = 8 * 60 * 60_000 } = {}) {
  const issued = new WeakMap();
  let active = false;
  const powershell = path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  async function nativeStatus(mode, signal) {
    const result = await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Mode', mode], { signal, timeout: 20_000, maxOutput: 1024 * 1024 });
    try { return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()); }
    catch { throw failure('Windows returned an unreadable Defender response. Open Windows Security to check protection.'); }
  }
  async function getSecurityStatus({ signal } = {}) {
    if (platform !== 'win32') return unsupported();
    checkAbort(signal);
    try {
      const data = await nativeStatus('status', signal);
      if (data.available !== true) return { available: false, canScan: false, reason: safe(data.reason || 'Microsoft Defender is unavailable.'), detections: [], warnings: [] };
      const canScan = data.administrator === true && data.enabled === true && data.serviceEnabled === true;
      const scanUnavailableReason = !data.administrator ? 'To run a Defender scan, start your terminal as administrator and launch Jarvis there.' : data.enabled !== true || data.serviceEnabled !== true ? (data.enabled === false || data.serviceEnabled === false ? 'Microsoft Defender is disabled or not the active antivirus. Review Windows Security.' : 'Windows returned incomplete protection status. Review Windows Security before scanning.') : null;
      return { available: true, provider: 'Microsoft Defender Antivirus', administrator: data.administrator === true, canScan, scanUnavailableReason,
        enabled: boolean(data.enabled), serviceEnabled: boolean(data.serviceEnabled), realtimeEnabled: boolean(data.realtimeEnabled),
        tamperProtected: typeof data.tamperProtected === 'boolean' ? data.tamperProtected : null,
        signatureVersion: safe(data.signatureVersion, 100), definitionsUpdated: date(data.definitionsUpdated),
        scanStatus: active ? 'Jarvis is monitoring a scan' : 'No Jarvis scan is being monitored',
        quickScan: { startedAt: date(data.quickScan?.startedAt), finishedAt: date(data.quickScan?.finishedAt) },
        fullScan: { startedAt: date(data.fullScan?.startedAt), finishedAt: date(data.fullScan?.finishedAt) },
        detections: (Array.isArray(data.detections) ? data.detections : []).slice(0, 100).map(item => ({ id: safe(item.id, 100), threatId: safe(item.threatId, 100), name: safe(item.name, 300), severity: safe(item.severity, 80),
          active: typeof item.active === 'boolean' ? item.active : null, actionSuccess: typeof item.actionSuccess === 'boolean' ? item.actionSuccess : null, detectedAt: date(item.detectedAt),
          resources: (Array.isArray(item.resources) ? item.resources : []).slice(0, 10).map(value => safe(value, 2048)) })),
        warnings: (Array.isArray(data.warnings) ? data.warnings : []).slice(0, 10).map(value => safe(value)),
      };
    } catch (error) {
      if (signal?.aborted || error.code === 'ABORT_ERR') throw error;
      return { available: false, canScan: false, reason: safe(error.message), detections: [], warnings: [] };
    }
  }
  async function planSecurityScan(input, { signal } = {}) {
    if (platform !== 'win32') throw failure(unsupported().reason);
    checkAbort(signal);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['type', 'path'].includes(key)) || !['quick', 'full', 'custom'].includes(input.type)) throw failure('Choose a quick, full, or custom Defender scan.', 'INVALID_SCAN');
    if (input.type !== 'custom' && input.path !== undefined) throw failure('Only custom scans accept a path.', 'INVALID_SCAN');
    if (active) throw failure('Jarvis is already monitoring a Defender scan.', 'SECURITY_BUSY');
    const status = await getSecurityStatus({ signal });
    if (!status.available || !status.canScan) throw failure(status.reason || status.scanUnavailableReason);
    const target = input.type === 'custom' ? await inspectPath(input.path) : null;
    const located = await nativeStatus('locate', signal);
    if (typeof located.path !== 'string' || !path.win32.isAbsolute(located.path) || path.win32.basename(located.path).toLowerCase() !== 'mpcmdrun.exe') throw failure('A trusted Microsoft Defender scanner is not available.');
    const expires = now() + 120_000;
    const plan = Object.freeze({ id: randomUUID(), type: input.type, path: target?.path || null, title: `${input.type[0].toUpperCase()}${input.type.slice(1)} Microsoft Defender scan`,
      warning: 'Microsoft Defender may quarantine or remove threats according to your Windows protection settings. Save your work first. Stopping monitoring does not stop the Defender scan; use Windows Security to review it. Full scans can take hours.',
      cancellation: 'monitoring-only', expiresAt: new Date(expires).toISOString() });
    issued.set(plan, { expires, target, executable: located.path });
    return plan;
  }
  async function runSecurityScan(plan, { confirmed = false, signal, onOutput } = {}) {
    if (platform !== 'win32') throw failure(unsupported().reason);
    checkAbort(signal);
    const record = plan && typeof plan === 'object' ? issued.get(plan) : null;
    if (!record) throw failure('Review this scan again before starting it.', 'INVALID_SCAN_PLAN');
    if (confirmed !== true) throw failure('Explicit confirmation is required before a Defender scan.', 'CONFIRMATION_REQUIRED');
    if (now() >= record.expires) { issued.delete(plan); throw failure('This scan review expired. Review it again.', 'SCAN_PLAN_EXPIRED'); }
    if (active) throw failure('Jarvis is already monitoring a Defender scan.', 'SECURITY_BUSY');
    issued.delete(plan);
    active = true;
    let started = false, timer, poller, polling = false, monitorReason = null;
    const monitor = new AbortController();
    const stopMonitoring = reason => { if (!monitor.signal.aborted) { monitorReason = reason; monitor.abort(); } };
    const onAbort = () => stopMonitoring('cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    try {
      const status = await getSecurityStatus({ signal: monitor.signal });
      if (!status.available || !status.canScan) throw failure(status.reason || status.scanUnavailableReason);
      if (record.target && !sameTarget(record.target, await inspectPath(record.target.path))) throw failure('The custom scan target changed since review. Review it again.', 'SCAN_TARGET_CHANGED');
      const located = await nativeStatus('locate', monitor.signal);
      if (located.path !== record.executable) throw failure('The Defender scanner changed since review. Review it again.', 'SCAN_SCANNER_CHANGED');
      checkAbort(monitor.signal);
      const args = ['-Scan', '-ScanType', String({ quick: 1, full: 2, custom: 3 }[plan.type])];
      if (record.target) args.push('-File', record.target.path);
      started = true;
      emit(onOutput, `Starting ${plan.type} Microsoft Defender scan. Defender may apply its configured threat actions.`);
      timer = setTimeout(() => stopMonitoring('timeout'), Math.min(Math.max(100, monitorTimeoutMs), 24 * 60 * 60_000));
      poller = setInterval(async () => {
        if (polling || monitor.signal.aborted) return;
        polling = true;
        try {
          const update = await getSecurityStatus({ signal: monitor.signal });
          emit(onOutput, update.available ? `Defender scan is still being monitored. ${update.detections.length} recent protection-history entries; these may predate this scan.` : 'Defender status refresh is unavailable; waiting for the scan command to finish.');
        } catch { /* The scan command remains authoritative; status refresh is best effort. */ }
        finally { polling = false; }
      }, Math.max(100, pollIntervalMs));
      const result = await execute(record.executable, args, { timeout: 0, signal: monitor.signal, killTree: false, allowFailure: true, maxOutput: 8 * 1024 * 1024,
        onOutput: chunk => { try { onOutput?.(chunk, 'stdout'); } catch { /* Non-fatal output handler. */ } } });
      clearTimeout(timer); clearInterval(poller);
      const security = await getSecurityStatus({ signal: monitor.signal }).catch(() => ({ available: false, reason: 'Status refresh was interrupted after the scan command finished.', detections: [], warnings: [] }));
      if (result.code === 0) return { status: 'completed', exitCode: 0, scanMayContinue: false, message: 'Defender finished the scan. It found no threats or successfully remediated detections. Review Protection history for details.', security };
      if (result.code === 2) return { status: 'attention-required', exitCode: 2, scanMayContinue: false, message: 'Defender reported a detection requiring attention or a scan error. Review Windows Security and the scan output.', warnings: ['Defender requires review; this result does not establish that the computer is clean.'], security };
      throw failure(`Microsoft Defender returned exit code ${result.code}. Review Windows Security and the scan output.`, 'SCAN_FAILED');
    } catch (error) {
      if (started && (monitor.signal.aborted || ['OUTPUT_LIMIT', 'OUTPUT_HANDLER', 'TIMEOUT'].includes(error.code))) {
        const message = monitorReason === 'timeout' ? 'Jarvis reached its monitoring time limit. Defender may still be scanning. Review Windows Security.' : 'Jarvis stopped monitoring. Defender may still be scanning. Review Windows Security; no global scan cancellation was sent.';
        emit(onOutput, message);
        return { status: 'monitoring-stopped', cancelled: monitorReason === 'cancelled', scanMayContinue: true, message, warnings: [message] };
      }
      throw error;
    } finally {
      clearTimeout(timer); clearInterval(poller); signal?.removeEventListener('abort', onAbort); monitor.abort(); active = false;
    }
  }
  return { getSecurityStatus, planSecurityScan, runSecurityScan };
}
const service = createSecurityService();
export const { getSecurityStatus, planSecurityScan, runSecurityScan } = service;
