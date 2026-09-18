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
const virusTotalResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    type: z.string(),
    attributes: z.object({
      reputation: z.number().optional(),
      last_analysis_date: z.number().int().optional(),
      last_analysis_stats: z.record(z.string(), z.number().int().nonnegative()).optional(),
    }).passthrough(),
  }),
});

export const ENRICHMENT_PROVIDERS = ['AUTO', 'VIRUSTOTAL'] as const;
export type EnrichmentProvider = typeof ENRICHMENT_PROVIDERS[number];

export type EnrichmentResult = { readonly provider: string; readonly data: Prisma.InputJsonValue };

export class UnsupportedIndicatorTypeError extends Error {
  constructor(readonly indicatorType: IndicatorType) {
    super(`Enrichment belum tersedia untuk tipe ${indicatorType}`);
    this.name = 'UnsupportedIndicatorTypeError';
  }
}

export class EnrichmentConfigurationError extends Error {
  constructor(readonly variable: string) {
    super(`${variable} belum dikonfigurasi`);
    this.name = 'EnrichmentConfigurationError';
  }
}

export class InvalidIndicatorValueError extends Error {
  constructor(readonly indicatorType: IndicatorType) {
    super(`Nilai ${indicatorType} tidak valid untuk VirusTotal`);
    this.name = 'InvalidIndicatorValueError';
  }
}

@Injectable()
export class IndicatorEnrichmentClient {
  provider(type: IndicatorType, provider: EnrichmentProvider = 'AUTO'): string {
    if (provider === 'VIRUSTOTAL') return 'VIRUSTOTAL';
    return type === 'IP_ADDRESS' ? 'IPWHOIS' : type === 'FILE_HASH' ? 'UNSUPPORTED' : 'CLOUDFLARE_DNS';
  }

  async enrich(type: IndicatorType, value: string, provider: EnrichmentProvider = 'AUTO'): Promise<EnrichmentResult> {
    if (provider === 'VIRUSTOTAL') return this.enrichVirusTotal(type, value);
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

  private async enrichVirusTotal(type: IndicatorType, value: string): Promise<EnrichmentResult> {
    const apiKey = process.env.VIRUSTOTAL_API_KEY?.trim();
    if (!apiKey) throw new EnrichmentConfigurationError('VIRUSTOTAL_API_KEY');
    const target = this.virusTotalTarget(type, value);
    const baseUrl = (process.env.VIRUSTOTAL_API_BASE_URL ?? 'https://www.virustotal.com/api/v3').replace(/\/$/, '');
    const timeout = this.virusTotalTimeout();
    const response = virusTotalResponseSchema.parse(await this.getJson(`${baseUrl}/${target}`, { 'x-apikey': apiKey }, timeout));
    const stats = response.data.attributes.last_analysis_stats ?? {};
    const detections = {
      malicious: stats.malicious ?? 0,
      suspicious: stats.suspicious ?? 0,
      harmless: stats.harmless ?? 0,
      undetected: stats.undetected ?? 0,
      timeout: stats.timeout ?? 0,
      total: Object.values(stats).reduce((total, count) => total + count, 0),
    };
    return {
      provider: 'VIRUSTOTAL',
      data: {
        objectId: response.data.id,
        objectType: response.data.type,
        reputation: response.data.attributes.reputation ?? null,
        detections,
        analysisAt: response.data.attributes.last_analysis_date
          ? new Date(response.data.attributes.last_analysis_date * 1_000).toISOString()
          : null,
      },
    };
  }

  private virusTotalTarget(type: IndicatorType, value: string): string {
    const normalized = value.trim();
    if (type === 'IP_ADDRESS') return `ip_addresses/${encodeURIComponent(normalized)}`;
    if (type === 'DOMAIN') {
      if (!normalized || normalized.includes('/') || normalized.includes('@')) throw new InvalidIndicatorValueError(type);
      return `domains/${encodeURIComponent(normalized.toLowerCase())}`;
    }
    if (type === 'URL') {
      try {
        const url = new URL(normalized);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new InvalidIndicatorValueError(type);
        return `urls/${Buffer.from(url.toString()).toString('base64url')}`;
      } catch (cause) {
        if (cause instanceof InvalidIndicatorValueError) throw cause;
        throw new InvalidIndicatorValueError(type);
      }
    }
    if (type === 'FILE_HASH') {
      if (!/^(?:[a-f\d]{32}|[a-f\d]{40}|[a-f\d]{64})$/i.test(normalized)) throw new InvalidIndicatorValueError(type);
      return `files/${normalized.toLowerCase()}`;
    }
    throw new UnsupportedIndicatorTypeError(type);
  }

  private virusTotalTimeout(): number {
    const configured = Number(process.env.VIRUSTOTAL_TIMEOUT_MS ?? 15_000);
    return Number.isFinite(configured) && configured > 0 ? configured : 15_000;
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

  private async getJson(url: string, headers: Readonly<Record<string, string>>, timeout = 15_000): Promise<unknown> {
    let response;
    try {
      response = await request(url, { method: 'GET', headers, headersTimeout: timeout, bodyTimeout: timeout, signal: AbortSignal.timeout(timeout) });
    } catch (cause) {
      if (cause instanceof Error && /timeout/i.test(`${cause.name} ${cause.message}`)) throw new Error(`Provider timeout setelah ${timeout} ms`);
      throw cause;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Provider HTTP status ${response.statusCode}`);
    return response.body.json();
  }
}
