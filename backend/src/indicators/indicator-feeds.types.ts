import { IsOptional, IsString } from 'class-validator';

export const feedProviders = ['URLHAUS', 'MALWAREBAZAAR', 'ABUSEIPDB'] as const;
export type FeedProvider = typeof feedProviders[number];

export class SyncIndicatorFeedsDto {
  @IsOptional()
  @IsString()
  tenantId?: string;
}

export type NormalizedIndicator = {
  readonly value: string;
  readonly type: 'IP_ADDRESS' | 'URL' | 'FILE_HASH';
  readonly severity: 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly confidence: number;
  readonly tags: readonly string[];
  readonly description: string;
};

export type FeedSyncResult = {
  readonly provider: FeedProvider;
  readonly status: 'SYNCED' | 'SKIPPED' | 'FAILED';
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly received: number;
  readonly message?: string;
};

export type FeedRuntimeResult = FeedSyncResult & {
  readonly completedAt: Date;
};
