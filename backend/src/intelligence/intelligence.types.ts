import { IndicatorSeverity, IntelligenceEntityType } from '@prisma/client';

export type EntityInput = {
  readonly tenantId?: string;
  readonly type?: IntelligenceEntityType;
  readonly name?: string;
  readonly description?: string;
  readonly externalId?: string;
  readonly confidence?: number;
  readonly severity?: IndicatorSeverity;
};

export type RelationshipInput = {
  readonly tenantId?: string;
  readonly sourceId?: string;
  readonly targetId?: string;
  readonly relationshipType?: string;
  readonly description?: string;
};
