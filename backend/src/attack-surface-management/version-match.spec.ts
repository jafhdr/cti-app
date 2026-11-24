import { matchVersion } from './version-match';

const vulnerability = { affectedProduct: 'OpenSSH', affectedVersionExact: null, affectedVersionStart: '8.0', affectedVersionEnd: '8.9' };
const service = { status: 'OPEN' as const, product: 'openssh', version: '8.4' };

describe('conservative version correlation', () => {
  it('confirms a numeric version inside an inclusive range', () => {
    expect(matchVersion(service, vulnerability)?.confidence).toBe('HIGH');
  });
  it('rejects a non-vulnerable version using numeric comparison', () => {
    expect(matchVersion({ ...service, version: '8.10' }, vulnerability)).toBeNull();
  });
  it('keeps an unknown version as candidate', () => {
    expect(matchVersion({ ...service, version: null }, vulnerability)?.confidence).toBe('LOW');
  });
  it('confirms a portable patch strictly inside a numeric base range', () => {
    expect(matchVersion({ ...service, version: '8.4p1' }, vulnerability)?.confidence).toBe('HIGH');
  });
  it('keeps an unparseable version as an ambiguous candidate', () => {
    expect(matchVersion({ ...service, version: 'vendor-build' }, vulnerability)?.confidence).toBe('MEDIUM');
  });
  it('matches an exact OpenSSH portable patch', () => {
    expect(matchVersion({ ...service, version: '8.4p1' }, { ...vulnerability, affectedVersionExact: '8.4p1' })?.confidence).toBe('HIGH');
    expect(matchVersion({ ...service, version: '8.4p1' }, { ...vulnerability, affectedVersionExact: '8.4p2' })).toBeNull();
  });
  it('keeps an exact OpenSSH comparison ambiguous when one portable patch is omitted', () => {
    expect(matchVersion({ ...service, version: '8.4p1' }, { ...vulnerability, affectedVersionExact: '8.4' })).toEqual({
      confidence: 'MEDIUM', reason: 'Product matches; exact version cannot be safely compared',
    });
  });
  it('proves a portable patch is outside a range when its base version is outside', () => {
    expect(matchVersion({ ...service, version: '8.4p1' }, { ...vulnerability, affectedVersionEnd: '8.3' })).toBeNull();
    expect(matchVersion({ ...service, version: '8.4p1' }, { ...vulnerability, affectedVersionStart: '8.5' })).toBeNull();
  });
  it('keeps a portable patch ambiguous at a numeric range boundary', () => {
    expect(matchVersion({ ...service, version: '8.4p1' }, { ...vulnerability, affectedVersionStart: '8.4', affectedVersionEnd: '8.4' })).toEqual({
      confidence: 'MEDIUM', reason: 'Product matches; version range cannot be safely compared',
    });
  });
  it('compares portable patch bounds of the same OpenSSH base version', () => {
    expect(matchVersion({ ...service, version: '8.4p1' }, { ...vulnerability, affectedVersionStart: '8.4p1', affectedVersionEnd: '8.4p2' })?.confidence).toBe('HIGH');
    expect(matchVersion({ ...service, version: '8.4p3' }, { ...vulnerability, affectedVersionStart: '8.4p1', affectedVersionEnd: '8.4p2' })).toBeNull();
  });
  it('does not match a closed service or another product', () => {
    expect(matchVersion({ ...service, status: 'CLOSED' }, vulnerability)).toBeNull();
    expect(matchVersion(service, { ...vulnerability, affectedProduct: 'nginx' })).toBeNull();
  });
});
