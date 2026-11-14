ALTER TABLE "MonitoringSource" DROP CONSTRAINT "MonitoringSource_catalogSourceId_tenantId_fkey";

ALTER TABLE "MonitoringSource"
  ADD COLUMN "catalogName" TEXT,
  ADD COLUMN "catalogTenantId" TEXT,
  ADD COLUMN "catalogTlp" "TlpLevel";

UPDATE "MonitoringSource" AS monitoring
SET "catalogName" = catalog."name",
    "catalogTenantId" = monitoring."tenantId",
    "catalogTlp" = catalog."tlp"
FROM "IntelligenceSource" AS catalog
WHERE catalog."id" = monitoring."catalogSourceId"
  AND catalog."tenantId" = monitoring."tenantId";

ALTER TABLE "MonitoringSource"
  ALTER COLUMN "catalogName" SET NOT NULL,
  ALTER COLUMN "catalogTlp" SET NOT NULL,
  ALTER COLUMN "catalogSourceId" DROP NOT NULL;

ALTER TABLE "MonitoringSource" ADD CONSTRAINT "MonitoringSource_catalogSourceId_catalogTenantId_fkey"
  FOREIGN KEY ("catalogSourceId", "catalogTenantId") REFERENCES "IntelligenceSource"("id", "tenantId")
  ON DELETE SET NULL ON UPDATE CASCADE;