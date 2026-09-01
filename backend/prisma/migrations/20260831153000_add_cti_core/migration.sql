CREATE TYPE "IntelligenceEntityType" AS ENUM ('SOURCE', 'FEED', 'THREAT_ACTOR', 'CAMPAIGN', 'MALWARE', 'TOOL', 'VULNERABILITY');
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'CLOSED');

CREATE TABLE "IntelligenceEntity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" "IntelligenceEntityType" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "externalId" TEXT,
  "confidence" INTEGER NOT NULL DEFAULT 50,
  "severity" "IndicatorSeverity" NOT NULL DEFAULT 'MEDIUM',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntelligenceEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntelligenceRelationship" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "relationshipType" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntelligenceRelationship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Case" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
  "severity" "IndicatorSeverity" NOT NULL DEFAULT 'MEDIUM',
  "ownerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CaseEntity" ("caseId" TEXT NOT NULL, "entityId" TEXT NOT NULL, CONSTRAINT "CaseEntity_pkey" PRIMARY KEY ("caseId", "entityId"));

CREATE TABLE "Alert" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
  "severity" "IndicatorSeverity" NOT NULL DEFAULT 'MEDIUM',
  "caseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlertEntity" ("alertId" TEXT NOT NULL, "entityId" TEXT NOT NULL, CONSTRAINT "AlertEntity_pkey" PRIMARY KEY ("alertId", "entityId"));

CREATE UNIQUE INDEX "IntelligenceEntity_tenantId_type_name_key" ON "IntelligenceEntity"("tenantId", "type", "name");
CREATE INDEX "IntelligenceEntity_tenantId_type_severity_idx" ON "IntelligenceEntity"("tenantId", "type", "severity");
CREATE UNIQUE INDEX "IntelligenceRelationship_tenantId_sourceId_targetId_relationshipType_key" ON "IntelligenceRelationship"("tenantId", "sourceId", "targetId", "relationshipType");
CREATE INDEX "IntelligenceRelationship_tenantId_sourceId_idx" ON "IntelligenceRelationship"("tenantId", "sourceId");
CREATE INDEX "IntelligenceRelationship_tenantId_targetId_idx" ON "IntelligenceRelationship"("tenantId", "targetId");
CREATE INDEX "Case_tenantId_status_severity_idx" ON "Case"("tenantId", "status", "severity");
CREATE INDEX "Alert_tenantId_status_severity_idx" ON "Alert"("tenantId", "status", "severity");

ALTER TABLE "IntelligenceEntity" ADD CONSTRAINT "IntelligenceEntity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntelligenceRelationship" ADD CONSTRAINT "IntelligenceRelationship_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntelligenceRelationship" ADD CONSTRAINT "IntelligenceRelationship_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "IntelligenceEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntelligenceRelationship" ADD CONSTRAINT "IntelligenceRelationship_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "IntelligenceEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Case" ADD CONSTRAINT "Case_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseEntity" ADD CONSTRAINT "CaseEntity_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseEntity" ADD CONSTRAINT "CaseEntity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "IntelligenceEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AlertEntity" ADD CONSTRAINT "AlertEntity_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertEntity" ADD CONSTRAINT "AlertEntity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "IntelligenceEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
