import { evaluateCorrelation, normalizeObservable } from './correlation-rules';

describe('correlation pilot rules', () => {
  test('Given a mixed-case domain, when normalized, then matching is case-insensitive', () => {
    expect(normalizeObservable('DOMAIN', ' Evil.Example. ')).toBe('evil.example');
  });

  test('Given observations inside the window, when matched, then evidence and score are returned', () => {
    const result = evaluateCorrelation({ type: 'DOMAIN', value: 'evil.example', observedAt: new Date('2026-11-09T00:01:00Z'), confidence: 80, ioaKind: 'DNS_QUERY' },
      { type: 'DOMAIN', value: 'EVIL.EXAMPLE', observedAt: new Date('2026-11-09T00:00:00Z'), confidence: 90 });
    expect(result).toEqual({ matched: true, score: 85, reason: 'EXACT_IOC_WITHIN_5_MINUTES' });
  });

  test('Given delayed, mismatched, or low-confidence input, when evaluated, then no alert match is made', () => {
    const feed = { type: 'DOMAIN' as const, value: 'evil.example', observedAt: new Date('2026-11-09T00:00:00Z'), confidence: 90 };
    expect(evaluateCorrelation({ type: 'DOMAIN', value: 'evil.example', observedAt: new Date('2026-11-09T00:06:00Z'), confidence: 90, ioaKind: 'DNS_QUERY' }, feed).matched).toBe(false);
    expect(evaluateCorrelation({ type: 'DOMAIN', value: 'other.example', observedAt: feed.observedAt, confidence: 90, ioaKind: 'DNS_QUERY' }, feed).matched).toBe(false);
    expect(evaluateCorrelation({ type: 'DOMAIN', value: 'evil.example', observedAt: feed.observedAt, confidence: 10, ioaKind: 'DNS_QUERY' }, feed).matched).toBe(false);
  });
});
