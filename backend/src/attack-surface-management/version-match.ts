import type { AssetPortService, Vulnerability } from '@prisma/client';

export type Match = { readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW'; readonly reason: string };

function parts(value: string): number[] | null {
  if (!/^\d+(?:\.\d+)*$/.test(value)) return null;
  return value.split('.').map(Number);
}

function compare(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function compareVersions(left: string, right: string, product: string): number | null {
  const numericLeft = parts(left);
  const numericRight = parts(right);
  if (numericLeft && numericRight) return compare(numericLeft, numericRight);
  if (product.trim().toLowerCase() !== 'openssh') return null;
  const pattern = /^(\d+)\.(\d+)(?:p(\d+))?$/;
  const leftMatch = pattern.exec(left);
  const rightMatch = pattern.exec(right);
  if (!leftMatch || !rightMatch) return null;
  const base = compare([Number(leftMatch[1]), Number(leftMatch[2])], [Number(rightMatch[1]), Number(rightMatch[2])]);
  if (base !== 0) return base;
  const leftPatch = leftMatch[3];
  const rightPatch = rightMatch[3];
  if (leftPatch === undefined || rightPatch === undefined) return null;
  return Math.sign(Number(leftPatch) - Number(rightPatch));
}

export function matchVersion(service: Pick<AssetPortService, 'status' | 'product' | 'version'>, vulnerability: Pick<Vulnerability, 'affectedProduct' | 'affectedVersionExact' | 'affectedVersionStart' | 'affectedVersionEnd'>): Match | null {
  if (service.status !== 'OPEN' || !service.product || !vulnerability.affectedProduct) return null;
  if (service.product.trim().toLowerCase() !== vulnerability.affectedProduct.trim().toLowerCase()) return null;
  if (!service.version) return { confidence: 'LOW', reason: 'Product matches; service version is unknown' };
  if (vulnerability.affectedVersionExact) {
    if (service.version === vulnerability.affectedVersionExact) return { confidence: 'HIGH', reason: 'Exact product and version match' };
    const exactComparison = compareVersions(service.version, vulnerability.affectedVersionExact, service.product);
    if (exactComparison === null) return { confidence: 'MEDIUM', reason: 'Product matches; exact version cannot be safely compared' };
    return exactComparison === 0 ? { confidence: 'HIGH', reason: 'Exact product and version match' } : null;
  }
  if (!vulnerability.affectedVersionStart && !vulnerability.affectedVersionEnd) {
    return { confidence: 'MEDIUM', reason: 'Product and detected version available; affected range unspecified' };
  }
  const start = vulnerability.affectedVersionStart ? compareVersions(service.version, vulnerability.affectedVersionStart, service.product) : 0;
  const end = vulnerability.affectedVersionEnd ? compareVersions(service.version, vulnerability.affectedVersionEnd, service.product) : 0;
  if ((start !== null && start < 0) || (end !== null && end > 0)) return null;
  if (start === null || end === null) {
    return { confidence: 'MEDIUM', reason: 'Product matches; version range cannot be safely compared' };
  }
  return { confidence: 'HIGH', reason: 'Product and numeric version within inclusive affected range' };
}
