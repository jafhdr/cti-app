CREATE TYPE "TelegramProcessingStatus" AS ENUM ('PENDING', 'FAILED');

ALTER TABLE "IntelligenceSource" ADD COLUMN "telegramChatId" TEXT;

CREATE TABLE "TelegramStagingMessage" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "intelligenceSourceId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "channelUsername" TEXT,
  "channelTitle" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "updateId" TEXT NOT NULL,
  "messageTimestamp" TIMESTAMP(3) NOT NULL,
  "editTimestamp" TIMESTAMP(3),
  "content" TEXT NOT NULL,
  "messageUrl" TEXT,
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStatus" "TelegramProcessingStatus" NOT NULL DEFAULT 'PENDING',
  "processingError" TEXT,
  "contentHash" TEXT NOT NULL,
  CONSTRAINT "TelegramStagingMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramPollingState" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "intelligenceSourceId" TEXT NOT NULL,
  "lastUpdateId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramPollingState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntelligenceSource_telegramChatId_key" ON "IntelligenceSource"("telegramChatId");
CREATE UNIQUE INDEX "TelegramStagingMessage_tenantId_telegramChatId_messageId_key" ON "TelegramStagingMessage"("tenantId", "telegramChatId", "messageId");
CREATE UNIQUE INDEX "TelegramStagingMessage_tenantId_updateId_key" ON "TelegramStagingMessage"("tenantId", "updateId");
CREATE INDEX "TelegramStagingMessage_tenantId_processingStatus_ingestedAt_idx" ON "TelegramStagingMessage"("tenantId", "processingStatus", "ingestedAt");
CREATE INDEX "TelegramStagingMessage_tenantId_intelligenceSourceId_messageTim_idx" ON "TelegramStagingMessage"("tenantId", "intelligenceSourceId", "messageTimestamp");
CREATE UNIQUE INDEX "TelegramPollingState_intelligenceSourceId_tenantId_key" ON "TelegramPollingState"("intelligenceSourceId", "tenantId");
CREATE UNIQUE INDEX "TelegramPollingState_id_tenantId_key" ON "TelegramPollingState"("id", "tenantId");
CREATE INDEX "TelegramPollingState_tenantId_updatedAt_idx" ON "TelegramPollingState"("tenantId", "updatedAt");

ALTER TABLE "TelegramStagingMessage" ADD CONSTRAINT "TelegramStagingMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramStagingMessage" ADD CONSTRAINT "TelegramStagingMessage_intelligenceSourceId_tenantId_fkey" FOREIGN KEY ("intelligenceSourceId", "tenantId") REFERENCES "IntelligenceSource"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramPollingState" ADD CONSTRAINT "TelegramPollingState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramPollingState" ADD CONSTRAINT "TelegramPollingState_intelligenceSourceId_tenantId_fkey" FOREIGN KEY ("intelligenceSourceId", "tenantId") REFERENCES "IntelligenceSource"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
