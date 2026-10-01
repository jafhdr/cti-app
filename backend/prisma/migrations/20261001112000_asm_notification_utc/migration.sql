CREATE OR REPLACE FUNCTION asm_notify_alert() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."source" <> 'ASM' OR NEW."severity" NOT IN ('HIGH', 'CRITICAL') OR NEW."firstSeenAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '5 minutes' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "AsmNotificationPreference"
    WHERE "tenantId" = NEW."tenantId"
      AND ("enabled" = FALSE OR ("minimumSeverity" = 'CRITICAL' AND NEW."severity" = 'HIGH'))
  ) THEN
    RETURN NEW;
  END IF;
  INSERT INTO "AsmNotification" ("id", "tenantId", "alertId")
  VALUES (md5(random()::text || clock_timestamp()::text), NEW."tenantId", NEW."id")
  ON CONFLICT ("alertId") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
