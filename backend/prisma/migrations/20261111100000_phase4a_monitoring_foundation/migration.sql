-- CreateEnum
CREATE TYPE "MonitoringWatchKind" AS ENUM ('DOMAIN', 'BRAND', 'IDENTITY_HASH');

-- CreateEnum
CREATE TYPE "MonitoringObservationKind" AS ENUM ('CREDENTIAL_EXPOSURE', 'CORPORATE_DATA_EXPOSURE', 'BRAND_IMPERSONATION', 'PHISHING_DOMAIN');

-- CreateEnum
CREATE TYPE "MonitoringFindingStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'CONFIRMED', 'FALSE_POSITIVE', 'RESOLVED');

-- CreateTable
CREATE TABLE "MonitoringWatchlist" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "MonitoringWatchKind" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "assetId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringWatchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "catalogSourceId" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "authorized" BOOLEAN NOT NULL DEFAULT false,
    "qaOnly" BOOLEAN NOT NULL DEFAULT true,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringObservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "providerEventKey" TEXT NOT NULL,
    "kind" "MonitoringObservationKind" NOT NULL,
    "domain" TEXT,
    "identityHash" TEXT,
    "metadataCategory" TEXT NOT NULL,
    "evidenceRef" TEXT NOT NULL,
    "evidenceDigest" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "tlp" "TlpLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringMatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "severity" "IndicatorSeverity" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringFinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "status" "MonitoringFindingStatus" NOT NULL DEFAULT 'NEW',
    "alertId" TEXT,
    "caseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" "MonitoringFindingStatus" NOT NULL,
    "toStatus" "MonitoringFindingStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitoringWatchlist_tenantId_active_expiresAt_idx" ON "MonitoringWatchlist"("tenantId", "active", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringWatchlist_tenantId_kind_value_key" ON "MonitoringWatchlist"("tenantId", "kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringWatchlist_id_tenantId_key" ON "MonitoringWatchlist"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringSource_tenantId_providerKey_key" ON "MonitoringSource"("tenantId", "providerKey");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringSource_id_tenantId_key" ON "MonitoringSource"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MonitoringObservation_tenantId_kind_observedAt_idx" ON "MonitoringObservation"("tenantId", "kind", "observedAt");

-- CreateIndex
CREATE INDEX "MonitoringObservation_expiresAt_idx" ON "MonitoringObservation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringObservation_tenantId_sourceId_providerEventKey_key" ON "MonitoringObservation"("tenantId", "sourceId", "providerEventKey");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringObservation_id_tenantId_key" ON "MonitoringObservation"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MonitoringMatch_tenantId_confidence_idx" ON "MonitoringMatch"("tenantId", "confidence");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringMatch_observationId_watchlistId_key" ON "MonitoringMatch"("observationId", "watchlistId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringMatch_id_tenantId_key" ON "MonitoringMatch"("id", "tenantId");

-- CreateIndex
CREATE INDEX "MonitoringFinding_tenantId_status_createdAt_idx" ON "MonitoringFinding"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringFinding_id_tenantId_key" ON "MonitoringFinding"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringFinding_matchId_tenantId_key" ON "MonitoringFinding"("matchId", "tenantId");

-- CreateIndex
CREATE INDEX "MonitoringReview_tenantId_findingId_createdAt_idx" ON "MonitoringReview"("tenantId", "findingId", "createdAt");

-- AddForeignKey
ALTER TABLE "MonitoringWatchlist" ADD CONSTRAINT "MonitoringWatchlist_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringWatchlist" ADD CONSTRAINT "MonitoringWatchlist_assetId_tenantId_fkey" FOREIGN KEY ("assetId", "tenantId") REFERENCES "Asset"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringWatchlist" ADD CONSTRAINT "MonitoringWatchlist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringSource" ADD CONSTRAINT "MonitoringSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringSource" ADD CONSTRAINT "MonitoringSource_catalogSourceId_tenantId_fkey" FOREIGN KEY ("catalogSourceId", "tenantId") REFERENCES "IntelligenceSource"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringObservation" ADD CONSTRAINT "MonitoringObservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringObservation" ADD CONSTRAINT "MonitoringObservation_sourceId_tenantId_fkey" FOREIGN KEY ("sourceId", "tenantId") REFERENCES "MonitoringSource"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringMatch" ADD CONSTRAINT "MonitoringMatch_observationId_tenantId_fkey" FOREIGN KEY ("observationId", "tenantId") REFERENCES "MonitoringObservation"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringMatch" ADD CONSTRAINT "MonitoringMatch_watchlistId_tenantId_fkey" FOREIGN KEY ("watchlistId", "tenantId") REFERENCES "MonitoringWatchlist"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringFinding" ADD CONSTRAINT "MonitoringFinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringFinding" ADD CONSTRAINT "MonitoringFinding_matchId_tenantId_fkey" FOREIGN KEY ("matchId", "tenantId") REFERENCES "MonitoringMatch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringFinding" ADD CONSTRAINT "MonitoringFinding_alertId_tenantId_fkey" FOREIGN KEY ("alertId", "tenantId") REFERENCES "Alert"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringFinding" ADD CONSTRAINT "MonitoringFinding_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringReview" ADD CONSTRAINT "MonitoringReview_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringReview" ADD CONSTRAINT "MonitoringReview_findingId_tenantId_fkey" FOREIGN KEY ("findingId", "tenantId") REFERENCES "MonitoringFinding"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringReview" ADD CONSTRAINT "MonitoringReview_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

