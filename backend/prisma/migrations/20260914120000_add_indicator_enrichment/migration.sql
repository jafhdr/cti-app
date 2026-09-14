CREATE TYPE "IndicatorEnrichmentStatus" AS ENUM ('SUCCESS', 'FAILED');

CREATE TABLE "IndicatorEnrichment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "data" JSONB,
    "status" "IndicatorEnrichmentStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IndicatorEnrichment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IndicatorEnrichment_tenantId_indicatorId_createdAt_idx"
ON "IndicatorEnrichment"("tenantId", "indicatorId", "createdAt");

ALTER TABLE "IndicatorEnrichment" ADD CONSTRAINT "IndicatorEnrichment_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IndicatorEnrichment" ADD CONSTRAINT "IndicatorEnrichment_indicatorId_tenantId_fkey"
FOREIGN KEY ("indicatorId", "tenantId") REFERENCES "Indicator"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
