import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { request } from 'undici';
import { z } from 'zod';
import type { FeedProvider, NormalizedIndicator } from './indicator-feeds.types';

const providerApiKeyNames = {
  URLHAUS: 'URLHAUS_AUTH_KEY',
  MALWAREBAZAAR: 'MALWAREBAZAAR_AUTH_KEY',
  ABUSEIPDB: 'ABUSEIPDB_API_KEY',
} as const satisfies Record<FeedProvider, string>;

const urlhausResponseSchema = z.object({
  query_status: z.string(),
  urls: z.array(z.object({
    url: z.string().url(),
    url_status: z.string().nullable().optional(),
    threat: z.string().nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
  })),
});

const malwareBazaarResponseSchema = z.object({
  query_status: z.string(),
  data: z.array(z.object({
    sha256_hash: z.string().regex(/^[a-fA-F0-9]{64}$/),
    file_name: z.string().nullable().optional(),
    file_type: z.string().nullable().optional(),
    signature: z.string().nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
  })).optional(),
});

const abuseIpDbResponseSchema = z.object({
  data: z.array(z.object({
    ipAddress: z.string().min(2),
    countryCode: z.string().nullable().optional(),
    abuseConfidenceScore: z.number().int().min(0).max(100),
    lastReportedAt: z.string().nullable().optional(),
  })),
});

class FeedConfigurationError extends Error {
  constructor(readonly variableName: string) {
    super(`Environment variable ${variableName} wajib dikonfigurasi`);
    this.name = 'FeedConfigurationError';
  }
}

@Injectable()
export class IndicatorFeedClients {
  constructor(private readonly config: ConfigService) {}

  configurationVariable(provider: FeedProvider): string {
    return providerApiKeyNames[provider];
  }

  isConfigured(provider: FeedProvider): boolean {
    return Boolean(this.config.get<string>(this.configurationVariable(provider))?.trim());
  }

  fetch(provider: FeedProvider): Promise<readonly NormalizedIndicator[]> {
    switch (provider) {
      case 'URLHAUS': return this.fetchUrlhaus();
      case 'MALWAREBAZAAR': return this.fetchMalwareBazaar();
      case 'ABUSEIPDB': return this.fetchAbuseIpDb();
    }
  }

  private async fetchUrlhaus(): Promise<readonly NormalizedIndicator[]> {
    const key = this.apiKey(this.configurationVariable('URLHAUS'));
    const payload = await this.getJson('https://urlhaus-api.abuse.ch/v1/urls/recent/', { 'Auth-Key': key });
    const response = urlhausResponseSchema.parse(payload);
    if (response.query_status !== 'ok') throw new Error(`URLhaus query status: ${response.query_status}`);
    return response.urls.slice(0, this.itemLimit()).map(item => ({
      value: item.url,
      type: 'URL',
      severity: item.url_status === 'online' ? 'CRITICAL' : 'HIGH',
      confidence: item.url_status === 'online' ? 95 : 85,
      tags: ['urlhaus', ...(item.tags ?? [])],
      description: `URLhaus ${item.threat ?? 'malicious URL'} (${item.url_status ?? 'unknown status'})`,
    }));
  }

  private async fetchMalwareBazaar(): Promise<readonly NormalizedIndicator[]> {
    const key = this.apiKey(this.configurationVariable('MALWAREBAZAAR'));
    const body = new URLSearchParams({ query: 'get_recent', selector: '100' }).toString();
    const payload = await this.postForm('https://mb-api.abuse.ch/api/v1/', key, body);
    const response = malwareBazaarResponseSchema.parse(payload);
    if (response.query_status !== 'ok') throw new Error(`MalwareBazaar query status: ${response.query_status}`);
    return (response.data ?? []).slice(0, this.itemLimit()).map(item => ({
      value: item.sha256_hash.toLowerCase(),
      type: 'FILE_HASH',
      severity: 'CRITICAL',
      confidence: 95,
      tags: ['malwarebazaar', item.file_type, item.signature, ...(item.tags ?? [])].filter((tag): tag is string => Boolean(tag)),
      description: `MalwareBazaar sample${item.signature ? ` (${item.signature})` : ''}${item.file_name ? `: ${item.file_name}` : ''}`,
    }));
  }

  private async fetchAbuseIpDb(): Promise<readonly NormalizedIndicator[]> {
    const key = this.apiKey(this.configurationVariable('ABUSEIPDB'));
    const limit = this.itemLimit();
    const payload = await this.getJson(`https://api.abuseipdb.com/api/v2/blacklist?confidenceMinimum=90&limit=${limit}`, { Accept: 'application/json', Key: key });
    const response = abuseIpDbResponseSchema.parse(payload);
    return response.data.map(item => ({
      value: item.ipAddress,
      type: 'IP_ADDRESS',
      severity: item.abuseConfidenceScore >= 95 ? 'CRITICAL' : 'HIGH',
      confidence: item.abuseConfidenceScore,
      tags: ['abuseipdb', ...(item.countryCode ? [item.countryCode.toLowerCase()] : [])],
      description: `AbuseIPDB blacklist, confidence ${item.abuseConfidenceScore}%${item.lastReportedAt ? `, last reported ${item.lastReportedAt}` : ''}`,
    }));
  }

  private async getJson(url: string, headers: Readonly<Record<string, string>>): Promise<unknown> {
    const response = await request(url, { method: 'GET', headers, headersTimeout: 15_000, bodyTimeout: 15_000 });
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Feed HTTP status ${response.statusCode}`);
    return response.body.json();
  }

  private async postForm(url: string, key: string, body: string): Promise<unknown> {
    const response = await request(url, {
      method: 'POST',
      headers: { 'Auth-Key': key, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Feed HTTP status ${response.statusCode}`);
    return response.body.json();
  }

  private apiKey(name: string): string {
    const value = this.config.get<string>(name)?.trim();
    if (!value) throw new FeedConfigurationError(name);
    return value;
  }

  private itemLimit(): number {
    const configured = Number(this.config.get<string>('THREAT_FEED_ITEM_LIMIT'));
    return Number.isInteger(configured) ? Math.min(Math.max(configured, 1), 500) : 100;
  }
}
