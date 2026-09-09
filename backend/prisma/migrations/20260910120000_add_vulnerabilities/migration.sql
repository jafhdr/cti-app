CREATE TABLE "Vulnerability" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "cveId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "severity" "IndicatorSeverity" NOT NULL DEFAULT 'MEDIUM',
  "cvssScore" DOUBLE PRECISION,
  "url" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vulnerability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Vulnerability_tenantId_cveId_key" ON "Vulnerability"("tenantId", "cveId");
CREATE UNIQUE INDEX "Vulnerability_id_tenantId_key" ON "Vulnerability"("id", "tenantId");
CREATE INDEX "Vulnerability_tenantId_severity_updatedAt_idx" ON "Vulnerability"("tenantId", "severity", "updatedAt");

CREATE TABLE "ThreatActorVulnerability" ("threatActorId" TEXT NOT NULL, "vulnerabilityId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ThreatActorVulnerability_pkey" PRIMARY KEY ("threatActorId", "vulnerabilityId"));
CREATE TABLE "CampaignVulnerability" ("campaignId" TEXT NOT NULL, "vulnerabilityId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CampaignVulnerability_pkey" PRIMARY KEY ("campaignId", "vulnerabilityId"));
CREATE TABLE "MalwareToolVulnerability" ("malwareToolId" TEXT NOT NULL, "vulnerabilityId" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MalwareToolVulnerability_pkey" PRIMARY KEY ("malwareToolId", "vulnerabilityId"));

CREATE INDEX "ThreatActorVulnerability_tenantId_vulnerabilityId_idx" ON "ThreatActorVulnerability"("tenantId", "vulnerabilityId");
CREATE INDEX "CampaignVulnerability_tenantId_vulnerabilityId_idx" ON "CampaignVulnerability"("tenantId", "vulnerabilityId");
CREATE INDEX "MalwareToolVulnerability_tenantId_vulnerabilityId_idx" ON "MalwareToolVulnerability"("tenantId", "vulnerabilityId");

ALTER TABLE "Vulnerability" ADD CONSTRAINT "Vulnerability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreatActorVulnerability" ADD CONSTRAINT "ThreatActorVulnerability_threatActorId_tenantId_fkey" FOREIGN KEY ("threatActorId", "tenantId") REFERENCES "ThreatActor"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreatActorVulnerability" ADD CONSTRAINT "ThreatActorVulnerability_vulnerabilityId_tenantId_fkey" FOREIGN KEY ("vulnerabilityId", "tenantId") REFERENCES "Vulnerability"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThreatActorVulnerability" ADD CONSTRAINT "ThreatActorVulnerability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignVulnerability" ADD CONSTRAINT "CampaignVulnerability_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignVulnerability" ADD CONSTRAINT "CampaignVulnerability_vulnerabilityId_tenantId_fkey" FOREIGN KEY ("vulnerabilityId", "tenantId") REFERENCES "Vulnerability"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignVulnerability" ADD CONSTRAINT "CampaignVulnerability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MalwareToolVulnerability" ADD CONSTRAINT "MalwareToolVulnerability_malwareToolId_tenantId_fkey" FOREIGN KEY ("malwareToolId", "tenantId") REFERENCES "MalwareTool"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MalwareToolVulnerability" ADD CONSTRAINT "MalwareToolVulnerability_vulnerabilityId_tenantId_fkey" FOREIGN KEY ("vulnerabilityId", "tenantId") REFERENCES "Vulnerability"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MalwareToolVulnerability" ADD CONSTRAINT "MalwareToolVulnerability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
