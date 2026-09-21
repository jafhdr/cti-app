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
    
    // Log: Chat ID diterima dari Telegram
    if (typeof console !== 'undefined') {
      console.log('[telegram.chat_id.received]', {
        updateId: update.update_id,
        chatId: telegramChatId,
        messageId: message.message_id,
        chatTitle: message.chat.title,
      });
    }
    
    if (!this.allowedChatIds.has(telegramChatId)) {
      // Log: Chat ID ditolak (mismatch dengan allowedChatIds)
      console.log('[telegram.chat_id.rejected]', {
        updateId: update.update_id,
        receivedChatId: telegramChatId,
        allowedChatIds: Array.from(this.allowedChatIds),
        message: `Chat ID ${telegramChatId} not in allowlist`,
      });
      return 'rejected';
    }
    
    // Log: Chat ID cocok
    console.log('[telegram.chat_id.matched]', {
      updateId: update.update_id,
      chatId: telegramChatId,
    });
    
    const sources = await this.prisma.intelligenceSource.findMany({
      where: { telegramChatId, status: 'ACTIVE' },
      select: { id: true, tenantId: true, telegramChatId: true },
    });
    
    const source = sources[0];
    if (!source || sources.length !== 1) {
      console.log('[telegram.ingestion.source_mismatch]', {
        updateId: update.update_id,
        chatId: telegramChatId,
        sourcesFound: sources.length,
        message: sources.length === 0 
          ? 'No ACTIVE source found for this chatId' 
          : `Multiple sources found (expected 1, got ${sources.length})`,
      });
      return 'rejected';
    }
    
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
    
    // Log: staging berhasil dibuat
    console.log('[telegram.ingestion.staged]', {
      updateId: update.update_id,
      chatId: telegramChatId,
      sourceId: source.id,
      tenantId: source.tenantId,
      contentLength: content.length,
      hasEntities: entities && entities.length > 0,
    });
    
    return 'staged';
  }
}
