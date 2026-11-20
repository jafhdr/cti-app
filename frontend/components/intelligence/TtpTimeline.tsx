"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useThreatIntelligenceTenant } from "./ThreatIntelligenceShell";

type Role = "SUPER_ADMIN" | "ADMIN" | "USER";
type Status = "CANDIDATE" | "CONFIRMED" | "DISPUTED" | "REJECTED";
type Observation = {
  readonly id: string;
  readonly observedStartAt: string;
  readonly observedEndAt: string;
  readonly timePrecision: "INSTANT" | "HOUR" | "DAY" | "INTERVAL";
  readonly status: Status;
  readonly ordering: "FIRST" | "BEFORE" | "AFTER" | "OVERLAPS";
  readonly tlp: string;
  readonly attackVersion: string;
  readonly attributionBasis: string;
  readonly evidenceSnapshot: string;
  readonly sourceReliability: string | null;
  readonly evidenceCredibility: string | null;
  readonly actorConfidence: number | null;
  readonly techniqueConfidence: number;
  readonly mitreTechnique: { readonly externalId: string; readonly name: string; readonly tactic: string };
  readonly reviews: readonly { readonly id: string; readonly status: Status; readonly reason: string; readonly createdAt: string; readonly reviewer: { readonly name: string } }[];
};
type EvidenceOption = { readonly id: string; readonly label: string; readonly relevanceNote: string | null };
type Technique = { readonly id: string; readonly externalId: string; readonly name: string; readonly tactic: string };
type Form = { readonly techniqueId: string; readonly evidenceId: string; readonly attackVersion: string; readonly start: string; readonly end: string; readonly precision: "INSTANT" | "HOUR" | "DAY" | "INTERVAL"; readonly tlp: "CLEAR" | "GREEN" | "AMBER" | "AMBER_STRICT" | "RED"; readonly actorConfidence: string; readonly techniqueConfidence: string; readonly basis: string };
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const initialForm: Form = { techniqueId: "", evidenceId: "", attackVersion: "", start: "", end: "", precision: "INSTANT", tlp: "AMBER", actorConfidence: "", techniqueConfidence: "50", basis: "" };
const statusLabel = { CANDIDATE: "Candidate · awaiting review", CONFIRMED: "Confirmed", DISPUTED: "Disputed · conflict", REJECTED: "Rejected · excluded" } as const;

