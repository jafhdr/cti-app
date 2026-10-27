CREATE TYPE "StakeholderScope" AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE "StakeholderCategory" AS ENUM ('STRATEGIC', 'OPERATIONAL', 'TACTICAL');
CREATE TYPE "StakeholderType" AS ENUM ('INDIVIDUAL', 'TEAM', 'ORGANIZATION');
CREATE TABLE "Stakeholder" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scope" "StakeholderScope" NOT NULL,
  "category" "StakeholderCategory" NOT NULL,
  "type" "StakeholderType" NOT NULL,
  "responsibleUserId" TEXT,
  "description" TEXT,
  "intelligenceInterests" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "reportingFormat" TEXT,
  "reportingFrequency" TEXT,
  "distributionChannel" TEXT,
  "classificationPreference" "TlpLevel",
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Stakeholder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Stakeholder_tenantId_category_isActive_idx" ON "Stakeholder"("tenantId", "category", "isActive");
CREATE INDEX "Stakeholder_tenantId_name_idx" ON "Stakeholder"("tenantId", "name");
CREATE INDEX "Stakeholder_responsibleUserId_tenantId_idx" ON "Stakeholder"("responsibleUserId", "tenantId");
ALTER TABLE "Stakeholder" ADD CONSTRAINT "Stakeholder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stakeholder" ADD CONSTRAINT "Stakeholder_responsibleUserId_tenantId_fkey" FOREIGN KEY ("responsibleUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stakeholder" ADD CONSTRAINT "Stakeholder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stakeholder" ADD CONSTRAINT "Stakeholder_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
