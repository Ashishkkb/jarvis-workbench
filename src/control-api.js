import * as networkFunctions from './network.js';
import * as audioFunctions from './audio.js';
import * as securityFunctions from './security.js';
import * as settingsFunctions from './settings.js';
import * as fileFunctions from './file-actions.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw fail('Unknown or invalid request fields.');
  for (const value of Object.values(body)) if (typeof value === 'string' && (value.includes('\0') || value.length > 4096)) throw fail('A request field is invalid or too long.');
}
const confirm = body => { if (body.confirmed !== true) throw fail('Review and explicitly confirm this change first.'); };
const filePlan = plan => Object.fromEntries(['id', 'action', 'source', 'destination', 'files', 'bytes', 'warning', 'expiresAt'].map(key => [key, plan[key]]));

/** Authenticated routes only: the HTTP server enforces token, origin, host and no-store. */
export function createControlApi({ workspace, demo, createJob, audit, network, audio, security, settings, fileActions }) {
  const services = { network: { ...networkFunctions, ...network }, audio: { ...audioFunctions, ...audio },
    security: { ...securityFunctions, ...security }, settings: { ...settingsFunctions, ...settings }, files: { ...fileFunctions, ...fileActions } };
  const plans = new Map();
  const demoReason = 'System and file controls use your actual computer. Start Jarvis without --demo to use them.';
  const unavailable = { available: false, reason: demoReason, warning: demoReason, adapters: [], profiles: [], devices: [], threats: [], powerPlans: [], pages: [] };
  async function get(route, signal) {
    if (route === '/api/control') return { platform: process.platform, capabilities: { network: !demo && process.platform === 'win32', audio: !demo && process.platform === 'win32', security: !demo && process.platform === 'win32', settings: !demo && process.platform === 'win32', files: !demo } };
    if (route === '/api/files/recovery') return demo ? [] : services.files.listFileRecovery(workspace);
    const methods = { '/api/network': ['network', 'getNetworkStatus'], '/api/audio': ['audio', 'getAudioStatus'], '/api/security': ['security', 'getSecurityStatus'], '/api/settings': ['settings', 'getSystemSettings'] };
    if (!methods[route]) throw fail('This control route was not found.', 404);
    if (demo) return unavailable;
    const [group, method] = methods[route];
    return services[group][method]({ signal });
  }
  function save(group, plan) {
    for (const [id, entry] of plans) if (Date.parse(entry.plan.expiresAt) <= Date.now()) plans.delete(id);
    while (plans.size >= 40) plans.delete(plans.keys().next().value);
    plans.set(plan.id, { group, plan });
  }
  async function immediate(action, execute) {
    const job = createJob(action, execute);
    await job.promise;
    if (job.status !== 'completed') throw fail(job.error || 'The change could not be completed.');
    return { status: 200, value: job.result };
  }
  async function post(route, body, signal) {
    if (!postRoutes.has(route)) throw fail('This control route was not found.', 404);
    if (demo) throw fail(demoReason);
    if (route === '/api/network/password') {
      fields(body, ['profile', 'adapterId', 'confirmed']); confirm(body);
      // Sensitive result bypasses jobs, audit, redaction and all persistence.
      const result = await services.network.getWifiPassword(body, { signal });
      if (typeof result?.password !== 'string') throw fail('No saved password was returned.');
      return { status: 200, sensitive: true, value: { password: result.password } };
    }
    if (route === '/api/audio') {
      fields(body, ['volume', 'muted', 'confirmed']); confirm(body);
      return immediate('audio-change', options => services.audio.setAudioSettings(body, options));
    }
    if (route === '/api/settings/open') {
      fields(body, ['id', 'confirmed']); confirm(body);
      return immediate('settings-open', options => services.settings.openSettingsPage(body.id, { ...options, confirmed: true }));
    }
    const group = route.split('/')[2];
    if (route.endsWith('/plan')) {
      const allowed = { network: ['action', 'adapterId', 'profile', 'dns'], security: ['type', 'path'], settings: ['action', 'id'], files: ['action', 'path', 'destination', 'name', 'recoveryId'] };
      fields(body, allowed[group]);
      const methods = { network: 'planNetworkChange', security: 'planSecurityScan', settings: 'planSettingChange', files: 'planFileAction' };
      const plan = group === 'files' ? await services.files.planFileAction(workspace, body, { signal }) : await services[group][methods[group]](body, { signal });
      save(group, plan);
      await audit({ action: group + '-plan', status: 'review', message: 'Reviewed ' + group + ' operation.' });
      return { status: 200, value: group === 'files' ? filePlan(plan) : plan };
    }
    fields(body, ['planId', 'confirmed']); confirm(body);
    const entry = typeof body.planId === 'string' ? plans.get(body.planId) : null;
    if (!entry || entry.group !== group || !Number.isFinite(Date.parse(entry.plan.expiresAt)) || Date.parse(entry.plan.expiresAt) <= Date.now()) throw fail('This review is missing, already used, or expired. Review the change again.');
    const methods = { network: 'applyNetworkChange', security: 'runSecurityScan', settings: 'applySettingChange', files: 'executeFileAction' };
    const action = group === 'security' ? 'security-scan' : group === 'files' ? 'file-' + entry.plan.action : group + '-change';
    const job = createJob(action, options => services[group][methods[group]](entry.plan, { ...options, confirmed: true }));
    plans.delete(body.planId);
    return { status: 202, value: { id: job.id } };
  }
  const getRoutes = new Set(['/api/control', '/api/network', '/api/audio', '/api/security', '/api/settings', '/api/files/recovery']);
  const postRoutes = new Set(['/api/network/plan', '/api/network/execute', '/api/network/password', '/api/audio', '/api/security/plan', '/api/security/scan', '/api/settings/plan', '/api/settings/execute', '/api/settings/open', '/api/files/plan', '/api/files/execute']);
  return { get, post, getRoutes, postRoutes };
}
