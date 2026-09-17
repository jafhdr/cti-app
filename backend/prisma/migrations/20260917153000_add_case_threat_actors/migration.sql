CREATE TABLE "CaseThreatActor" (
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "threatActorId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseThreatActor_pkey" PRIMARY KEY ("caseId", "threatActorId")
);

CREATE INDEX "CaseThreatActor_tenantId_caseId_createdAt_idx" ON "CaseThreatActor"("tenantId", "caseId", "createdAt");
CREATE INDEX "CaseThreatActor_tenantId_threatActorId_idx" ON "CaseThreatActor"("tenantId", "threatActorId");

ALTER TABLE "CaseThreatActor" ADD CONSTRAINT "CaseThreatActor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseThreatActor" ADD CONSTRAINT "CaseThreatActor_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseThreatActor" ADD CONSTRAINT "CaseThreatActor_threatActorId_tenantId_fkey" FOREIGN KEY ("threatActorId", "tenantId") REFERENCES "ThreatActor"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
