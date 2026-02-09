import { type TelegramExecutionContext } from '@codebam/cf-workers-telegram-bot';

import { type UserProfile } from './db';

export interface TelegramMessageUserCompat {
  id: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export type DisplayNameSource = {
  userId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

export function getUserProfileFromCallback(ctx: TelegramExecutionContext): UserProfile | null {
  const from = ctx.update.callback_query?.from;
  if (!from?.id) {
    return null;
  }

  return {
    userId: String(from.id),
    username: from.username ?? null,
    firstName: from.first_name ?? null,
    lastName: null,
  };
}

export function getUserProfileFromMessageUser(from: TelegramMessageUserCompat | undefined): UserProfile | null {
  if (!from?.id) {
    return null;
  }

  return {
    userId: String(from.id),
    username: from.username ?? null,
    firstName: from.first_name ?? null,
    lastName: from.last_name ?? null,
  };
}

export function getDisplayName(user: DisplayNameSource): string {
  const nickname = [user.firstName, user.lastName]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' ')
    .trim();

  if (nickname) {
    return nickname;
  }

  if (user.username?.trim()) {
    return `@${user.username.trim()}`;
  }

  return user.userId;
}
