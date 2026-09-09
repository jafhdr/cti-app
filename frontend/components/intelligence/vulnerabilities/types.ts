export const vulnerabilitySeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type VulnerabilitySeverity = typeof vulnerabilitySeverities[number];
export type RelationActor = { readonly id: string; readonly entity: { readonly name: string } };
export type RelationCampaign = { readonly id: string; readonly name: string; readonly status: string };
export type RelationMalwareTool = { readonly id: string; readonly name: string; readonly type: string };
export type Vulnerability = { readonly id: string; readonly cveId: string; readonly name: string; readonly description: string | null; readonly severity: VulnerabilitySeverity; readonly cvssScore: number | null; readonly url: string | null; readonly createdAt: string; readonly updatedAt: string; readonly threatActors: readonly { readonly threatActor: RelationActor }[]; readonly campaigns: readonly { readonly campaign: RelationCampaign }[]; readonly malwareTools: readonly { readonly malwareTool: RelationMalwareTool }[]; readonly _count: { readonly threatActors: number; readonly campaigns: number; readonly malwareTools: number } };
export type VulnerabilityForm = { readonly cveId: string; readonly name: string; readonly description: string; readonly severity: VulnerabilitySeverity; readonly cvssScore: string; readonly url: string };
export const emptyVulnerabilityForm: VulnerabilityForm = { cveId: '', name: '', description: '', severity: 'MEDIUM', cvssScore: '', url: '' };
