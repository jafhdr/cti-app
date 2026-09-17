CREATE TABLE "CaseCampaign" (
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseCampaign_pkey" PRIMARY KEY ("caseId", "campaignId")
);

CREATE INDEX "CaseCampaign_tenantId_caseId_createdAt_idx" ON "CaseCampaign"("tenantId", "caseId", "createdAt");
CREATE INDEX "CaseCampaign_tenantId_campaignId_idx" ON "CaseCampaign"("tenantId", "campaignId");

ALTER TABLE "CaseCampaign" ADD CONSTRAINT "CaseCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseCampaign" ADD CONSTRAINT "CaseCampaign_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseCampaign" ADD CONSTRAINT "CaseCampaign_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
