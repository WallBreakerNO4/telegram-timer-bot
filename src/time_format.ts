export type FormatLocalTimeResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

function toDate(value: Date | number): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatLocalTime(
  timeZone: string,
  now: Date | number = new Date(),
): FormatLocalTimeResult {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(toDate(now));
    const year = getPart(parts, "year");
    const month = getPart(parts, "month");
    const day = getPart(parts, "day");
    const hour = getPart(parts, "hour");
    const minute = getPart(parts, "minute");

    return { ok: true, value: `${year}-${month}-${day} ${hour}:${minute} (${timeZone})` };
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, error: `无效时区: ${timeZone}` };
    }
    throw error;
  }
}
