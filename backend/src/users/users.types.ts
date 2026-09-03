export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER';

export type AuthUser = {
  readonly sub: string;
  readonly tenantId: string | null;
  readonly role: UserRole;
};

export type ModuleAccessInput = {
  readonly moduleId: string;
  readonly featureKeys?: readonly string[];
};

export type BulkModuleAccessInput = {
  readonly assignments: readonly {
    readonly userId: string;
    readonly access: readonly ModuleAccessInput[];
  }[];
};
