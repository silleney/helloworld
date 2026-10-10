import type { Entry } from "./domain";
export interface LedgerRepository {
  list(): Promise<Entry[]>;
  put(entries: Entry[]): Promise<void>;
  remove(id: string): Promise<void>;
}
// Future authenticated cloud adapters implement this boundary; no cloud is used now.
export class IndexedDBLedger implements LedgerRepository {
  private db: Promise<IDBDatabase>;
  constructor(name = "little-ledger-v1") {
    this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("entries", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(
          new Error("数据库升级被其他标签页阻止，请关闭其他小账页面后重试"),
        );
    });
  }
  async list(): Promise<Entry[]> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("entries", "readonly");
      const request = tx.objectStore("entries").getAll();
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async put(entries: Entry[]) {
    await this.write((store, fail) => {
      // Check merged capacity within the same transaction as writes, including other tabs.
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          const merged = new Map<string, Entry>(
            (request.result as Entry[]).map((e) => [e.id, e]),
          );
          entries.forEach((e) => merged.set(e.id, e));
          if (merged.size > 100000)
            throw new Error("账本最多保存 10 万笔，请先备份整理");
          const total = [...merged.values()].reduce(
            (s, e) => s + BigInt(e.amount_cents),
            0n,
          );
          if (total > BigInt(Number.MAX_SAFE_INTEGER))
            throw new Error("账本总金额超出精确计算范围，未保存任何数据");
          entries.forEach((e) => store.put(e));
        } catch (error) {
          fail(error);
        }
      };
    });
  }
  async remove(id: string) {
    await this.write((store) => store.delete(id));
  }
  private async write(
    action: (store: IDBObjectStore, fail: (error: unknown) => void) => void,
  ) {
    const db = await this.db;
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("entries", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("保存已取消"));
      const fail = (error: unknown) => {
        tx.abort();
        reject(error);
      };
      try {
        action(tx.objectStore("entries"), fail);
      } catch (error) {
        fail(error);
      }
    });
  }
}
