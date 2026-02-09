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
  const prefix = '解析为：';
  if (header.length <= maxLength) {
    return header;
  }

  if (maxLength <= prefix.length) {
    return truncateText(prefix, maxLength);
  }

  if (header.startsWith(prefix)) {
    return `${prefix}${header.slice(prefix.length, maxLength)}`;
  }

  return truncateText(header, maxLength);
}

export function buildTzaMessage(lines: string[]): string {
  if (lines.length === 0) {
    return '本群暂无已登记且被识别的成员';
  }

  const fullMessage = lines.join('\n');
  if (fullMessage.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
    return fullMessage;
  }

  for (let visibleCount = lines.length - 1; visibleCount >= 0; visibleCount -= 1) {
    const hiddenCount = lines.length - visibleCount;
    const suffix = `（已截断，剩余 ${hiddenCount} 人未显示）`;
    const visibleText = visibleCount > 0 ? lines.slice(0, visibleCount).join('\n') : '';
    const candidate = visibleText ? `${visibleText}\n${suffix}` : suffix;

    if (candidate.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
      return candidate;
    }
  }

  return '（已截断，剩余成员未显示）';
}

export function buildTzmMessage(header: string, lines: string[]): string {
  const normalizedHeader = header.replace(/\s*\n+\s*/gu, ' ').trim();
  const contentLines = lines.length > 0 ? lines : ['本群暂无已登记且被识别的成员'];
  const fullText = `${normalizedHeader}\n${contentLines.join('\n')}`;
  if (fullText.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
    return fullText;
  }

  for (let visibleCount = contentLines.length - 1; visibleCount >= 0; visibleCount -= 1) {
    const hiddenCount = contentLines.length - visibleCount;
    const suffix = `（已截断，剩余 ${hiddenCount} 人未显示）`;
    const visibleText = visibleCount > 0 ? contentLines.slice(0, visibleCount).join('\n') : '';
    const body = visibleText ? `${visibleText}\n${suffix}` : suffix;
    const candidate = `${normalizedHeader}\n${body}`;

    if (candidate.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
      return candidate;
    }
  }

  const fallbackSuffix = '（已截断，剩余成员未显示）';
  const fallbackWithSuffixMaxHeaderLength = TELEGRAM_MESSAGE_MAX_LENGTH - 1 - fallbackSuffix.length;
  if (fallbackWithSuffixMaxHeaderLength > 0) {
    const truncatedHeader = truncateHeaderPreservingPrefix(normalizedHeader, fallbackWithSuffixMaxHeaderLength);
    return `${truncatedHeader}\n${fallbackSuffix}`;
  }

  return truncateHeaderPreservingPrefix(normalizedHeader, TELEGRAM_MESSAGE_MAX_LENGTH);
}
