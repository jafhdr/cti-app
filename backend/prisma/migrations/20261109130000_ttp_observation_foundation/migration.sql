CREATE TYPE "TtpObservationStatus" AS ENUM ('CANDIDATE', 'CONFIRMED', 'DISPUTED', 'REJECTED');
CREATE TYPE "TtpTimePrecision" AS ENUM ('INSTANT', 'HOUR', 'DAY', 'INTERVAL');

CREATE TABLE "TtpObservation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "threatActorId" TEXT,
  "campaignId" TEXT,
  "mitreTechniqueId" TEXT NOT NULL,
  "attackVersion" TEXT NOT NULL,
  "sirEvidenceId" TEXT NOT NULL,
  "evidenceSnapshot" TEXT NOT NULL,
  "evidenceDigest" TEXT NOT NULL,
  "attributionBasis" TEXT NOT NULL,
  "observedStartAt" TIMESTAMP(3) NOT NULL,
  "observedEndAt" TIMESTAMP(3) NOT NULL,
  "timePrecision" "TtpTimePrecision" NOT NULL,
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tlp" "TlpLevel" NOT NULL DEFAULT 'AMBER',
  "sourceReliability" TEXT,
  "evidenceCredibility" TEXT,
  "actorConfidence" INTEGER,
  "techniqueConfidence" INTEGER NOT NULL,
  "status" "TtpObservationStatus" NOT NULL DEFAULT 'CANDIDATE',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TtpObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TtpObservation_scope_check" CHECK ("threatActorId" IS NOT NULL OR "campaignId" IS NOT NULL),
  CONSTRAINT "TtpObservation_time_check" CHECK ("observedEndAt" >= "observedStartAt"),
  CONSTRAINT "TtpObservation_confidence_check" CHECK ("techniqueConfidence" BETWEEN 0 AND 100 AND ("actorConfidence" IS NULL OR "actorConfidence" BETWEEN 0 AND 100)),
  CONSTRAINT "TtpObservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TtpObservation_threatActorId_tenantId_fkey" FOREIGN KEY ("threatActorId", "tenantId") REFERENCES "ThreatActor"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TtpObservation_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TtpObservation_mitreTechniqueId_tenantId_fkey" FOREIGN KEY ("mitreTechniqueId", "tenantId") REFERENCES "MitreTechnique"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TtpObservation_sirEvidenceId_tenantId_fkey" FOREIGN KEY ("sirEvidenceId", "tenantId") REFERENCES "SirEvidence"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TtpObservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TtpObservation_tenantId_idempotencyKey_key" ON "TtpObservation"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "TtpObservation_id_tenantId_key" ON "TtpObservation"("id", "tenantId");
CREATE INDEX "TtpObservation_tenantId_threatActorId_observedStartAt_id_idx" ON "TtpObservation"("tenantId", "threatActorId", "observedStartAt", "id");
CREATE INDEX "TtpObservation_tenantId_campaignId_observedStartAt_id_idx" ON "TtpObservation"("tenantId", "campaignId", "observedStartAt", "id");
CREATE INDEX "TtpObservation_tenantId_status_idx" ON "TtpObservation"("tenantId", "status");

CREATE TABLE "TtpObservationReview" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "observationId" TEXT NOT NULL,
  "status" "TtpObservationStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TtpObservationReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TtpObservationReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TtpObservationReview_observationId_tenantId_fkey" FOREIGN KEY ("observationId", "tenantId") REFERENCES "TtpObservation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TtpObservationReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TtpObservationReview_tenantId_observationId_createdAt_id_idx" ON "TtpObservationReview"("tenantId", "observationId", "createdAt", "id");
