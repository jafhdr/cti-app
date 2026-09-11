export const feedProviderIds = ['URLHAUS', 'MALWAREBAZAAR', 'ABUSEIPDB'] as const;
export type FeedProviderId = typeof feedProviderIds[number];
export type FeedStatus = 'ACTIVE' | 'FAILED' | 'NOT_CONFIGURED';
export type FeedProviderStatus = {
  readonly provider: FeedProviderId;
  readonly name: string;
  readonly status: FeedStatus;
  readonly lastSyncAt: string | null;
  readonly received: number;
  readonly created: number | null;
  readonly updated: number | null;
  readonly error: string | null;
};
export type FeedStatusResponse = {
  readonly tenantId: string;
  readonly scheduler: { readonly enabled: boolean; readonly intervalMinutes: number; readonly nextSyncAt: string | null };
  readonly providers: readonly FeedProviderStatus[];
  readonly message?: string;
};
export type FeedSyncResult = { readonly provider: FeedProviderId; readonly status: 'SYNCED' | 'SKIPPED' | 'FAILED'; readonly created: number; readonly updated: number; readonly skipped: number; readonly received: number; readonly message?: string };
export type FeedSyncResponse = { readonly results: readonly FeedSyncResult[]; readonly totals: { readonly created: number; readonly updated: number; readonly skipped: number; readonly received: number }; readonly message?: string };
