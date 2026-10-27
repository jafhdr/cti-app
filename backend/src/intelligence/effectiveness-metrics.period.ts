import { BadRequestException } from '@nestjs/common';

export type MetricsRange = '30d' | '90d' | 'custom';
export type MetricsPeriodQuery = { readonly range?: MetricsRange; readonly from?: string; readonly to?: string; readonly tenantId?: string };
export type MetricsPeriod = { readonly from: Date; readonly to: Date; readonly range: MetricsRange };

const dayMs = 86_400_000;

function utcDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Use YYYY-MM-DD dates');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid calendar date');
  return date;
}

export function resolveMetricsPeriod(query: MetricsPeriodQuery, now: Date): MetricsPeriod {
  const range = query.range ?? '30d';
  if (range !== 'custom') {
    if (query.from || query.to) throw new BadRequestException('Custom dates require range=custom');
    return { range, from: new Date(now.valueOf() - (range === '30d' ? 30 : 90) * dayMs), to: now };
  }
  if (!query.from || !query.to) throw new BadRequestException('Custom range requires from and to');
  const from = utcDay(query.from);
  const to = new Date(utcDay(query.to).valueOf() + dayMs);
  if (to <= from || to.valueOf() - from.valueOf() > 366 * dayMs) throw new BadRequestException('Custom range must span 1 to 366 days');
  return { range, from, to };
}
