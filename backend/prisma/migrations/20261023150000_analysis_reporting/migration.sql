-- CreateEnum
CREATE TYPE "AnalysisConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntelligenceReportStatus" ADD VALUE 'IN_REVIEW';
ALTER TYPE "IntelligenceReportStatus" ADD VALUE 'FINAL';

-- AlterTable
ALTER TABLE "IntelligenceReport" ADD COLUMN     "authorId" TEXT,
ADD COLUMN     "confidence" "AnalysisConfidence",
ADD COLUMN     "finalSnapshot" JSONB,
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "informationGaps" TEXT,
ADD COLUMN     "keyFindings" TEXT,
ADD COLUMN     "pirId" TEXT,
ADD COLUMN     "recommendedActions" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "reviewerId" TEXT,
ADD COLUMN     "stakeholderId" TEXT;

-- CreateTable
CREATE TABLE "IntelligenceReportSir" (
    "reportId" TEXT NOT NULL,
    "sirId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pirId" TEXT NOT NULL,

    CONSTRAINT "IntelligenceReportSir_pkey" PRIMARY KEY ("reportId","sirId")
);

-- CreateTable
CREATE TABLE "IntelligenceReportEvidence" (
    "reportId" TEXT NOT NULL,
    "sirId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "IntelligenceReportEvidence_pkey" PRIMARY KEY ("reportId","evidenceId")
);

-- CreateIndex
CREATE INDEX "IntelligenceReportSir_tenantId_sirId_idx" ON "IntelligenceReportSir"("tenantId", "sirId");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceReportSir_reportId_sirId_tenantId_key" ON "IntelligenceReportSir"("reportId", "sirId", "tenantId");

-- CreateIndex
CREATE INDEX "IntelligenceReportEvidence_tenantId_evidenceId_idx" ON "IntelligenceReportEvidence"("tenantId", "evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceReport_tenantId_reference_key" ON "IntelligenceReport"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceReport_id_tenantId_pirId_key" ON "IntelligenceReport"("id", "tenantId", "pirId");

-- CreateIndex
CREATE UNIQUE INDEX "Pir_id_tenantId_stakeholderId_key" ON "Pir"("id", "tenantId", "stakeholderId");

-- CreateIndex
CREATE UNIQUE INDEX "Sir_id_tenantId_pirId_key" ON "Sir"("id", "tenantId", "pirId");

-- CreateIndex
CREATE UNIQUE INDEX "SirEvidence_id_tenantId_sirId_key" ON "SirEvidence"("id", "tenantId", "sirId");

-- AddForeignKey
ALTER TABLE "IntelligenceReport" ADD CONSTRAINT "IntelligenceReport_pirId_tenantId_stakeholderId_fkey" FOREIGN KEY ("pirId", "tenantId", "stakeholderId") REFERENCES "Pir"("id", "tenantId", "stakeholderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceReport" ADD CONSTRAINT "IntelligenceReport_stakeholderId_tenantId_fkey" FOREIGN KEY ("stakeholderId", "tenantId") REFERENCES "Stakeholder"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceReport" ADD CONSTRAINT "IntelligenceReport_authorId_tenantId_fkey" FOREIGN KEY ("authorId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceReport" ADD CONSTRAINT "IntelligenceReport_reviewerId_tenantId_fkey" FOREIGN KEY ("reviewerId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceReportSir" ADD CONSTRAINT "IntelligenceReportSir_reportId_tenantId_pirId_fkey" FOREIGN KEY ("reportId", "tenantId", "pirId") REFERENCES "IntelligenceReport"("id", "tenantId", "pirId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceReportSir" ADD CONSTRAINT "IntelligenceReportSir_sirId_tenantId_pirId_fkey" FOREIGN KEY ("sirId", "tenantId", "pirId") REFERENCES "Sir"("id", "tenantId", "pirId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceReportEvidence" ADD CONSTRAINT "IntelligenceReportEvidence_reportId_tenantId_fkey" FOREIGN KEY ("reportId", "tenantId") REFERENCES "IntelligenceReport"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceReportEvidence" ADD CONSTRAINT "IntelligenceReportEvidence_reportId_sirId_tenantId_fkey" FOREIGN KEY ("reportId", "sirId", "tenantId") REFERENCES "IntelligenceReportSir"("reportId", "sirId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceReportEvidence" ADD CONSTRAINT "IntelligenceReportEvidence_evidenceId_tenantId_sirId_fkey" FOREIGN KEY ("evidenceId", "tenantId", "sirId") REFERENCES "SirEvidence"("id", "tenantId", "sirId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Analysis rows must have a complete tenant-linked identity; legacy reports remain valid.
ALTER TABLE "IntelligenceReport" ADD CONSTRAINT "analysis_report_identity_check" CHECK (
  ("pirId" IS NULL AND "stakeholderId" IS NULL AND "reference" IS NULL AND "authorId" IS NULL)
  OR ("pirId" IS NOT NULL AND "stakeholderId" IS NOT NULL AND "reference" IS NOT NULL AND "authorId" IS NOT NULL)
);
