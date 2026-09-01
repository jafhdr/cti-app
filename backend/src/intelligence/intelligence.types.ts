import { AlertStatus, CaseStatus, IndicatorSeverity, IntelligenceEntityType } from '@prisma/client';

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

export type CaseInput = {
  readonly tenantId?: string;
  readonly title?: string;
  readonly description?: string;
  readonly severity?: IndicatorSeverity;
  readonly entityIds?: readonly string[];
};

export type AlertInput = {
  readonly tenantId?: string;
  readonly title?: string;
  readonly description?: string;
  readonly severity?: IndicatorSeverity;
  readonly caseId?: string;
  readonly entityIds?: readonly string[];
};

export type CaseStatusInput = { readonly tenantId?: string; readonly status?: CaseStatus };
export type AlertStatusInput = { readonly tenantId?: string; readonly status?: AlertStatus };
