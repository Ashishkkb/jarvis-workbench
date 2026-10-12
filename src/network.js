import path from 'node:path';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { run, ToolError } from './run.js';

const powershell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const helper = fileURLToPath(new URL('./network.ps1', import.meta.url));
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const error = (message, code = 'NETWORK_INVALID') => new ToolError(message, { code });
const unsupported = () => ({ available: false, adapters: [], profiles: [], warning: 'Network controls are currently available on Windows. Use your operating system settings on this platform.' });
const abort = signal => { if (signal?.aborted) throw error('Operation cancelled.', 'ABORT_ERR'); };
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}

/** The injected executor supports fixture testing without changing host network settings. */
export function createNetworkController({ platform = process.platform, execute = run, now = () => Date.now() } = {}) {
  const plans = new WeakMap();
  async function invoke(mode, request = {}, { signal } = {}) {
    abort(signal);
    if (platform !== 'win32') throw error(unsupported().warning, 'NETWORK_UNSUPPORTED');
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Mode', mode];
    if (request.adapterId) args.push('-AdapterId', request.adapterId);
    if (request.profile) args.push('-ProfileBase64', Buffer.from(request.profile, 'utf8').toString('base64'));
    if (request.dns) args.push('-DnsServers', request.dns.join(','));
    let result;
    try {
      result = await execute(powershell, args, { signal, timeout: 25_000, maxOutput: 1024 * 1024 });
    } catch (cause) {
      // Never propagate stdout/stderr: a password response must never escape into logs.
      if (signal?.aborted || cause.code === 'ABORT_ERR') throw error('Operation cancelled.', 'ABORT_ERR');
      throw error('Windows could not complete this network request. Check the adapter and your Windows permissions.', 'NETWORK_FAILED');
    }
    let data;
    try { data = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()); }
    catch { throw error('Windows returned an unreadable network response.', 'NETWORK_FAILED'); }
    if (data.error) throw error(data.message || 'Windows refused this network request.', data.error);
    return data;
  }

  async function getNetworkStatus({ signal } = {}) {
    abort(signal);
    if (platform !== 'win32') return unsupported();
    try {
      const data = await invoke('status', {}, { signal });
      if (!Array.isArray(data.adapters) || !Array.isArray(data.profiles)) throw error('Windows could not list network adapters.', 'NETWORK_FAILED');
      return data;
    } catch (cause) {
      if (cause.code === 'ABORT_ERR') throw cause;
      return { available: false, adapters: [], profiles: [], warning: cause.message };
    }
  }

  function validateProfile(profile) {
    if (typeof profile !== 'string' || !profile.length || profile.length > 255 || /[\0-\x1f\x7f]/.test(profile)) {
      throw error('Choose one saved Wi-Fi profile.');
    }
  }
  function findAdapter(status, adapterId, wifi = false) {
    if (typeof adapterId !== 'string' || !GUID.test(adapterId)) throw error('Choose a network adapter.');
    const adapter = status.adapters.find(item => item.id.toLowerCase() === adapterId.toLowerCase());
    if (!adapter || (wifi && !adapter.wifi)) throw error('The selected adapter is no longer available. Refresh the network view.', 'NETWORK_CHANGED');
    return adapter;
  }
  function findProfile(status, adapter, profile) {
    validateProfile(profile);
    if (!status.profiles.some(item => item.adapterId?.toLowerCase() === adapter.id.toLowerCase() && item.name === profile)) {
      throw error('This Wi-Fi profile is not saved for the selected adapter. Connect through Windows settings first.', 'NETWORK_PROFILE_MISSING');
    }
  }
  function signature(adapter) {
    return JSON.stringify({ id: adapter.id.toLowerCase(), name: adapter.name, mac: adapter.mac,
      profile: adapter.profile ?? null, dns: adapter.dns ?? [] });
  }

  async function planNetworkChange(request, { signal } = {}) {
    abort(signal);
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      !['connect', 'disconnect', 'dns'].includes(request.action) ||
      Object.keys(request).some(key => !['action', 'adapterId', 'profile', 'dns'].includes(key))) {
      throw error('Choose a supported network action.');
    }
    const { action } = request;
    if (action === 'connect') validateProfile(request.profile);
    if (action !== 'connect' && request.profile !== undefined) throw error('A profile is only used when connecting.');
    let dns;
    if (action === 'dns') {
      if (request.dns === null) dns = null;
      else if (Array.isArray(request.dns) && request.dns.length >= 1 && request.dns.length <= 4 &&
        request.dns.every(address => typeof address === 'string' && isIP(address) === 4)) {
        dns = [...new Set(request.dns)];
      } else throw error('Enter one to four IPv4 DNS server addresses, or choose Automatic.');
    } else if (request.dns !== undefined) throw error('DNS servers are only used for the DNS action.');
    const status = await getNetworkStatus({ signal });
    if (!status.available) throw error(status.warning, 'NETWORK_UNSUPPORTED');
    const adapter = findAdapter(status, request.adapterId, action !== 'dns');
    if (action === 'connect') findProfile(status, adapter, request.profile);
    const plan = freeze({ id: randomUUID(), action, adapterId: adapter.id, adapterName: adapter.name,
      ...(action === 'connect' ? { profile: request.profile } : {}),
      ...(action === 'dns' ? { dns } : {}),
      before: { profile: adapter.profile ?? null, dns: clone(adapter.dns ?? []) },
      warning: action === 'dns'
        ? 'Changing IPv4 DNS can interrupt name resolution. Your IPv4 address and IPv6 DNS settings are not changed. Windows may require administrator permission.'
        : 'This can disconnect your current Wi-Fi connection and interrupt downloads, calls, or remote sessions.',
      expiresAt: new Date(now() + 60_000).toISOString() });
    plans.set(plan, { signature: signature(adapter), expiresAt: now() + 60_000 });
    return plan;
  }

  async function applyNetworkChange(plan, { confirmed = false, signal, onOutput } = {}) {
    const recorded = plan && typeof plan === 'object' ? plans.get(plan) : null;
    if (!recorded) throw error('Review this network change again.', 'INVALID_NETWORK_PLAN');
    if (confirmed !== true) throw error('Confirm this network change before applying it.', 'CONFIRMATION_REQUIRED');
    if (now() > recorded.expiresAt) { plans.delete(plan); throw error('This network review expired. Review it again.', 'NETWORK_PLAN_EXPIRED'); }
    abort(signal);
    plans.delete(plan);
    const current = await getNetworkStatus({ signal });
    const adapter = findAdapter(current, plan.adapterId, plan.action !== 'dns');
    if (signature(adapter) !== recorded.signature) throw error('The adapter settings changed since review. Refresh and review the change again.', 'NETWORK_CHANGED');
    if (plan.action === 'connect') findProfile(current, adapter, plan.profile);
    abort(signal);
    const result = await invoke(plan.action === 'dns' && plan.dns === null ? 'dns-auto' : plan.action, plan, { signal });
    const message = result.message || (plan.action === 'dns' ? 'IPv4 DNS settings were applied.' : 'Windows accepted the Wi-Fi request. Refresh to check the connection.');
    try { onOutput?.(message + '\n', 'stdout'); } catch { /* The OS action has already happened. */ }
    return { action: plan.action, adapterId: plan.adapterId, status: result.status || (plan.action === 'dns' ? 'applied' : 'requested'), message };
  }

  async function getWifiPassword(request, { signal } = {}) {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).some(key => !['profile', 'adapterId', 'confirmed'].includes(key))) throw error('Choose one saved Wi-Fi profile.');
    if (request.confirmed !== true) throw error('Explicit confirmation is required to reveal this saved Wi-Fi password.', 'CONFIRMATION_REQUIRED');
    validateProfile(request.profile);
    const status = await getNetworkStatus({ signal });
    if (!status.available) throw error(status.warning, 'NETWORK_UNSUPPORTED');
    const adapter = findAdapter(status, request.adapterId, true);
    findProfile(status, adapter, request.profile);
    const result = await invoke('password', { adapterId: adapter.id, profile: request.profile }, { signal });
    if (typeof result.password !== 'string' || !result.password) throw error('This profile has no saved shared password to reveal.', 'WIFI_NO_PASSWORD');
    // Only return the selected secret directly. Never invoke onOutput or persistent logging.
    return { profile: request.profile, adapterId: adapter.id, password: result.password };
  }
  return { getNetworkStatus, planNetworkChange, applyNetworkChange, getWifiPassword };
}

const defaults = createNetworkController();
export const getNetworkStatus = defaults.getNetworkStatus;
export const planNetworkChange = defaults.planNetworkChange;
export const applyNetworkChange = defaults.applyNetworkChange;
export const getWifiPassword = defaults.getWifiPassword;
