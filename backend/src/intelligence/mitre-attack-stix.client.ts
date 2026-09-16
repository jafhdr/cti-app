import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errors, request } from 'undici';
import { z } from 'zod';

export const DEFAULT_MITRE_ATTACK_STIX_URL = 'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';
const DEFAULT_TIMEOUT_MS = 15_000;

const timeoutSchema = z.coerce.number().int().positive().max(120_000);
const stixBundleSchema = z.object({
  type: z.literal('bundle'),
  objects: z.array(z.json()),
}).catchall(z.json());

function isRequestTimeout(error: unknown): boolean {
  return error instanceof errors.HeadersTimeoutError
    || error instanceof errors.BodyTimeoutError
    || (error instanceof DOMException && error.name === 'TimeoutError');
}

export type StixBundle = z.infer<typeof stixBundleSchema>;

export class MitreAttackHttpError extends Error {
  readonly name = 'MitreAttackHttpError';
  constructor(readonly statusCode: number, readonly url: string) {
    super(`MITRE ATT&CK HTTP status ${statusCode}`);
  }
}

export class MitreAttackTimeoutError extends Error {
  readonly name = 'MitreAttackTimeoutError';
  constructor(readonly timeoutMs: number, readonly url: string) {
    super(`MITRE ATT&CK request timed out after ${timeoutMs} ms`);
  }
}

export class MitreAttackInvalidJsonError extends Error {
  readonly name = 'MitreAttackInvalidJsonError';
  constructor(readonly url: string) {
    super('MITRE ATT&CK response is not valid JSON');
  }
}

export class MitreAttackInvalidBundleError extends Error {
  readonly name = 'MitreAttackInvalidBundleError';
  constructor(readonly url: string) {
    super('MITRE ATT&CK response is not a STIX bundle');
  }
}

@Injectable()
export class MitreAttackStixClient {
  constructor(private readonly config: ConfigService) {}

  async fetchEnterpriseBundle(): Promise<StixBundle> {
    const url = this.config.get<string>('MITRE_ATTACK_STIX_URL') ?? DEFAULT_MITRE_ATTACK_STIX_URL;
    const timeoutMs = timeoutSchema.parse(this.config.get<string>('MITRE_ATTACK_STIX_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
    let response;
    try {
      response = await request(url, { method: 'GET', headers: { accept: 'application/json' }, headersTimeout: timeoutMs, bodyTimeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (isRequestTimeout(error)) throw new MitreAttackTimeoutError(timeoutMs, url);
      throw error;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) throw new MitreAttackHttpError(response.statusCode, url);

    let payload: unknown;
    try {
      payload = JSON.parse(await response.body.text());
    } catch (error) {
      if (isRequestTimeout(error)) throw new MitreAttackTimeoutError(timeoutMs, url);
      if (error instanceof SyntaxError) throw new MitreAttackInvalidJsonError(url);
      throw error;
    }
    const parsed = stixBundleSchema.safeParse(payload);
    if (!parsed.success) throw new MitreAttackInvalidBundleError(url);
    return parsed.data;
  }
}
