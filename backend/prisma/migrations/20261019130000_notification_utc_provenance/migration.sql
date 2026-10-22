-- Forward only: adding without a default leaves every historical row NULL.
-- Never infer a historical zone or rewrite existing createdAt/readAt values.
ALTER TABLE "AsmNotification" ADD COLUMN "utcCreatedAt" TIMESTAMP(3);
ALTER TABLE "AsmNotification" ALTER COLUMN "utcCreatedAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE "AsmNotification" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
ALTER TABLE "AsmNotificationRead" ALTER COLUMN "readAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
-- Raw SQL inserts and Prisma inserts must share the same UTC snapshot boundary.
ALTER TABLE "Notification" ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
