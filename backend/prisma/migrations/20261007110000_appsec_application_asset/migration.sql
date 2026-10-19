CREATE TABLE "ApplicationAsset" (
  "tenantId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationAsset_pkey" PRIMARY KEY ("applicationId", "assetId")
);
CREATE INDEX "ApplicationAsset_tenantId_applicationId_idx" ON "ApplicationAsset"("tenantId", "applicationId");
CREATE INDEX "ApplicationAsset_tenantId_assetId_idx" ON "ApplicationAsset"("tenantId", "assetId");
ALTER TABLE "ApplicationAsset" ADD CONSTRAINT "ApplicationAsset_applicationId_tenantId_fkey"
FOREIGN KEY ("applicationId", "tenantId") REFERENCES "Application"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationAsset" ADD CONSTRAINT "ApplicationAsset_assetId_tenantId_fkey"
FOREIGN KEY ("assetId", "tenantId") REFERENCES "Asset"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
