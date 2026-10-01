CREATE TYPE "AsmDiscoveryRunStatus" AS ENUM ('RUNNING','COMPLETED','PARTIAL','FAILED');
CREATE TYPE "AsmChangeType" AS ENUM ('ASSET_DISCOVERED','ASSET_NOT_OBSERVED','DNS_CHANGED','IP_DISCOVERED','IP_NOT_OBSERVED','PORT_OPENED','PORT_NOT_OBSERVED','SERVICE_DISCOVERED','SERVICE_CHANGED','VULNERABILITY_CONFIRMED','VULNERABILITY_STALE');
CREATE TABLE "AsmDiscoverySchedule" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "assetId" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 1440, "lastRunAt" TIMESTAMP(3), "nextRunAt" TIMESTAMP(3), "lockedUntil" TIMESTAMP(3),
  CONSTRAINT "AsmDiscoverySchedule_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AsmDiscoveryRun" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "assetId" TEXT NOT NULL,
  "status" "AsmDiscoveryRunStatus" NOT NULL DEFAULT 'RUNNING', "source" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  "discovered" INTEGER NOT NULL DEFAULT 0, "created" INTEGER NOT NULL DEFAULT 0, "updated" INTEGER NOT NULL DEFAULT 0, "failed" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT, "providers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "snapshot" JSONB,
  CONSTRAINT "AsmDiscoveryRun_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AsmExposureChange" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "assetId" TEXT NOT NULL, "runId" TEXT NOT NULL,
  "type" "AsmChangeType" NOT NULL, "entityKey" TEXT NOT NULL, "previousValue" TEXT, "currentValue" TEXT,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AsmExposureChange_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AsmDiscoverySchedule_assetId_key" ON "AsmDiscoverySchedule"("assetId");
CREATE UNIQUE INDEX "AsmDiscoverySchedule_assetId_tenantId_key" ON "AsmDiscoverySchedule"("assetId","tenantId");
CREATE INDEX "AsmDiscoverySchedule_enabled_nextRunAt_idx" ON "AsmDiscoverySchedule"("enabled","nextRunAt");
CREATE INDEX "AsmDiscoveryRun_tenantId_assetId_startedAt_idx" ON "AsmDiscoveryRun"("tenantId","assetId","startedAt");
CREATE UNIQUE INDEX "AsmExposureChange_runId_type_entityKey_key" ON "AsmExposureChange"("runId","type","entityKey");
CREATE INDEX "AsmExposureChange_tenantId_assetId_detectedAt_idx" ON "AsmExposureChange"("tenantId","assetId","detectedAt");
ALTER TABLE "AsmDiscoverySchedule" ADD CONSTRAINT "AsmDiscoverySchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AsmDiscoverySchedule" ADD CONSTRAINT "AsmDiscoverySchedule_assetId_tenantId_fkey" FOREIGN KEY ("assetId","tenantId") REFERENCES "Asset"("id","tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AsmDiscoveryRun" ADD CONSTRAINT "AsmDiscoveryRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AsmDiscoveryRun" ADD CONSTRAINT "AsmDiscoveryRun_assetId_tenantId_fkey" FOREIGN KEY ("assetId","tenantId") REFERENCES "Asset"("id","tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AsmExposureChange" ADD CONSTRAINT "AsmExposureChange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AsmExposureChange" ADD CONSTRAINT "AsmExposureChange_assetId_tenantId_fkey" FOREIGN KEY ("assetId","tenantId") REFERENCES "Asset"("id","tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AsmExposureChange" ADD CONSTRAINT "AsmExposureChange_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AsmDiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
