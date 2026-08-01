import { getSupportedTimezones } from "./timezones";

const MAX_CALLBACK_BYTES = 64;
const encoder = new TextEncoder();

export const ACTION_REGION = "r";
export const ACTION_PAGE = "p";
export const ACTION_BACK = "b";
export const ACTION_TIMEZONE = "t";
export const ACTION_SHARE = "s";

type CallbackAction =
  | typeof ACTION_REGION
  | typeof ACTION_PAGE
  | typeof ACTION_BACK
  | typeof ACTION_TIMEZONE
  | typeof ACTION_SHARE;

export type CallbackPayload =
  | { action: typeof ACTION_REGION; region: string }
  | { action: typeof ACTION_PAGE; region: string; page: number; pageSize: number }
  | { action: typeof ACTION_BACK; region: string; page: number; pageSize: number }
  | { action: typeof ACTION_TIMEZONE; timezone: string }
  | { action: typeof ACTION_SHARE; id: string };

export type CallbackDecodeErrorCode =
  | "too_long"
  | "invalid_format"
  | "unknown_action"
  | "invalid_page"
  | "invalid_page_size"
  | "invalid_timezone"
  | "invalid_share_id";

export type CallbackDecodeResult =
  | { ok: true; value: CallbackPayload }
  | { ok: false; error: { code: CallbackDecodeErrorCode; message: string } };

function toError(code: CallbackDecodeErrorCode, message: string): CallbackDecodeResult {
  return { ok: false, error: { code, message } };
}

function assertLength(data: string): void {
  if (encoder.encode(data).byteLength > MAX_CALLBACK_BYTES) {
    throw new Error(`callback_data exceeds ${MAX_CALLBACK_BYTES} bytes`);
  }
}

function parsePositiveInt(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function isKnownAction(action: string): action is CallbackAction {
  return (
    action === ACTION_REGION ||
    action === ACTION_PAGE ||
    action === ACTION_BACK ||
    action === ACTION_TIMEZONE ||
    action === ACTION_SHARE
  );
}

export function getCallbackDataByteLength(data: string): number {
  return encoder.encode(data).byteLength;
}

export function encodeCallbackData(payload: CallbackPayload): string {
  let data: string;
  switch (payload.action) {
    case ACTION_REGION:
      data = [ACTION_REGION, payload.region].join("|");
      break;
    case ACTION_PAGE:
      data = [ACTION_PAGE, payload.region, String(payload.page), String(payload.pageSize)].join("|");
      break;
    case ACTION_BACK:
      data = [ACTION_BACK, payload.region, String(payload.page), String(payload.pageSize)].join("|");
      break;
    case ACTION_TIMEZONE:
      data = [ACTION_TIMEZONE, payload.timezone].join("|");
      break;
    case ACTION_SHARE:
      data = [ACTION_SHARE, payload.id].join("|");
      break;
    default:
      throw new Error("Unsupported callback action");
  }
  assertLength(data);
  return data;
}

export function decodeCallbackData(
  data: string,
  supportedTimezones: readonly string[] = getSupportedTimezones(),
): CallbackDecodeResult {
  if (getCallbackDataByteLength(data) > MAX_CALLBACK_BYTES) {
    return toError("too_long", `callback_data exceeds ${MAX_CALLBACK_BYTES} bytes`);
  }

  const parts = data.split("|");
  if (parts.length < 2) {
    return toError("invalid_format", "callback_data format is invalid");
  }

  const [action] = parts;
  if (!isKnownAction(action)) {
    return toError("unknown_action", `unknown callback action: ${action}`);
  }

  if (action === ACTION_REGION) {
    if (parts.length !== 2 || !parts[1]) {
      return toError("invalid_format", "region callback_data format is invalid");
    }
    return { ok: true, value: { action, region: parts[1] } };
  }

  if (action === ACTION_SHARE) {
    if (parts.length !== 2 || !parts[1]) {
      return toError("invalid_share_id", "share callback_data format is invalid");
    }
    return { ok: true, value: { action, id: parts[1] } };
  }

  if (action === ACTION_PAGE || action === ACTION_BACK) {
    if (parts.length !== 4 || !parts[1]) {
      return toError("invalid_format", "page callback_data format is invalid");
    }

    const page = parsePositiveInt(parts[2]);
    if (page === null) {
      return toError("invalid_page", "page must be a positive integer");
    }

    const pageSize = parsePositiveInt(parts[3]);
    if (pageSize === null) {
      return toError("invalid_page_size", "pageSize must be a positive integer");
    }

    return {
      ok: true,
      value: {
        action,
        region: parts[1],
        page,
        pageSize,
      },
    };
  }

  if (parts.length !== 2 || !parts[1]) {
    return toError("invalid_format", "timezone callback_data format is invalid");
  }

  const timezone = parts[1];
  const timezoneSet = new Set(supportedTimezones);
  if (!timezoneSet.has(timezone)) {
    return toError("invalid_timezone", `unsupported timezone: ${timezone}`);
  }

  return { ok: true, value: { action, timezone } };
}
