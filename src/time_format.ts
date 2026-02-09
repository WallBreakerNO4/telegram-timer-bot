export type FormatLocalTimeResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export type FormatUtcOffsetResult =
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

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatUtcOffset(
  timeZone: string,
  now: Date | number = new Date(),
): FormatUtcOffsetResult {
  try {
    const date = toDate(now);
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const year = getPart(parts, "year");
    const month = getPart(parts, "month");
    const day = getPart(parts, "day");
    const hour = getPart(parts, "hour");
    const minute = getPart(parts, "minute");
    const second = getPart(parts, "second");

    const asIfUtc = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`);
    if (Number.isNaN(asIfUtc.getTime())) {
      return { ok: false, error: `无法计算时区偏移: ${timeZone}` };
    }

    const offsetMinutes = Math.round((asIfUtc.getTime() - date.getTime()) / 60000);
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absMinutes = Math.abs(offsetMinutes);
    const hours = Math.floor(absMinutes / 60);
    const minutes = absMinutes % 60;

    const suffix = minutes === 0 ? String(hours) : `${hours}:${pad2(minutes)}`;
    return { ok: true, value: `UTC${sign}${suffix}` };
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, error: `无效时区: ${timeZone}` };
    }
    throw error;
  }
}

export function formatLocalTime(
  timeZone: string,
  now: Date | number = new Date(),
): FormatLocalTimeResult {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(toDate(now));
    const month = getPart(parts, "month");
    const day = getPart(parts, "day");
    const hour = getPart(parts, "hour");
    const minute = getPart(parts, "minute");

    return { ok: true, value: `${month}-${day} ${hour}:${minute}` };
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, error: `无效时区: ${timeZone}` };
    }
    throw error;
  }
}
