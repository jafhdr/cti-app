ALTER TABLE "IocCandidate" ADD COLUMN "indicatorId" TEXT;

CREATE INDEX "IocCandidate_tenantId_indicatorId_idx"
ON "IocCandidate"("tenantId", "indicatorId");

ALTER TABLE "IocCandidate"
ADD CONSTRAINT "IocCandidate_indicatorId_tenantId_fkey"
FOREIGN KEY ("indicatorId", "tenantId")
REFERENCES "Indicator"("id", "tenantId")
ON DELETE RESTRICT
ON UPDATE CASCADE;
