'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { assetCriticalities, assetStatuses, assetTypes, type Asset, type AssetFormValue } from './types';

type Props = {
  readonly asset: Asset | null;
  readonly form: AssetFormValue;
  readonly mode: 'form' | 'detail';
  readonly saving: boolean;
  readonly onChange: (key: keyof AssetFormValue, value: string) => void;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function AssetPanel({ asset, form, mode, saving, onChange, onClose, onSubmit }: Props) {
  const detail = mode === 'detail' && asset;
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => opener?.focus();
  }, []);
  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])');
    if (!focusable?.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className="asm-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="asm-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-panel-title" onKeyDown={handleKeyDown}>
      <header><div><span className="source-eyebrow">ASSET REGISTRY</span><h2 id="asset-panel-title">{detail ? 'Asset Detail' : asset ? 'Edit Asset' : 'Create Asset'}</h2></div><Button view="flat" size="s" aria-label="Close asset panel" onClick={onClose}><X size={16} /></Button></header>
      {detail ? <AssetDetails asset={asset} /> : <form className="asm-form" onSubmit={onSubmit}>
        <label>Name<input required maxLength={255} value={form.name} onChange={event => onChange('name', event.target.value)} /></label>
        <label>Type<select value={form.type} onChange={event => onChange('type', event.target.value)}>{assetTypes.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="asm-form-wide">Value<input required maxLength={1024} value={form.value} onChange={event => onChange('value', event.target.value)} /></label>
        <label>Status<select value={form.status} onChange={event => onChange('status', event.target.value)}>{assetStatuses.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Criticality<select value={form.criticality} onChange={event => onChange('criticality', event.target.value)}>{assetCriticalities.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Owner<input maxLength={255} value={form.owner} onChange={event => onChange('owner', event.target.value)} /></label>
        <label>First seen<input type="datetime-local" value={form.firstSeenAt} onChange={event => onChange('firstSeenAt', event.target.value)} /></label>
        <label>Last seen<input type="datetime-local" value={form.lastSeenAt} onChange={event => onChange('lastSeenAt', event.target.value)} /></label>
        <label className="asm-form-wide">Description<textarea rows={4} maxLength={2000} value={form.description} onChange={event => onChange('description', event.target.value)} /></label>
        <footer><Button type="button" view="outlined" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving...' : asset ? 'Save changes' : 'Create asset'}</Button></footer>
      </form>}
    </section>
  </div>;
}

function AssetDetails({ asset }: { readonly asset: Asset }) {
  const fields: readonly [string, string][] = [
    ['Name', asset.name], ['Value', asset.value], ['Type', asset.type], ['Owner', asset.owner || '-'], ['Description', asset.description || '-'],
    ['First seen', formatDate(asset.firstSeenAt)], ['Last seen', formatDate(asset.lastSeenAt)],
    ['Created', formatDate(asset.createdAt)], ['Updated', formatDate(asset.updatedAt)],
  ];
  return <dl className="asm-detail">{fields.slice(0, 3).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}<div><dt>Status</dt><dd><span className={`cti-status is-${asset.status.toLowerCase()}`}>{asset.status}</span></dd></div><div><dt>Criticality</dt><dd><span className={`ioc-severity severity-${asset.criticality.toLowerCase()}`}>{asset.criticality}</span></dd></div>{fields.slice(3).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

export function formatDate(value: string | null): string {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('id-ID');
}
