CREATE TABLE "IndicatorSourceObservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "intelligenceSourceId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "provider" TEXT,
    "origin" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IndicatorSourceObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IndicatorSourceObservation_tenantId_indicatorId_sourceKey_key"
ON "IndicatorSourceObservation"("tenantId", "indicatorId", "sourceKey");
CREATE INDEX "IndicatorSourceObservation_tenantId_indicatorId_idx"
ON "IndicatorSourceObservation"("tenantId", "indicatorId");
CREATE INDEX "IndicatorSourceObservation_tenantId_intelligenceSourceId_idx"
ON "IndicatorSourceObservation"("tenantId", "intelligenceSourceId");

ALTER TABLE "IndicatorSourceObservation" ADD CONSTRAINT "IndicatorSourceObservation_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndicatorSourceObservation" ADD CONSTRAINT "IndicatorSourceObservation_indicatorId_tenantId_fkey"
FOREIGN KEY ("indicatorId", "tenantId") REFERENCES "Indicator"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndicatorSourceObservation" ADD CONSTRAINT "IndicatorSourceObservation_intelligenceSourceId_fkey"
FOREIGN KEY ("intelligenceSourceId") REFERENCES "IntelligenceSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "IndicatorSourceObservation" (
    "id", "tenantId", "indicatorId", "intelligenceSourceId", "sourceKey",
    "sourceName", "provider", "origin", "firstSeenAt", "lastSeenAt"
)
SELECT
    'legacy-' || i."id", i."tenantId", i."id", i."intelligenceSourceId",
    COALESCE(i."intelligenceSourceId", 'legacy:' || i."id"),
    COALESCE(s."name", i."source", 'Unknown'),
    COALESCE(s."provider", i."source"),
    CASE WHEN s."provider" IN ('URLhaus', 'MalwareBazaar', 'AbuseIPDB') THEN 'FEED' ELSE 'LEGACY' END,
    i."createdAt", i."updatedAt"
FROM "Indicator" i
LEFT JOIN "IntelligenceSource" s ON s."id" = i."intelligenceSourceId"
WHERE i."intelligenceSourceId" IS NOT NULL OR i."source" IS NOT NULL;
