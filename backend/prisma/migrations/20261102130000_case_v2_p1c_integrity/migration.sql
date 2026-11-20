-- CreateEnum
CREATE TYPE "CaseReviewDecisionKind" AS ENUM ('APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "investigationCycle" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CaseEvidenceRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT,
    "authorId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "integrityKind" TEXT NOT NULL DEFAULT 'METADATA_ONLY',

    CONSTRAINT "CaseEvidenceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseReviewRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseReviewDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "kind" "CaseReviewDecisionKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "caseRevision" INTEGER NOT NULL,
    "investigationSnapshotHash" TEXT NOT NULL,
    "investigationActivityCount" INTEGER NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseClosure" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "reviewDecisionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "investigationSummary" TEXT NOT NULL,
    "evidenceSnapshot" JSONB NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseReopen" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromCycle" INTEGER NOT NULL,
    "toCycle" INTEGER NOT NULL,
    "closureId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reopenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseReopen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseEvidenceRevision_tenantId_caseId_evidenceId_revision_idx" ON "CaseEvidenceRevision"("tenantId", "caseId", "evidenceId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "CaseEvidenceRevision_evidenceId_revision_key" ON "CaseEvidenceRevision"("evidenceId", "revision");

-- CreateIndex
CREATE INDEX "CaseReviewRequest_tenantId_caseId_cycle_createdAt_idx" ON "CaseReviewRequest"("tenantId", "caseId", "cycle", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaseReviewRequest_id_tenantId_caseId_key" ON "CaseReviewRequest"("id", "tenantId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseReviewDecision_reviewId_key" ON "CaseReviewDecision"("reviewId");

-- CreateIndex
CREATE INDEX "CaseReviewDecision_tenantId_caseId_decidedAt_idx" ON "CaseReviewDecision"("tenantId", "caseId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaseReviewDecision_id_tenantId_caseId_key" ON "CaseReviewDecision"("id", "tenantId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseReviewDecision_reviewId_tenantId_caseId_key" ON "CaseReviewDecision"("reviewId", "tenantId", "caseId");

-- CreateIndex
CREATE INDEX "CaseClosure_tenantId_caseId_closedAt_idx" ON "CaseClosure"("tenantId", "caseId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaseClosure_caseId_cycle_key" ON "CaseClosure"("caseId", "cycle");

CREATE UNIQUE INDEX "CaseClosure_id_tenantId_caseId_key" ON "CaseClosure"("id", "tenantId", "caseId");

-- CreateIndex
CREATE INDEX "CaseReopen_tenantId_caseId_reopenedAt_idx" ON "CaseReopen"("tenantId", "caseId", "reopenedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaseReopen_caseId_fromCycle_key" ON "CaseReopen"("caseId", "fromCycle");

-- CreateIndex
CREATE UNIQUE INDEX "CaseEvidence_id_tenantId_caseId_key" ON "CaseEvidence"("id", "tenantId", "caseId");

-- AddForeignKey
ALTER TABLE "CaseEvidenceRevision" ADD CONSTRAINT "CaseEvidenceRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseEvidenceRevision" ADD CONSTRAINT "CaseEvidenceRevision_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseEvidenceRevision" ADD CONSTRAINT "CaseEvidenceRevision_evidenceId_tenantId_caseId_fkey" FOREIGN KEY ("evidenceId", "tenantId", "caseId") REFERENCES "CaseEvidence"("id", "tenantId", "caseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseEvidenceRevision" ADD CONSTRAINT "CaseEvidenceRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReviewRequest" ADD CONSTRAINT "CaseReviewRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReviewRequest" ADD CONSTRAINT "CaseReviewRequest_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReviewRequest" ADD CONSTRAINT "CaseReviewRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReviewRequest" ADD CONSTRAINT "CaseReviewRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReviewDecision" ADD CONSTRAINT "CaseReviewDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReviewDecision" ADD CONSTRAINT "CaseReviewDecision_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReviewDecision" ADD CONSTRAINT "CaseReviewDecision_reviewId_tenantId_caseId_fkey" FOREIGN KEY ("reviewId", "tenantId", "caseId") REFERENCES "CaseReviewRequest"("id", "tenantId", "caseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReviewDecision" ADD CONSTRAINT "CaseReviewDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseClosure" ADD CONSTRAINT "CaseClosure_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseClosure" ADD CONSTRAINT "CaseClosure_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseClosure" ADD CONSTRAINT "CaseClosure_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseClosure" ADD CONSTRAINT "CaseClosure_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseClosure" ADD CONSTRAINT "CaseClosure_reviewDecisionId_tenantId_caseId_fkey" FOREIGN KEY ("reviewDecisionId", "tenantId", "caseId") REFERENCES "CaseReviewDecision"("id", "tenantId", "caseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReopen" ADD CONSTRAINT "CaseReopen_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReopen" ADD CONSTRAINT "CaseReopen_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReopen" ADD CONSTRAINT "CaseReopen_closureId_tenantId_caseId_fkey" FOREIGN KEY ("closureId", "tenantId", "caseId") REFERENCES "CaseClosure"("id", "tenantId", "caseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReopen" ADD CONSTRAINT "CaseReopen_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_case_v2_history_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Case V2 history is immutable';
END;
$$;
CREATE TRIGGER "CaseEvidenceRevision_immutable" BEFORE UPDATE OR DELETE ON "CaseEvidenceRevision" FOR EACH ROW EXECUTE FUNCTION "reject_case_v2_history_mutation"();
CREATE TRIGGER "CaseReviewRequest_immutable" BEFORE UPDATE OR DELETE ON "CaseReviewRequest" FOR EACH ROW EXECUTE FUNCTION "reject_case_v2_history_mutation"();
CREATE TRIGGER "CaseReviewDecision_immutable" BEFORE UPDATE OR DELETE ON "CaseReviewDecision" FOR EACH ROW EXECUTE FUNCTION "reject_case_v2_history_mutation"();
CREATE TRIGGER "CaseClosure_immutable" BEFORE UPDATE OR DELETE ON "CaseClosure" FOR EACH ROW EXECUTE FUNCTION "reject_case_v2_history_mutation"();
CREATE TRIGGER "CaseReopen_immutable" BEFORE UPDATE OR DELETE ON "CaseReopen" FOR EACH ROW EXECUTE FUNCTION "reject_case_v2_history_mutation"();
