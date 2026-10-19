UPDATE "ModuleFeature" AS feature
SET "name" = 'Advanced Charts (Legacy)',
    "description" = 'Legacy catalog only; tidak dapat diberikan sebagai fitur baru.'
FROM "AppModule" AS module
WHERE feature."moduleId" = module."id"
  AND module."slug" = 'appsec-posture'
  AND feature."key" = 'advanced-chart';
