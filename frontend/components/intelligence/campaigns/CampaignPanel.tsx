import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  campaignSeverities,
  campaignStatuses,
  type Campaign,
  type CampaignForm,
  type RelationActor,
  type RelationIndicator,
  type RelationMitreTechnique,
} from "./types";
type Props = {
  readonly campaign: Campaign | null;
  readonly form: CampaignForm;
  readonly actors: readonly RelationActor[];
  readonly indicators: readonly RelationIndicator[];
  readonly mitreTechniques: readonly RelationMitreTechnique[];
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly onChange: (
    key: keyof CampaignForm,
    value: string | readonly string[],
  ) => void;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent) => void;
};
export function CampaignPanel({
  campaign,
  form,
  actors,
  indicators,
  mitreTechniques,
  readOnly,
  saving,
  onChange,
  onClose,
  onSubmit,
}: Props) {
  const title = readOnly
    ? (campaign?.name ?? "Campaign detail")
    : campaign
      ? "Edit campaign"
      : "Create campaign";
  return (
    <Card
      view="outlined"
      className="source-panel"
      role="region"
      aria-label={title}
    >
      <div className="source-panel-heading">
        <div>
          <span className="source-eyebrow">CAMPAIGN RECORD</span>
          <h2>{title}</h2>
        </div>
        <Button view="flat" onClick={onClose}>
          Close
        </Button>
      </div>
      {readOnly && campaign ? (
        <>
          <dl className="source-detail">
            <Detail
              label="Threat actor"
              value={campaign.threatActor.entity.name}
            />
            <Detail
              label="Indicators"
              value={`${campaign._count.indicators} indicator${campaign._count.indicators === 1 ? "" : "s"}`}
            />
            <Detail label="MITRE techniques" value={String(campaign._count.mitreTechniques)} />
            <Detail label="Status" value={campaign.status} />
            <Detail label="Severity" value={campaign.severity} />
            <Detail label="Confidence" value={`${campaign.confidence}%`} />
            <Detail
              label="Timeline"
              value={`${formatDate(campaign.startDate)} - ${formatDate(campaign.endDate)}`}
            />
            <Detail label="External ID" value={campaign.externalId} />
            <Detail label="Reference URL" value={campaign.referenceUrl} />
            <Detail label="Objective" value={campaign.objective} wide />
            <Detail label="Description" value={campaign.description} wide />
          </dl>
          <section className="actor-related">
            <h3>Linked indicators</h3>
            {campaign.indicators.length === 0 ? (
              <p>No linked indicators.</p>
            ) : (
              <ul>
                {campaign.indicators.map(({ indicator }) => (
                  <li key={indicator.id}>
                    <span>{indicator.type}</span>
                    <strong>{indicator.value}</strong>
                    <small>
                      {indicator.severity} · {indicator.status}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="actor-related">
            <h3>MITRE ATT&amp;CK techniques</h3>
            {campaign.mitreTechniques.length === 0 ? <p>No linked MITRE techniques.</p> : <ul>{campaign.mitreTechniques.map(({ mitreTechnique }) => <li key={mitreTechnique.id}><span>{mitreTechnique.externalId}</span><strong>{mitreTechnique.name}</strong><small>{mitreTechnique.tactic} · {mitreTechnique.platform}</small></li>)}</ul>}
          </section>
        </>
      ) : (
        <form className="ioc-form" onSubmit={onSubmit}>
          <Field label="Name">
            <input
              required
              maxLength={160}
              value={form.name}
              onChange={(event) => onChange("name", event.target.value)}
            />
          </Field>
          <Field label="Threat actor">
            <select
              required
              value={form.threatActorId}
              onChange={(event) =>
                onChange("threatActorId", event.target.value)
              }
            >
              <option value="">Select threat actor</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.entity.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(event) => onChange("status", event.target.value)}
            >
              {campaignStatuses.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="Severity">
            <select
              value={form.severity}
              onChange={(event) => onChange("severity", event.target.value)}
            >
              {campaignSeverities.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="Confidence">
            <input
              required
              type="number"
              min="0"
              max="100"
              value={form.confidence}
              onChange={(event) => onChange("confidence", event.target.value)}
            />
          </Field>
          <Field label="External ID">
            <input
              maxLength={160}
              value={form.externalId}
              onChange={(event) => onChange("externalId", event.target.value)}
            />
          </Field>
          <Field label="Start date">
            <input
              type="date"
              value={form.startDate}
              onChange={(event) => onChange("startDate", event.target.value)}
            />
          </Field>
          <Field label="End date">
            <input
              type="date"
              min={form.startDate || undefined}
              value={form.endDate}
              onChange={(event) => onChange("endDate", event.target.value)}
            />
          </Field>
          <Field label="Reference URL" wide>
            <input
              type="url"
              value={form.referenceUrl}
              onChange={(event) => onChange("referenceUrl", event.target.value)}
            />
          </Field>
          <Field label="Objective" wide>
            <textarea
              maxLength={2000}
              value={form.objective}
              onChange={(event) => onChange("objective", event.target.value)}
            />
          </Field>
          <Field label="Description" wide>
            <textarea
              maxLength={4000}
              value={form.description}
              onChange={(event) => onChange("description", event.target.value)}
            />
          </Field>
          <Field label="Indicators" wide>
            <select
              multiple
              size={Math.min(Math.max(indicators.length, 3), 8)}
              value={[...form.indicatorIds]}
              onChange={(event) =>
                onChange(
                  "indicatorIds",
                  [...event.currentTarget.selectedOptions].map(
                    (option) => option.value,
                  ),
                )
              }
            >
              {indicators.map((indicator) => (
                <option key={indicator.id} value={indicator.id}>
                  {indicator.value} · {indicator.type} · {indicator.severity}
                </option>
              ))}
            </select>
            <small className="campaign-helper">
              Use Ctrl/Cmd to select multiple existing indicators.
            </small>
          </Field>
          <Field label="MITRE techniques" wide>
            <select multiple size={Math.min(Math.max(mitreTechniques.length, 3), 8)} value={[...form.mitreTechniqueIds]} onChange={(event) => onChange("mitreTechniqueIds", [...event.currentTarget.selectedOptions].map((option) => option.value))}>
              {mitreTechniques.map((technique) => <option key={technique.id} value={technique.id}>{technique.externalId} · {technique.name} · {technique.tactic}</option>)}
            </select>
            <small className="campaign-helper">Use Ctrl/Cmd to add or remove existing techniques.</small>
          </Field>
          <div className="ioc-actions">
            <Button view="action" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save campaign"}
            </Button>
            <Button view="outlined" type="button" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
function Field({
  label,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <label className={wide ? "ioc-wide" : undefined}>
      {label}
      {children}
    </label>
  );
}
function Detail({
  label,
  value,
  wide = false,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly wide?: boolean;
}) {
  return (
    <div className={wide ? "source-detail-wide" : undefined}>
      <dt>{label}</dt>
      <dd>
        {label === "Severity" && value ? (
          <span className={`ioc-severity severity-${value.toLowerCase()}`}>
            {value}
          </span>
        ) : (
          value || "-"
        )}
      </dd>
    </div>
  );
}
function formatDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "ongoing";
}
