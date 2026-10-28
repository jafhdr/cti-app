INSERT INTO "ModuleFeature" ("id", "moduleId", "key", "name", "description")
SELECT 'appsec-finding-remediation-submit-' || "id", "id", 'finding-remediation-submit',
       'Finding Remediation Submit', 'Mulai remediasi dan catat evidence untuk Finding yang ditugaskan.'
FROM "AppModule" WHERE "slug" = 'appsec-posture'
ON CONFLICT ("moduleId", "key") DO NOTHING;
