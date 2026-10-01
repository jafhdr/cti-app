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
  it('does not confirm a version that cannot be parsed', () => {
    expect(matchVersion({ ...service, version: '8.4p1' }, vulnerability)?.confidence).toBe('MEDIUM');
  });
  it('does not match a closed service or another product', () => {
    expect(matchVersion({ ...service, status: 'CLOSED' }, vulnerability)).toBeNull();
    expect(matchVersion(service, { ...vulnerability, affectedProduct: 'nginx' })).toBeNull();
  });
});
