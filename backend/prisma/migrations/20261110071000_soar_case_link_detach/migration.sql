-- Preserve the existing Case deletion lifecycle while keeping the tenant-scoped link.
-- A nullable tenant copy lets SetNull detach the link without changing run ownership.
ALTER TABLE "PlaybookRun" ADD COLUMN "caseTenantId" TEXT;
UPDATE "PlaybookRun" SET "caseTenantId" = "tenantId" WHERE "caseId" IS NOT NULL;
ALTER TABLE "PlaybookRun" ADD CONSTRAINT "PlaybookRun_case_tenant_check"
  CHECK (("caseId" IS NULL AND "caseTenantId" IS NULL) OR ("caseId" IS NOT NULL AND "caseTenantId" = "tenantId"));
ALTER TABLE "PlaybookRun" DROP CONSTRAINT "PlaybookRun_caseId_tenantId_fkey";
ALTER TABLE "PlaybookRun" ADD CONSTRAINT "PlaybookRun_caseId_tenantId_fkey"
  FOREIGN KEY ("caseId", "caseTenantId") REFERENCES "Case"("id", "tenantId")
  ON DELETE SET NULL ON UPDATE CASCADE;
