-- CreateTable
CREATE TABLE "SirEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sirId" TEXT NOT NULL,
    "indicatorId" TEXT,
    "threatActorId" TEXT,
    "campaignId" TEXT,
    "relevanceNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SirEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SirEvidence_tenantId_sirId_idx" ON "SirEvidence"("tenantId", "sirId");

-- CreateIndex
CREATE UNIQUE INDEX "SirEvidence_sirId_indicatorId_key" ON "SirEvidence"("sirId", "indicatorId");

-- CreateIndex
CREATE UNIQUE INDEX "SirEvidence_sirId_threatActorId_key" ON "SirEvidence"("sirId", "threatActorId");

-- CreateIndex
CREATE UNIQUE INDEX "SirEvidence_sirId_campaignId_key" ON "SirEvidence"("sirId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Sir_id_tenantId_key" ON "Sir"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "SirEvidence" ADD CONSTRAINT "SirEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirEvidence" ADD CONSTRAINT "SirEvidence_sirId_tenantId_fkey" FOREIGN KEY ("sirId", "tenantId") REFERENCES "Sir"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirEvidence" ADD CONSTRAINT "SirEvidence_indicatorId_tenantId_fkey" FOREIGN KEY ("indicatorId", "tenantId") REFERENCES "Indicator"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirEvidence" ADD CONSTRAINT "SirEvidence_threatActorId_tenantId_fkey" FOREIGN KEY ("threatActorId", "tenantId") REFERENCES "ThreatActor"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirEvidence" ADD CONSTRAINT "SirEvidence_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirEvidence" ADD CONSTRAINT "SirEvidence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A link must name exactly one supported, tenant-scoped source.
ALTER TABLE "SirEvidence" ADD CONSTRAINT "SirEvidence_exactly_one_source_check"
CHECK (num_nonnulls("indicatorId", "threatActorId", "campaignId") = 1);
