CREATE TABLE "CorrelationConnectorCredential" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "secretHash" CHAR(64) NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'telemetry:write',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "rotatedFromId" TEXT,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "CorrelationConnectorCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CorrelationConnectorCredential_scope_check" CHECK ("scope" = 'telemetry:write'),
  CONSTRAINT "CorrelationConnectorCredential_expiry_check" CHECK ("expiresAt" > "createdAt")
);
CREATE INDEX "CorrelationConnectorCredential_tenantId_revokedAt_expiresAt_idx"
  ON "CorrelationConnectorCredential"("tenantId", "revokedAt", "expiresAt");
