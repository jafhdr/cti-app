CREATE TABLE "AppSecFindingVulnerability" (
  "findingId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "vulnerabilityId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppSecFindingVulnerability_pkey" PRIMARY KEY ("findingId")
);
CREATE UNIQUE INDEX "AppSecFindingVulnerability_findingId_tenantId_key" ON "AppSecFindingVulnerability"("findingId", "tenantId");
CREATE INDEX "AppSecFindingVulnerability_tenantId_vulnerabilityId_idx" ON "AppSecFindingVulnerability"("tenantId", "vulnerabilityId");
ALTER TABLE "AppSecFindingVulnerability" ADD CONSTRAINT "AppSecFindingVulnerability_findingId_tenantId_fkey"
FOREIGN KEY ("findingId", "tenantId") REFERENCES "AppSecFinding"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppSecFindingVulnerability" ADD CONSTRAINT "AppSecFindingVulnerability_vulnerabilityId_tenantId_fkey"
FOREIGN KEY ("vulnerabilityId", "tenantId") REFERENCES "Vulnerability"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AppSecFindingCase" (
  "findingId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppSecFindingCase_pkey" PRIMARY KEY ("findingId")
);
CREATE UNIQUE INDEX "AppSecFindingCase_findingId_tenantId_key" ON "AppSecFindingCase"("findingId", "tenantId");
CREATE UNIQUE INDEX "AppSecFindingCase_caseId_tenantId_key" ON "AppSecFindingCase"("caseId", "tenantId");
CREATE UNIQUE INDEX "AppSecFindingCase_caseId_key" ON "AppSecFindingCase"("caseId");
CREATE INDEX "AppSecFindingCase_tenantId_caseId_idx" ON "AppSecFindingCase"("tenantId", "caseId");
ALTER TABLE "AppSecFindingCase" ADD CONSTRAINT "AppSecFindingCase_findingId_tenantId_fkey"
FOREIGN KEY ("findingId", "tenantId") REFERENCES "AppSecFinding"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppSecFindingCase" ADD CONSTRAINT "AppSecFindingCase_caseId_tenantId_fkey"
FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
