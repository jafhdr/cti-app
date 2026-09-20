import { z } from 'zod';

const chatSchema = z.object({
  id: z.number().int(),
  type: z.literal('channel'),
  title: z.string(),
  username: z.string().optional(),
});

const messageSchema = z.object({
  message_id: z.number().int(),
  date: z.number().int(),
  edit_date: z.number().int().optional(),
  chat: chatSchema,
  text: z.string().optional(),
  caption: z.string().optional(),
  entities: z.array(z.object({
    type: z.string(),
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive(),
    url: z.string().optional(),
  })).optional(),
  caption_entities: z.array(z.object({
    type: z.string(),
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive(),
    url: z.string().optional(),
  })).optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number().int(),
  channel_post: messageSchema.optional(),
  edited_channel_post: messageSchema.optional(),
});

export const telegramResponseSchema = z.object({
  ok: z.literal(true),
  result: z.array(telegramUpdateSchema),
});

export const telegramErrorResponseSchema = z.object({
  ok: z.literal(false),
  parameters: z.object({ retry_after: z.number().int().positive().optional() }).optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
