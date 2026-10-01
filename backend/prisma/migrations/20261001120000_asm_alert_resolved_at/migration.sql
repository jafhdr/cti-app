ALTER TABLE "Alert" ADD COLUMN "resolvedAt" TIMESTAMP(3);
CREATE INDEX "Alert_tenantId_status_resolvedAt_idx" ON "Alert"("tenantId", "status", "resolvedAt");

CREATE FUNCTION asm_alert_resolved_timestamp() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NEW."status" = 'CLOSED' THEN
      NEW."resolvedAt" := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
    ELSE
      NEW."resolvedAt" := NULL;
    END IF;
  ELSE
    NEW."resolvedAt" := OLD."resolvedAt";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asm_alert_resolved_at
BEFORE UPDATE ON "Alert"
FOR EACH ROW EXECUTE FUNCTION asm_alert_resolved_timestamp();
