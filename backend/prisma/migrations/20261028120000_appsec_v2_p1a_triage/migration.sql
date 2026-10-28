CREATE TYPE "AppSecValidationState" AS ENUM ('PENDING', 'VALID', 'REJECTED');
CREATE TYPE "AppSecFindingPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

ALTER TABLE "AppSecFinding"
  ADD COLUMN "workflowVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lifecycleCycle" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "validationState" "AppSecValidationState",
  ADD COLUMN "priority" "AppSecFindingPriority",
  ADD COLUMN "priorityRationale" TEXT,
  ADD COLUMN "assigneeId" TEXT;

ALTER TABLE "AppSecFinding"
  ADD CONSTRAINT "AppSecFinding_assigneeId_tenantId_fkey"
  FOREIGN KEY ("assigneeId", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AppSecFinding_tenantId_workflowVersion_status_idx"
  ON "AppSecFinding"("tenantId", "workflowVersion", "status");
CREATE INDEX "AppSecFinding_tenantId_assigneeId_status_dueDate_idx"
  ON "AppSecFinding"("tenantId", "assigneeId", "status", "dueDate");

CREATE TABLE "AppSecFindingActionEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "cycle" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT,
  "before" JSONB,
  "after" JSONB,
  "revision" INTEGER NOT NULL,
  "requestKey" TEXT,
  "requestHash" TEXT,
  "responseSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppSecFindingActionEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppSecFindingActionEvent_tenantId_findingId_requestKey_key"
  ON "AppSecFindingActionEvent"("tenantId", "findingId", "requestKey");
CREATE INDEX "AppSecFindingActionEvent_tenantId_findingId_cycle_createdAt_id_idx"
  ON "AppSecFindingActionEvent"("tenantId", "findingId", "cycle", "createdAt", "id");
CREATE INDEX "AppSecFindingActionEvent_tenantId_actorId_createdAt_idx"
  ON "AppSecFindingActionEvent"("tenantId", "actorId", "createdAt");
ALTER TABLE "AppSecFindingActionEvent"
  ADD CONSTRAINT "AppSecFindingActionEvent_findingId_tenantId_fkey"
  FOREIGN KEY ("findingId", "tenantId") REFERENCES "AppSecFinding"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppSecFindingActionEvent"
  ADD CONSTRAINT "AppSecFindingActionEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
