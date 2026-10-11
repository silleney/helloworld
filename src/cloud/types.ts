import type { Entry } from "../domain";
export type CloudRow = Entry & { revision: number; deleted: boolean };
export type Snapshot = { ledger_revision: number; rows: CloudRow[] };
export type Change =
  | {
      kind: "create" | "update" | "restore";
      id: string;
      expected_revision: number;
      entry: Entry;
    }
  | { kind: "delete"; id: string; expected_revision: number };
export type Result = {
  status: "applied" | "conflict";
  ledger_revision: number;
};
export type Operation = {
  operationId: string;
  changes: Change[];
  state: "pending" | "applied" | "conflict" | "discarded";
  result?: Result;
};
export interface CloudAPI {
  snapshot(ledgerId: string): Promise<Snapshot>;
  apply(
    ledgerId: string,
    operationId: string,
    changes: Change[],
  ): Promise<Result>;
}
