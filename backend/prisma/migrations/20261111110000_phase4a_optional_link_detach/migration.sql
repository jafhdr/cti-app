-- DropForeignKey
ALTER TABLE "MonitoringFinding" DROP CONSTRAINT "MonitoringFinding_alertId_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "MonitoringFinding" DROP CONSTRAINT "MonitoringFinding_caseId_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "MonitoringWatchlist" DROP CONSTRAINT "MonitoringWatchlist_assetId_tenantId_fkey";

-- AlterTable
ALTER TABLE "MonitoringFinding" ADD COLUMN     "alertTenantId" TEXT,
ADD COLUMN     "caseTenantId" TEXT;

-- AlterTable
ALTER TABLE "MonitoringWatchlist" ADD COLUMN     "assetTenantId" TEXT;

UPDATE "MonitoringWatchlist" SET "assetTenantId" = "tenantId" WHERE "assetId" IS NOT NULL;
UPDATE "MonitoringFinding" SET "alertTenantId" = "tenantId" WHERE "alertId" IS NOT NULL;
UPDATE "MonitoringFinding" SET "caseTenantId" = "tenantId" WHERE "caseId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "MonitoringWatchlist" ADD CONSTRAINT "MonitoringWatchlist_assetId_assetTenantId_fkey" FOREIGN KEY ("assetId", "assetTenantId") REFERENCES "Asset"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringFinding" ADD CONSTRAINT "MonitoringFinding_alertId_alertTenantId_fkey" FOREIGN KEY ("alertId", "alertTenantId") REFERENCES "Alert"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringFinding" ADD CONSTRAINT "MonitoringFinding_caseId_caseTenantId_fkey" FOREIGN KEY ("caseId", "caseTenantId") REFERENCES "Case"("id", "tenantId") ON DELETE SET NULL ON UPDATE CASCADE;

