-- CreateEnum
CREATE TYPE "PirPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PirStatus" AS ENUM ('OPEN', 'IN_COLLECTION', 'IN_ANALYSIS', 'ANSWERED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Pir" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "description" TEXT,
    "strategicContext" TEXT,
    "stakeholderId" TEXT NOT NULL,
    "priority" "PirPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "PirStatus" NOT NULL DEFAULT 'OPEN',
    "responsibleUserId" TEXT,
    "timeHorizon" TEXT,
    "dueDate" TIMESTAMP(3),
    "expectedOutcome" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pir_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pir_tenantId_status_priority_idx" ON "Pir"("tenantId", "status", "priority");

-- CreateIndex
CREATE INDEX "Pir_stakeholderId_tenantId_idx" ON "Pir"("stakeholderId", "tenantId");

-- CreateIndex
CREATE INDEX "Pir_responsibleUserId_tenantId_idx" ON "Pir"("responsibleUserId", "tenantId");

-- CreateIndex
CREATE INDEX "Pir_tenantId_dueDate_idx" ON "Pir"("tenantId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Pir_tenantId_reference_key" ON "Pir"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Stakeholder_id_tenantId_key" ON "Stakeholder"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "Pir" ADD CONSTRAINT "Pir_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pir" ADD CONSTRAINT "Pir_stakeholderId_tenantId_fkey" FOREIGN KEY ("stakeholderId", "tenantId") REFERENCES "Stakeholder"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pir" ADD CONSTRAINT "Pir_responsibleUserId_tenantId_fkey" FOREIGN KEY ("responsibleUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pir" ADD CONSTRAINT "Pir_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pir" ADD CONSTRAINT "Pir_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

