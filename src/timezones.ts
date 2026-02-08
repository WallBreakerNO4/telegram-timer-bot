const FALLBACK_TIMEZONES = ["Etc/UTC"] as const;

export interface TimezonePageOptions {
  page?: number;
  pageSize?: number;
  timezones?: readonly string[];
}

export interface TimezonePageResult {
  region: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: string[];
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

function sortStable(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, "en"));
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    return fallback;
  }
  return value;
}

export function getSupportedTimezones(): string[] {
  try {
    const intlWithSupportedValues = Intl as Intl.DateTimeFormatOptions & {
      supportedValuesOf?: (key: string) => string[];
    };

    if (typeof intlWithSupportedValues.supportedValuesOf === "function") {
      const values = intlWithSupportedValues.supportedValuesOf("timeZone");
      if (Array.isArray(values) && values.length > 0) {
        return sortStable(Array.from(new Set(values)));
      }
    }
  } catch {
    return [...FALLBACK_TIMEZONES];
  }

  return [...FALLBACK_TIMEZONES];
}

export function getTimezoneRegions(timezones: readonly string[] = getSupportedTimezones()): string[] {
  const regions = new Set<string>();
  for (const timezone of timezones) {
    const [region] = timezone.split("/");
    if (!region || region === "Etc") {
      continue;
    }
    regions.add(region);
  }
  return sortStable(Array.from(regions));
}

export function listTimezonesByRegion(
  region: string,
  options: TimezonePageOptions = {},
): TimezonePageResult {
  const page = normalizePositiveInt(options.page, DEFAULT_PAGE);
  const pageSize = normalizePositiveInt(options.pageSize, DEFAULT_PAGE_SIZE);
  const source = options.timezones ?? getSupportedTimezones();
  const prefix = `${region}/`;

  const allRegionTimezones = sortStable(source.filter((timezone) => timezone.startsWith(prefix)));
  const total = allRegionTimezones.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  return {
    region,
    page,
    pageSize,
    total,
    totalPages,
    items: allRegionTimezones.slice(start, end),
  };
}
