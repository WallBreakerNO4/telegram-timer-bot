import TelegramBot, { type TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';

export function parseArgumentsFromContext(ctx: TelegramExecutionContext): string[] {
  switch (ctx.update_type) {
    case 'message':
    case 'business_message':
      return ctx.update.message?.text?.split(' ') ?? [];
    case 'inline':
      return ctx.update.inline_query?.query.split(' ') ?? [];
    default:
      return [];
  }
}

function normalizeTelegramCommand(rawCommand: string, env: Env): string | null {
  const atIndex = rawCommand.indexOf('@');
  if (atIndex < 0) {
    return rawCommand;
  }

  const command = rawCommand.slice(0, atIndex);
  if (!command) {
    return null;
  }

  const mentionedUsername = rawCommand.slice(atIndex + 1);
  const expectedUsername = env.TELEGRAM_BOT_USERNAME?.trim();
  if (!expectedUsername) {
    return command;
  }

  if (!mentionedUsername) {
    return command;
  }

  if (mentionedUsername.toLowerCase() !== expectedUsername.toLowerCase()) {
    return null;
  }

  return command;
}

export function determineCommandFromContext(
  bot: TelegramBot,
  ctx: TelegramExecutionContext,
  args: string[],
  env: Env,
): string {
  // 先处理特殊 update 类型
  switch (ctx.update_type) {
    case 'photo':
      return ':photo' in bot.commands ? ':photo' : bot.defaultCommand;
    case 'document':
      return ':document' in bot.commands ? ':document' : bot.defaultCommand;
    case 'callback':
      return ':callback' in bot.commands ? ':callback' : bot.defaultCommand;
    case 'inline':
      return ':inline' in bot.commands ? ':inline' : bot.defaultCommand;
  }

  // 再处理 /command
  const firstArg = args[0];
  if (typeof firstArg === 'string' && firstArg.startsWith('/')) {
    const rawCommand = firstArg.slice(1);
    const normalized = normalizeTelegramCommand(rawCommand, env);
    if (!normalized) {
      return bot.defaultCommand;
    }
    return normalized in bot.commands ? normalized : bot.defaultCommand;
  }

  return bot.defaultCommand;
}
