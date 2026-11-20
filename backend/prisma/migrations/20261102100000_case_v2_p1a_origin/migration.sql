CREATE TYPE "CaseOriginKind" AS ENUM ('MANUAL', 'INDICATOR', 'ASM_ALERT', 'ASM_FINDING', 'APPSEC_FINDING');

CREATE TABLE "CaseOrigin" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "kind" "CaseOriginKind" NOT NULL,
  "sourceId" TEXT,
  "sourceOccurredAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  CONSTRAINT "CaseOrigin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaseOrigin_source_check" CHECK (("kind" = 'MANUAL' AND "sourceId" IS NULL) OR ("kind" <> 'MANUAL' AND "sourceId" IS NOT NULL))
);
CREATE UNIQUE INDEX "CaseOrigin_caseId_key" ON "CaseOrigin"("caseId");
CREATE UNIQUE INDEX "CaseOrigin_caseId_tenantId_key" ON "CaseOrigin"("caseId", "tenantId");
CREATE INDEX "CaseOrigin_tenantId_kind_sourceId_idx" ON "CaseOrigin"("tenantId", "kind", "sourceId");
ALTER TABLE "CaseOrigin" ADD CONSTRAINT "CaseOrigin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseOrigin" ADD CONSTRAINT "CaseOrigin_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CaseCreateRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseCreateRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CaseCreateRequest_tenantId_actorId_idempotencyKey_key" ON "CaseCreateRequest"("tenantId", "actorId", "idempotencyKey");
CREATE INDEX "CaseCreateRequest_tenantId_caseId_idx" ON "CaseCreateRequest"("tenantId", "caseId");
ALTER TABLE "CaseCreateRequest" ADD CONSTRAINT "CaseCreateRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseCreateRequest" ADD CONSTRAINT "CaseCreateRequest_caseId_tenantId_fkey" FOREIGN KEY ("caseId", "tenantId") REFERENCES "Case"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "preserve_case_origin"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Case origin is immutable';
END;
$$;
CREATE TRIGGER "CaseOrigin_immutable" BEFORE UPDATE OR DELETE ON "CaseOrigin" FOR EACH ROW EXECUTE FUNCTION "preserve_case_origin"();
