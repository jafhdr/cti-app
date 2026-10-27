CREATE TYPE "IndicatorSuppressionKind" AS ENUM ('FALSE_POSITIVE', 'SAFELIST');
CREATE TYPE "IndicatorDecisionKind" AS ENUM ('FALSE_POSITIVE', 'SAFELIST', 'CLEAR');

ALTER TABLE "Indicator" ADD COLUMN "suppressionKind" "IndicatorSuppressionKind";

CREATE TABLE "IndicatorDecision" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "indicatorId" TEXT NOT NULL,
  "kind" "IndicatorDecisionKind" NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IndicatorDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IndicatorDecision_tenantId_indicatorId_createdAt_id_idx" ON "IndicatorDecision"("tenantId", "indicatorId", "createdAt", "id");
ALTER TABLE "IndicatorDecision" ADD CONSTRAINT "IndicatorDecision_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IndicatorDecision" ADD CONSTRAINT "IndicatorDecision_indicator_fkey" FOREIGN KEY ("indicatorId", "tenantId") REFERENCES "Indicator"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IndicatorDecision" ADD CONSTRAINT "IndicatorDecision_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
