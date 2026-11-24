BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database_name,
       (SELECT count(*) FROM "Tenant") AS tenants,
       (SELECT count(*) FROM "ThreatActor") AS threat_actors,
       (SELECT count(*) FROM "Campaign") AS campaigns,
       (SELECT count(*) FROM "MitreTechnique") AS techniques,
       (SELECT count(*) FROM "SirEvidence") AS sir_evidence;
SELECT to_regclass('public."TtpObservation"') IS NOT NULL AS has_ttp_observations,
       to_regclass('public."TtpObservationReview"') IS NOT NULL AS has_ttp_reviews,
       to_regclass('public."NextStepRun"') IS NOT NULL AS has_next_step_runs,
       to_regclass('public."NextStepReview"') IS NOT NULL AS has_next_step_reviews;
COMMIT;
