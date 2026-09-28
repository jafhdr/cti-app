import type { ModulePolicy } from '@/lib/access-policy';

type Update = { readonly isEnabled?: boolean; readonly access?: { readonly ADMIN?: boolean; readonly USER?: boolean } };
export function ModulePolicyCard({ module, superAdmin, saving, onUpdate, onToggleGlobal }: { readonly module: ModulePolicy; readonly superAdmin: boolean; readonly saving: boolean; readonly onUpdate: (body: Update) => void; readonly onToggleGlobal: () => void }) {
  return <article className="module-card">
    <div className="module-card-top"><span className="module-category">{module.category}</span><span className={module.subscriptionIncluded ? 'module-status is-active' : 'module-status is-inactive'}>{module.subscriptionIncluded ? 'Included' : 'Not Included'}</span></div>
    <h2>{module.name}</h2><p>{module.description}</p>
    <dl className="access-policy-details">
      <div><dt>Module Included</dt><dd>{module.subscriptionIncluded ? 'Included' : 'Not Included'}</dd></div>
      <div><dt>Subscription</dt><dd>{module.subscriptionActive ? 'Active' : 'Inactive'}</dd></div>
      <div><dt>Source</dt><dd>{module.subscriptionSource ?? 'Belum berlangganan'}</dd></div>
      <div><dt>Global Module</dt><dd>{module.isActive ? 'Active' : 'Inactive'}</dd></div>
      <div><dt>Tenant Enabled</dt><dd>{module.tenantEnabled ? 'Enabled' : 'Disabled'}</dd></div>
      <div><dt>Role Access ADMIN</dt><dd>{module.roleAccess.ADMIN ? 'Allowed' : 'Denied'}</dd></div>
      <div><dt>Role Access USER</dt><dd>{module.roleAccess.USER ? 'Allowed' : 'Denied'}</dd></div>
    </dl>
    <div className="module-divider" />
    <strong>Effective Policy (sebelum User Assigned)</strong>
    <p>Akses user tetap memerlukan assignment dan Feature Access.</p>
    {(['ADMIN', 'USER'] as const).map(role => <p key={role}><strong>{role}: {module.policyAccess[role].accessible ? 'Eligible' : 'Not Accessible'}</strong>{module.policyAccess[role].reason && <><br />{module.policyAccess[role].reason}</>}</p>)}
    <div className="module-controls">
      <label className="module-toggle"><input type="checkbox" checked={module.tenantEnabled} disabled={saving} onChange={event => onUpdate({ isEnabled: event.target.checked })} /><span>Tenant Enabled</span></label>
      {superAdmin && <><label className="module-toggle"><input type="checkbox" checked={module.isActive} disabled={saving} onChange={onToggleGlobal} /><span>Global Module Active</span></label><label className="module-toggle"><input type="checkbox" checked={module.roleAccess.ADMIN} disabled={saving} onChange={event => onUpdate({ access: { ADMIN: event.target.checked } })} /><span>Role Access ADMIN</span></label></>}
      <label className="module-toggle"><input type="checkbox" checked={module.roleAccess.USER} disabled={saving} onChange={event => onUpdate({ access: { USER: event.target.checked } })} /><span>Role Access USER</span></label>
    </div>
    <div className="module-divider" /><strong>Feature Access catalog</strong>{module.features.length ? <ul>{module.features.map(feature => <li key={feature.id}>{feature.name}</li>)}</ul> : <p>Belum ada feature resmi untuk modul ini.</p>}
  </article>;
}
