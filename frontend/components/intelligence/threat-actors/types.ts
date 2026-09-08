export const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RelatedEntity = { readonly id: string; readonly name: string; readonly type: string; readonly severity: string };
export type Relationship = { readonly id: string; readonly relationshipType: string; readonly target?: RelatedEntity; readonly source?: RelatedEntity };
export type ThreatActor = {
  readonly id: string; readonly aliases: readonly string[]; readonly motivation: string | null;
  readonly targetSectors: readonly string[]; readonly country: string | null; readonly region: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE'; readonly createdAt: string; readonly updatedAt: string;
  readonly entity: { readonly id: string; readonly name: string; readonly description: string | null; readonly externalId: string | null; readonly confidence: number; readonly severity: typeof severities[number]; readonly metadata: { readonly referenceUrl?: string } | null; readonly indicators?: readonly RelatedEntity[]; readonly outgoingRelationships?: readonly Relationship[]; readonly incomingRelationships?: readonly Relationship[]; readonly _count?: { readonly outgoingRelationships: number; readonly incomingRelationships: number; readonly indicators: number } };
};
export type ThreatActorForm = { readonly name: string; readonly aliases: string; readonly description: string; readonly motivation: string; readonly targetSectors: string; readonly country: string; readonly region: string; readonly confidence: string; readonly severity: string; readonly status: string; readonly externalId: string; readonly referenceUrl: string };
export const emptyThreatActorForm: ThreatActorForm = { name: '', aliases: '', description: '', motivation: '', targetSectors: '', country: '', region: '', confidence: '50', severity: 'MEDIUM', status: 'ACTIVE', externalId: '', referenceUrl: '' };
