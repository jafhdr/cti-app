import { BillingCycle, SubscriptionStatus } from '@prisma/client';

export type CreateSubscriptionInput = {
  readonly tenantId?: string;
  readonly packageId?: string;
  readonly isCustom?: boolean;
  readonly billingCycle?: BillingCycle;
  readonly moduleIds?: readonly string[];
};

export type UpdateSubscriptionStatusInput = {
  readonly tenantId?: string;
  readonly status?: SubscriptionStatus;
};
