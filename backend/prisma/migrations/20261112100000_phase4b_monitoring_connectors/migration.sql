CREATE TYPE "MonitoringCollectionStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRY', 'SUCCEEDED', 'FAILED');

ALTER TABLE "MonitoringWatchlist" ADD COLUMN "identityKeyVersion" TEXT;
UPDATE "MonitoringWatchlist" SET "active" = false WHERE "kind" = 'IDENTITY_HASH';

ALTER TABLE "MonitoringSource"
  ADD COLUMN "connectorVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "collectionEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "collectionIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "nextCollectionAt" TIMESTAMP(3),
  ADD COLUMN "lastSuccessAt" TIMESTAMP(3),
  ADD COLUMN "lastFailureReason" TEXT,
  ADD COLUMN "coverageLabel" TEXT;

ALTER TABLE "MonitoringObservation"
  ADD COLUMN "identityKeyVersion" TEXT,
  ADD COLUMN "collectedAt" TIMESTAMP(3),
  ADD COLUMN "providerPublishedAt" TIMESTAMP(3),
  ADD COLUMN "collectionJobId" TEXT,
  ADD COLUMN "collectionJobTenantId" TEXT;

CREATE TABLE "MonitoringCollectionJob" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" "MonitoringCollectionStatus" NOT NULL DEFAULT 'QUEUED',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "observationCount" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "collectionLatencyMs" INTEGER,
  "processingLatencyMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonitoringCollectionJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonitoringCollectionJob_requestId_key" ON "MonitoringCollectionJob"("requestId");
CREATE UNIQUE INDEX "MonitoringCollectionJob_id_tenantId_key" ON "MonitoringCollectionJob"("id", "tenantId");
CREATE INDEX "MonitoringCollectionJob_status_dueAt_idx" ON "MonitoringCollectionJob"("status", "dueAt");
CREATE INDEX "MonitoringCollectionJob_tenantId_sourceId_createdAt_idx" ON "MonitoringCollectionJob"("tenantId", "sourceId", "createdAt");
ALTER TABLE "MonitoringCollectionJob" ADD CONSTRAINT "MonitoringCollectionJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitoringCollectionJob" ADD CONSTRAINT "MonitoringCollectionJob_sourceId_tenantId_fkey" FOREIGN KEY ("sourceId", "tenantId") REFERENCES "MonitoringSource"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonitoringObservation" ADD CONSTRAINT "MonitoringObservation_collectionJobId_collectionJobTenantId_fkey" FOREIGN KEY ("collectionJobId", "collectionJobTenantId") REFERENCES "MonitoringCollectionJob"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;
