import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { run, ToolError } from './run.js';
import { clean } from './format.js';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pages = [
  ['security', 'Windows Security', 'Review antivirus protection and protection history.', 'windowsdefender'],
  ['updates', 'Windows Update', 'Review updates and restart options in Windows.', 'windowsupdate'],
  ['storage', 'Storage', 'Review disk usage and Windows storage settings.', 'storagesense'],
  ['apps', 'Installed apps', 'Manage installed applications in Windows.', 'appsfeatures'],
  ['startup', 'Startup apps', 'Choose which apps start when you sign in.', 'startupapps'],
  ['display', 'Display', 'Adjust your monitors, scale and display settings.', 'display'],
  ['sound', 'Sound', 'Choose audio input and output devices.', 'sound'],
  ['network', 'Network', 'Review network connections in Windows.', 'network-status'],
  ['privacy', 'Privacy', 'Review Windows privacy controls.', 'privacy'],
  ['power', 'Power and sleep', 'Review sleep and power settings in Windows.', 'powersleep'],
].map(([id, title, description, suffix]) => Object.freeze({ id, title, description, uri: `ms-settings:${suffix}` }));
export const SETTINGS_PAGES = Object.freeze(pages.map(({ uri, ...page }) => Object.freeze(page)));
const failure = (message, code = 'SETTINGS_UNAVAILABLE') => new ToolError(message, { code });
const unsupported = () => ({ available: false, reason: 'Windows settings are available on Windows only.', powerPlans: [], activePowerPlanId: null, pages: [], items: [] });
const checkAbort = signal => { if (signal?.aborted) throw failure('Operation cancelled.', 'ABORT_ERR'); };
const nativeTool = name => path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name);
const emit = (callback, message) => { try { callback?.(`${message}\n`, 'stdout'); } catch { /* A display failure must not repeat a setting change. */ } };

function parsePlans(text, activeId) {
  const found = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+\((.*)\)/i.exec(line);
    if (match) { const id = match[1].toLowerCase(); found.set(id, { id, name: clean(match[2]).slice(0, 160), active: id === activeId }); }
  }
  return [...found.values()];
}

