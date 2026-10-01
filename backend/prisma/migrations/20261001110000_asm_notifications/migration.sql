CREATE TABLE "AsmNotificationPreference" (
  "tenantId" TEXT PRIMARY KEY REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "minimumSeverity" "IndicatorSeverity" NOT NULL DEFAULT 'HIGH'
);
CREATE TABLE "AsmNotification" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "alertId" TEXT NOT NULL UNIQUE REFERENCES "Alert"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AsmNotification_tenantId_createdAt_idx" ON "AsmNotification"("tenantId", "createdAt");
CREATE TABLE "AsmNotificationRead" (
  "notificationId" TEXT NOT NULL REFERENCES "AsmNotification"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("notificationId", "userId")
);
CREATE FUNCTION asm_notify_alert() RETURNS TRIGGER AS $$
DECLARE threshold "IndicatorSeverity";
BEGIN
  IF NEW."source" <> 'ASM' OR NEW."severity" NOT IN ('HIGH', 'CRITICAL') OR NEW."firstSeenAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes' THEN
    RETURN NEW;
  END IF;
  SELECT "minimumSeverity" INTO threshold FROM "AsmNotificationPreference" WHERE "tenantId" = NEW."tenantId" AND "enabled" = TRUE;
  IF NOT FOUND AND EXISTS (SELECT 1 FROM "AsmNotificationPreference" WHERE "tenantId" = NEW."tenantId") THEN RETURN NEW; END IF;
  IF threshold = 'CRITICAL' AND NEW."severity" <> 'CRITICAL' THEN RETURN NEW; END IF;
  INSERT INTO "AsmNotification" ("id", "tenantId", "alertId") VALUES (md5(random()::text || clock_timestamp()::text), NEW."tenantId", NEW."id") ON CONFLICT ("alertId") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER asm_alert_notify AFTER INSERT ON "Alert" FOR EACH ROW EXECUTE FUNCTION asm_notify_alert();
