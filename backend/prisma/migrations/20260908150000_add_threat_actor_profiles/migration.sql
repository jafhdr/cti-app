CREATE TYPE "ThreatActorStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TABLE "ThreatActor" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "motivation" TEXT,
  "targetSectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "country" TEXT,
  "region" TEXT,
  "status" "ThreatActorStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ThreatActor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ThreatActor_entityId_key" ON "ThreatActor"("entityId");
CREATE UNIQUE INDEX "ThreatActor_tenantId_entityId_key" ON "ThreatActor"("tenantId", "entityId");
CREATE INDEX "ThreatActor_tenantId_status_updatedAt_idx" ON "ThreatActor"("tenantId", "status", "updatedAt");
ALTER TABLE "ThreatActor" ADD CONSTRAINT "ThreatActor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreatActor" ADD CONSTRAINT "ThreatActor_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "IntelligenceEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
