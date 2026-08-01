import { type Bot, type Context } from 'grammy';

import {
  ACTION_BACK,
  ACTION_PAGE,
  ACTION_REGION,
  ACTION_SHARE,
  ACTION_TIMEZONE,
  decodeCallbackData,
} from '../callback_data';
import { deleteEphemeralShare, getEphemeralShare, initSchema, upsertUserTimezone } from '../db';
import {
  MSG_CHOOSE_REGION,
  MSG_EXPIRED,
  MSG_INVALID_ACTION,
  MSG_SHARE_EXPIRED,
  MSG_SHARED,
  MSG_TIMEZONE_SAVED,
  MSG_TIMEZONE_SET_DONE,
  MSG_USER_MISSING,
} from '../messages';
import { getUserProfileFromCallback } from '../telegram_profiles';
import {
  buildRegionSelectorMarkup,
  buildTimezonePageView,
  DEFAULT_TIMEZONE_PAGE_SIZE,
} from './timezone_keyboard';

export function registerCallbackHandler(bot: Bot, env: Env, supportedTimezones: readonly string[]): void {
  bot.on('callback_query:data', async (ctx: Context) => {
    const callback = ctx.callbackQuery;
    if (!callback?.id) {
      return new Response('ok');
    }

    const chatId = callback.message?.chat?.id ? String(callback.message.chat.id) : '';
    const messageId = callback.message?.message_id;

    if (!chatId || !messageId || !callback.data) {
      await ctx.answerCallbackQuery(MSG_EXPIRED);
      return new Response('ok');
    }

    const decoded = decodeCallbackData(callback.data, supportedTimezones);
    if (!decoded.ok) {
      await ctx.answerCallbackQuery(MSG_INVALID_ACTION);
      return new Response('ok');
    }

    switch (decoded.value.action) {
      case ACTION_REGION: {
        const pageView = buildTimezonePageView(
          supportedTimezones,
          decoded.value.region,
          1,
          DEFAULT_TIMEZONE_PAGE_SIZE,
        );
        await ctx.api.editMessageText(chatId, messageId, pageView.text, { reply_markup: pageView.markup });
        await ctx.answerCallbackQuery();
        return new Response('ok');
      }
      case ACTION_PAGE: {
        const pageView = buildTimezonePageView(
          supportedTimezones,
          decoded.value.region,
          decoded.value.page,
          decoded.value.pageSize,
        );
        await ctx.api.editMessageText(chatId, messageId, pageView.text, { reply_markup: pageView.markup });
        await ctx.answerCallbackQuery();
        return new Response('ok');
      }
      case ACTION_BACK: {
        const markup = buildRegionSelectorMarkup(supportedTimezones);
        await ctx.api.editMessageText(chatId, messageId, MSG_CHOOSE_REGION, { reply_markup: markup });
        await ctx.answerCallbackQuery();
        return new Response('ok');
      }
      case ACTION_TIMEZONE: {
        const userProfile = getUserProfileFromCallback(ctx);
        if (!userProfile) {
          await ctx.answerCallbackQuery(MSG_USER_MISSING);
          return new Response('ok');
        }

        await initSchema(env);
        await upsertUserTimezone(env, userProfile, decoded.value.timezone);
        await ctx.api.editMessageText(chatId, messageId, MSG_TIMEZONE_SET_DONE.replace('{tz}', decoded.value.timezone), {
          reply_markup: { inline_keyboard: [] },
        });
        await ctx.answerCallbackQuery(MSG_TIMEZONE_SAVED);
        return new Response('ok');
      }
      case ACTION_SHARE: {
        const callbackMessage = callback.message;
        const ephemeralMessageId = callbackMessage?.ephemeral_message_id;
        const receiverUser = callbackMessage?.receiver_user;
        const senderId = callback.from?.id;

        if (!ephemeralMessageId || !receiverUser || senderId === undefined) {
          await ctx.answerCallbackQuery(MSG_SHARE_EXPIRED);
          return new Response('ok');
        }

        const share = await getEphemeralShare(env, decoded.value.id);
        if (!share || share.chatId !== chatId || share.receiverUserId !== String(senderId)) {
          await ctx.answerCallbackQuery(MSG_SHARE_EXPIRED);
          return new Response('ok');
        }

        const claimed = await deleteEphemeralShare(env, share.id);
        if (!claimed) {
          await ctx.answerCallbackQuery(MSG_SHARE_EXPIRED);
          return new Response('ok');
        }

        await ctx.api.sendMessage(chatId, share.text);
        await ctx.api.deleteEphemeralMessage(chatId, receiverUser.id, ephemeralMessageId);
        await ctx.answerCallbackQuery(MSG_SHARED);
        return new Response('ok');
      }
    }

    return new Response('ok');
  });
}
