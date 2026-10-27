CREATE UNIQUE INDEX "SirEvidence_id_tenantId_key" ON "SirEvidence"("id", "tenantId");

CREATE TABLE "SourceReliabilityAssessment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "grade" "IntelligenceSourceReliability" NOT NULL,
  "rationale" TEXT NOT NULL,
  "consistency" TEXT,
  "accuracy" TEXT,
  "timeliness" TEXT,
  "trackRecord" TEXT,
  "assessedById" TEXT NOT NULL,
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewAt" TIMESTAMP(3),
  CONSTRAINT "SourceReliabilityAssessment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SourceReliabilityAssessment_tenantId_sourceId_assessedAt_idx" ON "SourceReliabilityAssessment"("tenantId", "sourceId", "assessedAt");
ALTER TABLE "SourceReliabilityAssessment" ADD CONSTRAINT "SourceReliabilityAssessment_sourceId_tenantId_fkey" FOREIGN KEY ("sourceId", "tenantId") REFERENCES "IntelligenceSource"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceReliabilityAssessment" ADD CONSTRAINT "SourceReliabilityAssessment_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "EvidenceCredibilityAssessment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "grade" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "supportingInformation" TEXT,
  "conflictingInformation" TEXT,
  "assessedById" TEXT NOT NULL,
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvidenceCredibilityAssessment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EvidenceCredibilityAssessment_tenantId_evidenceId_assessedAt_idx" ON "EvidenceCredibilityAssessment"("tenantId", "evidenceId", "assessedAt");
ALTER TABLE "EvidenceCredibilityAssessment" ADD CONSTRAINT "EvidenceCredibilityAssessment_evidenceId_tenantId_fkey" FOREIGN KEY ("evidenceId", "tenantId") REFERENCES "SirEvidence"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceCredibilityAssessment" ADD CONSTRAINT "EvidenceCredibilityAssessment_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
