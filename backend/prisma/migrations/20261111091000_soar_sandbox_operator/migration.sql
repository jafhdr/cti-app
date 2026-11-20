ALTER TABLE "SandboxConnectorJob" ADD COLUMN "requestedById" TEXT;
UPDATE "SandboxConnectorJob" j SET "requestedById" = r."triggeredById" FROM "PlaybookRun" r WHERE j."runId" = r."id";
ALTER TABLE "SandboxConnectorJob" ALTER COLUMN "requestedById" SET NOT NULL;
ALTER TABLE "SandboxConnectorJob" ADD CONSTRAINT "SandboxConnectorJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
