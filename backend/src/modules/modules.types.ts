import { ModuleCategory } from '@prisma/client';

export type ModuleRoleAccessInput = {
  readonly ADMIN?: boolean;
  readonly USER?: boolean;
};

export type CreateModuleInput = {
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string;
  readonly category?: ModuleCategory;
  readonly isActive?: boolean;
};

export type UpdateModuleInput = CreateModuleInput;

export type UpdateTenantModuleInput = {
  readonly tenantId?: string;
  readonly isEnabled?: boolean;
  readonly access?: ModuleRoleAccessInput;
};
