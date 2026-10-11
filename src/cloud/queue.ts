import { validateBackup } from "../domain";
import type { CloudAPI, Operation, Snapshot, Change } from "./types";
import { checkSnapshot } from "./api";
export interface State {
  snapshot?: Snapshot;
  operations: Operation[];
}
export interface StateStore {
  read(scope: string): Promise<State>;
  stage(scope: string, operation: Operation): Promise<void>;
  acknowledge(scope: string, operation: Operation): Promise<void>;
  cache(scope: string, snapshot: Snapshot): Promise<void>;
}
// Independent database: never opens, upgrades, deletes or writes little-ledger-v1.
export class CloudStateStore implements StateStore {
  private db: Promise<IDBDatabase>;
  constructor(name = "little-ledger-cloud-v1") {
    if (name === "little-ledger-v1")
      throw new Error("禁止用旧本地数据库存放同步状态");
    this.db = new Promise((resolve, reject) => {
      const q = indexedDB.open(name, 1);
      q.onupgradeneeded = () => q.result.createObjectStore("states");
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
      q.onblocked = () => reject(new Error("同步缓存暂不可用，未提交云操作"));
    });
  }
  private async tx<T>(
    scope: string,
    write: boolean,
    action: (s: State) => { state: State; result: T },
  ): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("states", write ? "readwrite" : "readonly");
      const store = tx.objectStore("states");
      const q = store.get(scope);
      let result: T;
      q.onsuccess = () => {
        try {
          const next = action(q.result ?? { operations: [] });
          result = next.result;
          if (write) store.put(next.state, scope);
        } catch (e) {
          tx.abort();
          reject(e);
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("同步缓存事务取消"));
    });
  }
  read(scope: string) {
    return this.tx(scope, false, (s) => ({
      state: s,
      result: structuredClone(s),
    }));
  }
  stage(scope: string, op: Operation) {
    return this.tx(scope, true, (s) => {
      const existing = s.operations.find(
        (o) => o.operationId === op.operationId,
      );
      if (
        existing &&
        JSON.stringify(existing.changes) !== JSON.stringify(op.changes)
      )
        throw new Error("操作ID不能用于不同内容");
      if (!existing) s.operations.push(structuredClone(op));
      return { state: s, result: undefined };
    });
  }
  acknowledge(scope: string, op: Operation) {
    return this.tx(scope, true, (s) => {
      const i = s.operations.findIndex((o) => o.operationId === op.operationId);
      if (
        i < 0 ||
        JSON.stringify(s.operations[i].changes) !== JSON.stringify(op.changes)
      )
        throw new Error("待同步操作不一致");
      s.operations[i] = structuredClone(op);
      return { state: s, result: undefined };
    });
  }
  cache(scope: string, snapshot: Snapshot) {
    return this.tx(scope, true, (s) => {
      // Concurrent responses may arrive out of order. Never replace a newer snapshot.
      if (!s.snapshot || snapshot.ledger_revision >= s.snapshot.ledger_revision)
        s.snapshot = structuredClone(snapshot);
      return { state: s, result: undefined };
    });
  }
}
export class CloudSync {
  private scope: string;
  private active: Promise<void> | null = null;
  private closed = false;
  constructor(
    private api: CloudAPI,
    private store: StateStore,
    project: string,
    accountId: string,
    private ledgerId: string,
  ) {
    if (!project || !accountId || !ledgerId)
      throw new Error("同步必须指定项目、账号、账本");
    this.scope = JSON.stringify([project, accountId, ledgerId]);
  }
  close() {
    this.closed = true;
  }
  async stage(operationId: string, changes: Change[]) {
    if (this.closed) throw new Error("旧账号同步已停止");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        operationId,
      ) ||
      changes.length < 1 ||
      changes.length > 1000
    )
      throw new Error("操作格式不正确");
    const ids = new Set<string>();
    if (new TextEncoder().encode(JSON.stringify(changes)).byteLength > 2000000)
      throw new Error("同步批次过大，请分批");
    for (const c of changes) {
      if (
        !["create", "update", "delete", "restore"].includes(c.kind) ||
        !c.id ||
        c.id.length > 128 ||
        ids.has(c.id) ||
        !Number.isSafeInteger(c.expected_revision) ||
        c.expected_revision < 0
      )
        throw new Error("变更格式不正确");
      ids.add(c.id);
      if (c.kind !== "delete") {
        validateBackup({ version: 1, entries: [c.entry] });
        if (c.entry.id !== c.id) throw new Error("记录ID不一致");
      }
    }
    // Persist before any network write. The editor must generate IDs once and reuse.
    await this.store.stage(this.scope, {
      operationId,
      changes,
      state: "pending",
    });
  }
  async state() {
    return this.store.read(this.scope);
  }
  sync(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("旧账号同步已停止"));
    if (!this.active)
      this.active = this.run().finally(() => {
        this.active = null;
      });
    return this.active;
  }
  private async run() {
    const state = await this.state();
    if (state.operations.some((o) => o.state === "conflict"))
      throw new Error("存在同步冲突，未继续提交后续操作");
    for (const op of state.operations.filter((o) => o.state === "pending")) {
      if (this.closed) throw new Error("旧账号同步已停止");
      const result = await this.api.apply(
        this.ledgerId,
        op.operationId,
        op.changes,
      );
      if (this.closed)
        throw new Error("会话已退出，提交结果将在重新登录后确认");
      await this.store.acknowledge(this.scope, {
        ...op,
        result,
        state: result.status,
      });
      if (result.status === "conflict") {
        await this.store.cache(
          this.scope,
          checkSnapshot(await this.api.snapshot(this.ledgerId)),
        );
        throw new Error("记录已被其他设备修改或删除，请核对冲突；原操作已保留");
      }
    }
    if (this.closed) throw new Error("旧账号同步已停止");
    await this.store.cache(
      this.scope,
      checkSnapshot(await this.api.snapshot(this.ledgerId)),
    );
  }
}
