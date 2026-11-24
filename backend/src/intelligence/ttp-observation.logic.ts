type Interval = { readonly start: string; readonly end: string };

export function classifyTemporalOrder(left: Interval, right: Interval): 'BEFORE' | 'AFTER' | 'OVERLAPS' {
  if (Date.parse(left.end) < Date.parse(right.start)) return 'BEFORE';
  if (Date.parse(right.end) < Date.parse(left.start)) return 'AFTER';
  return 'OVERLAPS';
}
