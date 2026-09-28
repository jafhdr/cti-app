export type AccessFeature = { readonly id: string; readonly key: string; readonly name: string };
export type PolicyResult = { readonly accessible: boolean; readonly reason: string | null };
export type ModulePolicy = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly category: string;
  readonly features: readonly AccessFeature[];
  readonly isActive: boolean;
  readonly subscriptionIncluded: boolean;
  readonly subscriptionActive: boolean;
  readonly subscriptionSource: string | null;
  readonly tenantEnabled: boolean;
  readonly roleAccess: { readonly ADMIN: boolean; readonly USER: boolean };
  readonly policyAccess: { readonly ADMIN: PolicyResult; readonly USER: PolicyResult };
};
export type UserModuleAccess = Omit<ModulePolicy, 'roleAccess' | 'policyAccess'> & PolicyResult & {
  readonly roleAllowed: boolean;
  readonly assigned: boolean;
  readonly assignable: boolean;
  readonly featureKeys: readonly string[];
};
