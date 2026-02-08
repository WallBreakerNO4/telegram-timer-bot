import { encodeCallbackData } from "../callback_data";
import { getTimezoneRegions, listTimezonesByRegion } from "../timezones";

export const DEFAULT_TIMEZONE_PAGE_SIZE = 8;

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
    callback_data: encodeCallbackData({ action: "r", region }),
  }));

  return {
    inline_keyboard: chunk(regionButtons, 3),
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
      callback_data: encodeCallbackData({ action: "t", timezone }),
    },
  ]);

  const navButtons: InlineKeyboardButton[] = [];
  if (pageResult.page > 1) {
    navButtons.push({
      text: "上一页",
      callback_data: encodeCallbackData({
        action: "p",
        region,
        page: pageResult.page - 1,
        pageSize: pageResult.pageSize,
      }),
    });
  }
  if (pageResult.page < pageResult.totalPages) {
    navButtons.push({
      text: "下一页",
      callback_data: encodeCallbackData({
        action: "p",
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
      text: "返回区域",
      callback_data: encodeCallbackData({
        action: "b",
        region,
        page: pageResult.page,
        pageSize: pageResult.pageSize,
      }),
    },
  ]);

  const totalPages = pageResult.totalPages === 0 ? 1 : pageResult.totalPages;
  const text = pageResult.total === 0
    ? `区域 ${region} 暂无可用时区，请返回重新选择区域。`
    : `请选择时区\n区域：${region}\n第 ${pageResult.page}/${totalPages} 页`;

  return {
    text,
    markup: {
      inline_keyboard: rows,
    },
  };
}
