-- CreateEnum
CREATE TYPE "ApplicationCriticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AppSecFindingSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AppSecFindingStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ACCEPTED_RISK', 'FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "AppSecFindingSource" AS ENUM ('MANUAL', 'SAST', 'SCA', 'DAST', 'SECRET_SCAN');

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "criticality" "ApplicationCriticality" NOT NULL DEFAULT 'MEDIUM',
    "status" "ApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "owner" TEXT,
    "repositoryUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSecFinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "AppSecFindingSeverity" NOT NULL,
    "status" "AppSecFindingStatus" NOT NULL DEFAULT 'OPEN',
    "source" "AppSecFindingSource" NOT NULL DEFAULT 'MANUAL',
    "sourceKey" TEXT,
    "category" TEXT,
    "cweId" TEXT,
    "location" TEXT,
    "remediationNote" TEXT,
    "dueDate" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSecFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Application_tenantId_status_criticality_idx" ON "Application"("tenantId", "status", "criticality");

-- CreateIndex
CREATE UNIQUE INDEX "Application_tenantId_name_key" ON "Application"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Application_id_tenantId_key" ON "Application"("id", "tenantId");

-- CreateIndex
CREATE INDEX "AppSecFinding_tenantId_applicationId_status_idx" ON "AppSecFinding"("tenantId", "applicationId", "status");

-- CreateIndex
CREATE INDEX "AppSecFinding_tenantId_status_severity_idx" ON "AppSecFinding"("tenantId", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "AppSecFinding_id_tenantId_key" ON "AppSecFinding"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSecFinding_tenantId_applicationId_source_sourceKey_key" ON "AppSecFinding"("tenantId", "applicationId", "source", "sourceKey");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSecFinding" ADD CONSTRAINT "AppSecFinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSecFinding" ADD CONSTRAINT "AppSecFinding_applicationId_tenantId_fkey" FOREIGN KEY ("applicationId", "tenantId") REFERENCES "Application"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add AppSec capabilities to existing installations without changing legacy assignments.
INSERT INTO "ModuleFeature" ("id", "moduleId", "key", "name", "description")
SELECT 'appsec-application-inventory-' || "id", "id", 'application-inventory', 'Application Inventory', 'Kelola inventaris aplikasi.'
FROM "AppModule" WHERE "slug" = 'appsec-posture'
ON CONFLICT ("moduleId", "key") DO NOTHING;

INSERT INTO "ModuleFeature" ("id", "moduleId", "key", "name", "description")
SELECT 'appsec-finding-management-' || "id", "id", 'finding-management', 'Finding Management', 'Kelola temuan keamanan aplikasi.'
FROM "AppModule" WHERE "slug" = 'appsec-posture'
ON CONFLICT ("moduleId", "key") DO NOTHING;
