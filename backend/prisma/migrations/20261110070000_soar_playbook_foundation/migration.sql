CREATE TABLE "PlaybookDefinition" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL, "title" TEXT NOT NULL, "actionKind" TEXT NOT NULL,
  "policy" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaybookDefinition_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "PlaybookDefinition_tenantId_key_version_key" ON "PlaybookDefinition"("tenantId", "key", "version");
CREATE UNIQUE INDEX "PlaybookDefinition_id_tenantId_key" ON "PlaybookDefinition"("id", "tenantId");
ALTER TABLE "PlaybookDefinition" ADD CONSTRAINT "PlaybookDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PlaybookRun" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "definitionId" TEXT NOT NULL,
  "alertId" TEXT NOT NULL, "caseId" TEXT, "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION', "domain" TEXT NOT NULL,
  "tlp" "TlpLevel" NOT NULL, "triggeredById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaybookRun_status_check" CHECK ("status" IN ('PENDING_CONFIRMATION','PENDING_APPROVAL','APPROVED','EXECUTING','VERIFYING','VERIFIED','FAILED','REJECTED','EXPIRED'))
);
CREATE UNIQUE INDEX "PlaybookRun_tenantId_idempotencyKey_key" ON "PlaybookRun"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "PlaybookRun_id_tenantId_key" ON "PlaybookRun"("id", "tenantId");
CREATE INDEX "PlaybookRun_tenantId_createdAt_idx" ON "PlaybookRun"("tenantId", "createdAt");
CREATE INDEX "PlaybookRun_tenantId_alertId_idx" ON "PlaybookRun"("tenantId", "alertId");
ALTER TABLE "PlaybookRun" ADD CONSTRAINT "PlaybookRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaybookRun" ADD CONSTRAINT "PlaybookRun_definitionId_tenantId_fkey" FOREIGN KEY ("definitionId", "tenantId") REFERENCES "PlaybookDefinition"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaybookRun" ADD CONSTRAINT "PlaybookRun_alertId_tenantId_fkey" FOREIGN KEY ("alertId", "tenantId") REFERENCES "Alert"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaybookRun" ADD CONSTRAINT "PlaybookRun_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaybookRun" ADD CONSTRAINT "PlaybookRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PlaybookStep" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "runId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL, "actionKind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0, "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "failureCode" TEXT,
  CONSTRAINT "PlaybookStep_ordinal_check" CHECK ("ordinal" > 0),
  CONSTRAINT "PlaybookStep_attemptCount_check" CHECK ("attemptCount" BETWEEN 0 AND 2),
  CONSTRAINT "PlaybookStep_status_check" CHECK ("status" IN ('PENDING','EXECUTING','VERIFYING','VERIFIED','FAILED'))
);
CREATE UNIQUE INDEX "PlaybookStep_runId_ordinal_key" ON "PlaybookStep"("runId", "ordinal");
CREATE UNIQUE INDEX "PlaybookStep_id_tenantId_key" ON "PlaybookStep"("id", "tenantId");
ALTER TABLE "PlaybookStep" ADD CONSTRAINT "PlaybookStep_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaybookStep" ADD CONSTRAINT "PlaybookStep_runId_tenantId_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "PlaybookRun"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PlaybookDecision" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "runId" TEXT NOT NULL,
  "kind" TEXT NOT NULL, "reason" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaybookDecision_kind_check" CHECK ("kind" IN ('CONFIRM','APPROVE','REJECT'))
);
CREATE INDEX "PlaybookDecision_tenantId_runId_createdAt_idx" ON "PlaybookDecision"("tenantId", "runId", "createdAt");
ALTER TABLE "PlaybookDecision" ADD CONSTRAINT "PlaybookDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaybookDecision" ADD CONSTRAINT "PlaybookDecision_runId_tenantId_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "PlaybookRun"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaybookDecision" ADD CONSTRAINT "PlaybookDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PlaybookReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL, "runId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL, "attempt" INTEGER NOT NULL, "adapter" TEXT NOT NULL,
  "action" TEXT NOT NULL, "result" TEXT NOT NULL, "targetDigest" TEXT NOT NULL,
  "evidence" JSONB NOT NULL, "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaybookReceipt_attempt_check" CHECK ("attempt" BETWEEN 1 AND 2)
);
CREATE UNIQUE INDEX "PlaybookReceipt_runId_stepId_attempt_key" ON "PlaybookReceipt"("runId", "stepId", "attempt");
CREATE INDEX "PlaybookReceipt_tenantId_runId_createdAt_idx" ON "PlaybookReceipt"("tenantId", "runId", "createdAt");
ALTER TABLE "PlaybookReceipt" ADD CONSTRAINT "PlaybookReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaybookReceipt" ADD CONSTRAINT "PlaybookReceipt_runId_tenantId_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "PlaybookRun"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaybookReceipt" ADD CONSTRAINT "PlaybookReceipt_stepId_tenantId_fkey" FOREIGN KEY ("stepId", "tenantId") REFERENCES "PlaybookStep"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlaybookReceipt" ADD CONSTRAINT "PlaybookReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION soar_immutable_record() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SOAR history is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PlaybookDecision_immutable" BEFORE UPDATE OR DELETE ON "PlaybookDecision" FOR EACH ROW EXECUTE FUNCTION soar_immutable_record();
CREATE TRIGGER "PlaybookReceipt_immutable" BEFORE UPDATE OR DELETE ON "PlaybookReceipt" FOR EACH ROW EXECUTE FUNCTION soar_immutable_record();
