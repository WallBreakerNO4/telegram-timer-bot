import { MSG_INVALID_TIMEZONE, MSG_UNABLE_TO_CALC_OFFSET } from './messages';

export type FormatLocalTimeResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export type FormatUtcOffsetResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export interface ZonedDateTime {
  date: string;
  time: string;
  utcOffset: string;
}

export type FormatZonedDateTimeResult =
  | { ok: true; value: ZonedDateTime }
  | { ok: false; error: string };

interface LocalDateTimeParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function toDate(value: Date | number): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function getLocalDateTimeParts(timeZone: string, date: Date): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);

  return {
    year: getPart(parts, 'year'),
    month: getPart(parts, 'month'),
    day: getPart(parts, 'day'),
    hour: getPart(parts, 'hour'),
    minute: getPart(parts, 'minute'),
    second: getPart(parts, 'second'),
  };
}

function getUtcOffset(timeZone: string, date: Date, parts: LocalDateTimeParts): FormatUtcOffsetResult {
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  if (Number.isNaN(asIfUtc)) {
    return { ok: false, error: MSG_UNABLE_TO_CALC_OFFSET.replace('{tz}', timeZone) };
  }

  const offsetMinutes = Math.round((asIfUtc - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const suffix = minutes === 0 ? String(hours) : `${hours}:${pad2(minutes)}`;

  return { ok: true, value: `UTC${sign}${suffix}` };
}

export function formatZonedDateTime(
  timeZone: string,
  now: Date | number = new Date(),
): FormatZonedDateTimeResult {
  try {
    const date = toDate(now);
    const parts = getLocalDateTimeParts(timeZone, date);
    const utcOffset = getUtcOffset(timeZone, date, parts);
    if (!utcOffset.ok) {
      return utcOffset;
    }

    return {
      ok: true,
      value: {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}`,
        utcOffset: utcOffset.value,
      },
    };
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, error: MSG_INVALID_TIMEZONE.replace('{tz}', timeZone) };
    }
    throw error;
  }
}

export function formatUtcOffset(
  timeZone: string,
  now: Date | number = new Date(),
): FormatUtcOffsetResult {
  try {
    const date = toDate(now);
    return getUtcOffset(timeZone, date, getLocalDateTimeParts(timeZone, date));
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, error: MSG_INVALID_TIMEZONE.replace('{tz}', timeZone) };
    }
    throw error;
  }
}

export function formatLocalTime(
  timeZone: string,
  now: Date | number = new Date(),
): FormatLocalTimeResult {
  try {
    const parts = getLocalDateTimeParts(timeZone, toDate(now));
    return { ok: true, value: `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` };
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, error: MSG_INVALID_TIMEZONE.replace('{tz}', timeZone) };
    }
    throw error;
  }
}
