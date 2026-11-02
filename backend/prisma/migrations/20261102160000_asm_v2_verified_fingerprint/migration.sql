CREATE UNIQUE INDEX "AsmDiscoveryRun_id_tenantId_key" ON "AsmDiscoveryRun"("id", "tenantId");

CREATE TABLE "AsmServiceFingerprintObservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "discoveryRunId" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "bannerHash" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AsmServiceFingerprintObservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AsmServiceFingerprintObservation_assetId_tenantId_fkey" FOREIGN KEY ("assetId", "tenantId") REFERENCES "Asset"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AsmServiceFingerprintObservation_serviceId_tenantId_fkey" FOREIGN KEY ("serviceId", "tenantId") REFERENCES "AssetPortService"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AsmServiceFingerprintObservation_discoveryRunId_tenantId_fkey" FOREIGN KEY ("discoveryRunId", "tenantId") REFERENCES "AsmDiscoveryRun"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AsmServiceFingerprintObservation_discoveryRunId_serviceId_key"
  ON "AsmServiceFingerprintObservation"("discoveryRunId", "serviceId");
CREATE INDEX "AsmServiceFingerprintObservation_tenantId_assetId_discoveryRunId_idx"
  ON "AsmServiceFingerprintObservation"("tenantId", "assetId", "discoveryRunId");
