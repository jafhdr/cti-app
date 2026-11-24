CREATE UNIQUE INDEX "Alert_id_tenantId_key" ON "Alert"("id", "tenantId");
CREATE UNIQUE INDEX "IndicatorSourceObservation_id_tenantId_key" ON "IndicatorSourceObservation"("id", "tenantId");

CREATE TABLE "ThreatEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "observableType" "IndicatorType" NOT NULL,
  "observableValue" TEXT NOT NULL,
  "ioaKind" TEXT,
  "provenance" JSONB NOT NULL,
  "confidence" INTEGER NOT NULL,
  "tlp" "TlpLevel" NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ThreatEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ThreatEvent_tenantId_sourceKind_sourceKey_key" ON "ThreatEvent"("tenantId", "sourceKind", "sourceKey");
CREATE UNIQUE INDEX "ThreatEvent_id_tenantId_key" ON "ThreatEvent"("id", "tenantId");
CREATE INDEX "ThreatEvent_tenantId_observableType_observableValue_observedAt_idx" ON "ThreatEvent"("tenantId", "observableType", "observableValue", "observedAt");
ALTER TABLE "ThreatEvent" ADD CONSTRAINT "ThreatEvent_confidence_check" CHECK ("confidence" BETWEEN 0 AND 100);

CREATE TABLE "ThreatCorrelation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "indicatorId" TEXT NOT NULL,
  "feedObservationId" TEXT NOT NULL,
  "alertId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "matchedAt" TIMESTAMP(3) NOT NULL,
  "correlatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "alertVisibleAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ThreatCorrelation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ThreatCorrelation_eventId_tenantId_fkey" FOREIGN KEY ("eventId", "tenantId") REFERENCES "ThreatEvent"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ThreatCorrelation_indicatorId_tenantId_fkey" FOREIGN KEY ("indicatorId", "tenantId") REFERENCES "Indicator"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ThreatCorrelation_alertId_tenantId_fkey" FOREIGN KEY ("alertId", "tenantId") REFERENCES "Alert"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ThreatCorrelation_feedObservationId_tenantId_fkey" FOREIGN KEY ("feedObservationId", "tenantId") REFERENCES "IndicatorSourceObservation"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ThreatCorrelation_eventId_key" ON "ThreatCorrelation"("eventId");
CREATE UNIQUE INDEX "ThreatCorrelation_alertId_key" ON "ThreatCorrelation"("alertId");
CREATE UNIQUE INDEX "ThreatCorrelation_id_tenantId_key" ON "ThreatCorrelation"("id", "tenantId");
CREATE UNIQUE INDEX "ThreatCorrelation_eventId_tenantId_key" ON "ThreatCorrelation"("eventId", "tenantId");
CREATE UNIQUE INDEX "ThreatCorrelation_alertId_tenantId_key" ON "ThreatCorrelation"("alertId", "tenantId");
CREATE INDEX "ThreatCorrelation_tenantId_correlatedAt_idx" ON "ThreatCorrelation"("tenantId", "correlatedAt");
ALTER TABLE "ThreatCorrelation" ADD CONSTRAINT "ThreatCorrelation_score_check" CHECK ("score" BETWEEN 0 AND 100);
