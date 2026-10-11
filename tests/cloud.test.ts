import { describe, it, expect, vi } from "vitest";
import "fake-indexeddb/auto";
import { CloudStateStore, CloudSync } from "../src/cloud/queue";
import {
  SupabaseLedgerAPI,
  checkConfig,
  checkSnapshot,
} from "../src/cloud/api";
import { SupabaseAuth } from "../src/cloud/auth";
import { IndexedDBLedger } from "../src/storage";
import type { Entry } from "../src/domain";
import type { Change, CloudAPI, Snapshot } from "../src/cloud/types";
const config = {
  url: "https://virtual-test.supabase.co",
  publishableKey: "sb_publishable_virtualtest",
};
const entry: Entry = {
  id: "legacy-text-id",
  description: "买菜",
  amount_cents: 3850,
  category: "necessary",
  spent_on: "2026-10-11",
  source: "manual",
  created_at: "2026-10-11T00:00:00.000Z",
  updated_at: "2026-10-11T00:00:00.000Z",
};
const change: Change = {
  kind: "create",
  id: entry.id,
  expected_revision: 0,
  entry,
};
const id = "20000000-0000-0000-0000-000000000001";
const snap: Snapshot = {
  ledger_revision: 1,
  rows: [{ ...entry, revision: 1, deleted: false }],
};
const store = () => new CloudStateStore(`cloud-test-${crypto.randomUUID()}`);
const api = (): CloudAPI => ({
  apply: vi.fn(async () => ({ status: "applied", ledger_revision: 1 })),
  snapshot: vi.fn(async () => structuredClone(snap)),
});
const sync = (a: CloudAPI, s: CloudStateStore, user = "A") =>
  new CloudSync(a, s, "virtual-project", user, "ledger");
