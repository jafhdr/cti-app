-- CreateTable
CREATE TABLE "Sir" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pirId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "description" TEXT,
    "intelligenceContext" TEXT,
    "knowledgeGaps" TEXT,
    "collectionGuidance" TEXT,
    "priority" "PirPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "PirStatus" NOT NULL DEFAULT 'OPEN',
    "responsibleUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "expectedAnswerCriteria" TEXT,
    "analystAnswer" TEXT,
    "evidenceNotes" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sir_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sir_pirId_tenantId_status_idx" ON "Sir"("pirId", "tenantId", "status");

-- CreateIndex
CREATE INDEX "Sir_tenantId_status_priority_idx" ON "Sir"("tenantId", "status", "priority");

-- CreateIndex
CREATE INDEX "Sir_responsibleUserId_tenantId_idx" ON "Sir"("responsibleUserId", "tenantId");

-- CreateIndex
CREATE INDEX "Sir_tenantId_dueDate_idx" ON "Sir"("tenantId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Sir_tenantId_reference_key" ON "Sir"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Pir_id_tenantId_key" ON "Pir"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "Sir" ADD CONSTRAINT "Sir_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sir" ADD CONSTRAINT "Sir_pirId_tenantId_fkey" FOREIGN KEY ("pirId", "tenantId") REFERENCES "Pir"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sir" ADD CONSTRAINT "Sir_responsibleUserId_tenantId_fkey" FOREIGN KEY ("responsibleUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sir" ADD CONSTRAINT "Sir_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sir" ADD CONSTRAINT "Sir_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

