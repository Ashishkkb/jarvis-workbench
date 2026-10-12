import { readFileSync } from 'node:fs';

export function getAbout() {
  const support = JSON.parse(readFileSync(new URL('../support.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const fields = ['accountHolder', 'accountNumber', 'ifsc', 'upi', 'paymentUrl'];
  const donations = Object.fromEntries(fields.filter(key => typeof support.donations?.[key] === 'string' && support.donations[key].trim())
    .map(key => [key, support.donations[key].trim()]));
  if (donations.paymentUrl && !/^https:\/\//i.test(donations.paymentUrl)) delete donations.paymentUrl;
  return { name: 'Jarvis Workbench', author: support.author || 'Ashishkkb', version: pkg.version,
    license: pkg.license, repository: 'https://github.com/Ashishkkb/jarvis-workbench',
    donations: Object.keys(donations).length ? donations : null };
}
