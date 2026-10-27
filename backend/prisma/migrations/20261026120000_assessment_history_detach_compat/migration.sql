BEGIN;

ALTER TABLE "SourceReliabilityAssessment"
  ADD COLUMN "liveSourceTenantId" TEXT,
  ADD COLUMN "originalSourceId" TEXT,
  ADD COLUMN "sourceName" TEXT,
  ADD COLUMN "sourceType" "IntelligenceSourceType";

UPDATE "SourceReliabilityAssessment" a
SET "liveSourceTenantId" = a."tenantId",
    "originalSourceId" = s.id,
    "sourceName" = s.name,
    "sourceType" = s."sourceType"
FROM "IntelligenceSource" s
WHERE s.id = a."sourceId" AND s."tenantId" = a."tenantId";

ALTER TABLE "EvidenceCredibilityAssessment"
  ADD COLUMN "liveEvidenceTenantId" TEXT,
  ADD COLUMN "originalEvidenceId" TEXT,
  ADD COLUMN "originalSirId" TEXT,
  ADD COLUMN "evidenceType" TEXT,
  ADD COLUMN "originalRecordId" TEXT;

UPDATE "EvidenceCredibilityAssessment" a
SET "liveEvidenceTenantId" = a."tenantId",
    "originalEvidenceId" = e.id,
    "originalSirId" = e."sirId",
    "evidenceType" = CASE WHEN e."indicatorId" IS NOT NULL THEN 'INDICATOR' WHEN e."threatActorId" IS NOT NULL THEN 'THREAT_ACTOR' WHEN e."campaignId" IS NOT NULL THEN 'CAMPAIGN' END,
    "originalRecordId" = COALESCE(e."indicatorId", e."threatActorId", e."campaignId")
FROM "SirEvidence" e
WHERE e.id = a."evidenceId" AND e."tenantId" = a."tenantId";

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "SourceReliabilityAssessment" WHERE "originalSourceId" IS NULL OR "sourceName" IS NULL OR "sourceType" IS NULL OR "liveSourceTenantId" IS NULL) THEN
    RAISE EXCEPTION 'Source assessment history cannot be backfilled from a tenant-matched source';
  END IF;
  IF EXISTS (SELECT 1 FROM "EvidenceCredibilityAssessment" WHERE "originalEvidenceId" IS NULL OR "originalSirId" IS NULL OR "evidenceType" IS NULL OR "originalRecordId" IS NULL OR "liveEvidenceTenantId" IS NULL) THEN
    RAISE EXCEPTION 'Evidence assessment history cannot be backfilled from a tenant-matched evidence link';
  END IF;
END $$;

ALTER TABLE "SourceReliabilityAssessment"
  ALTER COLUMN "sourceId" DROP NOT NULL,
  ALTER COLUMN "originalSourceId" SET NOT NULL,
  ALTER COLUMN "sourceName" SET NOT NULL,
  ALTER COLUMN "sourceType" SET NOT NULL;
ALTER TABLE "EvidenceCredibilityAssessment"
  ALTER COLUMN "evidenceId" DROP NOT NULL,
  ALTER COLUMN "originalEvidenceId" SET NOT NULL,
  ALTER COLUMN "originalSirId" SET NOT NULL,
  ALTER COLUMN "evidenceType" SET NOT NULL,
  ALTER COLUMN "originalRecordId" SET NOT NULL;

ALTER TABLE "SourceReliabilityAssessment" DROP CONSTRAINT "SourceReliabilityAssessment_sourceId_tenantId_fkey";
ALTER TABLE "EvidenceCredibilityAssessment" DROP CONSTRAINT "EvidenceCredibilityAssessment_evidenceId_tenantId_fkey";

ALTER TABLE "SourceReliabilityAssessment"
  ADD CONSTRAINT "SourceReliabilityAssessment_sourceId_liveSourceTenantId_fkey"
  FOREIGN KEY ("sourceId", "liveSourceTenantId") REFERENCES "IntelligenceSource"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SourceReliabilityAssessment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SourceReliabilityAssessment_liveTenant_check"
  CHECK (("sourceId" IS NULL AND "liveSourceTenantId" IS NULL) OR ("sourceId" IS NOT NULL AND "liveSourceTenantId" IS NOT NULL AND "liveSourceTenantId" = "tenantId"));

ALTER TABLE "EvidenceCredibilityAssessment"
  ADD CONSTRAINT "EvidenceCredibilityAssessment_evidenceId_liveEvidenceTenantId_fkey"
  FOREIGN KEY ("evidenceId", "liveEvidenceTenantId") REFERENCES "SirEvidence"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EvidenceCredibilityAssessment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EvidenceCredibilityAssessment_liveTenant_check"
  CHECK (("evidenceId" IS NULL AND "liveEvidenceTenantId" IS NULL) OR ("evidenceId" IS NOT NULL AND "liveEvidenceTenantId" IS NOT NULL AND "liveEvidenceTenantId" = "tenantId"));

CREATE INDEX "SourceReliabilityAssessment_tenantId_originalSourceId_assessedAt_idx"
  ON "SourceReliabilityAssessment"("tenantId", "originalSourceId", "assessedAt");
CREATE INDEX "EvidenceCredibilityAssessment_tenantId_originalEvidenceId_assessedAt_idx"
  ON "EvidenceCredibilityAssessment"("tenantId", "originalEvidenceId", "assessedAt");

COMMIT;
