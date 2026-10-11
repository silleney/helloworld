import { timedFetch } from "./request";
import { checkConfig, type CloudConfig } from "./api";
export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
};
// Session stays in memory for now. No browser session persistence or login UI is enabled.
// Reopening requires login until a reviewed, account-isolated session store is added.
export class SupabaseAuth {
  private origin: string;
  private session: Session | null = null;
  private epoch = 0;
  private refreshing: Promise<string> | null = null;
  constructor(
    private config: CloudConfig,
    private request: typeof fetch = timedFetch,
  ) {
    this.origin = checkConfig(config);
  }
  private async exchange(
    kind: string,
    body: unknown,
    epoch: number,
  ): Promise<Session> {
    const r = await this.request(
      `${this.origin}/auth/v1/token?grant_type=${kind}`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          apikey: this.config.publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!r.ok)
      throw new Error("登录或续期失败，请重新登录；待同步操作保持不变");
    const s = (await r.json()) as Session & { expires_in?: number };
    if (
      !s.access_token ||
      !s.refresh_token ||
      !s.user?.id ||
      !Number.isFinite(s.expires_in) ||
      Number(s.expires_in) <= 0
    )
      throw new Error("认证响应无效");
    if (epoch !== this.epoch) throw new Error("登录状态已变更");
    s.expires_at = Date.now() + Number(s.expires_in) * 1000;
    this.session = s;
    return s;
  }
  async signIn(email: string, password: string) {
    const epoch = ++this.epoch;
    this.session = null;
    this.refreshing = null;
    return (await this.exchange("password", { email, password }, epoch)).user
      .id;
  }
  async token(expectedAccountId?: string): Promise<string> {
    if (!this.session) throw new Error("请先登录");
    if (expectedAccountId && this.session.user.id !== expectedAccountId)
      throw new Error("账号已切换，停止旧账号同步");
    if (this.session.expires_at > Date.now() + 60000)
      return this.session.access_token;
    if (!this.refreshing) {
      const epoch = this.epoch;
      const pending = this.exchange(
        "refresh_token",
        { refresh_token: this.session.refresh_token },
        epoch,
      )
        .then((s) => s.access_token)
        .finally(() => {
          if (this.refreshing === pending) this.refreshing = null;
        });
      this.refreshing = pending;
    }
    const token = await this.refreshing;
    if (
      !this.session ||
      (expectedAccountId && this.session.user.id !== expectedAccountId)
    )
      throw new Error("账号已切换，停止旧账号同步");
    return token;
  }
  async signOut() {
    const token = this.session?.access_token;
    ++this.epoch;
    this.session = null;
    if (token) {
      const r = await this.request(
        `${this.origin}/auth/v1/logout?scope=local`,
        {
          method: "POST",
          cache: "no-store",
          headers: {
            apikey: this.config.publishableKey,
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!r.ok)
        throw new Error(
          "本机已退出，云端会话撤销未确认；请重试或在账户中撤销会话",
        );
    }
  }
}
