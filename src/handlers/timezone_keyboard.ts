import { ACTION_BACK, ACTION_PAGE, ACTION_REGION, ACTION_TIMEZONE, encodeCallbackData } from "../callback_data";
import { getTimezoneRegions, listTimezonesByRegion } from "../timezones";
import { MSG_BACK_REGION, MSG_CHOOSE_TIMEZONE_PAGE, MSG_NEXT_PAGE, MSG_NO_TIMEZONES_IN_REGION, MSG_PREV_PAGE } from "../messages";

export const DEFAULT_TIMEZONE_PAGE_SIZE = 8;

const REGION_BUTTONS_PER_ROW = 3;

interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TimezonePageView {
  text: string;
  markup: InlineKeyboardMarkup;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push([...items.slice(index, index + size)]);
  }
  return rows;
}

function getTimezoneButtonText(timezone: string): string {
  const [, ...parts] = timezone.split("/");
  if (parts.length === 0) {
    return timezone;
  }
  return parts.join("/");
}

export function buildRegionSelectorMarkup(timezones: readonly string[]): InlineKeyboardMarkup {
  const regions = getTimezoneRegions(timezones);
  const regionButtons = regions.map((region) => ({
    text: region,
    callback_data: encodeCallbackData({ action: ACTION_REGION, region }),
  }));

  return {
    inline_keyboard: chunk(regionButtons, REGION_BUTTONS_PER_ROW),
  };
}

export function buildTimezonePageView(
  timezones: readonly string[],
  region: string,
  page: number,
  pageSize: number = DEFAULT_TIMEZONE_PAGE_SIZE,
): TimezonePageView {
  const pageResult = listTimezonesByRegion(region, {
    page,
    pageSize,
    timezones,
  });

  const timezoneRows = pageResult.items.map((timezone) => [
    {
      text: getTimezoneButtonText(timezone),
      callback_data: encodeCallbackData({ action: ACTION_TIMEZONE, timezone }),
    },
  ]);

  const navButtons: InlineKeyboardButton[] = [];
  if (pageResult.page > 1) {
    navButtons.push({
      text: MSG_PREV_PAGE,
      callback_data: encodeCallbackData({
        action: ACTION_PAGE,
        region,
        page: pageResult.page - 1,
        pageSize: pageResult.pageSize,
      }),
    });
  }
  if (pageResult.page < pageResult.totalPages) {
    navButtons.push({
      text: MSG_NEXT_PAGE,
      callback_data: encodeCallbackData({
        action: ACTION_PAGE,
        region,
        page: pageResult.page + 1,
        pageSize: pageResult.pageSize,
      }),
    });
  }

  const rows: InlineKeyboardButton[][] = [...timezoneRows];
  if (navButtons.length > 0) {
    rows.push(navButtons);
  }
  rows.push([
    {
      text: MSG_BACK_REGION,
      callback_data: encodeCallbackData({
        action: ACTION_BACK,
        region,
        page: pageResult.page,
        pageSize: pageResult.pageSize,
      }),
    },
  ]);

  const totalPages = pageResult.totalPages === 0 ? 1 : pageResult.totalPages;
  const text = pageResult.total === 0
    ? MSG_NO_TIMEZONES_IN_REGION.replace('{region}', region)
    : MSG_CHOOSE_TIMEZONE_PAGE.replace('{region}', region).replace('{page}', String(pageResult.page)).replace('{total}', String(totalPages));

  return {
    text,
    markup: {
      inline_keyboard: rows,
    },
  };
}
