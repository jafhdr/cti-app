ALTER TABLE "ThreatEvent"
  ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "processedAt" TIMESTAMP(3),
  ADD COLUMN "failureCode" TEXT;

ALTER TABLE "ThreatEvent" ADD CONSTRAINT "ThreatEvent_processingStatus_check"
  CHECK ("processingStatus" IN ('PENDING', 'PROCESSING', 'MATCHED', 'NO_MATCH', 'FAILED'));
ALTER TABLE "ThreatEvent" ADD CONSTRAINT "ThreatEvent_attempts_check" CHECK ("attempts" BETWEEN 0 AND 3);
CREATE INDEX "ThreatEvent_processingStatus_nextAttemptAt_ingestedAt_idx"
  ON "ThreatEvent"("processingStatus", "nextAttemptAt", "ingestedAt");

DROP INDEX "ThreatCorrelation_eventId_key";
DROP INDEX "ThreatCorrelation_eventId_tenantId_key";
CREATE INDEX "ThreatCorrelation_eventId_tenantId_idx" ON "ThreatCorrelation"("eventId", "tenantId");
