"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useThreatIntelligenceTenant } from "./ThreatIntelligenceShell";

type Role = "SUPER_ADMIN" | "ADMIN" | "USER";
type Observation = { readonly id: string; readonly status: string; readonly observedStartAt: string; readonly mitreTechnique: { readonly externalId: string } };
type Review = { readonly id: string; readonly kind: "DISPOSITION" | "OUTCOME"; readonly disposition: string | null; readonly outcome: string | null; readonly reason: string; readonly createdAt: string; readonly reviewer: { readonly name: string } };
type Candidate = { readonly id: string; readonly rank: number; readonly supportScore: number; readonly techniqueExternalId: string; readonly techniqueName: string; readonly techniqueTactic: string; readonly supportingObservationIds: readonly string[]; readonly contradictingObservationIds: readonly string[]; readonly ruleTrace: { readonly ruleVersion: string; readonly ruleId: string; readonly explanation: string; readonly components: Record<string, number> }; readonly investigationSteps: readonly string[]; readonly reviews: readonly Review[] };
type Run = { readonly id: string; readonly asOf: string; readonly horizonDays: number; readonly engineVersion: string; readonly ruleVersion: string; readonly inputDigest: string; readonly status: "GENERATED" | "ABSTAINED"; readonly abstentionReason: string | null; readonly candidates: readonly Candidate[]; readonly createdAt: string };
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function NextStepHypotheses({ actorId, campaignId, role }: { readonly actorId?: string; readonly campaignId?: string; readonly role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [runs, setRuns] = useState<readonly Run[]>([]);
  const [observations, setObservations] = useState<readonly Observation[]>([]);
  const [horizonDays, setHorizonDays] = useState(14);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingRun = useRef<{ readonly key: string; readonly asOf: string } | null>(null);
  const scope = new URLSearchParams(actorId ? { actorId } : { campaignId: campaignId ?? "" });
  if (role === "SUPER_ADMIN" && tenantId) scope.set("tenantId", tenantId);
  const query = scope.toString();
  const tenantQuery = role === "SUPER_ADMIN" ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const canReview = role !== "USER";

  const load = useCallback(async () => {
    if (role === "SUPER_ADMIN" && (!ready || !tenantId)) return;
    try {
      const [runResponse, observationResponse] = await Promise.all([
        fetch(`${API}/intelligence/next-step-runs?${query}`, { credentials: "include", cache: "no-store" }),
        fetch(`${API}/intelligence/ttp-observations?${query}`, { credentials: "include", cache: "no-store" }),
      ]);
      if (!runResponse.ok || !observationResponse.ok) throw new Error("Unable to load hypothesis history");
      setRuns(await runResponse.json()); setObservations(await observationResponse.json());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load hypothesis history"); }
  }, [query, ready, role, tenantId]);
  useEffect(() => { void load(); }, [load]);

  async function generate() {
    pendingRun.current ??= { key: crypto.randomUUID(), asOf: new Date().toISOString() };
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/intelligence/next-step-runs${tenantQuery}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: pendingRun.current.key, ...(actorId ? { threatActorId: actorId } : { campaignId }), asOf: pendingRun.current.asOf, horizonDays }) });
      if (!response.ok) { const body: { readonly message?: string } = await response.json(); throw new Error(body.message || "Unable to generate hypothesis"); }
      const run: Run = await response.json(); pendingRun.current = null; setNotice(run.status === "ABSTAINED" ? "Run abstained; review the evidence gap below." : "Deterministic hypothesis run recorded."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to generate hypothesis"); }
    finally { setBusy(false); }
  }

  async function review(candidate: Candidate, kind: "DISPOSITION" | "OUTCOME", value: string) {
    const reason = reasons[candidate.id]?.trim() ?? "";
    if (reason.length < 10) { setError("Enter a review reason of at least 10 characters."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const body = kind === "DISPOSITION" ? { kind, disposition: value, reason } : { kind, outcome: value, reason, ...(value === "VERIFIED" ? { outcomeObservationId: outcomes[candidate.id] } : {}) };
      const response = await fetch(`${API}/intelligence/next-step-runs/candidates/${candidate.id}/reviews${tenantQuery}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, expectedReviewId: candidate.reviews[candidate.reviews.length - 1]?.id ?? null }) });
      if (!response.ok) { const result: { readonly message?: string } = await response.json(); throw new Error(result.message || "Unable to record review"); }
      setReasons(current => ({ ...current, [candidate.id]: "" })); setNotice("Analyst review recorded."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to record review"); }
    finally { setBusy(false); }
  }

  async function copyGuidance(candidate: Candidate) {
    const text = `${candidate.techniqueExternalId} ${candidate.techniqueName}: ${candidate.ruleTrace.explanation}\nInvestigation: ${candidate.investigationSteps.join("; ")}\nRun evidence: ${candidate.supportingObservationIds.join(", ")}`;
    try { await navigator.clipboard.writeText(text); setNotice("Investigation guidance copied for a case note."); }
    catch { setError("Clipboard unavailable; use the guidance displayed below."); }
  }

  return <section className="actor-related next-step-hypotheses" aria-label="Next-step hypothesis history">
    <div className="source-panel-heading"><div><span className="source-eyebrow">PHASE 2B / ANALYST HYPOTHESES</span><h3>Next-step hypothesis history</h3></div></div>
    <p>Deterministic investigation prompts from confirmed evidence. Scores are heuristic support points, not probabilities or validated predictions. ATT&amp;CK tactic order alone does not establish progression.</p>
    {canReview && <div className="next-step-controls"><label>Investigation horizon (days)<input type="number" min="1" max="90" value={horizonDays} onChange={event => { pendingRun.current = null; setHorizonDays(Number(event.target.value)); }} /></label><Button view="outlined" size="s" disabled={busy} onClick={() => void generate()}>Generate hypothesis run</Button></div>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success" role="status">{notice}</p>}
    {runs.length === 0 && <p>No hypothesis runs yet. Confirm source-backed observations before generating one.</p>}
    <div className="next-step-runs">{runs.map(run => <article className="next-step-run" key={run.id}>
      <header><strong>{run.status === "ABSTAINED" ? "Abstained" : "Hypothesis run"}</strong><small>As of {new Date(run.asOf).toLocaleString()} · {run.horizonDays}-day horizon · {run.ruleVersion}</small></header>
      {run.abstentionReason && <p>{run.abstentionReason}</p>}
      <small>Snapshot SHA-256: {run.inputDigest}</small>
      {run.candidates.map(candidate => <div className="next-step-candidate" key={candidate.id}>
        <h4>#{candidate.rank} · {candidate.techniqueExternalId} {candidate.techniqueName}</h4>
        <p>{candidate.techniqueTactic} · Heuristic support {candidate.supportScore}/100</p>
        <p>{candidate.ruleTrace.explanation}</p>
        <dl><div><dt>Rule</dt><dd>{candidate.ruleTrace.ruleId} · {candidate.ruleTrace.ruleVersion}</dd></div><div><dt>Score components</dt><dd>{Object.entries(candidate.ruleTrace.components).map(([name, value]) => `${name} ${value >= 0 ? "+" : ""}${value}`).join(" · ")}</dd></div><div><dt>Supporting observations</dt><dd>{candidate.supportingObservationIds.join(", ")}</dd></div><div><dt>Contradictory observations</dt><dd>{candidate.contradictingObservationIds.join(", ") || "None recorded"}</dd></div></dl>
        <h5>Recommended investigation</h5><ul>{candidate.investigationSteps.map(step => <li key={step}>{step}</li>)}</ul>
        {candidate.reviews.length > 0 && <div className="next-step-history"><h5>Analyst history</h5>{candidate.reviews.map(item => <p key={item.id}>{item.kind === "DISPOSITION" ? item.disposition?.replaceAll("_", " ") : `Outcome: ${item.outcome}`} · {item.reviewer.name} · {new Date(item.createdAt).toLocaleString()} · {item.reason}</p>)}</div>}
        {candidate.reviews.some(item => item.disposition === "ACCEPT_FOR_INVESTIGATION") && <div className="next-step-case"><Button view="outlined" size="s" onClick={() => void copyGuidance(candidate)}>Copy case guidance</Button> <a href="/cases">Open Case Management</a></div>}
        {canReview && <div className="next-step-review"><label>Review reason<input minLength={10} maxLength={2000} value={reasons[candidate.id] ?? ""} onChange={event => setReasons(current => ({ ...current, [candidate.id]: event.target.value }))} /></label><div className="next-step-actions"><Button view="outlined" size="s" disabled={busy} onClick={() => void review(candidate, "DISPOSITION", "ACCEPT_FOR_INVESTIGATION")}>Accept for investigation</Button><Button view="outlined" size="s" disabled={busy} onClick={() => void review(candidate, "DISPOSITION", "DISMISSED")}>Dismiss</Button><Button view="outlined" size="s" disabled={busy} onClick={() => void review(candidate, "DISPOSITION", "ALREADY_OBSERVED")}>Already observed</Button></div><label>Later confirmed observation<select value={outcomes[candidate.id] ?? ""} onChange={event => setOutcomes(current => ({ ...current, [candidate.id]: event.target.value }))}><option value="">Select for verified outcome</option>{observations.filter(item => item.status === "CONFIRMED" && item.mitreTechnique.externalId === candidate.techniqueExternalId && new Date(item.observedStartAt) > new Date(run.asOf)).map(item => <option key={item.id} value={item.id}>{item.id} · {new Date(item.observedStartAt).toLocaleString()}</option>)}</select></label><div className="next-step-actions"><Button view="outlined" size="s" disabled={busy || !outcomes[candidate.id]} onClick={() => void review(candidate, "OUTCOME", "VERIFIED")}>Record verified outcome</Button><Button view="outlined" size="s" disabled={busy} onClick={() => void review(candidate, "OUTCOME", "UNCERTAIN")}>Record uncertain</Button><Button view="outlined" size="s" disabled={busy} onClick={() => void review(candidate, "OUTCOME", "UNOBSERVABLE")}>Record unobservable</Button></div></div>}
      </div>)}
    </article>)}</div>
  </section>;
}
