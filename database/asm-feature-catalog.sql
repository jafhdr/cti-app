-- Optional data repair for an existing ASM catalog missing its seeded features.
-- Run manually after reviewing the target database. No schema or assignments change.
BEGIN;

INSERT INTO "ModuleFeature" ("id", "moduleId", "key", "name", "description")
SELECT 'asm-assets-' || "id", "id", 'asset-management', 'Asset Management', 'Kelola aset dan detail inventaris.'
FROM "AppModule" WHERE "slug" = 'attack-surface-management'
ON CONFLICT ("moduleId", "key") DO NOTHING;

INSERT INTO "ModuleFeature" ("id", "moduleId", "key", "name", "description")
SELECT 'asm-discovery-' || "id", "id", 'asset-discovery', 'Asset Discovery', 'Temukan dan monitor aset baru.'
FROM "AppModule" WHERE "slug" = 'attack-surface-management'
ON CONFLICT ("moduleId", "key") DO NOTHING;

COMMIT;
