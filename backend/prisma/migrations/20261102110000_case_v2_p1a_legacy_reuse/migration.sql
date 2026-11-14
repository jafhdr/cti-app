ALTER TABLE "CaseCreateRequest" DROP CONSTRAINT "CaseCreateRequest_caseId_tenantId_fkey";
ALTER TABLE "CaseCreateRequest" ADD CONSTRAINT "CaseCreateRequest_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
