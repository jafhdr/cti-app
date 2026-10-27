export type IndicatorType = 'IP_ADDRESS' | 'DOMAIN' | 'URL' | 'FILE_HASH' | 'EMAIL';
export type IndicatorSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IndicatorStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED';

export type IndicatorInput = {
  value: string;
  type: IndicatorType;
  severity: IndicatorSeverity;
  confidence: number;
  status?: IndicatorStatus;
  tags?: string[];
  source?: string;
  description?: string;
  expiresAt?: string | null;
  tenantId?: string;
  intelligenceEntityId?: string | null;
  intelligenceSourceId?: string | null;
  lifecycleReason?: string;
};

export type ThreatActorAttributionInput = {
  readonly threatActorId: string;
};

export type LinkCaseInput = {
  readonly caseId: string;
};

export type IndicatorDecisionInput = {
  readonly kind: 'FALSE_POSITIVE' | 'SAFELIST' | 'CLEAR';
  readonly reason: string;
};
