CREATE UNIQUE INDEX "Case_id_tenantId_key" ON "Case"("id", "tenantId");

CREATE TABLE "CaseInvestigationNote" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseInvestigationNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CaseEvidence" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "description" TEXT,
  "source" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CaseActivity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CaseInvestigationNote_tenantId_caseId_createdAt_idx" ON "CaseInvestigationNote"("tenantId", "caseId", "createdAt");
CREATE INDEX "CaseEvidence_tenantId_caseId_createdAt_idx" ON "CaseEvidence"("tenantId", "caseId", "createdAt");
CREATE INDEX "CaseActivity_tenantId_caseId_createdAt_idx" ON "CaseActivity"("tenantId", "caseId", "createdAt");

ALTER TABLE "CaseInvestigationNote" ADD CONSTRAINT "CaseInvestigationNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseInvestigationNote" ADD CONSTRAINT "CaseInvestigationNote_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseInvestigationNote" ADD CONSTRAINT "CaseInvestigationNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseEvidence" ADD CONSTRAINT "CaseEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseEvidence" ADD CONSTRAINT "CaseEvidence_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseEvidence" ADD CONSTRAINT "CaseEvidence_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseActivity" ADD CONSTRAINT "CaseActivity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseActivity" ADD CONSTRAINT "CaseActivity_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
