import { type Context } from 'grammy';

import { ACTION_SHARE, encodeCallbackData } from '../callback_data';
import { createEphemeralShare } from '../db';
import { MSG_SHARE_TO_GROUP } from '../messages';

export interface EphemeralReplyOptions {
  replyToMessageId: number;
  withShareButton?: boolean;
}

/**
 * 群聊/超级群聊内回复统一改为仅触发者可见的临时消息；
 * 需要分享按钮时先落库存原文，再挂「分享到群聊」内联按钮。
 * 非群聊场景回退为普通回复，行为保持不变。
 */
export async function sendEphemeralReply(
  ctx: Context,
  env: Env,
  text: string,
  options: EphemeralReplyOptions,
): Promise<void> {
  const message = ctx.message;
  const chatId = message?.chat?.id;
  const senderId = message?.from?.id;
  if (!chatId || !senderId) {
    return;
  }

  const isGroupChat = message?.chat?.type === 'group' || message?.chat?.type === 'supergroup';
  const replyParameters = { message_id: options.replyToMessageId };

  if (!isGroupChat) {
    await ctx.reply(text, { reply_parameters: replyParameters });
    return;
  }

  if (!options.withShareButton) {
    await ctx.reply(text, {
      reply_parameters: replyParameters,
      receiver_user_id: senderId,
    });
    return;
  }

  const shareId = await createEphemeralShare(env, {
    chatId: String(chatId),
    receiverUserId: String(senderId),
    text,
  });

  await ctx.reply(text, {
    reply_parameters: replyParameters,
    receiver_user_id: senderId,
    reply_markup: {
      inline_keyboard: [
        [{ text: MSG_SHARE_TO_GROUP, callback_data: encodeCallbackData({ action: ACTION_SHARE, id: shareId }) }],
      ],
    },
  });
}
