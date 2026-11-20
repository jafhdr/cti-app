ALTER TABLE "NextStepCandidate"
  ADD COLUMN "techniqueExternalId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "techniqueName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "techniqueTactic" TEXT NOT NULL DEFAULT '';

UPDATE "NextStepCandidate" AS candidate
SET "techniqueExternalId" = technique."externalId",
    "techniqueName" = technique."name",
    "techniqueTactic" = technique."tactic"
FROM "MitreTechnique" AS technique
WHERE candidate."mitreTechniqueId" = technique."id" AND candidate."tenantId" = technique."tenantId";

ALTER TABLE "NextStepCandidate"
  ALTER COLUMN "techniqueExternalId" DROP DEFAULT,
  ALTER COLUMN "techniqueName" DROP DEFAULT,
  ALTER COLUMN "techniqueTactic" DROP DEFAULT;
