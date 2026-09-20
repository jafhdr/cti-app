CREATE TYPE "IndicatorEnrichmentJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

CREATE TABLE "IndicatorEnrichmentJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'VIRUSTOTAL',
    "trigger" TEXT NOT NULL DEFAULT 'TELEGRAM_APPROVAL',
    "requestedById" TEXT,
    "status" "IndicatorEnrichmentJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IndicatorEnrichmentJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IndicatorEnrichmentJob_tenantId_indicatorId_provider_key"
ON "IndicatorEnrichmentJob"("tenantId", "indicatorId", "provider");

CREATE INDEX "IndicatorEnrichmentJob_status_availableAt_idx"
ON "IndicatorEnrichmentJob"("status", "availableAt");

CREATE INDEX "IndicatorEnrichmentJob_tenantId_status_availableAt_idx"
ON "IndicatorEnrichmentJob"("tenantId", "status", "availableAt");

ALTER TABLE "IndicatorEnrichmentJob" ADD CONSTRAINT "IndicatorEnrichmentJob_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IndicatorEnrichmentJob" ADD CONSTRAINT "IndicatorEnrichmentJob_indicatorId_tenantId_fkey"
FOREIGN KEY ("indicatorId", "tenantId") REFERENCES "Indicator"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
