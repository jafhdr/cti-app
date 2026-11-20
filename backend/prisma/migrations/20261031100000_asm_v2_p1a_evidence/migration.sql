ALTER TABLE "AssetVulnerabilityCorrelation"
  ADD COLUMN "workflowVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewStatus" TEXT,
  ADD COLUMN "evidenceHash" TEXT,
  ADD COLUMN "reviewedEvidenceHash" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "AssetVulnerabilityCorrelation_id_tenantId_key"
  ON "AssetVulnerabilityCorrelation"("id", "tenantId");
CREATE INDEX "AssetVulnerabilityCorrelation_v2_queue_idx"
  ON "AssetVulnerabilityCorrelation"("tenantId", "assetId", "workflowVersion", "reviewStatus", "status");

CREATE TABLE "AsmV2Enrollment" (
  "tenantId" TEXT NOT NULL PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AsmV2Enrollment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AsmCorrelationObservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "vulnerabilityId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "discoveryRunId" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind" TEXT NOT NULL,
  "confidence" TEXT,
  "matchReason" TEXT,
  "matcherVersion" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "serviceSnapshot" JSONB NOT NULL,
  "tiSnapshot" JSONB NOT NULL,
  "fingerprintSource" TEXT,
  CONSTRAINT "AsmCorrelationObservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AsmCorrelationObservation_assetId_tenantId_fkey" FOREIGN KEY ("assetId", "tenantId") REFERENCES "Asset"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AsmCorrelationObservation_serviceId_tenantId_fkey" FOREIGN KEY ("serviceId", "tenantId") REFERENCES "AssetPortService"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AsmCorrelationObservation_vulnerabilityId_tenantId_fkey" FOREIGN KEY ("vulnerabilityId", "tenantId") REFERENCES "Vulnerability"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AsmCorrelationObservation_correlationId_tenantId_fkey" FOREIGN KEY ("correlationId", "tenantId") REFERENCES "AssetVulnerabilityCorrelation"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AsmCorrelationObservation_asset_history_idx"
  ON "AsmCorrelationObservation"("tenantId", "assetId", "observedAt", "id");
CREATE INDEX "AsmCorrelationObservation_correlation_history_idx"
  ON "AsmCorrelationObservation"("tenantId", "correlationId", "observedAt", "id");
