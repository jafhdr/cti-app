CREATE TYPE "SubscriptionPackageType" AS ENUM ('PREDEFINED', 'CUSTOM');
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED');

CREATE TABLE "SubscriptionPackage" (
    "id" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
    "type" "SubscriptionPackageType" NOT NULL DEFAULT 'PREDEFINED',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "priceMonthly" INTEGER NOT NULL, "priceYearly" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionPackage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PackageModule" (
    "packageId" TEXT NOT NULL, "moduleId" TEXT NOT NULL,
    "modulePriceMonthly" INTEGER, "modulePriceYearly" INTEGER,
    CONSTRAINT "PackageModule_pkey" PRIMARY KEY ("packageId", "moduleId")
);
CREATE TABLE "ModuleFeature" (
    "id" TEXT NOT NULL, "moduleId" TEXT NOT NULL, "key" TEXT NOT NULL,
    "name" TEXT NOT NULL, "description" TEXT,
    CONSTRAINT "ModuleFeature_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TenantSubscription" (
    "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "packageId" TEXT,
    "isCustom" BOOLEAN NOT NULL DEFAULT false, "billingCycle" "BillingCycle" NOT NULL,
    "priceMonthly" INTEGER NOT NULL, "priceYearly" INTEGER,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewalAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TenantCustomModule" (
    "subscriptionId" TEXT NOT NULL, "moduleId" TEXT NOT NULL,
    CONSTRAINT "TenantCustomModule_pkey" PRIMARY KEY ("subscriptionId", "moduleId")
);
CREATE TABLE "UserModuleAccess" (
    "userId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "moduleId" TEXT NOT NULL,
    "featureKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "UserModuleAccess_pkey" PRIMARY KEY ("userId", "tenantId", "moduleId")
);

CREATE UNIQUE INDEX "SubscriptionPackage_name_key" ON "SubscriptionPackage"("name");
CREATE UNIQUE INDEX "ModuleFeature_moduleId_key_key" ON "ModuleFeature"("moduleId", "key");
CREATE UNIQUE INDEX "TenantSubscription_tenantId_key" ON "TenantSubscription"("tenantId");
CREATE INDEX "TenantSubscription_status_renewalAt_idx" ON "TenantSubscription"("status", "renewalAt");
CREATE INDEX "UserModuleAccess_tenantId_moduleId_idx" ON "UserModuleAccess"("tenantId", "moduleId");

ALTER TABLE "PackageModule" ADD CONSTRAINT "PackageModule_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SubscriptionPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PackageModule" ADD CONSTRAINT "PackageModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "AppModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModuleFeature" ADD CONSTRAINT "ModuleFeature_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "AppModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SubscriptionPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TenantCustomModule" ADD CONSTRAINT "TenantCustomModule_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "TenantSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantCustomModule" ADD CONSTRAINT "TenantCustomModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "AppModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserModuleAccess" ADD CONSTRAINT "UserModuleAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserModuleAccess" ADD CONSTRAINT "UserModuleAccess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserModuleAccess" ADD CONSTRAINT "UserModuleAccess_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "AppModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
