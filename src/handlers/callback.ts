import TelegramBot, { type TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';

import { ACTION_BACK, ACTION_PAGE, ACTION_REGION, ACTION_TIMEZONE, decodeCallbackData } from '../callback_data';
import { initSchema, upsertUserTimezone } from '../db';
import { MSG_CHOOSE_REGION, MSG_EXPIRED, MSG_INVALID_ACTION, MSG_RETRY_LATER, MSG_TIMEZONE_SAVED, MSG_TIMEZONE_SET_DONE, MSG_USER_MISSING } from '../messages';
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
      await answerCallbackQuery(ctx, callbackId, MSG_EXPIRED);
      return new Response('ok');
    }

    const decoded = decodeCallbackData(callback.data, supportedTimezones);
    if (!decoded.ok) {
      await answerCallbackQuery(ctx, callbackId, MSG_INVALID_ACTION);
      return new Response('ok');
    }

    try {
      switch (decoded.value.action) {
        case ACTION_REGION: {
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
        case ACTION_PAGE: {
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
        case ACTION_BACK: {
          const markup = buildRegionSelectorMarkup(supportedTimezones);
          await editMessageTextWithFallback(ctx, chatId, messageId, MSG_CHOOSE_REGION, markup);
          await answerCallbackQuery(ctx, callbackId);
          return new Response('ok');
        }
        case ACTION_TIMEZONE: {
          const userProfile = getUserProfileFromCallback(ctx);
          if (!userProfile) {
            await answerCallbackQuery(ctx, callbackId, MSG_USER_MISSING);
            return new Response('ok');
          }

          await initSchema(env);
          await upsertUserTimezone(env, userProfile, decoded.value.timezone);
          await editMessageTextWithFallback(
            ctx,
            chatId,
            messageId,
            MSG_TIMEZONE_SET_DONE.replace('{tz}', decoded.value.timezone),
            { inline_keyboard: [] },
          );
          await answerCallbackQuery(ctx, callbackId, MSG_TIMEZONE_SAVED);
          return new Response('ok');
        }
      }
    } catch {
      await answerCallbackQuery(ctx, callbackId, MSG_RETRY_LATER);
    }

    return new Response('ok');
  });
}
