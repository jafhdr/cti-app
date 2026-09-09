CREATE TABLE "MitreTechnique" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "tactic" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "url" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MitreTechnique_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CampaignMitreTechnique" (
  "campaignId" TEXT NOT NULL,
  "mitreTechniqueId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignMitreTechnique_pkey" PRIMARY KEY ("campaignId", "mitreTechniqueId")
);
CREATE UNIQUE INDEX "Campaign_id_tenantId_key" ON "Campaign"("id", "tenantId");
CREATE UNIQUE INDEX "MitreTechnique_tenantId_externalId_key" ON "MitreTechnique"("tenantId", "externalId");
CREATE UNIQUE INDEX "MitreTechnique_id_tenantId_key" ON "MitreTechnique"("id", "tenantId");
CREATE INDEX "MitreTechnique_tenantId_tactic_platform_idx" ON "MitreTechnique"("tenantId", "tactic", "platform");
CREATE INDEX "MitreTechnique_tenantId_updatedAt_idx" ON "MitreTechnique"("tenantId", "updatedAt");
CREATE INDEX "CampaignMitreTechnique_tenantId_mitreTechniqueId_idx" ON "CampaignMitreTechnique"("tenantId", "mitreTechniqueId");
ALTER TABLE "MitreTechnique" ADD CONSTRAINT "MitreTechnique_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignMitreTechnique" ADD CONSTRAINT "CampaignMitreTechnique_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignMitreTechnique" ADD CONSTRAINT "CampaignMitreTechnique_mitreTechniqueId_tenantId_fkey" FOREIGN KEY ("mitreTechniqueId", "tenantId") REFERENCES "MitreTechnique"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignMitreTechnique" ADD CONSTRAINT "CampaignMitreTechnique_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