export function TtpTimeline({ actorId, campaignId, role }: { readonly actorId?: string; readonly campaignId?: string; readonly role: Role }) {
  const { tenantId, ready } = useThreatIntelligenceTenant();
  const [items, setItems] = useState<readonly Observation[]>([]);
  const [evidence, setEvidence] = useState<readonly EvidenceOption[]>([]);
  const [techniques, setTechniques] = useState<readonly Technique[]>([]);
  const [form, setForm] = useState<Form>(initialForm);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const requestKey = useRef<string | null>(null);
  const canReview = role !== "USER";
  const scope = new URLSearchParams(actorId ? { actorId } : { campaignId: campaignId ?? "" });
  if (role === "SUPER_ADMIN" && tenantId) scope.set("tenantId", tenantId);
  const scopeQuery = scope.toString();

  const load = useCallback(async () => {
    if (role === "SUPER_ADMIN" && (!ready || !tenantId)) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API}/intelligence/ttp-observations?${scopeQuery}`, { credentials: "include", cache: "no-store" });
      const body: readonly Observation[] & { readonly message?: string } = await response.json();
      if (!response.ok) throw new Error(body.message || "Unable to load observations");
      setItems(body);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "Unable to load observations");
    } finally { setLoading(false); }
  }, [ready, role, scopeQuery, tenantId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!canReview || (role === "SUPER_ADMIN" && (!ready || !tenantId))) return;
    let active = true;
    async function options() {
      try {
        const [evidenceResponse, relationResponse] = await Promise.all([
          fetch(`${API}/intelligence/ttp-observations/evidence-options?${scopeQuery}`, { credentials: "include", cache: "no-store" }),
          fetch(`${API}/intelligence/campaigns/relations${role === "SUPER_ADMIN" ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`, { credentials: "include", cache: "no-store" }),
        ]);
        if (!evidenceResponse.ok || !relationResponse.ok) throw new Error("Unable to load evidence or techniques");
        const evidenceBody: readonly EvidenceOption[] = await evidenceResponse.json();
        const relationBody: { readonly mitreTechniques: readonly Technique[] } = await relationResponse.json();
        if (active) { setEvidence(evidenceBody); setTechniques(relationBody.mitreTechniques); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load options"); }
    }
    void options();
    return () => { active = false; };
  }, [canReview, ready, role, scopeQuery, tenantId]);

  function setField<K extends keyof Form>(key: K, value: Form[K]) { requestKey.current = null; setForm(current => ({ ...current, [key]: value })); }
  function setPrecision(value: string) {
    switch (value) {
      case "INSTANT": case "HOUR": case "DAY": case "INTERVAL": setField("precision", value); return;
      default: return;
    }
  }
  function setTlp(value: string) {
    switch (value) {
      case "CLEAR": case "GREEN": case "AMBER": case "AMBER_STRICT": case "RED": setField("tlp", value); return;
      default: return;
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    requestKey.current ??= crypto.randomUUID();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/intelligence/ttp-observations${role === "SUPER_ADMIN" ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: requestKey.current, ...(actorId ? { threatActorId: actorId } : { campaignId }), mitreTechniqueId: form.techniqueId, sirEvidenceId: form.evidenceId, attackVersion: form.attackVersion.trim(), attributionBasis: form.basis.trim(), observedStartAt: new Date(form.start).toISOString(), observedEndAt: new Date(form.end || form.start).toISOString(), timePrecision: form.precision, tlp: form.tlp, ...(form.actorConfidence ? { actorConfidence: Number(form.actorConfidence) } : {}), techniqueConfidence: Number(form.techniqueConfidence) }),
      });
      const body: { readonly message?: string } = await response.json();
      if (!response.ok) throw new Error(body.message || "Unable to create observation");
      requestKey.current = null; setForm(initialForm); setShowForm(false); setNotice("Candidate observation created for analyst review."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create observation"); }
    finally { setBusy(false); }
  }
  async function review(item: Observation, status: "CONFIRMED" | "DISPUTED" | "REJECTED") {
    const reason = reviewReasons[item.id]?.trim() ?? "";
    if (reason.length < 10) { setError("Enter a review reason of at least 10 characters."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/intelligence/ttp-observations/${item.id}/reviews${role === "SUPER_ADMIN" ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, expectedStatus: item.status, reason }) });
      const body: { readonly message?: string } = await response.json();
      if (!response.ok) throw new Error(body.message || "Unable to review observation");
      setReviewReasons(current => ({ ...current, [item.id]: "" })); setNotice(`Observation ${status.toLowerCase()}.`); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to review observation"); }
    finally { setBusy(false); }
  }
  return <section className="actor-related ttp-timeline" aria-label="ATT&CK observation timeline">
    <div className="source-panel-heading"><div><span className="source-eyebrow">PHASE 2A / EVIDENCE FOUNDATION</span><h3>ATT&amp;CK observation timeline</h3></div>{canReview && <Button view="outlined" size="s" onClick={() => setShowForm(value => !value)}>{showForm ? "Cancel" : "Add observation"}</Button>}</div>
    <p>Only reviewed, source-backed observations describe confirmed activity. This timeline does not predict a next step.</p>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success" role="status">{notice}</p>}
    {showForm && canReview && <form className="ttp-form" onSubmit={event => void submit(event)}>
      <label>ATT&amp;CK technique<select required value={form.techniqueId} onChange={event => setField("techniqueId", event.target.value)}><option value="">Select technique</option>{techniques.map(item => <option key={item.id} value={item.id}>{item.externalId} · {item.name}</option>)}</select></label>
      <label>Linked SIR evidence<select required value={form.evidenceId} onChange={event => setField("evidenceId", event.target.value)}><option value="">Select evidence</option>{evidence.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      {evidence.length === 0 && <p>No SIR evidence is linked to this {actorId ? "actor" : "campaign"}. Attach evidence in a SIR first.</p>}
      <label>ATT&amp;CK version<input required maxLength={160} value={form.attackVersion} onChange={event => setField("attackVersion", event.target.value)} placeholder="e.g. Enterprise v18" /></label>
      <label>Observed from<input required type="datetime-local" value={form.start} onChange={event => setField("start", event.target.value)} /></label>
      <label>Observed until<input type="datetime-local" min={form.start} value={form.end} onChange={event => setField("end", event.target.value)} /></label>
      <label>Time precision<select value={form.precision} onChange={event => setPrecision(event.target.value)}><option>INSTANT</option><option>HOUR</option><option>DAY</option><option>INTERVAL</option></select></label>
      <label>TLP<select value={form.tlp} onChange={event => setTlp(event.target.value)}><option>CLEAR</option><option>GREEN</option><option>AMBER</option><option>AMBER_STRICT</option><option>RED</option></select></label>
      <label>Actor attribution confidence<input type="number" min="0" max="100" value={form.actorConfidence} onChange={event => setField("actorConfidence", event.target.value)} /></label>
      <label>Technique mapping confidence<input required type="number" min="0" max="100" value={form.techniqueConfidence} onChange={event => setField("techniqueConfidence", event.target.value)} /></label>
      <label className="ttp-wide">Attribution and technique basis<textarea required minLength={10} maxLength={2000} value={form.basis} onChange={event => setField("basis", event.target.value)} /></label>
      <Button view="action" type="submit" disabled={busy || evidence.length === 0}>Create candidate</Button>
    </form>}
    {loading ? <p>Loading observations...</p> : items.length === 0 ? <p>No TTP observations recorded for this {actorId ? "actor" : "campaign"}.</p> : <ol className="ttp-list">{items.map((item) => {
      return <li key={item.id} className={`ttp-item ttp-${item.status.toLowerCase()}`}>
        <div className="ttp-row"><strong>{item.mitreTechnique.externalId} · {item.mitreTechnique.name}</strong><span className="cti-status">{statusLabel[item.status]}</span></div>
        <p>{item.mitreTechnique.tactic} · {new Date(item.observedStartAt).toLocaleString()} to {new Date(item.observedEndAt).toLocaleString()} · {item.timePrecision}{item.ordering === "OVERLAPS" ? " · Ordering uncertain: interval overlaps prior record" : ""}</p>
        <p>Evidence: {item.evidenceSnapshot} · TLP {item.tlp} · ATT&amp;CK {item.attackVersion}</p>
        <p>Basis: {item.attributionBasis}</p>
        <p>Source reliability {item.sourceReliability ?? "unassessed"} · Evidence credibility {item.evidenceCredibility ?? "unassessed"} · Actor attribution {item.actorConfidence ?? "unassessed"} · Technique mapping {item.techniqueConfidence}/100</p>
        {item.reviews.length > 0 && <ul>{item.reviews.map(event => <li key={event.id}>{event.status} by {event.reviewer.name} · {new Date(event.createdAt).toLocaleString()} · {event.reason}</li>)}</ul>}
        {canReview && item.status !== "REJECTED" && <div className="ttp-review"><label>Review reason<input minLength={10} maxLength={2000} value={reviewReasons[item.id] ?? ""} onChange={event => setReviewReasons(current => ({ ...current, [item.id]: event.target.value }))} /></label><div>{item.status !== "CONFIRMED" && <Button view="outlined" size="s" disabled={busy} onClick={() => void review(item, "CONFIRMED")}>Confirm</Button>}{item.status !== "DISPUTED" && <Button view="outlined" size="s" disabled={busy} onClick={() => void review(item, "DISPUTED")}>Dispute</Button>}<Button view="flat-danger" size="s" disabled={busy} onClick={() => void review(item, "REJECTED")}>Reject</Button></div></div>}
      </li>;
    })}</ol>}
  </section>;
}
