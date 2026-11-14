import { randomUUID } from 'node:crypto';
import { recoverSandboxSchema } from './playbook.dto';

describe('sandbox rollback recovery boundary', () => {
  it('accepts a reason and stable idempotency key', () => {
    const key = randomUUID();
    expect(recoverSandboxSchema.parse({ reason: 'Operator checked the failed rollback and sandbox tool.', idempotencyKey: key }).idempotencyKey).toBe(key);
  });

  it.each([
    { reason: 'short', idempotencyKey: randomUUID() },
    { reason: 'Operator checked the failed rollback.', idempotencyKey: 'not-a-uuid' },
    { reason: 'Operator checked the failed rollback.', idempotencyKey: randomUUID(), target: 'external.example.com' },
  ])('rejects invalid or expanded recovery input', input => {
    expect(recoverSandboxSchema.safeParse(input).success).toBe(false);
  });
});
