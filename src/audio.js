import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, ToolError } from './run.js';

const powershell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const helper = fileURLToPath(new URL('./audio.ps1', import.meta.url));
const fail = (message, code = 'AUDIO_INVALID') => new ToolError(message, { code });
const unavailable = () => ({ available: false, volume: null, muted: null, devices: [], defaultDeviceId: null, canSelectDevice: false,
  warning: 'Audio controls are currently available on Windows. Use your operating system sound settings on this platform.' });

export function createAudioController({ platform = process.platform, execute = run } = {}) {
  let applying = false;
  async function invoke(mode, settings, { signal } = {}) {
    if (signal?.aborted) throw fail('Operation cancelled.', 'ABORT_ERR');
    if (platform !== 'win32') throw fail(unavailable().warning, 'AUDIO_UNSUPPORTED');
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Mode', mode];
    if (settings?.volume !== undefined) args.push('-Volume', String(settings.volume));
    if (settings?.muted !== undefined) args.push('-Mute', settings.muted ? '1' : '0');
    if (settings?.deviceId !== undefined) args.push('-DeviceIdBase64', Buffer.from(settings.deviceId, 'utf8').toString('base64'));
    let result;
    try { result = await execute(powershell, args, { cwd: path.win32.dirname(powershell), signal, timeout: 15_000, maxOutput: 256 * 1024 }); }
    catch (cause) {
      if (signal?.aborted || cause.code === 'ABORT_ERR') throw fail('Operation cancelled.', 'ABORT_ERR');
      throw fail('Windows could not access the sound controls. Check the audio device and Windows Audio service.', 'AUDIO_FAILED');
    }
    let data;
    try { data = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()); }
    catch { throw fail('Windows returned an unreadable sound response.', 'AUDIO_FAILED'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('Windows returned an unreadable sound response.', 'AUDIO_FAILED');
    if (data.error === 'AUDIO_CHANGED') throw fail('The default output device changed. Refresh and review the sound change again.', 'AUDIO_CHANGED');
    if (data.error) throw fail('Windows could not access the sound controls. Check the audio device and Windows Audio service.', 'AUDIO_FAILED');
    if (!Array.isArray(data.devices) || data.devices.length > 4096 || data.devices.some(item => !item || typeof item.id !== 'string' || typeof item.name !== 'string' || !['input', 'output'].includes(item.kind) || typeof item.isDefault !== 'boolean') || typeof data.available !== 'boolean' ||
      (data.available && (!Number.isFinite(data.volume) || data.volume < 0 || data.volume > 100 || typeof data.muted !== 'boolean'))) {
      throw fail('Windows returned incomplete sound settings.', 'AUDIO_FAILED');
    }
    return { ...data, defaultDeviceId: data.devices.find(item => item?.kind === 'output' && item.isDefault === true)?.id || data.changedDeviceId || null };
  }
  async function getAudioStatus({ signal } = {}) {
    if (signal?.aborted) throw fail('Operation cancelled.', 'ABORT_ERR');
    if (platform !== 'win32') return unavailable();
    try { return await invoke('status', {}, { signal }); }
    catch (cause) {
      if (cause.code === 'ABORT_ERR') throw cause;
      return { ...unavailable(), warning: cause.message };
    }
  }
  async function setAudioSettings(settings, { signal } = {}) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      Object.keys(settings).some(key => !['volume', 'muted', 'confirmed', 'deviceId'].includes(key))) throw fail('Choose a volume or mute setting.');
    if (settings.confirmed !== true) throw fail('Confirm the sound change before applying it.', 'CONFIRMATION_REQUIRED');
    if (settings.volume === undefined && settings.muted === undefined) throw fail('Choose a volume or mute setting.');
    if (settings.volume !== undefined && (typeof settings.volume !== 'number' || !Number.isFinite(settings.volume) ||
      settings.volume < 0 || settings.volume > 100)) throw fail('Volume must be a number from 0 to 100.');
    if (settings.muted !== undefined && typeof settings.muted !== 'boolean') throw fail('Mute must be true or false.');
    if (settings.deviceId !== undefined && (typeof settings.deviceId !== 'string' || !settings.deviceId.length || settings.deviceId.length > 2048 || /[\0-\x1f\x7f]/.test(settings.deviceId))) throw fail('Choose a current output device.');
    if (signal?.aborted) throw fail('Operation cancelled.', 'ABORT_ERR');
    if (applying) throw fail('Another sound change is in progress. Wait for it to finish.', 'AUDIO_BUSY');
    applying = true;
    try {
      let result, interrupted = false;
      try { result = await invoke('set', settings, { signal }); }
      catch (cause) {
        if (['AUDIO_CHANGED', 'AUDIO_UNSUPPORTED'].includes(cause.code)) throw cause;
        interrupted = true;
        result = await getAudioStatus().catch(() => unavailable());
      }
      if (!result.available && !result.mutationAttempted && !interrupted) throw fail('No default output device is available. Choose an output in Windows sound settings.', 'AUDIO_UNAVAILABLE');
      const before = result.before && Number.isFinite(result.before.volume) && typeof result.before.muted === 'boolean' && typeof result.before.deviceId === 'string'
        ? { volume: result.before.volume, muted: result.before.muted, deviceId: result.before.deviceId } : null;
      const observedDeviceId = result.changedDeviceId || result.devices.find(item => item.kind === 'output' && item.isDefault)?.id || null;
      const sameDevice = !settings.deviceId || observedDeviceId === settings.deviceId;
      const after = result.available ? { volume: result.volume, muted: result.muted, deviceId: observedDeviceId } : null;
      const verified = Boolean(after && sameDevice && (settings.volume === undefined || Math.abs(after.volume - settings.volume) <= 0.11) && (settings.muted === undefined || after.muted === settings.muted));
      const partial = after && before && sameDevice && (after.volume !== before.volume || after.muted !== before.muted);
      const status = verified ? 'changed' : partial ? 'partial' : 'uncertain';
      const restoreInstruction = before ? `Previous sound settings on the reviewed device: volume ${before.volume}%, ${before.muted ? 'muted' : 'unmuted'}. Review a new change to restore them. Jarvis did not roll back.`
        : 'Refresh Sound or open Windows sound settings to check the current device. The previous values could not be recovered; Jarvis did not roll back.';
      const message = verified ? 'The requested sound settings were verified on the output device.'
        : partial ? 'Only part of the sound change was observed. Review the current volume and mute settings before trying again.'
          : 'The requested sound settings could not be verified. The device may already have changed; refresh before trying again.';
      const warnings = verified && !interrupted && !result.warning ? [] : [message, restoreInstruction];
      if (verified && interrupted) warnings[0] = 'The command response was interrupted, but the requested sound settings were subsequently observed.';
      return { ...result, status, verified, before, after, changedDeviceId: observedDeviceId, restoreInstruction,
        cancellationRequested: signal?.aborted === true, message, warnings };
    } finally { applying = false; }
  }
  return { getAudioStatus, setAudioSettings };
}
const defaults = createAudioController();
export const getAudioStatus = defaults.getAudioStatus;
export const setAudioSettings = defaults.setAudioSettings;
