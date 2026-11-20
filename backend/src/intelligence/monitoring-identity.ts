import { createHmac } from 'node:crypto';
import { normalizeDomain } from './monitoring.logic';

export function identityVersion(): string {
  const version = process.env.SICTI_MONITORING_IDENTITY_ACTIVE_VERSION;
  if (!version || !/^v[1-9][0-9]{0,3}$/.test(version)) throw new Error('Monitoring identity key version unavailable');
  return version;
}

export function identityDigest(tenantId: string, raw: string, version = identityVersion()): { readonly digest: string; readonly label: string; readonly version: string } {
  const identity = raw.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/.test(identity)) throw new Error('Invalid identity');
  const domain = normalizeDomain(identity.split('@')[1]);
  const encoded = process.env[`SICTI_MONITORING_IDENTITY_KEY_${version.toUpperCase()}`];
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new Error('Monitoring identity key unavailable');
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) throw new Error('Monitoring identity key invalid');
  const tenantKey = createHmac('sha256', key).update(`sicti-monitoring-identity\0${tenantId}`).digest();
  const digest = createHmac('sha256', tenantKey).update(identity).digest('hex');
  return { digest, label: `***@${domain}`, version };
}
