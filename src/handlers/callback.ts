import TelegramBot, { type TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';

import { decodeCallbackData } from '../callback_data';
import { initSchema, upsertUserTimezone } from '../db';
import { answerCallbackQuery, editMessageTextWithFallback } from '../telegram_api';
import { getUserProfileFromCallback } from '../telegram_profiles';
import {
  buildRegionSelectorMarkup,
  buildTimezonePageView,
  DEFAULT_TIMEZONE_PAGE_SIZE,
} from './timezone_keyboard';

export function registerCallbackHandler(bot: TelegramBot, env: Env, supportedTimezones: readonly string[]): void {
  bot.on(':callback', async (ctx: TelegramExecutionContext) => {
    const callback = ctx.update.callback_query;
    if (!callback?.id) {
      return new Response('ok');
    }

    const callbackId = String(callback.id);
    const chatId = callback.message?.chat?.id ? String(callback.message.chat.id) : '';
    const messageId = callback.message?.message_id;

    if (!chatId || !messageId || !callback.data) {
      await answerCallbackQuery(ctx, callbackId, '消息已过期，请重新 /start');
      return new Response('ok');
    }

    const decoded = decodeCallbackData(callback.data, supportedTimezones);
    if (!decoded.ok) {
      await answerCallbackQuery(ctx, callbackId, '操作无效，请重新选择');
      return new Response('ok');
    }

    try {
      switch (decoded.value.action) {
        case 'r': {
          const pageView = buildTimezonePageView(
            supportedTimezones,
            decoded.value.region,
            1,
            DEFAULT_TIMEZONE_PAGE_SIZE,
          );
          await editMessageTextWithFallback(ctx, chatId, messageId, pageView.text, pageView.markup);
          await answerCallbackQuery(ctx, callbackId);
          return new Response('ok');
        }
        case 'p': {
          const pageView = buildTimezonePageView(
            supportedTimezones,
            decoded.value.region,
            decoded.value.page,
            decoded.value.pageSize,
          );
          await editMessageTextWithFallback(ctx, chatId, messageId, pageView.text, pageView.markup);
          await answerCallbackQuery(ctx, callbackId);
          return new Response('ok');
        }
        case 'b': {
          const markup = buildRegionSelectorMarkup(supportedTimezones);
          await editMessageTextWithFallback(ctx, chatId, messageId, '请选择区域', markup);
          await answerCallbackQuery(ctx, callbackId);
          return new Response('ok');
        }
        case 't': {
          const userProfile = getUserProfileFromCallback(ctx);
          if (!userProfile) {
            await answerCallbackQuery(ctx, callbackId, '用户信息缺失，请重试');
            return new Response('ok');
          }

          await initSchema(env);
          await upsertUserTimezone(env, userProfile, decoded.value.timezone);
          await editMessageTextWithFallback(
            ctx,
            chatId,
            messageId,
            `时区设置完成：${decoded.value.timezone}`,
            { inline_keyboard: [] },
          );
          await answerCallbackQuery(ctx, callbackId, '时区已保存');
          return new Response('ok');
        }
      }
    } catch {
      await answerCallbackQuery(ctx, callbackId, '处理失败，请稍后重试');
    }

    return new Response('ok');
  });
}
