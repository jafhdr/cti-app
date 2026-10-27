-- CreateEnum
CREATE TYPE "ReportDistributionStatus" AS ENUM ('AVAILABLE', 'VIEWED');

-- CreateEnum
CREATE TYPE "ReportRequirementAnswer" AS ENUM ('YES', 'PARTIALLY', 'NO');

-- CreateTable
CREATE TABLE "ReportDissemination" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "stakeholderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "status" "ReportDistributionStatus" NOT NULL DEFAULT 'AVAILABLE',
    "message" TEXT,
    "disseminatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3),

    CONSTRAINT "ReportDissemination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportFeedback" (
    "id" TEXT NOT NULL,
    "disseminationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "relevance" INTEGER NOT NULL,
    "answeredRequirement" "ReportRequirementAnswer" NOT NULL,
    "actionability" INTEGER NOT NULL,
    "comments" TEXT,
    "furtherIntelligenceRequest" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportDissemination_tenantId_recipientId_disseminatedAt_idx" ON "ReportDissemination"("tenantId", "recipientId", "disseminatedAt");

-- CreateIndex
CREATE INDEX "ReportDissemination_tenantId_reportId_disseminatedAt_idx" ON "ReportDissemination"("tenantId", "reportId", "disseminatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportDissemination_reportId_recipientId_key" ON "ReportDissemination"("reportId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportDissemination_id_tenantId_recipientId_reportId_key" ON "ReportDissemination"("id", "tenantId", "recipientId", "reportId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportFeedback_disseminationId_key" ON "ReportFeedback"("disseminationId");

-- CreateIndex
CREATE INDEX "ReportFeedback_tenantId_reportId_submittedAt_idx" ON "ReportFeedback"("tenantId", "reportId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportFeedback_disseminationId_tenantId_recipientId_reportI_key" ON "ReportFeedback"("disseminationId", "tenantId", "recipientId", "reportId");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceReport_id_tenantId_stakeholderId_key" ON "IntelligenceReport"("id", "tenantId", "stakeholderId");

-- AddForeignKey
ALTER TABLE "ReportDissemination" ADD CONSTRAINT "ReportDissemination_reportId_tenantId_stakeholderId_fkey" FOREIGN KEY ("reportId", "tenantId", "stakeholderId") REFERENCES "IntelligenceReport"("id", "tenantId", "stakeholderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDissemination" ADD CONSTRAINT "ReportDissemination_stakeholderId_tenantId_fkey" FOREIGN KEY ("stakeholderId", "tenantId") REFERENCES "Stakeholder"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDissemination" ADD CONSTRAINT "ReportDissemination_recipientId_tenantId_fkey" FOREIGN KEY ("recipientId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDissemination" ADD CONSTRAINT "ReportDissemination_senderId_tenantId_fkey" FOREIGN KEY ("senderId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportFeedback" ADD CONSTRAINT "ReportFeedback_disseminationId_tenantId_recipientId_report_fkey" FOREIGN KEY ("disseminationId", "tenantId", "recipientId", "reportId") REFERENCES "ReportDissemination"("id", "tenantId", "recipientId", "reportId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guard the persisted rating scale and observable view state.
ALTER TABLE "ReportFeedback" ADD CONSTRAINT "ReportFeedback_rating_range_check" CHECK ("relevance" BETWEEN 1 AND 5 AND "actionability" BETWEEN 1 AND 5);
ALTER TABLE "ReportDissemination" ADD CONSTRAINT "ReportDissemination_view_state_check" CHECK (("status" = 'AVAILABLE' AND "viewedAt" IS NULL) OR ("status" = 'VIEWED' AND "viewedAt" IS NOT NULL));
