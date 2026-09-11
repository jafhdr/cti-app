export const reportTypes = ['STRATEGIC', 'TACTICAL', 'OPERATIONAL', 'TECHNICAL'] as const;
export const reportStatuses = ['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;
export const tlpLevels = ['CLEAR', 'GREEN', 'AMBER', 'AMBER_STRICT', 'RED'] as const;
export type RelationKind = 'threat-actors' | 'campaigns' | 'indicators' | 'malware-tools' | 'vulnerabilities' | 'sources';
export type Option = { readonly id: string; readonly label: string };
export type Report = {
 readonly id: string; readonly title: string; readonly summary: string; readonly content: string; readonly reportType: string; readonly tlp: string; readonly status: string; readonly publishedAt: string | null;
 readonly threatActors: readonly { readonly threatActor: { readonly id: string; readonly entity: { readonly name: string } } }[]; readonly campaigns: readonly { readonly campaign: { readonly id: string; readonly name: string } }[]; readonly indicators: readonly { readonly indicator: { readonly id: string; readonly value: string } }[]; readonly malwareTools: readonly { readonly malwareTool: { readonly id: string; readonly name: string } }[]; readonly vulnerabilities: readonly { readonly vulnerability: { readonly id: string; readonly cveId: string } }[]; readonly sources: readonly { readonly source: { readonly id: string; readonly name: string } }[]; readonly _count: Readonly<Record<string, number>>;
};
export type ReportForm = { readonly title: string; readonly summary: string; readonly content: string; readonly reportType: string; readonly tlp: string; readonly status: string; readonly publishedAt: string };
export const emptyForm: ReportForm = { title: '', summary: '', content: '', reportType: 'TACTICAL', tlp: 'AMBER', status: 'DRAFT', publishedAt: '' };
