import { describe, expect, it } from "vitest";

import {
  decodeCallbackData,
  encodeCallbackData,
  getCallbackDataByteLength,
} from "../src/callback_data";
import { formatLocalTime, formatUtcOffset } from "../src/time_format";
import {
  getSupportedTimezones,
  getTimezoneRegions,
  listTimezonesByRegion,
} from "../src/timezones";

describe("timezones", () => {
  it("falls back to Etc/UTC when Intl.supportedValuesOf is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "supportedValuesOf");

    Object.defineProperty(Intl, "supportedValuesOf", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      expect(getSupportedTimezones()).toEqual(["Etc/UTC"]);
    } finally {
      if (descriptor) {
        Object.defineProperty(Intl, "supportedValuesOf", descriptor);
      }
    }
  });

  it("derives regions and paginates region timezones with stable sorting", () => {
    const source = [
      "Europe/London",
      "Asia/Tokyo",
      "Etc/UTC",
      "Asia/Shanghai",
      "Asia/Almaty",
      "Europe/Paris",
      "Asia/Seoul",
    ];

    expect(getTimezoneRegions(source)).toEqual(["Asia", "Europe"]);

    const page = listTimezonesByRegion("Asia", {
      page: 2,
      pageSize: 2,
      timezones: source,
    });

    expect(page).toEqual({
      region: "Asia",
      page: 2,
      pageSize: 2,
      total: 4,
      totalPages: 2,
      items: ["Asia/Shanghai", "Asia/Tokyo"],
    });
  });
});

describe("formatLocalTime", () => {
  it("formats fixed timestamp into MM-DD HH:mm", () => {
    const now = new Date("2024-03-01T00:05:00.000Z");
    expect(formatLocalTime("Asia/Shanghai", now)).toEqual({
      ok: true,
      value: "03-01 08:05",
    });
  });

  it("returns recoverable error for invalid timezone", () => {
    expect(formatLocalTime("Mars/Base", new Date("2024-03-01T00:05:00.000Z"))).toEqual({
      ok: false,
      error: "无效时区: Mars/Base",
    });
  });
});

describe("formatUtcOffset", () => {
  it("computes UTC offset for fixed timestamp", () => {
    const now = new Date("2024-03-01T00:05:00.000Z");
    expect(formatUtcOffset("Asia/Shanghai", now)).toEqual({
      ok: true,
      value: "UTC+8",
    });
  });

  it("returns recoverable error for invalid timezone", () => {
    expect(formatUtcOffset("Mars/Base", new Date("2024-03-01T00:05:00.000Z"))).toEqual({
      ok: false,
      error: "无效时区: Mars/Base",
    });
  });
});

describe("callback_data", () => {
  it("encodes callback_data within 64 bytes for multiple samples", () => {
    const samples = [
      encodeCallbackData({ action: "r", region: "Asia" }),
      encodeCallbackData({ action: "p", region: "Asia", page: 2, pageSize: 20 }),
      encodeCallbackData({ action: "b", region: "Europe", page: 1, pageSize: 20 }),
      encodeCallbackData({ action: "t", timezone: "America/Argentina/ComodRivadavia" }),
    ];

    for (const data of samples) {
      expect(getCallbackDataByteLength(data)).toBeLessThanOrEqual(64);
    }
  });

  it("rejects unknown action", () => {
    expect(decodeCallbackData("x|Asia", ["Asia/Shanghai"]).ok).toBe(false);
    const result = decodeCallbackData("x|Asia", ["Asia/Shanghai"]);
    if (result.ok) {
      throw new Error("expected decode error");
    }
    expect(result.error.code).toBe("unknown_action");
  });

  it("rejects timezone not in supported list", () => {
    const result = decodeCallbackData("t|Asia/Shanghai", ["Europe/London"]);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_timezone",
        message: "unsupported timezone: Asia/Shanghai",
      },
    });
  });

  it("rejects invalid page and pageSize", () => {
    const badPage = decodeCallbackData("p|Asia|0|20", ["Asia/Shanghai"]);
    expect(badPage).toEqual({
      ok: false,
      error: {
        code: "invalid_page",
        message: "page must be a positive integer",
      },
    });

    const badPageSize = decodeCallbackData("p|Asia|1|-1", ["Asia/Shanghai"]);
    expect(badPageSize).toEqual({
      ok: false,
      error: {
        code: "invalid_page_size",
        message: "pageSize must be a positive integer",
      },
    });
  });
});
