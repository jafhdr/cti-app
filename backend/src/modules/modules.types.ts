import { ModuleStatus, SubscriptionPlan } from '@prisma/client';

export interface CreateModuleDto {
  name: string;
  code: string;
  description?: string;
  version?: string;
  status?: ModuleStatus;
  isGlobalEnabled?: boolean;
  config?: Record<string, any>;
}

export interface UpdateModuleDto {
  name?: string;
  code?: string;
  description?: string;
  version?: string;
  status?: ModuleStatus;
  isGlobalEnabled?: boolean;
  config?: Record<string, any>;
}

export interface CreateModuleEntitlementDto {
  moduleId: string;
  plan: SubscriptionPlan;
  isEnabled?: boolean;
  quotaLimit?: number;
}

export interface UpdateModuleEntitlementDto {
  isEnabled?: boolean;
  quotaLimit?: number;
}

export interface AssignModuleToTenantDto {
  tenantId: string;
  moduleId: string;
  isEnabled?: boolean;
  featureFlags?: Record<string, any>;
  config?: Record<string, any>;
  overrideReason?: string;
}

export interface UpdateTenantModuleDto {
  isEnabled?: boolean;
  featureFlags?: Record<string, any>;
  config?: Record<string, any>;
  overrideReason?: string;
}

export interface CreateGlobalConfigDto {
  key: string;
  value: Record<string, any>;
  moduleId?: string;
}

export interface UpdateModuleHealthDto {
  status?: string;
  errorRate?: number;
  latency?: number;
  queueBacklog?: number;
  failureCount?: number;
  metadata?: Record<string, any>;
}
