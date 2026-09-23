import { Injectable, Logger } from '@nestjs/common';
import { isIP } from 'node:net';
import { request } from 'undici';
import { z } from 'zod';

// ─── Timeout constant ────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_DNS_ANSWERS = 500;

// ─── Zod schemas ─────────────────────────────────────────────────────────────
const dnsJsonResponseSchema = z.object({
  Status: z.number().int(),
  Answer: z
    .array(
      z.object({
        name: z.string(),
        type: z.number().int(),
        TTL: z.number().int(),
        data: z.string(),
      }),
    )
    .optional(),
});

const crtshEntrySchema = z.object({ name_value: z.string() });
const crtshResponseSchema = z.array(crtshEntrySchema);

// ─── Error classes ───────────────────────────────────────────────────────────
export class DiscoveryTimeoutError extends Error {
  readonly name = 'DiscoveryTimeoutError';
  constructor(readonly provider: string, readonly timeoutMs: number) {
    super(`Discovery provider "${provider}" timed out after ${timeoutMs} ms`);
  }
}

export class DiscoveryNetworkError extends Error {
  readonly name = 'DiscoveryNetworkError';
  constructor(readonly provider: string, readonly cause: Error) {
    super(`Discovery provider "${provider}" network error: ${cause.message}`);
  }
}

export class DiscoveryHttpError extends Error {
  readonly name = 'DiscoveryHttpError';
  constructor(readonly provider: string, readonly statusCode: number) {
    super(`Discovery provider "${provider}" returned HTTP ${statusCode}`);
  }
}

// ─── Result type ──────────────────────────────────────────────────────────────
export interface DiscoveryProviderResult {
  readonly provider: string;
  readonly hostnames: readonly string[];
  readonly error?: string;
}

export interface DnsResolutionResult {
  readonly provider: string;
  readonly hostname: string;
  readonly ipv4: readonly string[];
  readonly ipv6: readonly string[];
  readonly cnames: readonly string[];
  readonly errors: readonly string[];
}

// ─── Client ──────────────────────────────────────────────────────────────────
@Injectable()
export class DiscoveryClient {
  private readonly logger = new Logger(DiscoveryClient.name);

  /** DNS-over-HTTPS via Cloudflare – discovers NS/MX/CNAME subdomains. No brute-force. */
  async discoverViaDns(domain: string): Promise<DiscoveryProviderResult> {
    const provider = 'CLOUDFLARE_DOH';
    const discovered = new Set<string>();
    const errors: string[] = [];
    const recordTypes = [
      { type: 'NS', code: 2 },
      { type: 'MX', code: 15 },
      { type: 'CNAME', code: 5 },
    ];

    for (const { type, code } of recordTypes) {
      try {
        const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`;
        const payload = await this.getJson(url, { Accept: 'application/dns-json' }, provider);
        const parsed = dnsJsonResponseSchema.parse(payload);
        if (parsed.Status === 0 && parsed.Answer) {
          for (const record of parsed.Answer) {
            const raw = record.data.replace(/\.$/, '').toLowerCase().trim();
            let host = raw;
            if (code === 15) {
              // MX data is "priority hostname"
              const parts = raw.split(/\s+/);
              host = parts[parts.length - 1];
            }
            if (host && this.isSubdomainOf(host, domain)) discovered.add(host);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`[${type}] ${message}`);
        this.logger.warn(`DNS ${type} for ${domain} failed: ${message}`);
      }
    }
    const result = { provider, hostnames: [...discovered] };
    return errors.length > 0 ? { ...result, error: errors.join('; ') } : result;
  }

  /** Certificate Transparency via crt.sh – no API key required. */
  async discoverViaCertTransparency(domain: string): Promise<DiscoveryProviderResult> {
    const provider = 'CRTSH';
    try {
      const url = `https://crt.sh/?q=%.${encodeURIComponent(domain)}&output=json`;
      const payload = await this.getJson(url, {}, provider);
      const entries = crtshResponseSchema.parse(payload);
      const discovered = new Set<string>();
      for (const entry of entries) {
        const names = entry.name_value.split(/\n/).map((n) => n.replace(/^\*\./, '').toLowerCase().trim());
        for (const name of names) {
          if (name && this.isSubdomainOf(name, domain)) discovered.add(name);
        }
      }
      return { provider, hostnames: [...discovered] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`CRTSH for ${domain} failed: ${message}`);
      return { provider, hostnames: [], error: message };
    }
  }

  async resolveDns(hostname: string): Promise<DnsResolutionResult> {
    const provider = 'CLOUDFLARE_DOH';
    const recordTypes = [
      { name: 'A', code: 1 },
      { name: 'AAAA', code: 28 },
      { name: 'CNAME', code: 5 },
    ] as const;
    const answers = await Promise.allSettled(recordTypes.map(async ({ name, code }) => {
      const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${name}`;
      const payload = await this.getJson(url, { Accept: 'application/dns-json' }, provider);
      const response = dnsJsonResponseSchema.parse(payload);
      if (response.Status !== 0) return { name, values: [] } as const;
      const values = (response.Answer ?? [])
        .filter((record) => record.type === code)
        .slice(0, MAX_DNS_ANSWERS)
        .map((record) => record.data.replace(/\.$/, '').toLowerCase().trim());
      return { name, values } as const;
    }));

    const records = new Map<string, readonly string[]>();
    const errors: string[] = [];
    for (const answer of answers) {
      if (answer.status === 'fulfilled') {
        records.set(answer.value.name, answer.value.values);
      } else {
        errors.push(answer.reason instanceof Error ? answer.reason.message : String(answer.reason));
      }
    }

    return {
      provider,
      hostname,
      ipv4: [...new Set(records.get('A') ?? [])].filter((value) => isIP(value) === 4),
      ipv6: [...new Set(records.get('AAAA') ?? [])].filter((value) => isIP(value) === 6),
      cnames: [...new Set(records.get('CNAME') ?? [])].filter((value) => this.isValidHostname(value)),
      errors,
    };
  }

  /** True only if hostname is a strict subdomain of domain (not the root itself). */
  isSubdomainOf(hostname: string, domain: string): boolean {
    const h = hostname.toLowerCase().trim();
    const d = domain.toLowerCase().trim();
    if (h === d) return false;
    return h.endsWith(`.${d}`);
  }

  /** RFC 1123 hostname validation. */
  isValidHostname(hostname: string): boolean {
    if (!hostname || hostname.length > 253) return false;
    const labels = hostname.split('.');
    return labels.every(
      (l) => l.length > 0 && l.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(l),
    );
  }

  private async getJson(
    url: string,
    headers: Readonly<Record<string, string>>,
    provider: string,
  ): Promise<unknown> {
    const timeout = this.timeoutMs();
    let response: Awaited<ReturnType<typeof request>>;
    try {
      response = await request(url, {
        method: 'GET',
        headers,
        headersTimeout: timeout,
        bodyTimeout: timeout,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (cause) {
      if (cause instanceof Error && /timeout|abort/i.test(`${cause.name} ${cause.message}`)) {
        throw new DiscoveryTimeoutError(provider, timeout);
      }
      if (cause instanceof Error) throw new DiscoveryNetworkError(provider, cause);
      throw cause;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new DiscoveryHttpError(provider, response.statusCode);
    }
    return response.body.json();
  }

  private timeoutMs(): number {
    const v = Number(process.env.ASM_DISCOVERY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
  }
}
