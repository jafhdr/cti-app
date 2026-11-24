CREATE TABLE "AsmCorrelationDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "previousReviewStatus" TEXT NOT NULL,
  "reviewStatus" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "resultingRevision" INTEGER NOT NULL,
  "requestKey" TEXT NOT NULL,
  "inspectedEvidence" BOOLEAN NOT NULL,
  "overrideReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AsmCorrelationDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AsmCorrelationDecision_correlationId_tenantId_fkey" FOREIGN KEY ("correlationId", "tenantId") REFERENCES "AssetVulnerabilityCorrelation"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AsmCorrelationDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AsmCorrelationDecision_request_key" ON "AsmCorrelationDecision"("tenantId", "correlationId", "actorId", "requestKey");
CREATE INDEX "AsmCorrelationDecision_history_idx" ON "AsmCorrelationDecision"("tenantId", "correlationId", "createdAt", "id");
