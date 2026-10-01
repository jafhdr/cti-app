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

export function matchVersion(service: Pick<AssetPortService, 'status' | 'product' | 'version'>, vulnerability: Pick<Vulnerability, 'affectedProduct' | 'affectedVersionExact' | 'affectedVersionStart' | 'affectedVersionEnd'>): Match | null {
  if (service.status !== 'OPEN' || !service.product || !vulnerability.affectedProduct) return null;
  if (service.product.trim().toLowerCase() !== vulnerability.affectedProduct.trim().toLowerCase()) return null;
  if (!service.version) return { confidence: 'LOW', reason: 'Product matches; service version is unknown' };
  if (vulnerability.affectedVersionExact) {
    return service.version === vulnerability.affectedVersionExact
      ? { confidence: 'HIGH', reason: 'Exact product and version match' } : null;
  }
  if (!vulnerability.affectedVersionStart && !vulnerability.affectedVersionEnd) {
    return { confidence: 'MEDIUM', reason: 'Product and detected version available; affected range unspecified' };
  }
  const version = parts(service.version);
  const start = vulnerability.affectedVersionStart ? parts(vulnerability.affectedVersionStart) : null;
  const end = vulnerability.affectedVersionEnd ? parts(vulnerability.affectedVersionEnd) : null;
  if (!version || (vulnerability.affectedVersionStart && !start) || (vulnerability.affectedVersionEnd && !end)) {
    return { confidence: 'MEDIUM', reason: 'Product matches; version range cannot be safely compared' };
  }
  if ((start && compare(version, start) < 0) || (end && compare(version, end) > 0)) return null;
  return { confidence: 'HIGH', reason: 'Product and numeric version within inclusive affected range' };
}
