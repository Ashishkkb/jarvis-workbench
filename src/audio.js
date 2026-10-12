import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, ToolError } from './run.js';

const powershell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const helper = fileURLToPath(new URL('./audio.ps1', import.meta.url));
const fail = (message, code = 'AUDIO_INVALID') => new ToolError(message, { code });
const unavailable = () => ({ available: false, volume: null, muted: null, devices: [], canSelectDevice: false,
  warning: 'Audio controls are currently available on Windows. Use your operating system sound settings on this platform.' });

export function createAudioController({ platform = process.platform, execute = run } = {}) {
  async function invoke(mode, settings, { signal } = {}) {
    if (signal?.aborted) throw fail('Operation cancelled.', 'ABORT_ERR');
    if (platform !== 'win32') throw fail(unavailable().warning, 'AUDIO_UNSUPPORTED');
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Mode', mode];
    if (settings?.volume !== undefined) args.push('-Volume', String(settings.volume));
    if (settings?.muted !== undefined) args.push('-Mute', settings.muted ? '1' : '0');
    let result;
    try { result = await execute(powershell, args, { signal, timeout: 15_000, maxOutput: 256 * 1024 }); }
    catch (cause) {
      if (signal?.aborted || cause.code === 'ABORT_ERR') throw fail('Operation cancelled.', 'ABORT_ERR');
      throw fail('Windows could not access the sound controls. Check the audio device and Windows Audio service.', 'AUDIO_FAILED');
    }
    let data;
    try { data = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()); }
    catch { throw fail('Windows returned an unreadable sound response.', 'AUDIO_FAILED'); }
    if (data.error) throw fail(data.message || 'Windows refused the sound change.', data.error);
    if (!Array.isArray(data.devices) || typeof data.available !== 'boolean' ||
      (data.available && (!Number.isFinite(data.volume) || data.volume < 0 || data.volume > 100 || typeof data.muted !== 'boolean'))) {
      throw fail('Windows returned incomplete sound settings.', 'AUDIO_FAILED');
    }
    return data;
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
      Object.keys(settings).some(key => !['volume', 'muted', 'confirmed'].includes(key))) throw fail('Choose a volume or mute setting.');
    if (settings.confirmed !== true) throw fail('Confirm the sound change before applying it.', 'CONFIRMATION_REQUIRED');
    if (settings.volume === undefined && settings.muted === undefined) throw fail('Choose a volume or mute setting.');
    if (settings.volume !== undefined && (typeof settings.volume !== 'number' || !Number.isFinite(settings.volume) ||
      settings.volume < 0 || settings.volume > 100)) throw fail('Volume must be a number from 0 to 100.');
    if (settings.muted !== undefined && typeof settings.muted !== 'boolean') throw fail('Mute must be true or false.');
    const result = await invoke('set', settings, { signal });
    if (!result.available) throw fail('No default output device is available. Choose an output in Windows sound settings.', 'AUDIO_UNAVAILABLE');
    return result;
  }
  return { getAudioStatus, setAudioSettings };
}
const defaults = createAudioController();
export const getAudioStatus = defaults.getAudioStatus;
export const setAudioSettings = defaults.setAudioSettings;
