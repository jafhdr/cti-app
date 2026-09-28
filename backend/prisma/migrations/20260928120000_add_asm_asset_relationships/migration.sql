CREATE TYPE "AssetRelationshipType" AS ENUM ('DISCOVERED_SUBDOMAIN', 'RESOLVES_TO');
CREATE TYPE "AssetDiscoverySource" AS ENUM ('CLOUDFLARE_DOH', 'CRT_SH', 'DNS_RESOLUTION');
CREATE TABLE "AssetRelationship" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "rootAssetId" TEXT NOT NULL,
  "sourceAssetId" TEXT NOT NULL,
  "targetAssetId" TEXT NOT NULL,
  "type" "AssetRelationshipType" NOT NULL,
  "source" "AssetDiscoverySource" NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetRelationship_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssetRelationship_tenantId_sourceAssetId_targetAssetId_type_source_key" ON "AssetRelationship"("tenantId", "sourceAssetId", "targetAssetId", "type", "source");
CREATE INDEX "AssetRelationship_tenantId_rootAssetId_idx" ON "AssetRelationship"("tenantId", "rootAssetId");
CREATE INDEX "AssetRelationship_tenantId_sourceAssetId_idx" ON "AssetRelationship"("tenantId", "sourceAssetId");
CREATE INDEX "AssetRelationship_tenantId_targetAssetId_idx" ON "AssetRelationship"("tenantId", "targetAssetId");
ALTER TABLE "AssetRelationship" ADD CONSTRAINT "AssetRelationship_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetRelationship" ADD CONSTRAINT "AssetRelationship_rootAssetId_tenantId_fkey" FOREIGN KEY ("rootAssetId", "tenantId") REFERENCES "Asset"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetRelationship" ADD CONSTRAINT "AssetRelationship_sourceAssetId_tenantId_fkey" FOREIGN KEY ("sourceAssetId", "tenantId") REFERENCES "Asset"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetRelationship" ADD CONSTRAINT "AssetRelationship_targetAssetId_tenantId_fkey" FOREIGN KEY ("targetAssetId", "tenantId") REFERENCES "Asset"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
