import { domainToASCII } from 'node:url';
import type { IndicatorSeverity, MonitoringObservationKind, MonitoringWatchKind } from '@prisma/client';

export function normalizeDomain(raw: string): string {
  const value = domainToASCII(raw.trim().replace(/\.$/, '')).toLowerCase();
  if (value.length < 4 || value.length > 253 || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value)
    || value.split('.').some(label => label.startsWith('-') || label.endsWith('-') || label.length > 63)) throw new Error('Invalid domain');
  return value;
}

export function normalizeWatch(kind: MonitoringWatchKind, raw: string): { readonly value: string; readonly label: string } {
  if (kind === 'DOMAIN') { const value = normalizeDomain(raw); return { value, label: value }; }
  if (kind === 'BRAND') {
    const value = raw.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9 -]{1,78}[a-z0-9]$/.test(value)) throw new Error('Invalid brand');
    return { value, label: value };
  }
  throw new Error('Identity watch requires tenant-keyed digest');
}

export function safeEvidenceRef(raw: string): string {
  if (!/^qa:\/\/[a-z0-9-]{1,60}\/[a-z0-9-]{1,100}$/.test(raw)) throw new Error('Unsafe evidence reference');
  return raw;
}

type Match = { readonly rule: string; readonly confidence: number; readonly severity: IndicatorSeverity };
function oneEdit(left: string, right: string): boolean {
  if (left.length < 4 || right.length < 4 || Math.abs(left.length - right.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; continue; }
    edits++;
    if (edits > 1) return false;
    if (left.length >= right.length) i++;
    if (right.length >= left.length) j++;
  }
  return edits + (left.length - i) + (right.length - j) === 1;
}
export function matchObservation(kind: MonitoringObservationKind, domain: string | null, identityHash: string | null, watch: { readonly kind: MonitoringWatchKind; readonly value: string }): Match | null {
  if (watch.kind === 'IDENTITY_HASH') {
    return kind === 'CREDENTIAL_EXPOSURE' && identityHash === watch.value ? { rule: 'IDENTITY_HASH_EXACT', confidence: 100, severity: 'HIGH' } : null;
  }
  if (!domain) return null;
  if (watch.kind === 'DOMAIN') {
    if (domain === watch.value || domain.endsWith(`.${watch.value}`)) return { rule: 'CORPORATE_DOMAIN', confidence: 95, severity: kind === 'CORPORATE_DATA_EXPOSURE' ? 'HIGH' : 'MEDIUM' };
    const stem = watch.value.split('.')[0];
    if ((kind === 'BRAND_IMPERSONATION' || kind === 'PHISHING_DOMAIN') && domain.split(/[.-]/).includes(stem)) return { rule: 'LOOKALIKE_TOKEN', confidence: 80, severity: 'HIGH' };
    if ((kind === 'BRAND_IMPERSONATION' || kind === 'PHISHING_DOMAIN') && oneEdit(domain.split(/[.-]/)[0], stem)) return { rule: 'LOOKALIKE_EDIT_1', confidence: 70, severity: 'MEDIUM' };
    return null;
  }
  const brand = watch.value.replace(/\s+/g, '-');
  if ((kind === 'BRAND_IMPERSONATION' || kind === 'PHISHING_DOMAIN') && (domain.split(/[.-]/).includes(brand) || domain.startsWith(`${brand}-`))) return { rule: 'BRAND_TOKEN', confidence: 80, severity: 'HIGH' };
  return null;
}
