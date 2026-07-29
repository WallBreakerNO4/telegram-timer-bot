import { MSG_NO_MEMBERS, MSG_PARSED_AS, MSG_TRUNCATED, MSG_TRUNCATED_COUNT } from './messages';

export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

export type TzaMessageMember =
  | {
      ok: true;
      displayName: string;
      timezone: string;
      localDate: string;
      localTime: string;
      utcOffset: string;
    }
  | {
      ok: false;
      displayName: string;
      timezone: string;
      error: string;
    };

function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength);
}

function truncateHeaderPreservingPrefix(header: string, maxLength: number): string {
  if (header.length <= maxLength) {
    return header;
  }

  if (maxLength <= MSG_PARSED_AS.length) {
    return truncateText(MSG_PARSED_AS, maxLength);
  }

  if (header.startsWith(MSG_PARSED_AS)) {
    return `${MSG_PARSED_AS}${header.slice(MSG_PARSED_AS.length, maxLength)}`;
  }

  return truncateText(header, maxLength);
}

function compareTzaMembers(left: TzaMessageMember, right: TzaMessageMember): number {
  if (left.ok !== right.ok) {
    return left.ok ? -1 : 1;
  }

  if (left.ok && right.ok) {
    return (
      right.localDate.localeCompare(left.localDate) ||
      right.localTime.localeCompare(left.localTime) ||
      left.timezone.localeCompare(right.timezone)
    );
  }

  if (!left.ok && !right.ok) {
    return left.timezone.localeCompare(right.timezone);
  }

  return 0;
}

function renderTzaMembers(
  visibleMembers: readonly TzaMessageMember[],
  totalCount: number,
): string {
  const validMembers = visibleMembers.filter((member): member is Extract<TzaMessageMember, { ok: true }> => member.ok);
  const invalidMembers = visibleMembers.filter((member): member is Extract<TzaMessageMember, { ok: false }> => !member.ok);
  const blocks: string[] = [];

  const dateGroups = new Map<string, Map<string, { utcOffset: string; timezones: Map<string, string[]> }>>();
  for (const member of validMembers) {
    let timeGroups = dateGroups.get(member.localDate);
    if (!timeGroups) {
      timeGroups = new Map();
      dateGroups.set(member.localDate, timeGroups);
    }

    let timeGroup = timeGroups.get(member.localTime);
    if (!timeGroup) {
      timeGroup = { utcOffset: member.utcOffset, timezones: new Map() };
      timeGroups.set(member.localTime, timeGroup);
    }

    const names = timeGroup.timezones.get(member.timezone) ?? [];
    names.push(member.displayName);
    timeGroup.timezones.set(member.timezone, names);
  }

  for (const [localDate, timeGroups] of dateGroups) {
    for (const [localTime, timeGroup] of timeGroups) {
      const timezoneLines = [...timeGroup.timezones].map(([timezone, names]) => `${timezone}：${names.join('、')}`);
      blocks.push([`${localDate} · ${timeGroup.utcOffset} · ${localTime}`, ...timezoneLines].join('\n'));
    }
  }

  const errorGroups = new Map<string, string[]>();
  for (const member of invalidMembers) {
    const names = errorGroups.get(member.error) ?? [];
    names.push(member.displayName);
    errorGroups.set(member.error, names);
  }
  if (errorGroups.size > 0) {
    blocks.push([...errorGroups].map(([error, names]) => `${error}：${names.join('、')}`).join('\n'));
  }

  const hiddenCount = totalCount - visibleMembers.length;
  if (hiddenCount > 0) {
    blocks.push(MSG_TRUNCATED_COUNT.replace('{n}', String(hiddenCount)));
  }

  return blocks.join('\n\n');
}

function buildTzaMessageWithinLimit(members: readonly TzaMessageMember[], maxLength: number): string {
  if (members.length === 0) {
    return truncateText(MSG_NO_MEMBERS, maxLength);
  }

  const sortedMembers = [...members].sort(compareTzaMembers);
  const fullMessage = renderTzaMembers(sortedMembers, sortedMembers.length);
  if (fullMessage.length <= maxLength) {
    return fullMessage;
  }

  for (let visibleCount = sortedMembers.length - 1; visibleCount >= 0; visibleCount -= 1) {
    const candidate = renderTzaMembers(sortedMembers.slice(0, visibleCount), sortedMembers.length);
    if (candidate.length <= maxLength) {
      return candidate;
    }
  }

  return truncateText(MSG_TRUNCATED, maxLength);
}

export function buildTzaMessage(members: readonly TzaMessageMember[]): string {
  return buildTzaMessageWithinLimit(members, TELEGRAM_MESSAGE_MAX_LENGTH);
}

export function buildTzmMessage(header: string, members: readonly TzaMessageMember[]): string {
  const normalizedHeader = header.replace(/\s*\n+\s*/gu, ' ').trim();
  const contentMaxLength = TELEGRAM_MESSAGE_MAX_LENGTH - normalizedHeader.length - 2;
  const content = buildTzaMessageWithinLimit(members, Math.max(0, contentMaxLength));
  const fullText = `${normalizedHeader}\n\n${content}`;
  if (fullText.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
    return fullText;
  }

  const truncationSuffix = MSG_TRUNCATED;
  const maxHeaderLengthWithSuffix = TELEGRAM_MESSAGE_MAX_LENGTH - 1 - truncationSuffix.length;
  if (maxHeaderLengthWithSuffix > 0) {
    const truncatedHeader = truncateHeaderPreservingPrefix(normalizedHeader, maxHeaderLengthWithSuffix);
    return `${truncatedHeader}\n${truncationSuffix}`;
  }

  return truncateHeaderPreservingPrefix(normalizedHeader, TELEGRAM_MESSAGE_MAX_LENGTH);
}
