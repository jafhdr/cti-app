CREATE TABLE "CaseIndicator" (
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaseIndicator_pkey" PRIMARY KEY ("caseId", "indicatorId")
);

CREATE INDEX "CaseIndicator_tenantId_caseId_createdAt_idx" ON "CaseIndicator"("tenantId", "caseId", "createdAt");
CREATE INDEX "CaseIndicator_tenantId_indicatorId_idx" ON "CaseIndicator"("tenantId", "indicatorId");

ALTER TABLE "CaseIndicator" ADD CONSTRAINT "CaseIndicator_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseIndicator" ADD CONSTRAINT "CaseIndicator_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseIndicator" ADD CONSTRAINT "CaseIndicator_indicatorId_tenantId_fkey" FOREIGN KEY ("indicatorId", "tenantId") REFERENCES "Indicator"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
