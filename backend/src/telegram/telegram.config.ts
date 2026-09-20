import { z } from 'zod';

const enabledSchema = z.string().optional().transform(value => value === 'true');
const positiveInteger = (fallback: number, maximum: number) => z.string().optional()
  .transform(value => value === undefined || value === '' ? fallback : Number(value))
  .pipe(z.number().int().positive().max(maximum));

const environmentSchema = z.object({
  TELEGRAM_POLL_ENABLED: enabledSchema,
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().optional(),
  TELEGRAM_POLL_TIMEOUT_SECONDS: positiveInteger(30, 50),
  TELEGRAM_POLL_BATCH_LIMIT: positiveInteger(100, 100),
});

export type TelegramConfig = {
  readonly enabled: boolean;
  readonly botToken: string;
  readonly allowedChatIds: ReadonlySet<string>;
  readonly timeoutSeconds: number;
  readonly batchLimit: number;
};

export class TelegramConfigError extends Error {
  readonly name = 'TelegramConfigError';
}

export function parseTelegramConfig(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): TelegramConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) throw new TelegramConfigError('Telegram polling configuration is invalid');
  const allowedChatIds = new Set((parsed.data.TELEGRAM_ALLOWED_CHAT_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean));
  const botToken = parsed.data.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  if (parsed.data.TELEGRAM_POLL_ENABLED && (!botToken || allowedChatIds.size === 0)) {
    throw new TelegramConfigError('Telegram polling requires a bot credential and at least one allowed chat');
  }
  return { enabled: parsed.data.TELEGRAM_POLL_ENABLED, botToken, allowedChatIds, timeoutSeconds: parsed.data.TELEGRAM_POLL_TIMEOUT_SECONDS, batchLimit: parsed.data.TELEGRAM_POLL_BATCH_LIMIT };
}
