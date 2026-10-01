CREATE TYPE "AsmRiskTrend" AS ENUM ('BASELINE', 'INCREASED', 'DECREASED', 'UNCHANGED');
CREATE TABLE "AsmRiskSnapshot" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "critical" INTEGER NOT NULL,
  "high" INTEGER NOT NULL,
  "medium" INTEGER NOT NULL,
  "low" INTEGER NOT NULL,
  "total" INTEGER NOT NULL,
  "score" INTEGER NOT NULL,
  "previousScore" INTEGER,
  "trend" "AsmRiskTrend" NOT NULL,
  "highImpactFindingIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AsmRiskSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AsmRiskSnapshot_runId_assetId_key" ON "AsmRiskSnapshot"("runId", "assetId");
CREATE INDEX "AsmRiskSnapshot_tenantId_assetId_evaluatedAt_idx" ON "AsmRiskSnapshot"("tenantId", "assetId", "evaluatedAt");
ALTER TABLE "AsmRiskSnapshot" ADD CONSTRAINT "AsmRiskSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AsmRiskSnapshot" ADD CONSTRAINT "AsmRiskSnapshot_assetId_tenantId_fkey" FOREIGN KEY ("assetId", "tenantId") REFERENCES "Asset"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AsmRiskSnapshot" ADD CONSTRAINT "AsmRiskSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AsmDiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD COLUMN "riskSnapshotId" TEXT;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_riskSnapshotId_fkey" FOREIGN KEY ("riskSnapshotId") REFERENCES "AsmRiskSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
