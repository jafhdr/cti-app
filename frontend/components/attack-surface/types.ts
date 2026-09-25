export const assetTypes = ['DOMAIN', 'SUBDOMAIN', 'IP_ADDRESS', 'HOST', 'URL', 'API', 'CERTIFICATE', 'CLOUD_ASSET'] as const;
export const assetStatuses = ['ACTIVE', 'INACTIVE', 'UNKNOWN'] as const;
export const assetCriticalities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type AssetType = typeof assetTypes[number];
export type AssetStatus = typeof assetStatuses[number];
export type AssetCriticality = typeof assetCriticalities[number];

export type Asset = {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly type: AssetType;
  readonly value: string;
  readonly status: AssetStatus;
  readonly criticality: AssetCriticality;
  readonly description: string | null;
  readonly owner: string | null;
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AssetFormValue = {
  readonly name: string;
  readonly type: AssetType;
  readonly value: string;
  readonly status: AssetStatus;
  readonly criticality: AssetCriticality;
  readonly description: string;
  readonly owner: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
};

export type DiscoverySummary = {
  readonly rootDomain: string;
  readonly discovered: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly providers: readonly string[];
  readonly errors: readonly string[];
};

export type PortService = {
  readonly id: string;
  readonly port: number;
  readonly protocol: string;
  readonly service: string | null;
  readonly status: 'OPEN' | 'CLOSED' | 'FILTERED' | 'UNKNOWN';
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
};

export type PortDiscoverySummary = {
  readonly target: string;
  readonly scanned: number;
  readonly open: number;
  readonly closed: number;
  readonly timeout: number;
  readonly failed: number;
  readonly results: readonly { readonly port: number; readonly protocol: string; readonly service: string | null; readonly status: 'open' | 'closed' | 'timeout' | 'failed'; readonly error?: string }[];
};

export const emptyAssetForm: AssetFormValue = {
  name: '', type: 'DOMAIN', value: '', status: 'UNKNOWN', criticality: 'MEDIUM',
  description: '', owner: '', firstSeenAt: '', lastSeenAt: '',
};
