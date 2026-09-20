import { request } from 'undici';
import { telegramErrorResponseSchema, telegramResponseSchema, type TelegramUpdate } from './telegram.types';

type HttpResponse = { readonly statusCode: number; readonly body: { json(): Promise<unknown> } };
type Requester = (methodPath: string, token: string) => Promise<HttpResponse>;
type Sleeper = (milliseconds: number) => Promise<void>;

const sleep: Sleeper = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const defaultRequester: Requester = (methodPath, token) => request(`https://api.telegram.org/bot${token}/${methodPath}`);

export class TelegramApiError extends Error {
  readonly name = 'TelegramApiError';
  constructor(readonly statusCode?: number) {
    super('Telegram Bot API request failed');
  }
}

export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly requester: Requester = defaultRequester,
    private readonly sleeper: Sleeper = sleep,
  ) {}

  async getUpdates(offset: number, timeoutSeconds: number, limit: number): Promise<readonly TelegramUpdate[]> {
    const query = new URLSearchParams({ offset: String(offset), timeout: String(timeoutSeconds), limit: String(limit), allowed_updates: JSON.stringify(['channel_post', 'edited_channel_post']) });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await this.requester(`getUpdates?${query}`, this.token);
        const body = await response.body.json();
        if (response.statusCode === 429) {
          const parsed = telegramErrorResponseSchema.safeParse(body);
          await this.sleeper((parsed.success ? parsed.data.parameters?.retry_after ?? 1 : 1) * 1_000);
          continue;
        }
        if (response.statusCode >= 500) {
          await this.sleeper(2 ** attempt * 1_000);
          continue;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) throw new TelegramApiError(response.statusCode);
        return telegramResponseSchema.parse(body).result;
      } catch (error) {
        if (error instanceof TelegramApiError || attempt === 4) throw new TelegramApiError();
        await this.sleeper(2 ** attempt * 1_000);
      }
    }
    throw new TelegramApiError();
  }
}
