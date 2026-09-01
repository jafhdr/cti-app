ALTER TABLE "Indicator" ADD COLUMN "intelligenceEntityId" TEXT;

ALTER TABLE "Indicator"
ADD CONSTRAINT "Indicator_intelligenceEntityId_fkey"
FOREIGN KEY ("intelligenceEntityId") REFERENCES "IntelligenceEntity"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Indicator_tenantId_intelligenceEntityId_idx"
ON "Indicator"("tenantId", "intelligenceEntityId");
