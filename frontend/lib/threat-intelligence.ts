export const intelligenceSections = [
  { slug: 'threat-actors', label: 'Threat Actors', types: ['THREAT_ACTOR'] },
  { slug: 'campaigns', label: 'Campaigns', types: ['CAMPAIGN'] },
  { slug: 'malware-tools', label: 'Malware & Tools', types: ['MALWARE', 'TOOL'] },
  { slug: 'vulnerabilities', label: 'Vulnerabilities', types: ['VULNERABILITY'] },
  { slug: 'reports', label: 'Intelligence Reports', types: ['REPORT'] },
  { slug: 'sources', label: 'Sources', types: ['SOURCE'] },
] as const;

export type IntelligenceEntity = {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly description: string | null;
  readonly severity: string;
  readonly confidence: number;
  readonly updatedAt: string;
  readonly indicators: readonly { readonly id: string; readonly value: string }[];
};

export type IntelligenceRelationship = {
  readonly id: string;
  readonly relationshipType: string;
  readonly source: { readonly id: string; readonly name: string; readonly type: string };
  readonly target: { readonly id: string; readonly name: string; readonly type: string };
};

export type IntelligenceOverview = {
  readonly entities: readonly IntelligenceEntity[];
  readonly relationships: readonly IntelligenceRelationship[];
};
