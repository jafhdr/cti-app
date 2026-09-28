INSERT INTO "PackageModule" ("packageId", "moduleId")
SELECT package."id", module."id"
FROM "SubscriptionPackage" AS package
CROSS JOIN "AppModule" AS module
WHERE package."name" = 'Team'
  AND package."type" = 'PREDEFINED'
  AND module."slug" = 'attack-surface-management'
ON CONFLICT ("packageId", "moduleId") DO NOTHING;

INSERT INTO "ModuleFeature" ("id", "moduleId", "key", "name", "description")
SELECT 'asm-assets-' || "id", "id", 'asset-management', 'Asset Management', 'Kelola aset dan detail inventaris.'
FROM "AppModule" WHERE "slug" = 'attack-surface-management'
ON CONFLICT ("moduleId", "key") DO NOTHING;

INSERT INTO "ModuleFeature" ("id", "moduleId", "key", "name", "description")
SELECT 'asm-discovery-' || "id", "id", 'asset-discovery', 'Asset Discovery', 'Temukan dan monitor aset baru.'
FROM "AppModule" WHERE "slug" = 'attack-surface-management'
ON CONFLICT ("moduleId", "key") DO NOTHING;
