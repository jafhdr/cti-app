-- Protect only Case V2 actions. Legacy Case activity and unrelated AuditLog consumers
-- keep their existing update/delete and V1 Case cascade behavior.
CREATE FUNCTION "reject_case_v2_event_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.action IN (
    'CASE_V2_ORIGIN_CREATED', 'CASE_TASK_CREATED', 'CASE_TASK_UPDATED',
    'CASE_HANDOFF', 'CASE_DUE_DATE_CHANGED', 'CASE_EVIDENCE_REVISED',
    'CASE_REVIEW_REQUESTED', 'CASE_REVIEW_DECIDED', 'CASE_CLOSED_V2',
    'CASE_REOPENED_V2'
  ) THEN
    RAISE EXCEPTION 'Case V2 event history is immutable';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "CaseActivity_v2_immutable" BEFORE UPDATE OR DELETE ON "CaseActivity"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_v2_event_mutation"();
CREATE TRIGGER "AuditLog_case_v2_immutable" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "reject_case_v2_event_mutation"();
