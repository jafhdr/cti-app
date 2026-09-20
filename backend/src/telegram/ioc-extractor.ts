import { isIP } from 'node:net';

export const IOC_TYPES = ['IPV4', 'IPV6', 'DOMAIN', 'URL', 'MD5', 'SHA1', 'SHA256'] as const;
export type IocType = typeof IOC_TYPES[number];
export type ExtractionMethod = 'TEXT' | 'CAPTION' | 'ENTITY';
export type TelegramEntity = { readonly type: string; readonly offset: number; readonly length: number; readonly url?: string };
export type ExtractedIoc = {
  readonly rawValue: string;
  readonly normalizedValue: string;
  readonly type: IocType;
  readonly extractionMethod: ExtractionMethod;
  readonly confidence: number;
  readonly spanStart: number;
  readonly spanEnd: number;
};

const urlPattern = /\b(?:https?|hxxps?):\/\/[^\s<>"']+/giu;
const ipv4Pattern = /(?<![\da-f:])(?:\d{1,3}\.){3}\d{1,3}(?![\da-f:])/giu;
const ipv6Pattern = /(?<![\da-f:])[\da-f]*(?::[\da-f]*){2,7}(?![\da-f:])/giu;
const domainPattern = /(?<![@\w])(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\[\.\]|\(\.\)|\.))+[a-z]{2,63}\.?(?![\w-])/giu;
const hashPattern = /\b[a-f\d]{32}\b|\b[a-f\d]{40}\b|\b[a-f\d]{64}\b/giu;

export function extractIocs(input: { readonly text?: string | null; readonly caption?: string | null; readonly entities?: readonly TelegramEntity[] | null }): readonly ExtractedIoc[] {
  const results: ExtractedIoc[] = [];
  if (input.text) results.push(...extractFromString(input.text, 'TEXT'));
  if (input.caption) results.push(...extractFromString(input.caption, 'CAPTION'));
  const entitySource = input.text ?? input.caption ?? '';
  for (const entity of input.entities ?? []) {
    const rawValue = entity.url ?? entitySource.slice(entity.offset, entity.offset + entity.length);
    const normalized = normalizeValue(rawValue);
    if (normalized) results.push({ ...normalized, rawValue, extractionMethod: 'ENTITY', spanStart: entity.offset, spanEnd: entity.offset + entity.length });
  }
  const seen = new Set<string>();
  return results.filter(item => {
    const key = `${item.type}:${item.normalizedValue}:${item.extractionMethod}:${item.spanStart ?? ''}:${item.spanEnd ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractFromString(value: string, extractionMethod: Exclude<ExtractionMethod, 'ENTITY'>): readonly ExtractedIoc[] {
  const matches: ExtractedIoc[] = [];
  for (const pattern of [urlPattern, hashPattern, ipv4Pattern, ipv6Pattern, domainPattern]) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      const rawValue = trimPunctuation(match[0]);
      const normalized = normalizeValue(rawValue);
      if (!normalized || match.index === undefined) continue;
      if (normalized.type === 'DOMAIN' && overlapsUrl(matches, match.index, match.index + rawValue.length)) continue;
      matches.push({ ...normalized, rawValue, extractionMethod, spanStart: match.index, spanEnd: match.index + rawValue.length });
    }
  }
  return matches;
}

function normalizeValue(rawValue: string): Pick<ExtractedIoc, 'normalizedValue' | 'type' | 'confidence'> | null {
  const defanged = trimPunctuation(rawValue).replace(/^hxxps:/i, 'https:').replace(/^hxxp:/i, 'http:').replace(/\[\.\]|\(\.\)/g, '.');
  if (/^https?:\/\//i.test(defanged)) {
    try {
      const url = new URL(defanged);
      if (!validDomainOrIp(url.hostname)) return null;
      url.hostname = url.hostname.toLowerCase().replace(/\.$/, '');
      if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) url.port = '';
      url.hash = '';
      return { normalizedValue: url.toString(), type: 'URL', confidence: 85 };
    } catch { return null; }
  }
  if (/^[a-f\d]+$/i.test(defanged)) {
    const type = defanged.length === 32 ? 'MD5' : defanged.length === 40 ? 'SHA1' : defanged.length === 64 ? 'SHA256' : null;
    return type ? { normalizedValue: defanged.toLowerCase(), type, confidence: 95 } : null;
  }
  const ipVersion = isIP(defanged);
  if (ipVersion === 4) return { normalizedValue: defanged, type: 'IPV4', confidence: isPublicIp(defanged) ? 90 : 30 };
  if (ipVersion === 6) return { normalizedValue: defanged.toLowerCase(), type: 'IPV6', confidence: isPublicIp(defanged) ? 90 : 30 };
  const domain = defanged.toLowerCase().replace(/\.$/, '');
  return validDomain(domain) ? { normalizedValue: domain, type: 'DOMAIN', confidence: 80 } : null;
}

function validDomainOrIp(value: string): boolean { return isIP(value) !== 0 || validDomain(value.toLowerCase().replace(/\.$/, '')); }
function validDomain(value: string): boolean {
  if (value.length > 253 || !value.includes('.')) return false;
  const labels = value.split('.');
  const topLevel = labels[labels.length - 1];
  return Boolean(topLevel && /[a-z]/i.test(topLevel)) && labels.every(label => label.length > 0 && label.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label));
}
function trimPunctuation(value: string): string { return value.replace(/^[([{<]+/, '').replace(/[\])}>.,;!?]+$/, ''); }
function overlapsUrl(items: readonly ExtractedIoc[], start: number, end: number): boolean {
  return items.some(item => item.type === 'URL' && start >= item.spanStart && end <= item.spanEnd);
}
function isPublicIp(value: string): boolean {
  if (isIP(value) === 4) {
    const [a = 0, b = 0] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 192 && b === 88) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224);
  }
  const normalized = value.toLowerCase();
  return !(normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('2001:db8:'));
}
