import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetSecThailandCache, secThailandProvider } from "./sec-thailand";

// All test data is synthetic. No real Thai fund codes appear in this file.
const FAKE_AMC = { unique_id: "amc-synthetic-1" };
const FAKE_FUND = {
  unique_id: FAKE_AMC.unique_id,
  proj_id: "proj-synthetic-fund-a",
  proj_abbr_name: "EXAMPLE-FUND-A",
  proj_name_en: "Example Fund A",
  fund_status: "Registered",
  fund_class_name: "main",
};

function envelope<T>(items: T[], next_cursor = ""): string {
  return JSON.stringify({
    message: "success",
    page_size: 100,
    next_cursor,
    items,
  });
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  while (d <= stop) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

function makeFetchStub() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const u = new URL(url);

    if (u.pathname === "/v2/fund/general-info/amcs") {
      return new Response(envelope([FAKE_AMC]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (u.pathname === "/v2/fund/general-info/profiles") {
      const companyInfo = u.searchParams.get("company_info");
      const items = companyInfo === FAKE_AMC.unique_id ? [FAKE_FUND] : [];
      return new Response(envelope(items), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (u.pathname === "/v2/fund/daily-info/nav") {
      const projId = u.searchParams.get("proj_id");
      if (projId !== FAKE_FUND.proj_id) {
        return new Response(envelope([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const start = u.searchParams.get("start_nav_date") ?? "";
      const end = u.searchParams.get("end_nav_date") ?? "";
      const dates = dateRange(start, end);
      // Skip weekends and the synthetic "no data" date 2026-05-15.
      const items = dates
        .filter((d) => {
          const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
          return dow !== 0 && dow !== 6 && d !== "2026-05-15";
        })
        .map((d) => ({
          proj_id: projId,
          unique_id: FAKE_AMC.unique_id,
          fund_class_name: "main",
          nav_date: d,
          last_val: 10 + Number(d.slice(-2)) / 100,
          net_asset: 1_000_000,
        }));
      return new Response(envelope(items), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  });
}

describe("sec-thailand provider", () => {
  beforeEach(() => {
    __resetSecThailandCache();
    process.env.SEC_API_KEY = "test-key-synthetic";
    // Only fake Date; keep setTimeout real-but-fast so the provider's rate
    // limiter doesn't deadlock against fake timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.SEC_API_KEY;
  });

  it("matches thfund: prefixed symbols only", () => {
    expect(secThailandProvider.matches("thfund:EXAMPLE-FUND-A")).toBe(true);
    expect(secThailandProvider.matches("AAPL")).toBe(false);
    expect(secThailandProvider.matches("^SET.BK")).toBe(false);
  });

  it("resolves fund abbreviation to proj_id and returns ascending series", async () => {
    const fetchStub = makeFetchStub();
    vi.stubGlobal("fetch", fetchStub);

    const result = await secThailandProvider.fetchSeries("thfund:EXAMPLE-FUND-A", "1mo", "1d");

    expect(result.series.length).toBeGreaterThan(0);
    expect(result.quote.symbol).toBe("thfund:EXAMPLE-FUND-A");
    expect(result.quote.currency).toBe("THB");
    expect(result.quote.name).toBe("Example Fund A");
    // Ascending order is contract.
    for (let i = 1; i < result.series.length; i++) {
      expect(result.series[i].t).toBeGreaterThan(result.series[i - 1].t);
    }
    // Weekends skipped + the 2026-05-15 gap synthesized.
    for (const p of result.series) {
      const date = new Date(p.t * 1000).toISOString().slice(0, 10);
      expect(date).not.toBe("2026-05-15");
      const dow = new Date(p.t * 1000).getUTCDay();
      expect(dow).not.toBe(0);
      expect(dow).not.toBe(6);
    }

    // The single date-range NAV call replaces the legacy per-date loop.
    const navCalls = fetchStub.mock.calls
      .map((c) => (c[0] as URL | string).toString())
      .filter((u) => u.includes("/v2/fund/daily-info/nav"));
    expect(navCalls.length).toBe(1);
  });

  it("uppercases the abbreviation when looking up funds", async () => {
    const fetchStub = makeFetchStub();
    vi.stubGlobal("fetch", fetchStub);

    const result = await secThailandProvider.fetchSeries("thfund:example-fund-a", "1mo", "1d");
    expect(result.quote.name).toBe("Example Fund A");
  });

  it("throws a clear error when the fund code is not in the index", async () => {
    const fetchStub = makeFetchStub();
    vi.stubGlobal("fetch", fetchStub);

    await expect(
      secThailandProvider.fetchSeries("thfund:UNKNOWN-FUND-X", "1mo", "1d"),
    ).rejects.toThrow(/Unknown Thai fund code/);
  });

  it("throws when SEC_API_KEY is missing", async () => {
    delete process.env.SEC_API_KEY;
    const fetchStub = makeFetchStub();
    vi.stubGlobal("fetch", fetchStub);

    await expect(
      secThailandProvider.fetchSeries("thfund:EXAMPLE-FUND-A", "1mo", "1d"),
    ).rejects.toThrow(/SEC_API_KEY is not set/);
  });

  it("propagates 401 as ProviderError", async () => {
    const fetchStub = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchStub);

    await expect(
      secThailandProvider.fetchSeries("thfund:EXAMPLE-FUND-A", "1mo", "1d"),
    ).rejects.toThrow(/rejected the subscription key/);
  });

  it("treats HTTP 421 as a rate-limit error (new portal)", async () => {
    const fetchStub = vi.fn(async () => new Response("too many", { status: 421 }));
    vi.stubGlobal("fetch", fetchStub);

    await expect(
      secThailandProvider.fetchSeries("thfund:EXAMPLE-FUND-A", "1mo", "1d"),
    ).rejects.toThrow(/rate-limited \(421\)/);
  });

  it("follows next_cursor pagination when fund list spans multiple pages", async () => {
    const FAKE_AMC_2 = { unique_id: "amc-synthetic-2" };
    const FAKE_FUND_2 = {
      unique_id: FAKE_AMC_2.unique_id,
      proj_id: "proj-synthetic-fund-b",
      proj_abbr_name: "EXAMPLE-FUND-B",
      proj_name_en: "Example Fund B",
      fund_class_name: "main",
    };
    const fetchStub = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const u = new URL(url);
      const cursor = u.searchParams.get("next_cursor");
      if (u.pathname === "/v2/fund/general-info/amcs") {
        if (!cursor) {
          return new Response(envelope([FAKE_AMC], "cursor-page-2"), { status: 200 });
        }
        return new Response(envelope([FAKE_AMC_2]), { status: 200 });
      }
      if (u.pathname === "/v2/fund/general-info/profiles") {
        const ci = u.searchParams.get("company_info");
        const items =
          ci === FAKE_AMC.unique_id
            ? [FAKE_FUND]
            : ci === FAKE_AMC_2.unique_id
              ? [FAKE_FUND_2]
              : [];
        return new Response(envelope(items), { status: 200 });
      }
      if (u.pathname === "/v2/fund/daily-info/nav") {
        return new Response(
          envelope([
            {
              proj_id: u.searchParams.get("proj_id"),
              nav_date: "2026-05-21",
              last_val: 12.34,
              fund_class_name: "main",
            },
          ]),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchStub);

    // Either fund should resolve thanks to multi-page AMC traversal.
    const result = await secThailandProvider.fetchSeries("thfund:EXAMPLE-FUND-B", "1mo", "1d");
    expect(result.quote.name).toBe("Example Fund B");

    // We hit /amcs twice (first page + cursor follow).
    const amcCalls = fetchStub.mock.calls
      .map((c) => (c[0] as URL | string).toString())
      .filter((u) => u.includes("/v2/fund/general-info/amcs"));
    expect(amcCalls.length).toBe(2);
  });
});