/** Factory permits deterministic tests; UI callers use the singleton exports below. */
export function createSettingsService({ platform = process.platform, execute = run, now = Date.now } = {}) {
  const issued = new WeakMap();
  const ensureWindows = () => { if (platform !== 'win32') throw failure(unsupported().reason); };
  async function getSystemSettings({ signal } = {}) {
    if (platform !== 'win32') return unsupported();
    checkAbort(signal);
    try {
      const options = { signal, timeout: 10_000, maxOutput: 64 * 1024 };
      const [listed, active] = await Promise.all([execute(nativeTool('powercfg.exe'), ['/list'], options), execute(nativeTool('powercfg.exe'), ['/getactivescheme'], options)]);
      const activePowerPlanId = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(active.stdout)?.[0].toLowerCase();
      const powerPlans = parsePlans(listed.stdout, activePowerPlanId);
      if (!activePowerPlanId || !powerPlans.some(item => item.id === activePowerPlanId)) throw failure('Windows returned an incomplete power-plan list.');
      return { available: true, powerPlans, activePowerPlanId, pages: SETTINGS_PAGES, items: SETTINGS_PAGES.map(item => ({ ...item, available: true })) };
    } catch (error) {
      if (signal?.aborted || error.code === 'ABORT_ERR') throw error;
      return { available: true, powerPlans: [], activePowerPlanId: null, pages: SETTINGS_PAGES, items: SETTINGS_PAGES.map(item => ({ ...item, available: true })), powerPlanError: clean(error.message).slice(0, 500) };
    }
  }
  async function planSettingChange(input, { signal } = {}) {
    ensureWindows(); checkAbort(signal);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('Choose a setting to review.', 'INVALID_SETTING');
    if (input.action === 'power-plan') {
      if (Object.keys(input).some(key => !['action', 'id'].includes(key))) throw failure('Unknown setting fields.', 'INVALID_SETTING');
      input = { kind: 'power-plan', planId: input.id };
    }
    let details;
    if (input.kind === 'power-plan') {
      if (Object.keys(input).some(key => !['kind', 'planId'].includes(key)) || typeof input.planId !== 'string' || !GUID.test(input.planId)) throw failure('Choose a power plan from the current list.', 'INVALID_SETTING');
      const status = await getSystemSettings({ signal });
      const selected = status.powerPlans.find(item => item.id === input.planId.toLowerCase());
      if (!selected || !status.activePowerPlanId) throw failure(status.powerPlanError || 'This power plan is no longer available.', 'SETTING_CHANGED');
      details = { kind: input.kind, planId: selected.id, previousPlanId: status.activePowerPlanId, name: selected.name, title: `Use ${selected.name}`,
        warning: 'Changes the active Windows power plan. Battery life, performance and sleep behavior may change. You can select the previous plan again to undo this.' };
    } else if (input.kind === 'open-settings') {
      if (Object.keys(input).some(key => !['kind', 'pageId'].includes(key))) throw failure('Unknown setting fields.', 'INVALID_SETTING');
      const page = pages.find(item => item.id === input.pageId);
      if (!page) throw failure('Choose an available Windows Settings page.', 'INVALID_SETTING');
      details = { kind: input.kind, pageId: page.id, name: page.title, title: `Open ${page.title}`, warning: 'Opens this page in Windows Settings. Any setting changes are made there by you.' };
    } else throw failure('This setting action is not supported.', 'INVALID_SETTING');
    const expires = now() + 120_000;
    const plan = Object.freeze({ id: randomUUID(), ...details, expiresAt: new Date(expires).toISOString() });
    issued.set(plan, { expires });
    return plan;
  }
  async function openSettingsPage(id, { confirmed = false, signal } = {}) {
    ensureWindows(); checkAbort(signal);
    if (confirmed !== true) throw failure('Confirm opening this Windows Settings page first.', 'CONFIRMATION_REQUIRED');
    const page = pages.find(item => item.id === id);
    if (!page) throw failure('Choose an available Windows Settings page.', 'INVALID_SETTING');
    // The script contains only a compile-time allowlisted URI, never user input.
    await execute(nativeTool('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; Start-Process -FilePath '${page.uri}'`], { signal, timeout: 10_000, maxOutput: 16 * 1024 });
    return { status: 'opened', pageId: page.id, message: `Opened ${page.title} in Windows Settings.` };
  }
  async function applySettingChange(plan, { confirmed = false, signal, onOutput } = {}) {
    ensureWindows(); checkAbort(signal);
    const record = plan && typeof plan === 'object' ? issued.get(plan) : null;
    if (!record) throw failure('Review this setting again before applying it.', 'INVALID_SETTING_PLAN');
    if (confirmed !== true) throw failure('Explicit confirmation is required.', 'CONFIRMATION_REQUIRED');
    if (now() >= record.expires) { issued.delete(plan); throw failure('This setting review expired. Review it again.', 'SETTING_PLAN_EXPIRED'); }
    issued.delete(plan);
    if (plan.kind === 'open-settings') {
      const result = await openSettingsPage(plan.pageId, { confirmed: true, signal }); emit(onOutput, result.message); return result;
    }
    const current = await getSystemSettings({ signal });
    if (!current.powerPlans.some(item => item.id === plan.planId) || current.activePowerPlanId !== plan.previousPlanId) throw failure('The power plans changed since review. Refresh and review again.', 'SETTING_CHANGED');
    checkAbort(signal);
    await execute(nativeTool('powercfg.exe'), ['/setactive', plan.planId], { signal, timeout: 10_000, maxOutput: 64 * 1024 });
    const after = await getSystemSettings({ signal });
    if (after.activePowerPlanId !== plan.planId) return { status: 'requested', planId: plan.planId, message: 'Windows accepted the power-plan command, but the active plan could not be verified. Refresh to check.', warnings: ['The resulting power plan could not be verified.'] };
    const result = { status: 'changed', planId: plan.planId, previousPlanId: plan.previousPlanId, message: `Active power plan: ${plan.name}.` };
    emit(onOutput, result.message); return result;
  }
  return { getSystemSettings, planSettingChange, applySettingChange, openSettingsPage };
}
const service = createSettingsService();
export const { getSystemSettings, planSettingChange, applySettingChange, openSettingsPage } = service;