describe("cloud preparation isolation and protocol", () => {
  it("rejects secret keys and unsafe project origins", () => {
    for (const publishableKey of [
      "sb_secret_danger",
      "eyJhbGciOiJIUzI1NiJ9.service_role",
      "",
    ])
      expect(() => checkConfig({ ...config, publishableKey })).toThrow();
    for (const url of [
      "http://virtual-test.supabase.co",
      "https://supabase.co.evil.test",
      "https://user:pass@a.supabase.co",
      "https://a.supabase.co/x",
    ])
      expect(() => checkConfig({ ...config, url })).toThrow();
  });
  it("preserves V1 fields, non-UUID record ID and integer cents", () => {
    const value = checkSnapshot(snap);
    expect(value.rows[0]).toEqual({ ...entry, revision: 1, deleted: false });
    expect(() =>
      checkSnapshot({
        ...snap,
        rows: [{ ...snap.rows[0], amount_cents: 38.5 }],
      }),
    ).toThrow();
    expect(() =>
      checkSnapshot({ ...snap, rows: [{ ...snap.rows[0], revision: 2 }] }),
    ).toThrow();
  });
  it("persists operation before network and acknowledges only server commit", async () => {
    const s = store(),
      a = api(),
      c = sync(a, s);
    await c.stage(id, [change]);
    expect(a.apply).not.toHaveBeenCalled();
    expect((await c.state()).operations[0].state).toBe("pending");
    await c.sync();
    expect((await c.state()).operations[0].state).toBe("applied");
    expect((await c.state()).snapshot).toEqual(snap);
  });
  it("lost response retains exact operation ID for retry after reopen", async () => {
    const s = store(),
      a = api();
    let first = true;
    a.apply = vi.fn(async () => {
      if (first) {
        first = false;
        throw new Error("response lost after commit");
      }
      return { status: "applied", ledger_revision: 1 };
    });
    const c = sync(a, s);
    await c.stage(id, [change]);
    await expect(c.sync()).rejects.toThrow();
    expect((await c.state()).operations[0].state).toBe("pending");
    const reopened = sync(a, s);
    await reopened.sync();
    expect(vi.mocked(a.apply).mock.calls.map((c) => c[1])).toEqual([id, id]);
    expect((await reopened.state()).operations).toHaveLength(1);
  });
  it("duplicate stage is stable; changed payload for same operation is rejected", async () => {
    const c = sync(api(), store());
    await c.stage(id, [change]);
    await c.stage(id, [change]);
    expect((await c.state()).operations).toHaveLength(1);
    await expect(
      c.stage(id, [{ ...change, entry: { ...entry, amount_cents: 1 } }]),
    ).rejects.toThrow("操作ID");
  });
  it("concurrent stage from separate tabs is atomic", async () => {
    const name = `cloud-test-${crypto.randomUUID()}`;
    const a = sync(api(), new CloudStateStore(name)),
      b = sync(api(), new CloudStateStore(name));
    await Promise.all([a.stage(id, [change]), b.stage(id, [change])]);
    expect((await a.state()).operations).toHaveLength(1);
  });
  it("keeps cache and operations isolated by account", async () => {
    const s = store(),
      a = sync(api(), s),
      b = sync(api(), s, "B");
    await a.stage(id, [change]);
    await a.sync();
    expect(await b.state()).toEqual({ operations: [] });
  });
  it("never replaces newer cache with stale response", async () => {
    const s = store();
    await s.cache("scope", { ...snap, ledger_revision: 5 });
    await s.cache("scope", snap);
    expect((await s.read("scope")).snapshot?.ledger_revision).toBe(5);
  });
  it("retains conflict and blocks later dependent operations", async () => {
    const a = api();
    a.apply = vi.fn(async () => ({ status: "conflict", ledger_revision: 1 }));
    const c = sync(a, store());
    await c.stage(id, [change]);
    await c.stage("20000000-0000-0000-0000-000000000002", [
      { kind: "delete", id: entry.id, expected_revision: 1 },
    ]);
    await expect(c.sync()).rejects.toThrow("冲突");
    await expect(c.sync()).rejects.toThrow("冲突");
    expect(a.apply).toHaveBeenCalledTimes(1);
    expect((await c.state()).operations.map((o) => o.state)).toEqual([
      "conflict",
      "pending",
    ]);
  });
  it("concurrent sync uses one local request chain", async () => {
    const a = api(),
      c = sync(a, store());
    await c.stage(id, [change]);
    await Promise.all([c.sync(), c.sync()]);
    expect(a.apply).toHaveBeenCalledTimes(1);
  });
  it("failed durable queue write makes no cloud request", async () => {
    const a = api(),
      s = store();
    vi.spyOn(s, "stage").mockRejectedValue(new Error("quota"));
    const c = sync(a, s);
    await expect(c.stage(id, [change])).rejects.toThrow("quota");
    expect(a.apply).not.toHaveBeenCalled();
  });
  it("preserves the original database and refuses to use it as cloud state", async () => {
    const local = new IndexedDBLedger();
    await local.put([entry]);
    expect(() => new CloudStateStore("little-ledger-v1")).toThrow();
    const c = sync(api(), store());
    await c.stage(id, [change]);
    await c.sync();
    expect(await local.list()).toEqual([entry]);
  });
  it("RPC requires user access token, never puts key in URL", async () => {
    const request = vi.fn(
      async () => new Response(JSON.stringify(snap), { status: 200 }),
    );
    const client = new SupabaseLedgerAPI(
      config,
      async () => "virtual-user-token",
      request as typeof fetch,
    );
    expect(await client.snapshot("ledger")).toEqual(snap);
    const [url, opts] = request.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).not.toContain(config.publishableKey);
    expect(opts.headers).toMatchObject({
      apikey: config.publishableKey,
      Authorization: "Bearer virtual-user-token",
    });
    expect(opts.cache).toBe("no-store");
  });
  it("401 is an error, not an empty ledger", async () => {
    const client = new SupabaseLedgerAPI(
      config,
      async () => "expired",
      async () => new Response('{"code":"expired"}', { status: 401 }),
    );
    await expect(client.snapshot("ledger")).rejects.toThrow("登录已失效");
  });
  it("login failure does not return a usable session", async () => {
    const auth = new SupabaseAuth(
      config,
      async () => new Response("{}", { status: 400 }),
    );
    await expect(
      auth.signIn("virtual@example.invalid", "not-real"),
    ).rejects.toThrow();
    await expect(auth.token()).rejects.toThrow("请先登录");
  });
  it("late login response cannot restore logged-out session", async () => {
    let finish!: (r: Response) => void;
    const auth = new SupabaseAuth(
      config,
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const login = auth.signIn("virtual@example.invalid", "not-real");
    await auth.signOut();
    finish(
      new Response(
        JSON.stringify({
          access_token: "virtual",
          refresh_token: "virtual",
          expires_in: 3600,
          user: { id: "A" },
        }),
      ),
    );
    await expect(login).rejects.toThrow("状态已变更");
    await expect(auth.token()).rejects.toThrow("请先登录");
  });
  it("account-bound token getter refuses a different logged-in account", async () => {
    const auth = new SupabaseAuth(
      config,
      async () =>
        new Response(
          JSON.stringify({
            access_token: "virtual",
            refresh_token: "virtual",
            expires_in: 3600,
            user: { id: "B" },
          }),
        ),
    );
    await auth.signIn("virtual@example.invalid", "not-real");
    await expect(auth.token("A")).rejects.toThrow("账号已切换");
    expect(await auth.token("B")).toBe("virtual");
  });
  it("failed account switch removes previous usable session", async () => {
    let n = 0;
    const auth = new SupabaseAuth(config, async () =>
      ++n === 1
        ? new Response(
            JSON.stringify({
              access_token: "virtual",
              refresh_token: "virtual",
              expires_in: 3600,
              user: { id: "A" },
            }),
          )
        : new Response("{}", { status: 400 }),
    );
    await auth.signIn("a@example.invalid", "not-real");
    await expect(
      auth.signIn("b@example.invalid", "not-real"),
    ).rejects.toThrow();
    await expect(auth.token()).rejects.toThrow("请先登录");
  });
  it("logout closes future sync without deleting durable pending data", async () => {
    const a = api(),
      s = store(),
      c = sync(a, s);
    await c.stage(id, [change]);
    c.close();
    await expect(c.sync()).rejects.toThrow("旧账号");
    expect((await sync(a, s).state()).operations[0].state).toBe("pending");
    expect(a.apply).not.toHaveBeenCalled();
  });
  it("refresh is shared by concurrent callers and logout is local", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "virtual",
            refresh_token: "virtual-refresh",
            expires_in: 1,
            user: { id: "A" },
          }),
        ),
    );
    const auth = new SupabaseAuth(config, request as typeof fetch);
    await auth.signIn("virtual@example.invalid", "not-real");
    await Promise.all([auth.token("A"), auth.token("A")]);
    expect(request).toHaveBeenCalledTimes(2);
    await auth.signOut();
    expect((request.mock.calls[2] as unknown as [string])[0]).toContain(
      "logout?scope=local",
    );
    await expect(auth.token()).rejects.toThrow("请先登录");
  });
});
