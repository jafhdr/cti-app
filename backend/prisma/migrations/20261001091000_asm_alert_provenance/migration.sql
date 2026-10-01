ALTER TABLE "Alert" ADD CONSTRAINT "Alert_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AssetFinding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_changeEventId_fkey" FOREIGN KEY ("changeEventId") REFERENCES "AsmExposureChange"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_vulnerabilityCorrelationId_fkey" FOREIGN KEY ("vulnerabilityCorrelationId") REFERENCES "AssetVulnerabilityCorrelation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
