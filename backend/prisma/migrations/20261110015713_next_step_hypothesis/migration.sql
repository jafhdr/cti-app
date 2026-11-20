-- CreateEnum
CREATE TYPE "NextStepRunStatus" AS ENUM ('GENERATED', 'ABSTAINED');

-- CreateEnum
CREATE TYPE "NextStepReviewKind" AS ENUM ('DISPOSITION', 'OUTCOME');

-- CreateEnum
CREATE TYPE "NextStepDisposition" AS ENUM ('ACCEPT_FOR_INVESTIGATION', 'DISMISSED', 'ALREADY_OBSERVED');

-- CreateEnum
CREATE TYPE "NextStepOutcome" AS ENUM ('VERIFIED', 'UNCERTAIN', 'UNOBSERVABLE');

-- CreateTable
CREATE TABLE "NextStepRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "threatActorId" TEXT,
    "campaignId" TEXT,
    "asOf" TIMESTAMP(3) NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "maxTlp" "TlpLevel" NOT NULL,
    "status" "NextStepRunStatus" NOT NULL,
    "abstentionReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NextStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NextStepCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "mitreTechniqueId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "supportScore" INTEGER NOT NULL,
    "supportingObservationIds" JSONB NOT NULL,
    "contradictingObservationIds" JSONB NOT NULL,
    "ruleTrace" JSONB NOT NULL,
    "investigationSteps" JSONB NOT NULL,

    CONSTRAINT "NextStepCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NextStepReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" "NextStepReviewKind" NOT NULL,
    "disposition" "NextStepDisposition",
    "outcome" "NextStepOutcome",
    "outcomeObservationId" TEXT,
    "reason" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NextStepReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NextStepRun_tenantId_threatActorId_createdAt_idx" ON "NextStepRun"("tenantId", "threatActorId", "createdAt");

-- CreateIndex
CREATE INDEX "NextStepRun_tenantId_campaignId_createdAt_idx" ON "NextStepRun"("tenantId", "campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NextStepRun_tenantId_idempotencyKey_key" ON "NextStepRun"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "NextStepRun_id_tenantId_key" ON "NextStepRun"("id", "tenantId");

-- CreateIndex
CREATE INDEX "NextStepCandidate_tenantId_mitreTechniqueId_idx" ON "NextStepCandidate"("tenantId", "mitreTechniqueId");

-- CreateIndex
CREATE UNIQUE INDEX "NextStepCandidate_runId_rank_key" ON "NextStepCandidate"("runId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "NextStepCandidate_id_tenantId_key" ON "NextStepCandidate"("id", "tenantId");

-- CreateIndex
CREATE INDEX "NextStepReview_tenantId_candidateId_createdAt_id_idx" ON "NextStepReview"("tenantId", "candidateId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "NextStepRun" ADD CONSTRAINT "NextStepRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextStepRun" ADD CONSTRAINT "NextStepRun_threatActorId_tenantId_fkey" FOREIGN KEY ("threatActorId", "tenantId") REFERENCES "ThreatActor"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextStepRun" ADD CONSTRAINT "NextStepRun_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextStepRun" ADD CONSTRAINT "NextStepRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextStepCandidate" ADD CONSTRAINT "NextStepCandidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextStepCandidate" ADD CONSTRAINT "NextStepCandidate_runId_tenantId_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "NextStepRun"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextStepCandidate" ADD CONSTRAINT "NextStepCandidate_mitreTechniqueId_tenantId_fkey" FOREIGN KEY ("mitreTechniqueId", "tenantId") REFERENCES "MitreTechnique"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextStepReview" ADD CONSTRAINT "NextStepReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextStepReview" ADD CONSTRAINT "NextStepReview_candidateId_tenantId_fkey" FOREIGN KEY ("candidateId", "tenantId") REFERENCES "NextStepCandidate"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextStepReview" ADD CONSTRAINT "NextStepReview_outcomeObservationId_tenantId_fkey" FOREIGN KEY ("outcomeObservationId", "tenantId") REFERENCES "TtpObservation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextStepReview" ADD CONSTRAINT "NextStepReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "NextStepRun" ADD CONSTRAINT "NextStepRun_scope_check" CHECK ("threatActorId" IS NOT NULL OR "campaignId" IS NOT NULL);
ALTER TABLE "NextStepRun" ADD CONSTRAINT "NextStepRun_horizon_check" CHECK ("horizonDays" BETWEEN 1 AND 90);
ALTER TABLE "NextStepCandidate" ADD CONSTRAINT "NextStepCandidate_score_check" CHECK ("supportScore" BETWEEN 0 AND 100 AND "rank" > 0);
ALTER TABLE "NextStepReview" ADD CONSTRAINT "NextStepReview_shape_check" CHECK (("kind" = 'DISPOSITION' AND "disposition" IS NOT NULL AND "outcome" IS NULL AND "outcomeObservationId" IS NULL) OR ("kind" = 'OUTCOME' AND "disposition" IS NULL AND "outcome" IS NOT NULL));

