CREATE TYPE "FeedbackFollowUpStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

ALTER TABLE "ReportFeedback" ADD CONSTRAINT "ReportFeedback_id_tenantId_reportId_key" UNIQUE ("id", "tenantId", "reportId");
ALTER TABLE "ReportFeedback" ADD CONSTRAINT "ReportFeedback_report_fkey" FOREIGN KEY ("reportId", "tenantId") REFERENCES "IntelligenceReport"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FeedbackFollowUp" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "feedbackId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "pirId" TEXT NOT NULL,
  "sirId" TEXT,
  "reference" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "newRequirementNeeded" BOOLEAN NOT NULL DEFAULT false,
  "priority" "PirPriority" NOT NULL DEFAULT 'MEDIUM',
  "assigneeId" TEXT,
  "dueDate" TIMESTAMP(3),
  "status" "FeedbackFollowUpStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionNote" TEXT,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeedbackFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeedbackFollowUp_feedbackId_key" ON "FeedbackFollowUp"("feedbackId");
CREATE UNIQUE INDEX "FeedbackFollowUp_feedbackId_tenantId_reportId_key" ON "FeedbackFollowUp"("feedbackId", "tenantId", "reportId");
CREATE UNIQUE INDEX "FeedbackFollowUp_tenantId_reference_key" ON "FeedbackFollowUp"("tenantId", "reference");
CREATE INDEX "FeedbackFollowUp_tenantId_status_updatedAt_idx" ON "FeedbackFollowUp"("tenantId", "status", "updatedAt");
CREATE INDEX "FeedbackFollowUp_tenantId_pirId_status_idx" ON "FeedbackFollowUp"("tenantId", "pirId", "status");
CREATE INDEX "FeedbackFollowUp_tenantId_sirId_status_idx" ON "FeedbackFollowUp"("tenantId", "sirId", "status");
CREATE INDEX "FeedbackFollowUp_tenantId_assigneeId_status_idx" ON "FeedbackFollowUp"("tenantId", "assigneeId", "status");

ALTER TABLE "FeedbackFollowUp" ADD CONSTRAINT "FeedbackFollowUp_feedback_fkey" FOREIGN KEY ("feedbackId", "tenantId", "reportId") REFERENCES "ReportFeedback"("id", "tenantId", "reportId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeedbackFollowUp" ADD CONSTRAINT "FeedbackFollowUp_report_fkey" FOREIGN KEY ("reportId", "tenantId", "pirId") REFERENCES "IntelligenceReport"("id", "tenantId", "pirId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeedbackFollowUp" ADD CONSTRAINT "FeedbackFollowUp_pir_fkey" FOREIGN KEY ("pirId", "tenantId") REFERENCES "Pir"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeedbackFollowUp" ADD CONSTRAINT "FeedbackFollowUp_sir_fkey" FOREIGN KEY ("sirId", "tenantId", "pirId") REFERENCES "Sir"("id", "tenantId", "pirId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeedbackFollowUp" ADD CONSTRAINT "FeedbackFollowUp_assignee_fkey" FOREIGN KEY ("assigneeId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeedbackFollowUp" ADD CONSTRAINT "FeedbackFollowUp_createdBy_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeedbackFollowUp" ADD CONSTRAINT "FeedbackFollowUp_updatedBy_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
