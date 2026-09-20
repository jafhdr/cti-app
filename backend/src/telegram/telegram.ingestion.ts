import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { TelegramUpdate } from './telegram.types';

type TelegramDatabase = Pick<Prisma.TransactionClient, 'intelligenceSource' | 'telegramStagingMessage'>;
export type TelegramIngestionResult = 'ignored' | 'rejected' | 'staged';

export class TelegramIngestion {
  constructor(
    private readonly prisma: TelegramDatabase,
    private readonly allowedChatIds: ReadonlySet<string>,
  ) {}

  async process(update: TelegramUpdate): Promise<TelegramIngestionResult> {
    const message = update.edited_channel_post ?? update.channel_post;
    if (!message) return 'ignored';
    const telegramChatId = String(message.chat.id);
    if (!this.allowedChatIds.has(telegramChatId)) return 'rejected';
    const sources = await this.prisma.intelligenceSource.findMany({
      where: { telegramChatId, status: 'ACTIVE' },
      select: { id: true, tenantId: true, telegramChatId: true },
    });
    const source = sources[0];
    if (!source || sources.length !== 1) return 'rejected';
    const content = message.text ?? message.caption ?? '';
    const entities = message.text ? message.entities : message.caption_entities;
    const mutableFields = {
      channelUsername: message.chat.username ?? null,
      channelTitle: message.chat.title,
      updateId: String(update.update_id),
      editTimestamp: message.edit_date ? new Date(message.edit_date * 1_000) : null,
      content,
      text: message.text ?? null,
      caption: message.caption ?? null,
      entities: entities ?? [],
      messageUrl: message.chat.username ? `https://t.me/${message.chat.username}/${message.message_id}` : null,
      contentHash: createHash('sha256').update(content).digest('hex'),
      processingStatus: 'PENDING' as const,
      processingError: null,
    };
    await this.prisma.telegramStagingMessage.upsert({
      where: { tenantId_telegramChatId_messageId: { tenantId: source.tenantId, telegramChatId, messageId: String(message.message_id) } },
      create: {
        tenantId: source.tenantId,
        intelligenceSourceId: source.id,
        telegramChatId,
        messageId: String(message.message_id),
        messageTimestamp: new Date(message.date * 1_000),
        ...mutableFields,
      },
      update: mutableFields,
    });
    return 'staged';
  }
}
