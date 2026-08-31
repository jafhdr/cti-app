CREATE TYPE "ModuleCategory" AS ENUM ('CTI', 'APPSEC', 'PLATFORM');

CREATE TABLE "AppModule" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" "ModuleCategory" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppModule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TenantModule" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantModule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModuleRoleAccess" (
  "id" TEXT NOT NULL,
  "tenantModuleId" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "isAllowed" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ModuleRoleAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppModule_slug_key" ON "AppModule"("slug");
CREATE UNIQUE INDEX "TenantModule_tenantId_moduleId_key" ON "TenantModule"("tenantId", "moduleId");
CREATE INDEX "TenantModule_tenantId_isEnabled_idx" ON "TenantModule"("tenantId", "isEnabled");
CREATE UNIQUE INDEX "ModuleRoleAccess_tenantModuleId_role_key" ON "ModuleRoleAccess"("tenantModuleId", "role");

ALTER TABLE "TenantModule" ADD CONSTRAINT "TenantModule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantModule" ADD CONSTRAINT "TenantModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "AppModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModuleRoleAccess" ADD CONSTRAINT "ModuleRoleAccess_tenantModuleId_fkey" FOREIGN KEY ("tenantModuleId") REFERENCES "TenantModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
