CREATE TYPE "IndicatorType" AS ENUM ('IP_ADDRESS', 'DOMAIN', 'URL', 'FILE_HASH', 'EMAIL');
CREATE TYPE "IndicatorSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "IndicatorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');

CREATE TABLE "Indicator" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "type" "IndicatorType" NOT NULL,
  "severity" "IndicatorSeverity" NOT NULL DEFAULT 'MEDIUM',
  "confidence" INTEGER NOT NULL DEFAULT 50,
  "status" "IndicatorStatus" NOT NULL DEFAULT 'ACTIVE',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source" TEXT,
  "description" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Indicator_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Indicator_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Indicator_tenantId_type_value_key" ON "Indicator"("tenantId", "type", "value");
CREATE INDEX "Indicator_tenantId_status_severity_idx" ON "Indicator"("tenantId", "status", "severity");
CREATE INDEX "Indicator_tenantId_createdAt_idx" ON "Indicator"("tenantId", "createdAt");
