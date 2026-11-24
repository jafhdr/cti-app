CREATE TYPE "CaseTaskState" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');
ALTER TABLE "Case" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Case" ADD COLUMN "dueAt" TIMESTAMP(3);
ALTER TABLE "Case" ADD COLUMN "slaPolicyKey" TEXT;
CREATE INDEX "Case_tenantId_dueAt_idx" ON "Case"("tenantId", "dueAt");

CREATE TABLE "CaseTask" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "state" "CaseTaskState" NOT NULL DEFAULT 'TODO',
  "assigneeId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CaseTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CaseTask_id_tenantId_key" ON "CaseTask"("id", "tenantId");
CREATE INDEX "CaseTask_tenantId_caseId_state_idx" ON "CaseTask"("tenantId", "caseId", "state");
CREATE INDEX "CaseTask_tenantId_assigneeId_state_idx" ON "CaseTask"("tenantId", "assigneeId", "state");
ALTER TABLE "CaseTask" ADD CONSTRAINT "CaseTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseTask" ADD CONSTRAINT "CaseTask_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseTask" ADD CONSTRAINT "CaseTask_assigneeId_tenantId_fkey" FOREIGN KEY ("assigneeId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseTask" ADD CONSTRAINT "CaseTask_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CaseHandoff" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "previousAssigneeId" TEXT,
  "previousAssigneeName" TEXT,
  "newAssigneeId" TEXT NOT NULL,
  "newAssigneeName" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "caseRevision" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseHandoff_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CaseHandoff_tenantId_caseId_createdAt_idx" ON "CaseHandoff"("tenantId", "caseId", "createdAt");
ALTER TABLE "CaseHandoff" ADD CONSTRAINT "CaseHandoff_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseHandoff" ADD CONSTRAINT "CaseHandoff_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "preserve_case_handoff"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Case handoff is immutable';
END;
$$;
CREATE TRIGGER "CaseHandoff_immutable" BEFORE UPDATE OR DELETE ON "CaseHandoff" FOR EACH ROW EXECUTE FUNCTION "preserve_case_handoff"();
