export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
export type Application = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly owner: string | null;
  readonly repositoryUrl: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly linkedAssetCount?: number | null;
};
export type Asset = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly type: string;
  readonly status: string;
  readonly criticality: string;
};
export type ListResponse<Item> = { readonly items: readonly Item[]; readonly total: number; readonly page: number; readonly limit: number };
export type ApplicationFormValue = { readonly name: string; readonly description: string; readonly criticality: Application['criticality']; readonly status: Application['status']; readonly owner: string; readonly repositoryUrl: string };
export const emptyApplicationForm: ApplicationFormValue = { name: '', description: '', criticality: 'MEDIUM', status: 'ACTIVE', owner: '', repositoryUrl: '' };
export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
export function appsecUrl(path: string, role: Role, tenantId: string, params?: URLSearchParams): string {
  const query = new URLSearchParams(params);
  if (role === 'SUPER_ADMIN') query.set('tenantId', tenantId);
  const suffix = query.toString();
  return `${API}${path}${suffix ? `?${suffix}` : ''}`;
}
export function errorMessage(body: { readonly message?: string | readonly string[] }, fallback: string, status?: number): string {
  if (status === 401) return 'Sesi berakhir. Silakan masuk kembali.';
  if (status === 403) return 'Akses ke fitur ini ditolak.';
  if (status === 404) return 'Data tidak ditemukan dalam tenant ini.';
  if (status !== undefined && status >= 500) return 'Layanan sedang bermasalah. Coba lagi.';
  const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

export type FindingStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ACCEPTED_RISK' | 'FALSE_POSITIVE';
export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Finding = {
  readonly id: string; readonly applicationId: string; readonly application?: { readonly id: string; readonly name: string };
  readonly title: string; readonly description: string | null; readonly severity: FindingSeverity;
  readonly status: FindingStatus; readonly source: string; readonly category: string | null;
  readonly cweId: string | null; readonly location: string | null; readonly remediationNote: string | null;
  readonly dueDate: string | null; readonly resolution: string | null; readonly resolvedAt: string | null;
  readonly firstSeenAt: string; readonly lastSeenAt: string; readonly createdAt: string; readonly updatedAt: string;
};
export type Posture = {
  readonly applications: { readonly total: number; readonly active: number };
  readonly findings: { readonly total: number; readonly active: number; readonly resolved: number };
  readonly severity: { readonly critical: number; readonly high: number; readonly medium: number; readonly low: number };
  readonly status: { readonly open: number; readonly inProgress: number; readonly resolved: number; readonly acceptedRisk: number; readonly falsePositive: number };
  readonly applicationsWithActiveFindings: number;
  readonly topApplications: readonly { readonly applicationId: string; readonly name: string; readonly criticality: Application['criticality']; readonly activeFindings: number; readonly criticalFindings: number; readonly highFindings: number }[];
};
export const findingSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const findingStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE'] as const;
export function isTerminalFinding(status: FindingStatus): boolean { return status === 'RESOLVED' || status === 'ACCEPTED_RISK' || status === 'FALSE_POSITIVE'; }
export function findingTransitions(status: FindingStatus): readonly FindingStatus[] {
  switch (status) {
    case 'OPEN': return ['IN_PROGRESS', 'RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE'];
    case 'IN_PROGRESS': return ['OPEN', 'RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE'];
    case 'RESOLVED': case 'ACCEPTED_RISK': case 'FALSE_POSITIVE': return ['OPEN'];
  }
}
