import { resolveMetricsPeriod } from './effectiveness-metrics.period';

describe('CTI metrics period', () => {
  it('uses an exclusive UTC end for a custom calendar range', () => {
    // Given a requested two-day UTC calendar range.
    const now = new Date('2026-10-26T08:00:00.000Z');
    // When the period is resolved.
    const period = resolveMetricsPeriod({ range: 'custom', from: '2026-10-01', to: '2026-10-02' }, now);
    // Then both requested days are included without including the following day.
    expect(period.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('rejects an inverted custom range', () => {
    // Given a later start date.
    const now = new Date('2026-10-26T08:00:00.000Z');
    // When the period is resolved, then the invalid request fails.
    expect(() => resolveMetricsPeriod({ range: 'custom', from: '2026-10-03', to: '2026-10-02' }, now)).toThrow();
  });

  it('uses a rolling 30-day window ending at the query instant', () => {
    // Given a fixed query instant.
    const now = new Date('2026-10-26T08:00:00.000Z');
    // When the preset is resolved.
    const period = resolveMetricsPeriod({ range: '30d' }, now);
    // Then the bounded interval has exactly 30 days.
    expect(period.to.toISOString()).toBe(now.toISOString());
    expect(period.from.toISOString()).toBe('2026-09-26T08:00:00.000Z');
  });
});
