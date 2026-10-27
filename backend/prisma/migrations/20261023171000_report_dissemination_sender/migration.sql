ALTER TABLE "ReportDissemination" DROP CONSTRAINT "ReportDissemination_senderId_tenantId_fkey";
ALTER TABLE "ReportDissemination" ADD CONSTRAINT "ReportDissemination_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
