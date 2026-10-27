-- CreateEnum
CREATE TYPE "CollectionMethod" AS ENUM ('MANUAL_RESEARCH', 'INTELLIGENCE_FEED', 'TELEGRAM_IOC', 'INDICATOR_ENRICHMENT', 'MITRE_ATTACK');

-- CreateEnum
CREATE TYPE "CollectionTaskStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CollectionResultKind" AS ENUM ('FINDINGS', 'NO_FINDINGS');

-- CreateTable
CREATE TABLE "CollectionTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sirId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "informationRequired" TEXT NOT NULL,
    "method" "CollectionMethod" NOT NULL,
    "sourceId" TEXT,
    "guidance" TEXT,
    "priority" "PirPriority" NOT NULL DEFAULT 'MEDIUM',
    "responsibleUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "CollectionTaskStatus" NOT NULL DEFAULT 'PLANNED',
    "resultKind" "CollectionResultKind",
    "resultSummary" TEXT,
    "informationGaps" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionTaskEvidence" (
    "taskId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sirId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionTaskEvidence_pkey" PRIMARY KEY ("taskId","evidenceId")
);

-- CreateIndex
CREATE INDEX "CollectionTask_tenantId_status_priority_dueDate_idx" ON "CollectionTask"("tenantId", "status", "priority", "dueDate");

-- CreateIndex
CREATE INDEX "CollectionTask_sirId_tenantId_status_idx" ON "CollectionTask"("sirId", "tenantId", "status");

-- CreateIndex
CREATE INDEX "CollectionTask_responsibleUserId_tenantId_idx" ON "CollectionTask"("responsibleUserId", "tenantId");

-- CreateIndex
CREATE INDEX "CollectionTask_sourceId_tenantId_idx" ON "CollectionTask"("sourceId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTask_tenantId_reference_key" ON "CollectionTask"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTask_id_tenantId_sirId_key" ON "CollectionTask"("id", "tenantId", "sirId");

-- CreateIndex
CREATE INDEX "CollectionTaskEvidence_evidenceId_tenantId_sirId_idx" ON "CollectionTaskEvidence"("evidenceId", "tenantId", "sirId");

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_sirId_tenantId_fkey" FOREIGN KEY ("sirId", "tenantId") REFERENCES "Sir"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_sourceId_tenantId_fkey" FOREIGN KEY ("sourceId", "tenantId") REFERENCES "IntelligenceSource"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_responsibleUserId_tenantId_fkey" FOREIGN KEY ("responsibleUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTaskEvidence" ADD CONSTRAINT "CollectionTaskEvidence_taskId_tenantId_sirId_fkey" FOREIGN KEY ("taskId", "tenantId", "sirId") REFERENCES "CollectionTask"("id", "tenantId", "sirId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionTaskEvidence" ADD CONSTRAINT "CollectionTaskEvidence_evidenceId_tenantId_sirId_fkey" FOREIGN KEY ("evidenceId", "tenantId", "sirId") REFERENCES "SirEvidence"("id", "tenantId", "sirId") ON DELETE RESTRICT ON UPDATE CASCADE;
