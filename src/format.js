export function clean(value = '') {
  return String(value)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ');
}

function charWidth(char) {
  const c = char.codePointAt(0);
  if (/\p{Mark}/u.test(char)) return 0;
  return c >= 0x1100 && (c <= 0x115f || c >= 0x2e80 && c <= 0xa4cf || c >= 0xac00 && c <= 0xd7a3 ||
    c >= 0xf900 && c <= 0xfaff || c >= 0xfe10 && c <= 0xfe6f || c >= 0xff00 && c <= 0xff60 ||
    c >= 0x1f300 && c <= 0x1faff) ? 2 : 1;
}
export function width(value) { return [...clean(value)].reduce((sum, char) => sum + charWidth(char), 0); }
export function fit(value, limit, pad = true) {
  const source = clean(value);
  let out = '', used = 0;
  const clipped = width(source) > limit;
  const target = Math.max(0, limit - (clipped ? 1 : 0));
  for (const char of source) {
    const w = charWidth(char);
    if (used + w > target) break;
    out += char; used += w;
  }
  if (clipped && limit > 0) { out += '~'; used++; }
  return out + (pad ? ' '.repeat(Math.max(0, limit - used)) : '');
}
export function bytes(value = 0) {
  if (!Number.isFinite(value)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i === 0 ? 0 : value < 10 ? 1 : 0)} ${units[i]}`;
}
export function elapsed(seconds = 0) {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export function friendlyError(error) {
  const message = clean(error?.message || error);
  if (/Authentication failed|could not read Username|Permission denied \(publickey\)|terminal prompts disabled|invalid credentials|could not.*credential|credential.*(?:expired|rejected)/i.test(message)) {
    return 'Git sign-in is needed. Sign in with your Git client, then try again.';
  }
  if (/not a git repository/i.test(message)) return 'This folder is not a Git repository.';
  if (/index.lock.*exists|Unable to create.*index.lock/i.test(message)) return 'Another Git operation is running. Wait for it to finish, then refresh.';
  return message;
}
export function safeRemote(value = '') {
  return clean(value || '(none)').replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[credentials]@').replace(/([?&](?:token|access_token|key)=)[^&\s]+/gi, '$1[redacted]');
}
