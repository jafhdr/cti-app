type Metric = { readonly label: string; readonly value: string | number };

export function Phase2bSummary({ title, metrics }: { readonly title: string; readonly metrics: readonly Metric[] }) {
  return <section className="ti-phase2b-summary" aria-label={title}>
    <span className="source-eyebrow">{title}</span>
    <div className="editorial-metrics">{metrics.map(metric => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}</div>
  </section>;
}
