import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import type { MetricsPeriodQuery, MetricsRange } from './effectiveness-metrics.period';

export class EffectivenessMetricsQueryDto implements MetricsPeriodQuery {
  @IsOptional() @IsIn(['30d', '90d', 'custom']) range?: MetricsRange;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsString() tenantId?: string;
}
