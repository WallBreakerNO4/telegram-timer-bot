import { Bot, webhookCallback } from 'grammy';
import { type UserFromGetMe } from 'grammy/types';

import { WEBHOOK_TIMEOUT_MS } from './config';
import { registerCallbackHandler } from './handlers/callback';
import { registerStartHandlers } from './handlers/start';
import { registerTzHandler } from './handlers/tz';
import { registerTzaHandler } from './handlers/tza';
import { registerTzmHandler } from './handlers/tzm';
import { getSupportedTimezones } from './timezones';

const supportedTimezones = getSupportedTimezones();

function getConfiguredBotInfo(token: string, username: string | undefined): UserFromGetMe {
  const botId = Number(token.slice(0, token.indexOf(':')));
  if (!username || !Number.isSafeInteger(botId) || botId <= 0) {
    throw new Error('TELEGRAM_BOT_USERNAME or Telegram bot token is invalid');
  }

  return {
    id: botId,
    is_bot: true,
    first_name: username,
    username,
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
}

export function createBot(token: string, env: Env): Bot {
  const botInfo = getConfiguredBotInfo(token, env.TELEGRAM_BOT_USERNAME);
  const bot = new Bot(token, { botInfo });

  registerStartHandlers(bot, env, supportedTimezones);
  registerTzHandler(bot, env);
  registerTzaHandler(bot, env);
  registerTzmHandler(bot, env);
  registerCallbackHandler(bot, env, supportedTimezones);

  return bot;
}

export function getWebhookHandler(token: string, env: Env): (request: Request) => Promise<Response> {
  return webhookCallback(createBot(token, env), 'cloudflare-mod', { timeoutMilliseconds: WEBHOOK_TIMEOUT_MS });
}
