CREATE TYPE "CampaignStatus" AS ENUM ('PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "Campaign" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "objective" TEXT,
  "status" "CampaignStatus" NOT NULL DEFAULT 'PLANNED',
  "severity" "IndicatorSeverity" NOT NULL DEFAULT 'MEDIUM',
  "confidence" INTEGER NOT NULL DEFAULT 50,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "externalId" TEXT,
  "referenceUrl" TEXT,
  "threatActorId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignIndicator" (
  "campaignId" TEXT NOT NULL,
  "indicatorId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignIndicator_pkey" PRIMARY KEY ("campaignId", "indicatorId")
);

CREATE UNIQUE INDEX "Campaign_tenantId_name_key" ON "Campaign"("tenantId", "name");
CREATE INDEX "Campaign_tenantId_status_severity_updatedAt_idx" ON "Campaign"("tenantId", "status", "severity", "updatedAt");
CREATE INDEX "Campaign_tenantId_threatActorId_idx" ON "Campaign"("tenantId", "threatActorId");
CREATE INDEX "CampaignIndicator_tenantId_indicatorId_idx" ON "CampaignIndicator"("tenantId", "indicatorId");
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_threatActorId_fkey" FOREIGN KEY ("threatActorId") REFERENCES "ThreatActor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignIndicator" ADD CONSTRAINT "CampaignIndicator_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignIndicator" ADD CONSTRAINT "CampaignIndicator_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "Indicator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignIndicator" ADD CONSTRAINT "CampaignIndicator_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
