-- Add caseNumber column with default value for existing rows
ALTER TABLE "Case" ADD COLUMN "caseNumber" TEXT NOT NULL DEFAULT '';

-- Add createdBy column with a default value for existing rows
ALTER TABLE "Case" ADD COLUMN "createdBy" TEXT;

-- Update existing rows with generated case numbers
WITH numbered_cases AS (
  SELECT id, "tenantId", ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt") as row_num
  FROM "Case"
)
UPDATE "Case" 
SET "caseNumber" = 'CASE-' || EXTRACT(YEAR FROM "createdAt") || '-' || LPAD(CAST(row_num AS TEXT), 5, '0')
FROM numbered_cases
WHERE "Case".id = numbered_cases.id;

-- Set createdBy to a default system user (adjust user ID as needed)
UPDATE "Case" SET "createdBy" = (SELECT id FROM "User" WHERE role = 'SUPER_ADMIN' LIMIT 1) WHERE "createdBy" IS NULL;

-- Make createdBy NOT NULL
ALTER TABLE "Case" ALTER COLUMN "createdBy" SET NOT NULL;

-- Add unique constraint
ALTER TABLE "Case" ADD CONSTRAINT "Case_tenantId_caseNumber_key" UNIQUE ("tenantId", "caseNumber");
