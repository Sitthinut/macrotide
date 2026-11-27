// The `settings` table is one global key/value store, so per-user values live
// under keys that carry the user's id. These tests pin that one signed-in user
// can't read or write another user's settings, that no API route lists the
// table, and that the old shared broker-sync rows are cleared.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/with-db", () => ({
  withDb: <T>(fn: () => T | Promise<T>) => fn(),
}));
vi.mock("@/lib/portfolio/connector", () => ({
  getConnector: async () => ({
    id: "example",
    sourceTag: "example-broker",
    displayName: "Example Broker",
    openUrl: "https://broker.example.test/orders",
  }),
}));

import { GET as getBrokerToken } from "@/app/api/import/broker/token/route";
import { runWithDbContext, runWithUserScope } from "@/lib/db/context";
import {
  getBrokerAccountOrder,
  getBrokerLoginLabel,
  setBrokerAccountOrder,
  setBrokerLoginLabel,
} from "@/lib/db/queries/broker-connections";
import { getBrokerImportToken, getOrCreateBrokerImportToken } from "@/lib/db/queries/broker-token";
import { getSetting, setSetting, userSettingKey } from "@/lib/db/queries/settings";
import { settings } from "@/lib/db/schema";
import { freshAppDb, makeTestDbContext } from "@/tests/db-helpers";

/** Run in a fresh, non-demo DB context (the broker routes refuse demo sessions). */
function withOwnerDb<T>(fn: () => T | Promise<T>): T | Promise<T> {
  return runWithDbContext(makeTestDbContext(), fn);
}

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("userSettingKey", () => {
  it("puts the current user's id right after the name", async () => {
    await withOwnerDb(async () => {
      expect(userSettingKey("broker_login_label", "x")).toBe("broker_login_label:owner:x");
      await runWithUserScope("alice", () => {
        expect(userSettingKey("broker_login_label", "x")).toBe("broker_login_label:alice:x");
        expect(userSettingKey("pref")).toBe("pref:alice");
      });
    });
  });

  it("can't be steered into another user's key through the sub part", async () => {
    await withOwnerDb(async () => {
      const bobs = await runWithUserScope("bob", () => userSettingKey("broker_login_label", "x"));
      await runWithUserScope("alice", () => {
        for (const sub of ["x", "bob:x", ":bob:x", "../bob:x"]) {
          expect(userSettingKey("broker_login_label", sub)).not.toBe(bobs);
          expect(
            userSettingKey("broker_login_label", sub).startsWith("broker_login_label:alice:"),
          ).toBe(true);
        }
      });
    });
  });
});

describe("per-user settings stay private", () => {
  it("a signed-in user can't read or overwrite another user's value", async () => {
    await withOwnerDb(async () => {
      await runWithUserScope("alice", () =>
        setSetting(userSettingKey("broker_login_label", "example-broker"), "alice-label"),
      );
      await runWithUserScope("bob", () => {
        expect(getSetting(userSettingKey("broker_login_label", "example-broker"))).toBeUndefined();
        setSetting(userSettingKey("broker_login_label", "example-broker"), "bob-label");
      });
      await runWithUserScope("alice", () => {
        expect(getSetting(userSettingKey("broker_login_label", "example-broker"))).toBe(
          "alice-label",
        );
      });
    });
  });

  it("broker sync label and account order are kept per user", async () => {
    await withOwnerDb(async () => {
      await runWithUserScope("alice", () => {
        setBrokerLoginLabel("example-broker", "alice-label");
        setBrokerAccountOrder("example-broker", ["A2", "A1"]);
      });
      await runWithUserScope("bob", () => {
        expect(getBrokerLoginLabel("example-broker")).toBeNull();
        expect(getBrokerAccountOrder("example-broker")).toEqual([]);
        setBrokerLoginLabel("example-broker", "bob-label");
        setBrokerAccountOrder("example-broker", ["B1"]);
      });
      await runWithUserScope("alice", () => {
        expect(getBrokerLoginLabel("example-broker")).toBe("alice-label");
        expect(getBrokerAccountOrder("example-broker")).toEqual(["A2", "A1"]);
      });
    });
  });

  it("each user's broker import token is their own", async () => {
    await withOwnerDb(async () => {
      const alice = await runWithUserScope("alice", () => getOrCreateBrokerImportToken());
      await runWithUserScope("bob", () => {
        expect(getBrokerImportToken()).toBeNull();
        expect(getOrCreateBrokerImportToken()).not.toBe(alice);
      });
    });
  });

  it("GET /api/import/broker/token shows the caller's own label and token only", async () => {
    await withOwnerDb(async () => {
      const aliceToken = await runWithUserScope("alice", () => {
        // What a sync writes for alice (the ingest route calls this).
        setBrokerLoginLabel("example-broker", "alice-label");
        return getOrCreateBrokerImportToken();
      });
      const request = () => new Request("http://localhost/api/import/broker/token");
      await runWithUserScope("bob", async () => {
        const res = await getBrokerToken(request());
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.accountLabel).toBeNull();
        expect(body.token).not.toBe(aliceToken);
        expect(JSON.stringify(body)).not.toContain(aliceToken);
        expect(JSON.stringify(body)).not.toContain("alice-label");
      });
      await runWithUserScope("alice", async () => {
        const body = await (await getBrokerToken(request())).json();
        expect(body.accountLabel).toBe("alice-label");
        expect(body.token).toBe(aliceToken);
      });
    });
  });
});

describe("no API route exposes the settings table", () => {
  it("the generic settings endpoint is gone", () => {
    expect(existsSync(join(ROOT, "app/api/settings/route.ts"))).toBe(false);
  });

  it("only the broker-token module lists every settings row", () => {
    const users = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]
      .filter((f) => /\blistSettings\b/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f))
      .sort();
    expect(users).toEqual(["lib/db/queries/broker-token.ts", "lib/db/queries/settings.ts"]);
  });

  it("no route builds a broker import token key itself", () => {
    const hits = walk(join(ROOT, "app"))
      .filter((f) => readFileSync(f, "utf8").includes("broker_import_token"))
      .map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});

describe("migration 0026 clears the old shared broker-sync rows", () => {
  it("deletes legacy label/order rows and keeps everything else", () => {
    const { sqlite, db } = freshAppDb();
    db.insert(settings)
      .values([
        { key: "broker_login_label:example-broker", value: "someone" },
        { key: "broker_account_order:example-broker", value: ["A1", "A2"] },
        { key: "broker_import_token:alice", value: "t" },
        { key: "unrelated", value: 1 },
      ])
      .run();
    sqlite.exec(
      readFileSync(
        join(ROOT, "lib/db/migrations/app/0026_user_scoped_broker_settings.sql"),
        "utf8",
      ),
    );
    const keys = db
      .select({ key: settings.key })
      .from(settings)
      .all()
      .map((r) => r.key)
      .sort();
    expect(keys).toEqual(["broker_import_token:alice", "unrelated"]);
  });
});
