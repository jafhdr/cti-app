CREATE TYPE "IntelligenceSourceType" AS ENUM ('OPEN_SOURCE', 'COMMERCIAL', 'GOVERNMENT', 'COMMUNITY', 'INTERNAL');
CREATE TYPE "IntelligenceSourceReliability" AS ENUM ('A', 'B', 'C', 'D', 'E', 'F');
CREATE TYPE "TlpLevel" AS ENUM ('CLEAR', 'GREEN', 'AMBER', 'AMBER_STRICT', 'RED');
CREATE TYPE "IntelligenceSourceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "IntelligenceSource" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "sourceType" "IntelligenceSourceType" NOT NULL,
  "provider" TEXT,
  "url" TEXT,
  "reliability" "IntelligenceSourceReliability" NOT NULL DEFAULT 'C',
  "confidence" INTEGER NOT NULL DEFAULT 50,
  "tlp" "TlpLevel" NOT NULL DEFAULT 'AMBER',
  "status" "IntelligenceSourceStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastSyncAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntelligenceSource_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Indicator" ADD COLUMN "intelligenceSourceId" TEXT;
CREATE UNIQUE INDEX "IntelligenceSource_tenantId_name_key" ON "IntelligenceSource"("tenantId", "name");
CREATE INDEX "IntelligenceSource_tenantId_sourceType_status_tlp_idx" ON "IntelligenceSource"("tenantId", "sourceType", "status", "tlp");
CREATE INDEX "IntelligenceSource_tenantId_updatedAt_idx" ON "IntelligenceSource"("tenantId", "updatedAt");
CREATE INDEX "Indicator_tenantId_intelligenceSourceId_idx" ON "Indicator"("tenantId", "intelligenceSourceId");
ALTER TABLE "IntelligenceSource" ADD CONSTRAINT "IntelligenceSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Indicator" ADD CONSTRAINT "Indicator_intelligenceSourceId_fkey" FOREIGN KEY ("intelligenceSourceId") REFERENCES "IntelligenceSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
