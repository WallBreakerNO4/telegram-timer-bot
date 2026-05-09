import { MSG_NO_MEMBERS, MSG_PARSED_AS, MSG_TRUNCATED, MSG_TRUNCATED_COUNT } from './messages';

export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

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

export function buildTzaMessage(lines: string[]): string {
  if (lines.length === 0) {
    return MSG_NO_MEMBERS;
  }

  const fullMessage = lines.join('\n');
  if (fullMessage.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
    return fullMessage;
  }

  for (let visibleCount = lines.length - 1; visibleCount >= 0; visibleCount -= 1) {
    const hiddenCount = lines.length - visibleCount;
    const suffix = MSG_TRUNCATED_COUNT.replace('{n}', String(hiddenCount));
    const visibleText = visibleCount > 0 ? lines.slice(0, visibleCount).join('\n') : '';
    const candidate = visibleText ? `${visibleText}\n${suffix}` : suffix;

    if (candidate.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
      return candidate;
    }
  }

  return MSG_TRUNCATED;
}

export function buildTzmMessage(header: string, lines: string[]): string {
  const normalizedHeader = header.replace(/\s*\n+\s*/gu, ' ').trim();
  const contentLines = lines.length > 0 ? lines : [MSG_NO_MEMBERS];
  const fullText = `${normalizedHeader}\n${contentLines.join('\n')}`;
  if (fullText.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
    return fullText;
  }

  for (let visibleCount = contentLines.length - 1; visibleCount >= 0; visibleCount -= 1) {
    const hiddenCount = contentLines.length - visibleCount;
    const suffix = MSG_TRUNCATED_COUNT.replace('{n}', String(hiddenCount));
    const visibleText = visibleCount > 0 ? contentLines.slice(0, visibleCount).join('\n') : '';
    const body = visibleText ? `${visibleText}\n${suffix}` : suffix;
    const candidate = `${normalizedHeader}\n${body}`;

    if (candidate.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
      return candidate;
    }
  }

  const fallbackSuffix = MSG_TRUNCATED;
  const fallbackWithSuffixMaxHeaderLength = TELEGRAM_MESSAGE_MAX_LENGTH - 1 - fallbackSuffix.length;
  if (fallbackWithSuffixMaxHeaderLength > 0) {
    const truncatedHeader = truncateHeaderPreservingPrefix(normalizedHeader, fallbackWithSuffixMaxHeaderLength);
    return `${truncatedHeader}\n${fallbackSuffix}`;
  }

  return truncateHeaderPreservingPrefix(normalizedHeader, TELEGRAM_MESSAGE_MAX_LENGTH);
}
