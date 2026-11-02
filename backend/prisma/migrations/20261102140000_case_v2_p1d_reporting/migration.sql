CREATE INDEX "Case_tenantId_status_dueAt_assigneeId_createdAt_id_idx"
  ON "Case"("tenantId", "status", "dueAt", "assigneeId", "createdAt", "id");
CREATE INDEX "CaseReviewRequest_tenantId_caseId_cycle_createdAt_id_idx"
  ON "CaseReviewRequest"("tenantId", "caseId", "cycle", "createdAt", "id");
CREATE INDEX "CaseActivity_first_resolution_idx"
  ON "CaseActivity"("tenantId", "caseId", "createdAt")
  WHERE action = 'CASE_STATUS_CHANGED' AND metadata->>'toStatus' = 'RESOLVED';
