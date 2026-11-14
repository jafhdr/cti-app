CREATE TABLE "SandboxConnectorJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SandboxConnectorJob_operation_check" CHECK ("operation" IN ('BLOCK_DOMAIN','UNBLOCK_DOMAIN')),
  CONSTRAINT "SandboxConnectorJob_status_check" CHECK ("status" IN ('QUEUED','CLAIMED','ACKNOWLEDGED','VERIFYING','SUCCEEDED','FAILED','ABORTED')),
  CONSTRAINT "SandboxConnectorJob_attempts_check" CHECK ("attempts" BETWEEN 0 AND 3)
);
CREATE UNIQUE INDEX "SandboxConnectorJob_requestId_key" ON "SandboxConnectorJob"("requestId");
CREATE UNIQUE INDEX "SandboxConnectorJob_runId_operation_key" ON "SandboxConnectorJob"("runId", "operation");
CREATE UNIQUE INDEX "SandboxConnectorJob_id_tenantId_key" ON "SandboxConnectorJob"("id", "tenantId");
CREATE INDEX "SandboxConnectorJob_status_nextAttemptAt_idx" ON "SandboxConnectorJob"("status", "nextAttemptAt");
CREATE INDEX "SandboxConnectorJob_tenantId_runId_idx" ON "SandboxConnectorJob"("tenantId", "runId");
ALTER TABLE "SandboxConnectorJob" ADD CONSTRAINT "SandboxConnectorJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SandboxConnectorJob" ADD CONSTRAINT "SandboxConnectorJob_runId_tenantId_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "PlaybookRun"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SandboxConnectorEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SandboxConnectorEvent_tenantId_runId_createdAt_idx" ON "SandboxConnectorEvent"("tenantId", "runId", "createdAt");
ALTER TABLE "SandboxConnectorEvent" ADD CONSTRAINT "SandboxConnectorEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SandboxConnectorEvent" ADD CONSTRAINT "SandboxConnectorEvent_runId_tenantId_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "PlaybookRun"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SandboxConnectorEvent" ADD CONSTRAINT "SandboxConnectorEvent_jobId_tenantId_fkey" FOREIGN KEY ("jobId", "tenantId") REFERENCES "SandboxConnectorJob"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "SandboxConnectorEvent_immutable" BEFORE UPDATE OR DELETE ON "SandboxConnectorEvent" FOR EACH ROW EXECUTE FUNCTION soar_immutable_record();

ALTER TABLE "PlaybookRun" DROP CONSTRAINT "PlaybookRun_status_check";
ALTER TABLE "PlaybookRun" ADD CONSTRAINT "PlaybookRun_status_check" CHECK ("status" IN ('PENDING_CONFIRMATION','PENDING_APPROVAL','APPROVED','EXECUTING','VERIFYING','VERIFIED','FAILED','REJECTED','EXPIRED','ROLLBACK_QUEUED','ROLLING_BACK','ROLLED_BACK','ROLLBACK_FAILED','ABORTED'));
