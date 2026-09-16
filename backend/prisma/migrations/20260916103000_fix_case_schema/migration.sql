CREATE TYPE "CasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

DROP INDEX "Case_tenantId_status_severity_idx";

ALTER TABLE "Case" RENAME COLUMN "ownerId" TO "assigneeId";

ALTER TABLE "Case"
  ADD COLUMN "priority" "CasePriority" NOT NULL DEFAULT 'MEDIUM',
  ALTER COLUMN "caseNumber" DROP DEFAULT;

CREATE INDEX "Case_tenantId_status_priority_severity_idx"
  ON "Case"("tenantId", "status", "priority", "severity");

CREATE INDEX "Case_tenantId_createdAt_idx"
  ON "Case"("tenantId", "createdAt");

ALTER TABLE "Case"
  ADD CONSTRAINT "Case_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Case_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
