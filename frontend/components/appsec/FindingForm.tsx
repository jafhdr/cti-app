'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { FormModal } from '@/components/ui/modal-patterns';
import { useAppSec } from './AppSecShell';
import { appsecUrl, errorMessage, findingSeverities, type Finding, type FindingSeverity } from './types';

type Option = { readonly id: string; readonly name: string };
type Form = { readonly applicationId: string; readonly title: string; readonly description: string; readonly severity: FindingSeverity; readonly category: string; readonly cweId: string; readonly location: string; readonly remediationNote: string; readonly dueDate: string };
const empty: Form = { applicationId: '', title: '', description: '', severity: 'MEDIUM', category: '', cweId: '', location: '', remediationNote: '', dueDate: '' };
type Props = { readonly open: boolean; readonly finding?: Finding | null; readonly onClose: () => void; readonly onSaved: (finding: Finding) => void };

export function FindingForm({ open, finding, onClose, onSaved }: Props) {
  const { role, tenantId } = useAppSec();
  const [form, setForm] = useState<Form>(empty);
  const [options, setOptions] = useState<readonly Option[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setForm(finding ? { applicationId: finding.applicationId, title: finding.title, description: finding.description ?? '', severity: finding.severity, category: finding.category ?? '', cweId: finding.cweId ?? '', location: finding.location ?? '', remediationNote: finding.remediationNote ?? '', dueDate: finding.dueDate?.slice(0, 10) ?? '' } : empty);
    setError('');
    if (!open) return;
    let cancelled = false;
    async function load(): Promise<void> {
      setLoadingOptions(true);
      try {
        const response = await fetch(appsecUrl('/appsec/findings/applications', role, tenantId), { credentials: 'include', cache: 'no-store' });
        const body: readonly Option[] & { readonly message?: string | readonly string[] } = await response.json();
        if (!response.ok) throw new Error(errorMessage(body, 'Gagal memuat pilihan Application.', response.status));
        if (!cancelled) setOptions(body);
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Gagal memuat pilihan Application.'); }
      finally { if (!cancelled) setLoadingOptions(false); }
    }
    void load(); return () => { cancelled = true; };
  }, [finding, open, role, tenantId]);
  function change(key: keyof Form, value: string): void { setForm(current => ({ ...current, [key]: value })); }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setSaving(true); setError('');
    const path = finding ? `/appsec/findings/${finding.id}` : '/appsec/findings';
    const { applicationId, ...fields } = form;
    const payload = { ...fields, cweId: form.cweId || null, dueDate: form.dueDate ? new Date(`${form.dueDate}T00:00:00.000Z`).toISOString() : finding ? null : undefined, ...(finding ? { ...(finding.workflowVersion === 2 ? { expectedRevision: finding.revision } : {}) } : { applicationId }) };
    try {
      const response = await fetch(appsecUrl(path, role, tenantId), { method: finding ? 'PATCH' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body: Finding & { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, 'Gagal menyimpan Finding.', response.status));
      onSaved(body); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal menyimpan Finding.'); }
    finally { setSaving(false); }
  }
  return <FormModal open={open} onOpenChange={value => { if (!value) onClose(); }} title={finding ? 'Edit finding' : 'Create finding'} description="Manual AppSec finding" submitLabel={finding ? 'Save changes' : 'Create finding'} loading={saving || loadingOptions} error={error} onSubmit={event => void submit(event)}>
    <div className="appsec-form-grid">
      <label className="appsec-form-wide">Application *<select required disabled={Boolean(finding)} value={form.applicationId} onChange={event => change('applicationId', event.target.value)}><option value="">Select Application</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      <label className="appsec-form-wide">Title *<input required maxLength={255} value={form.title} onChange={event => change('title', event.target.value)} /></label>
      <label>Severity *<select value={form.severity} onChange={event => change('severity', findingSeverities.find(value => value === event.target.value) ?? 'MEDIUM')}>{findingSeverities.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Due date<input type="date" value={form.dueDate} onChange={event => change('dueDate', event.target.value)} /></label>
      <label>Category<input maxLength={255} value={form.category} onChange={event => change('category', event.target.value)} /></label>
      <label>CWE<input pattern="CWE-[1-9][0-9]*" placeholder="CWE-79" value={form.cweId} onChange={event => change('cweId', event.target.value)} /></label>
      <label className="appsec-form-wide">Location<input maxLength={2048} value={form.location} onChange={event => change('location', event.target.value)} /></label>
      <label className="appsec-form-wide">Description<textarea rows={3} maxLength={4000} value={form.description} onChange={event => change('description', event.target.value)} /></label>
      <label className="appsec-form-wide">Remediation note<textarea rows={3} maxLength={4000} value={form.remediationNote} onChange={event => change('remediationNote', event.target.value)} /></label>
    </div>
  </FormModal>;
}
