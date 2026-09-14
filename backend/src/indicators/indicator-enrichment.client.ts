import { Injectable } from '@nestjs/common';
import { request } from 'undici';
import { z } from 'zod';
import type { IndicatorType, Prisma } from '@prisma/client';

const dnsResponseSchema = z.object({
  Status: z.number().int(),
  Answer: z.array(z.object({ name: z.string(), type: z.number().int(), TTL: z.number().int(), data: z.string() })).optional(),
});
const ipResponseSchema = z.object({
  success: z.boolean(),
  ip: z.string().optional(),
  type: z.string().optional(),
  continent: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  city: z.string().optional(),
  connection: z.object({ asn: z.number().optional(), org: z.string().optional(), isp: z.string().optional(), domain: z.string().optional() }).optional(),
  timezone: z.object({ id: z.string().optional(), utc: z.string().optional() }).optional(),
  message: z.string().optional(),
});

export type EnrichmentResult = { readonly provider: string; readonly data: Prisma.InputJsonValue };

export class UnsupportedIndicatorTypeError extends Error {
  constructor(readonly indicatorType: IndicatorType) {
    super(`Enrichment belum tersedia untuk tipe ${indicatorType}`);
    this.name = 'UnsupportedIndicatorTypeError';
  }
}

@Injectable()
export class IndicatorEnrichmentClient {
  provider(type: IndicatorType): string {
    return type === 'IP_ADDRESS' ? 'IPWHOIS' : type === 'FILE_HASH' ? 'UNSUPPORTED' : 'CLOUDFLARE_DNS';
  }

  async enrich(type: IndicatorType, value: string): Promise<EnrichmentResult> {
    if (type === 'IP_ADDRESS') return this.enrichIp(value);
    if (type === 'FILE_HASH') throw new UnsupportedIndicatorTypeError(type);
    const host = this.hostname(type, value);
    const payload = await this.getJson(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, {
      Accept: 'application/dns-json',
    });
    const response = dnsResponseSchema.parse(payload);
    return {
      provider: 'CLOUDFLARE_DNS',
      data: { host, responseCode: response.Status, records: (response.Answer ?? []).map(answer => ({ type: answer.type, ttl: answer.TTL, value: answer.data })) },
    };
  }

  private async enrichIp(value: string): Promise<EnrichmentResult> {
    const response = ipResponseSchema.parse(await this.getJson(`https://ipwho.is/${encodeURIComponent(value)}`, {}));
    if (!response.success) throw new Error(response.message ?? 'IP enrichment gagal');
    return {
      provider: 'IPWHOIS',
      data: {
        ip: response.ip ?? value,
        ipVersion: response.type ?? null,
        location: { continent: response.continent ?? null, country: response.country ?? null, region: response.region ?? null, city: response.city ?? null },
        network: response.connection ?? null,
        timezone: response.timezone ?? null,
      },
    };
  }

  private hostname(type: IndicatorType, value: string): string {
    if (type === 'DOMAIN') return value.trim().toLowerCase();
    if (type === 'URL') return new URL(value).hostname.toLowerCase();
    if (type === 'EMAIL') {
      const separator = value.lastIndexOf('@');
      if (separator < 1 || separator === value.length - 1) throw new Error('Format email tidak valid');
      return value.slice(separator + 1).toLowerCase();
    }
    throw new UnsupportedIndicatorTypeError(type);
  }

  private async getJson(url: string, headers: Readonly<Record<string, string>>): Promise<unknown> {
    const response = await request(url, { method: 'GET', headers, headersTimeout: 15_000, bodyTimeout: 15_000 });
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Provider HTTP status ${response.statusCode}`);
    return response.body.json();
  }
}
