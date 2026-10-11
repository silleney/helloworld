import { validateBackup } from "../domain";
import type { Change, CloudAPI, Result, Snapshot } from "./types";
export class CloudAPIError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(
      status === 401
        ? "登录已失效，待同步操作已保留"
        : status === 403
          ? "无权访问此账本"
          : "云端操作未确认，数据已保留，请重试或检查权限",
    );
  }
}
export type CloudConfig = { url: string; publishableKey: string };
export function checkConfig(config: CloudConfig) {
  const url = new URL(config.url);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".supabase.co") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("请使用 Supabase 官方项目 HTTPS URL");
  // New publishable keys only; never accept secret/service-role keys or arbitrary JWTs.
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey))
    throw new Error("仅接受公开 publishable key，禁止 secret 或 service_role");
  return url.origin;
}
function revision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
export function checkSnapshot(value: unknown): Snapshot {
  const s = value as Snapshot;
  if (!s || !revision(s.ledger_revision) || !Array.isArray(s.rows))
    throw new Error("云端快照格式不正确");
  validateBackup({ version: 1, entries: s.rows });
  for (const row of s.rows)
    if (
      !revision(row.revision) ||
      row.revision < 1 ||
      row.revision > s.ledger_revision ||
      typeof row.deleted !== "boolean"
    )
      throw new Error("云端修订信息不正确");
  return structuredClone(s);
}
export class SupabaseLedgerAPI implements CloudAPI {
  private origin: string;
  constructor(
    private config: CloudConfig,
    private accessToken: () => Promise<string>,
    private request: typeof fetch = fetch,
  ) {
    this.origin = checkConfig(config);
  }
  private async rpc(name: string, body: unknown): Promise<unknown> {
    const token = await this.accessToken();
    if (!token) throw new Error("请先登录");
    const response = await this.request(`${this.origin}/rest/v1/rpc/${name}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: this.config.publishableKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      throw new CloudAPIError(response.status, data.code ?? "http_error");
    }
    return response.json();
  }
  async createPersonalLedger(ledgerId: string, name: string): Promise<string> {
    const result = await this.rpc("ll_create_personal_ledger", {
      p_ledger_id: ledgerId,
      p_name: name,
    });
    if (result !== ledgerId) throw new Error("云端账本创建结果不一致");
    return result as string;
  }
  async snapshot(ledgerId: string) {
    return checkSnapshot(
      await this.rpc("ll_snapshot", { p_ledger_id: ledgerId }),
    );
  }
  async apply(
    ledgerId: string,
    operationId: string,
    changes: Change[],
  ): Promise<Result> {
    const r = (await this.rpc("ll_apply_operation", {
      p_ledger_id: ledgerId,
      p_operation_id: operationId,
      p_changes: changes,
    })) as Result;
    if (
      !r ||
      !["applied", "conflict"].includes(r.status) ||
      !revision(r.ledger_revision)
    )
      throw new Error("云端提交结果无法确认");
    return r;
  }
}
