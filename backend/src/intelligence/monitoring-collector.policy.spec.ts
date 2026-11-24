import { monitoringSimulatorEndpoint } from './monitoring-collector-policy';

describe('monitoring collector policy', () => {
  it('allows only the fixed loopback simulator path', () => {
    expect(monitoringSimulatorEndpoint('http://127.0.0.1:43123/v1/collect')).toBe('http://127.0.0.1:43123/v1/collect');
  });

  it.each([
    undefined,
    'https://127.0.0.1:43123/v1/collect',
    'http://localhost:43123/v1/collect',
    'http://production.example.test/v1/collect',
    'http://127.0.0.1:43123/v1/other',
    'http://127.0.0.1:43123/v1/collect?token=secret',
  ])('rejects unavailable or non-loopback simulator endpoint %s', endpoint => {
    expect(() => monitoringSimulatorEndpoint(endpoint)).toThrow();
  });
});
