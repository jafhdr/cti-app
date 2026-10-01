CREATE TYPE "AssetFindingSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "AssetFindingStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TABLE "AssetFinding" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "severity" "AssetFindingSeverity" NOT NULL,
  "status" "AssetFindingStatus" NOT NULL DEFAULT 'OPEN',
  "source" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "evidence" JSONB,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetFinding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssetFinding_tenantId_assetId_source_sourceKey_key" ON "AssetFinding"("tenantId", "assetId", "source", "sourceKey");
CREATE INDEX "AssetFinding_tenantId_assetId_status_idx" ON "AssetFinding"("tenantId", "assetId", "status");
ALTER TABLE "AssetFinding" ADD CONSTRAINT "AssetFinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetFinding" ADD CONSTRAINT "AssetFinding_assetId_tenantId_fkey" FOREIGN KEY ("assetId", "tenantId") REFERENCES "Asset"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
