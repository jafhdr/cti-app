ALTER TABLE "User"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "deactivatedAt" TIMESTAMP(3);

ALTER TABLE "AuditLog"
ADD COLUMN "tenantId" TEXT;

UPDATE "AuditLog" AS audit
SET "tenantId" = users."tenantId"
FROM "User" AS users
WHERE audit."userId" = users."id";

ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
