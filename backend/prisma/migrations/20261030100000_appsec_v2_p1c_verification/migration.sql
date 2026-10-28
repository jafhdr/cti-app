CREATE TYPE "AppSecVerificationState" AS ENUM ('NONE', 'REQUESTED', 'REJECTED', 'APPROVED');

ALTER TABLE "AppSecFinding" ADD COLUMN "verificationState" "AppSecVerificationState";

CREATE INDEX "AppSecFinding_tenantId_verificationState_status_idx" ON "AppSecFinding"("tenantId", "verificationState", "status");

INSERT INTO "ModuleFeature" ("id", "moduleId", "key", "name", "description")
SELECT 'appsec-finding-review-' || "id", "id", 'finding-review',
       'Finding Review', 'Verifikasi independen dan keputusan terminal Finding V2.'
FROM "AppModule" WHERE "slug" = 'appsec-posture'
ON CONFLICT ("moduleId", "key") DO NOTHING;
