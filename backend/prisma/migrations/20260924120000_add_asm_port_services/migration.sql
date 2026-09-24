CREATE TYPE "NetworkProtocol" AS ENUM ('TCP', 'UDP');
CREATE TYPE "PortDiscoveryStatus" AS ENUM ('OPEN', 'CLOSED', 'FILTERED', 'UNKNOWN');

CREATE UNIQUE INDEX "Asset_id_tenantId_key" ON "Asset"("id", "tenantId");

CREATE TABLE "AssetPortService" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "protocol" "NetworkProtocol" NOT NULL,
    "service" TEXT,
    "status" "PortDiscoveryStatus" NOT NULL DEFAULT 'UNKNOWN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssetPortService_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetPortService_tenantId_assetId_protocol_port_key"
ON "AssetPortService"("tenantId", "assetId", "protocol", "port");
CREATE INDEX "AssetPortService_tenantId_assetId_status_idx"
ON "AssetPortService"("tenantId", "assetId", "status");
CREATE INDEX "AssetPortService_tenantId_protocol_port_idx"
ON "AssetPortService"("tenantId", "protocol", "port");

ALTER TABLE "AssetPortService" ADD CONSTRAINT "AssetPortService_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetPortService" ADD CONSTRAINT "AssetPortService_assetId_tenantId_fkey"
FOREIGN KEY ("assetId", "tenantId") REFERENCES "Asset"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
