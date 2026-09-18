import { z } from 'zod';
import { ENRICHMENT_PROVIDERS } from './indicator-enrichment.client';

export const indicatorEnrichmentInputSchema = z.object({
  provider: z.enum(ENRICHMENT_PROVIDERS).default('AUTO'),
});

export type IndicatorEnrichmentInput = z.infer<typeof indicatorEnrichmentInputSchema>;
