'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { FormModal } from '@/components/ui/modal-patterns';
import { useAppSec } from './AppSecShell';
import { appsecUrl, emptyApplicationForm, errorMessage, type Application, type ApplicationFormValue } from './types';

const criticalities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const statuses = ['ACTIVE', 'INACTIVE'] as const;

type Props = { readonly open: boolean; readonly application?: Application | null; readonly onClose: () => void; readonly onSaved: (application: Application) => void };
export function ApplicationForm({ open, application, onClose, onSaved }: Props) {
  const { role, tenantId } = useAppSec();
  const [form, setForm] = useState<ApplicationFormValue>(emptyApplicationForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setForm(application ? { name: application.name, description: application.description ?? '', criticality: application.criticality, status: application.status, owner: application.owner ?? '', repositoryUrl: application.repositoryUrl ?? '' } : emptyApplicationForm);
    setError('');
  }, [application, open]);
  function change(key: keyof ApplicationFormValue, value: string): void { setForm(current => ({ ...current, [key]: value })); }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setSaving(true); setError('');
    const path = application ? `/appsec/applications/${application.id}` : '/appsec/applications';
    try {
      const response = await fetch(appsecUrl(path, role, tenantId), { method: application ? 'PATCH' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(application ? { ...form, repositoryUrl: form.repositoryUrl || null } : { name: form.name, description: form.description, criticality: form.criticality, owner: form.owner, repositoryUrl: form.repositoryUrl || null }) });
      const body: Application & { readonly message?: string | readonly string[] } = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? 'Nama aplikasi sudah digunakan dalam tenant ini.' : errorMessage(body, 'Gagal menyimpan aplikasi.', response.status));
      onSaved(body); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Gagal menyimpan aplikasi.'); }
    finally { setSaving(false); }
  }
  return <FormModal open={open} onOpenChange={value => { if (!value) onClose(); }} title={application ? 'Edit application' : 'Create application'} description="Application Inventory" submitLabel={application ? 'Save changes' : 'Create application'} loading={saving} error={error} onSubmit={event => void submit(event)}>
    <div className="appsec-form-grid">
      <label>Name *<input required maxLength={255} value={form.name} onChange={event => change('name', event.target.value)} /></label>
      <label>Criticality *<select value={form.criticality} onChange={event => change('criticality', criticalities.find(value => value === event.target.value) ?? 'MEDIUM')}>{criticalities.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Status<select value={form.status} disabled={!application} onChange={event => change('status', statuses.find(value => value === event.target.value) ?? 'ACTIVE')}>{statuses.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Owner<input maxLength={255} value={form.owner} onChange={event => change('owner', event.target.value)} /></label>
      <label className="appsec-form-wide">Repository URL<input type="url" maxLength={2048} value={form.repositoryUrl} onChange={event => change('repositoryUrl', event.target.value)} /></label>
      <label className="appsec-form-wide">Description<textarea maxLength={2000} rows={4} value={form.description} onChange={event => change('description', event.target.value)} /></label>
    </div>
  </FormModal>;
}
