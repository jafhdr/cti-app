CREATE TYPE "IocCandidateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "IocCandidateType" AS ENUM ('IPV4', 'IPV6', 'DOMAIN', 'URL', 'MD5', 'SHA1', 'SHA256');
ALTER TYPE "TelegramProcessingStatus" ADD VALUE IF NOT EXISTS 'PROCESSED';

ALTER TABLE "TelegramStagingMessage"
  ADD COLUMN "text" TEXT,
  ADD COLUMN "caption" TEXT,
  ADD COLUMN "entities" JSONB;

CREATE TABLE "IocCandidate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "intelligenceSourceId" TEXT NOT NULL,
  "type" "IocCandidateType" NOT NULL,
  "rawValue" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "confidence" INTEGER NOT NULL,
  "status" "IocCandidateStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IocCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IocCandidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "IocCandidate_intelligenceSourceId_tenantId_fkey" FOREIGN KEY ("intelligenceSourceId", "tenantId") REFERENCES "IntelligenceSource"("id", "tenantId") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "IocCandidate_tenantId_type_normalizedValue_key" ON "IocCandidate"("tenantId", "type", "normalizedValue");
CREATE UNIQUE INDEX "IocCandidate_id_tenantId_key" ON "IocCandidate"("id", "tenantId");
CREATE INDEX "IocCandidate_tenantId_status_createdAt_idx" ON "IocCandidate"("tenantId", "status", "createdAt");
CREATE INDEX "IocCandidate_tenantId_intelligenceSourceId_idx" ON "IocCandidate"("tenantId", "intelligenceSourceId");

CREATE TABLE "IocObservation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "telegramStagingMessageId" TEXT NOT NULL,
  "rawValue" TEXT NOT NULL,
  "extractionMethod" TEXT NOT NULL,
  "spanStart" INTEGER,
  "spanEnd" INTEGER,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IocObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IocObservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "IocObservation_candidateId_tenantId_fkey" FOREIGN KEY ("candidateId", "tenantId") REFERENCES "IocCandidate"("id", "tenantId") ON DELETE CASCADE,
  CONSTRAINT "IocObservation_telegramStagingMessageId_fkey" FOREIGN KEY ("telegramStagingMessageId") REFERENCES "TelegramStagingMessage"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "IocObservation_message_span_key" ON "IocObservation"("tenantId", "candidateId", "telegramStagingMessageId", "extractionMethod", "spanStart", "spanEnd");
CREATE INDEX "IocObservation_tenantId_telegramStagingMessageId_idx" ON "IocObservation"("tenantId", "telegramStagingMessageId");
