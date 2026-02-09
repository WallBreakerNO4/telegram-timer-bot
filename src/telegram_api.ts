import { type TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';

export interface TelegramCallbackAnswerPayload {
  callback_query_id: string;
  text?: string;
}

export interface TelegramApiCompat {
  answerCallbackQuery?: (botApi: string, data: TelegramCallbackAnswerPayload) => Promise<Response>;
  answerCallback?: (botApi: string, data: TelegramCallbackAnswerPayload) => Promise<Response>;
  sendMessage: (botApi: string, data: Record<string, unknown>) => Promise<Response>;
  editMessageText: (botApi: string, data: Record<string, unknown>) => Promise<Response>;
}

export async function answerCallbackQuery(
  ctx: TelegramExecutionContext,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  const payload: TelegramCallbackAnswerPayload = {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  };

  const api = ctx.api as unknown as TelegramApiCompat;
  if (typeof api.answerCallbackQuery === 'function') {
    await api.answerCallbackQuery(ctx.bot.api.toString(), payload);
    return;
  }

  if (typeof api.answerCallback === 'function') {
    await api.answerCallback(ctx.bot.api.toString(), payload);
  }
}

export async function editMessageTextWithFallback(
  ctx: TelegramExecutionContext,
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup: object,
): Promise<void> {
  const api = ctx.api as unknown as TelegramApiCompat;

  const response = await api.editMessageText(ctx.bot.api.toString(), {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: replyMarkup,
  });

  const payload = await response
    .clone()
    .json()
    .catch(() => null) as { ok?: boolean } | null;

  if (!response.ok || payload?.ok === false) {
    await api.sendMessage(ctx.bot.api.toString(), {
      chat_id: chatId,
      reply_to_message_id: messageId,
      text,
      reply_markup: replyMarkup,
      parse_mode: '',
    });
  }
}
