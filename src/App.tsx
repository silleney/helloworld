import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { IndexedDBLedger } from "./storage";
import {
  amountText,
  categories,
  exportCSV,
  localDate,
  makeEntry,
  money,
  parseExpenses,
  planImport,
  suggestCategory,
  totals,
  toCents,
  validateBackup,
} from "./domain";
import type { Draft, Entry } from "./domain";
type Page = "home" | "ledger" | "stats";
type Speech = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  abort(): void;
  onresult:
    | ((e: {
        results: {
          [index: number]: { [index: number]: { transcript: string } };
        };
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const paths: Record<string, string> = {
  book: "M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4Zm4 4h8M8 12h6",
  home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  chart: "M4 20V10m8 10V4m8 16v-7",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 6v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8",
  leaf: "M20 3C8 2 2 8 5 16c8 3 15-3 15-13ZM4 21 15 10",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  close: "m6 6 12 12M6 18 18 6",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  check: "m5 12 4 4L19 6",
  chevron: "m9 5 7 7-7 7",
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.book} />
    </svg>
  );
}
const blank = (): Draft => ({
  description: "",
  amount: "",
  category: "",
  spent_on: localDate(),
  source: "manual",
});
function getSaved(): string {
  try {
    const stored = localStorage.getItem("little-ledger-input") ?? "";
    // Current versions store plain text; retain compatibility with older JSON wrappers.
    try {
      const raw = JSON.parse(stored);
      if (raw && typeof raw.text === "string") return raw.text;
    } catch {
      /* plain text */
    }
    return stored;
  } catch {
    return "";
  }
}
function getSavedDrafts(): Draft[] {
  try {
    const r = JSON.parse(localStorage.getItem("little-ledger-drafts") ?? "[]");
    return Array.isArray(r) &&
      r.length <= 100 &&
      r.every(
        (d) =>
          d &&
          typeof d.description === "string" &&
          typeof d.amount === "string" &&
          typeof d.spent_on === "string" &&
          ["", "necessary", "discretionary"].includes(d.category) &&
          ["manual", "voice"].includes(d.source),
      )
      ? r
      : [];
  } catch {
    return [];
  }
}
function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function monthLabel(s: string) {
  const [y, m] = s.split("-");
  return `${y} 年 ${Number(m)} 月`;
}
export default function App() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 600px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 600px)");
    const change = () => setIsMobile(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const repository = useRef<IndexedDBLedger | null>(null);
  const getRepo = () =>
    repository.current ?? (repository.current = new IndexedDBLedger());
  const [entries, setEntries] = useState<Entry[]>([]),
    [loading, setLoading] = useState(true),
    [dbError, setDbError] = useState("");
  const [page, setPage] = useState<Page>("home"),
    [month, setMonth] = useState(localDate().slice(0, 7)),
    [text, setText] = useState(getSaved),
    [textSource, setTextSource] = useState<Entry["source"]>("manual");
  const [drafts, setDrafts] = useState<Draft[]>(getSavedDrafts),
    [editing, setEditing] = useState<Entry | null>(null),
    [warnings, setWarnings] = useState<string[]>([]),
    [composer, setComposer] = useState(getSavedDrafts().length > 0);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [settings, setSettings] = useState(false),
    [deleteEntry, setDeleteEntry] = useState<Entry | null>(null),
    [undo, setUndo] = useState<Entry | null>(null),
    [incoming, setIncoming] = useState<Entry[] | null>(null);
  const lock = useRef(false),
    speech = useRef<Speech | null>(null),
    [listening, setListening] = useState(false);
  const [expandedDraft, setExpandedDraft] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const modalRef = useRef<HTMLDialogElement>(null);
  const resizeInput = () => {
    const input = inputRef.current;
    if (!input) return;
    if (!isMobile) {
      input.style.height = "";
      return;
    }
    const min = document.activeElement === input ? 96 : 64;
    const max = Math.max(
      min,
      Math.min(
        240,
        (window.visualViewport?.height ?? window.innerHeight) * 0.4,
      ),
    );
    input.style.height = "0px";
    input.style.height = `${Math.min(max, Math.max(min, input.scrollHeight + 2))}px`;
  };
  useLayoutEffect(resizeInput, [text, isMobile, page, loading, dbError]);
  useEffect(() => {
    // Keyboard-close events must not move a button while its tap is in flight.
    const whileEditing = () => {
      if (document.activeElement === inputRef.current) resizeInput();
    };
    window.visualViewport?.addEventListener("resize", whileEditing);
    window.addEventListener("resize", whileEditing);
    return () => {
      window.visualViewport?.removeEventListener("resize", whileEditing);
      window.removeEventListener("resize", whileEditing);
    };
  }, [isMobile]);
  const refresh = async () => {
    try {
      const all = await getRepo().list();
      setEntries(all);
      setDbError("");
    } catch (e) {
      repository.current = null;
      setDbError(
        `无法读取本地数据库：${e instanceof Error ? e.message : "浏览器存储不可用"}。请勿清除浏览器数据。`,
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    if ("BroadcastChannel" in window) {
      channel.current = new BroadcastChannel("little-ledger");
      channel.current.onmessage = focus;
    }
    return () => {
      window.removeEventListener("focus", focus);
      channel.current?.close();
      speech.current?.abort();
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("little-ledger-input", text);
    } catch {
      setError("无法保留未提交文字，请及时记账或复制保存。");
    }
  }, [text]);
  useEffect(() => {
    if (!editing)
      try {
        localStorage.setItem("little-ledger-drafts", JSON.stringify(drafts));
      } catch {
        setError("无法保留待确认输入，请勿刷新页面。");
      }
  }, [drafts, editing]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 6000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const modal = settings || !!deleteEntry || incoming !== null;
  useEffect(() => {
    const dialog = modalRef.current;
    if (modal && !dialog?.open) dialog?.showModal();
    else if (!modal && dialog?.open) dialog.close();
  }, [modal]);
  const closeModal = () => {
    if (!busy) {
      setSettings(false);
      setDeleteEntry(null);
      setIncoming(null);
      setError("");
    }
  };
  const mutate = async (
    action: () => Promise<void>,
    success: string,
    onSuccess?: () => void,
  ) => {
    if (lock.current || dbError || loading) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      channel.current?.postMessage("changed");
      setNotice(success);
      onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，输入已保留，请重试");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  const save = () =>
    void mutate(
      async () => {
        const validated = drafts.map((d, i) => {
          try {
            return makeEntry(d, editing ?? undefined);
          } catch (error) {
            setExpandedDraft(i);
            throw error;
          }
        });
        if (!validated.length) throw new Error("请先添加待确认账目");
        if (editing) {
          const latest = (await getRepo().list()).find(
            (e) => e.id === editing.id,
          );
          if (!latest || latest.updated_at !== editing.updated_at)
            throw new Error(
              "此账目已在其他页面修改或删除，请取消后重新打开，避免覆盖修改。",
            );
        }
        await getRepo().put(validated);
      },
      editing ? "账目已更新" : `已保存 ${drafts.length} 笔账目`,
      () => {
        setDrafts([]);
        setText("");
        setWarnings([]);
        setEditing(null);
        setComposer(false);
      },
    );
  const parse = () => {
    if (!text.trim()) {
      setError("请先输入消费文字");
      return;
    }
    if (drafts.length) {
      setError("请先保存或取消现有待确认账目，再识别新文字");
      return;
    }
    setExpandedDraft(null);
    const result = parseExpenses(text, entries, localDate(), textSource);
    setDrafts(result.drafts);
    setWarnings(result.warnings);
    setComposer(true);
    setError("");
    if (result.drafts.length && window.matchMedia("(max-width: 600px)").matches)
      inputRef.current?.blur();
    resizeInput();
  };
  const manual = () => {
    setExpandedDraft(drafts.length);
    setEditing(null);
    setDrafts((d) => [...d, blank()]);
    setComposer(true);
    setError("");
  };
  const cancel = () => {
    setExpandedDraft(null);
    setDrafts([]);
    setWarnings([]);
    setEditing(null);
    setComposer(false);
    setError("");
  };
  const edit = (e: Entry) => {
    if (drafts.length) {
      setError("请先保存或取消待确认账目，再编辑历史记录");
      return;
    }
    setExpandedDraft(0);
    setEditing(e);
    setDrafts([
      {
        description: e.description,
        amount: amountText(e.amount_cents),
        category: e.category,
        spent_on: e.spent_on,
        source: e.source,
      },
    ]);
    setComposer(true);
    setPage("home");
    setError("");
  };
  const patch = (i: number, key: keyof Draft, value: string) =>
    setDrafts((old) =>
      old.map((d, j) => (j === i ? { ...d, [key]: value } : d)),
    );
  const SpeechAPI =
    (
      window as unknown as {
        SpeechRecognition?: new () => Speech;
        webkitSpeechRecognition?: new () => Speech;
      }
    ).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => Speech })
      .webkitSpeechRecognition;
  const startVoice = () => {
    if (listening) {
      const s = speech.current;
      if (s) {
        s.onresult = null;
        s.onend = null;
        s.onerror = null;
        s.abort();
      }
      setListening(false);
      setNotice("已取消语音，本次内容未添加");
      return;
    }
    if (!SpeechAPI) return;
    try {
      const s = new SpeechAPI();
      speech.current = s;
      s.lang = "zh-CN";
      s.continuous = false;
      s.interimResults = false;
      s.onresult = (e) => {
        const value = e.results[0]?.[0]?.transcript;
        if (value?.trim()) {
          setText((t) => (t ? `${t}，${value}` : value));
          setTextSource("voice");
          setNotice("语音已转为文字，请识别并核对后保存");
        } else setError("没有听到有效内容，请重试或手动输入");
      };
      s.onerror = (e) => {
        setListening(false);
        setError(
          e.error === "not-allowed"
            ? "麦克风权限被拒绝。可使用系统键盘听写，或手动输入。"
            : `语音未成功（${e.error}），请使用键盘听写或手动输入。`,
        );
      };
      s.onend = () => setListening(false);
      s.start();
      setListening(true);
      setError("");
    } catch {
      setListening(false);
      setError("网页语音不可用，请使用系统键盘听写或手动输入");
    }
  };
  const readBackup = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("备份文件超过 20 MB，请使用较小的 JSON 文件");
      const data = validateBackup(JSON.parse(await file.text()));
      planImport(await getRepo().list(), data);
      setSettings(false);
      setIncoming(data);
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "JSON 文件格式错误，未导入数据"
          : e instanceof Error
            ? e.message
            : "读取备份失败",
      );
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  let draftTotal: number | null = 0;
  try {
    for (const d of drafts) draftTotal += toCents(d.amount);
    if (!Number.isSafeInteger(draftTotal)) draftTotal = null;
  } catch {
    draftTotal = null;
  }
  const sorted = [...entries].sort(
    (a, b) =>
      b.spent_on.localeCompare(a.spent_on) ||
      b.created_at.localeCompare(a.created_at),
  );
  const selected = sorted.filter((e) => e.spent_on.startsWith(month));
  const stats = totals(selected);
  const current = totals(
    entries.filter((e) => e.spent_on.startsWith(localDate().slice(0, 7))),
  );
  const months = [
    ...new Set([
      localDate().slice(0, 7),
      month,
      ...entries.map((e) => e.spent_on.slice(0, 7)),
    ]),
  ]
    .sort()
    .reverse();
  const selectedDate = new Date(month + "-01T12:00:00");
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(selectedDate);
    d.setMonth(d.getMonth() - 5 + i);
    const key = localDate(d).slice(0, 7);
    return {
      key,
      label: `${d.getMonth() + 1}月`,
      ...totals(entries.filter((e) => e.spent_on.startsWith(key))),
    };
  });
  const max = Math.max(...trend.map((t) => t.total), 1);
  const MonthPicker = () => (
    <div className="month-picker">
      <label htmlFor="month">月份</label>
      <select
        id="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      >
        {months.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
    </div>
  );
  const rows = (list: Entry[]) =>
    list.length ? (
      <div className="entry-list">
        {list.map((e) => (
          <div className="entry" key={e.id}>
            <div className={`entry-icon ${e.category}`}>
              <Icon name={e.category === "necessary" ? "leaf" : "spark"} />
            </div>
            <div className="entry-info">
              <strong>{e.description}</strong>
              <span>
                {e.spent_on.replaceAll("-", ".")}
                <span className="dot">·</span>
                {categories[e.category]}
              </span>
            </div>
            <div className="entry-amount">¥ {money(e.amount_cents)}</div>
            <div className="entry-actions">
              <button
                aria-label={`编辑 ${e.description}`}
                className="icon-button"
                disabled={busy}
                onClick={() => edit(e)}
              >
                <Icon name="edit" size={17} />
              </button>
              <button
                aria-label={`删除 ${e.description}`}
                className="icon-button"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setDeleteEntry(e);
                }}
              >
                <Icon name="trash" size={17} />
              </button>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="empty">
        <div className="empty-icon">
          <Icon name="book" size={30} />
        </div>
        <strong>还没有账目</strong>
        <p>从一笔小小的消费开始，慢慢看清生活。</p>
        <button
          className="text-button"
          onClick={() => {
            setPage("home");
            manual();
          }}
        >
          记下第一笔 <Icon name="arrow" size={16} />
        </button>
      </div>
    );
  return (
    <div className={`app-shell page-${page}`}>
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setPage("home");
          }}
        >
          <span className="brand-mark">
            <Icon name="book" size={25} />
          </span>
          <span>
            小账<small>把日子，记清楚。</small>
          </span>
        </a>
        <div className="nav-caption">我的记账本</div>
        <nav aria-label="主导航">
          {(
            [
              ["home", "home", "首页"],
              ["ledger", "list", "消费流水"],
              ["stats", "chart", "统计分析"],
            ] as const
          ).map(([id, icon, label]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {page === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <Icon name="shield" />
            <div>
              <strong>你的数据，由你掌握</strong>
              <p>本地保存 · 支持完整备份</p>
            </div>
          </div>
          <button
            className="settings-nav"
            onClick={() => {
              setError("");
              setSettings(true);
            }}
          >
            <Icon name="settings" />
            设置与备份
          </button>
          <div className="version">
            小账 V1.0 <span>本地版</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-home-title">
            <strong>
              {page === "home"
                ? "小账"
                : page === "ledger"
                  ? "消费流水"
                  : "统计分析"}
            </strong>
            <span>
              {monthLabel(page === "home" ? localDate().slice(0, 7) : month)}
            </span>
          </div>
          <span className="breadcrumb">
            我的记账本 <span>/</span>{" "}
            {page === "home"
              ? "首页"
              : page === "ledger"
                ? "消费流水"
                : "统计分析"}
          </span>
          <button className="local-status" onClick={() => setSettings(true)}>
            <span />
            仅当前浏览器
          </button>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {page === "home"
                  ? "KEEP IT SIMPLE"
                  : page === "ledger"
                    ? "EVERY LITTLE MOMENT"
                    : "A CLEARER PICTURE"}
              </p>
              <h1>
                {page === "home"
                  ? "每一笔，都有迹可循。"
                  : page === "ledger"
                    ? "生活的点滴，有账可查。"
                    : "钱花在哪里，一目了然。"}
              </h1>
              <p>
                {page === "home"
                  ? "简单记下今天的消费，把更多时间留给生活。"
                  : page === "ledger"
                    ? "回顾每一笔支出，也可以随时修改。"
                    : "少一点复杂数字，多一点对生活的了解。"}
              </p>
            </div>
            <div className="today">
              {localDate().replaceAll("-", ".")}
              <span>
                {
                  [
                    "星期日",
                    "星期一",
                    "星期二",
                    "星期三",
                    "星期四",
                    "星期五",
                    "星期六",
                  ][new Date().getDay()]
                }
              </span>
            </div>
          </div>
          {needRefresh && (
            <div className="banner">
              新版本已准备好，请先保存当前输入。
              <button
                disabled={busy || drafts.length > 0 || !!text.trim()}
                onClick={() => void updateServiceWorker(true)}
              >
                更新应用
              </button>
            </div>
          )}
          {loading && (
            <div className="banner" role="status">
              正在读取你的账本…
            </div>
          )}
          {dbError && (
            <div className="banner error" role="alert">
              <strong>账本未能读取，当前金额和记录数量未知。</strong>
              <br />
              {dbError}
              <button onClick={() => void refresh()}>重试</button>
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              <Icon name="check" />
              {notice}
            </div>
          )}
          {error && !modal && (
            <div className="banner error global-error" role="alert">
              {error}
            </div>
          )}
          {page === "home" && !loading && !dbError && (
            <div className="home-content">
              <section className="summary-grid" aria-label="本月概览">
                <div className="total-card">
                  <div className="card-label">
                    本月总支出 <span>{Number(localDate().slice(5, 7))} 月</span>
                  </div>
                  <div className="big-money">
                    <small>¥</small>
                    {money(current.total)}
                  </div>
                  <div className="total-foot">
                    <span className="mini-line" />
                    好好记账，好好生活
                  </div>
                  <div className="card-decoration" />
                </div>
                <div className="summary-card">
                  <div className="summary-top">
                    <span className="category-icon necessary">
                      <Icon name="leaf" />
                    </span>
                    <span>必要生活开支</span>
                  </div>
                  <div className="summary-money">
                    <small>¥</small>
                    {money(current.necessary)}
                  </div>
                  <p>
                    日常所需，安心生活
                    <span>
                      {current.total
                        ? Math.round((current.necessary / current.total) * 100)
                        : 0}
                      %
                    </span>
                  </p>
                  <div className="progress">
                    <i
                      style={{
                        width: `${current.total ? (current.necessary / current.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="summary-card">
                  <div className="summary-top">
                    <span className="category-icon discretionary">
                      <Icon name="spark" />
                    </span>
                    <span>非必要开支</span>
                  </div>
                  <div className="summary-money">
                    <small>¥</small>
                    {money(current.discretionary)}
                  </div>
                  <p>
                    小小欢喜，也值得记录
                    <span>
                      {current.total
                        ? Math.round(
                            (current.discretionary / current.total) * 100,
                          )
                        : 0}
                      %
                    </span>
                  </p>
                  <div className="progress warm">
                    <i
                      style={{
                        width: `${current.total ? (current.discretionary / current.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </section>
              <div className="home-columns">
                <section className="panel quick-panel">
                  <div className="section-title">
                    <h2>
                      <Icon name="plus" />
                      记一笔
                    </h2>
                    <span className="sub-label">不用复杂，随手就好</span>
                  </div>
                  <label className="input-caption" htmlFor="expense-text">
                    今天花了什么？
                  </label>
                  <textarea
                    ref={inputRef}
                    onFocus={resizeInput}
                    id="expense-text"
                    placeholder={
                      isMobile
                        ? "买菜38元，零食25元"
                        : "例如：今天买菜花了38块，买零食花了25块"
                    }
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setTextSource("manual");
                    }}
                    maxLength={3000}
                    disabled={busy || !!editing}
                  />
                  <div className="voice-tip">
                    <Icon name="mic" size={16} />
                    <span>iPhone 可点击系统键盘麦克风，直接听写</span>
                  </div>
                  <div className="quick-actions">
                    {SpeechAPI && (
                      <button
                        className={
                          listening ? "secondary listening" : "secondary"
                        }
                        onClick={startVoice}
                        disabled={busy || !!editing}
                      >
                        <Icon name="mic" size={17} />
                        {listening ? "取消语音" : "语音输入"}
                      </button>
                    )}
                    <button
                      className="primary"
                      onClick={parse}
                      disabled={busy || loading || !!dbError || !!editing}
                    >
                      识别账目 <Icon name="arrow" size={16} />
                    </button>
                    <button
                      className="text-button"
                      onClick={manual}
                      disabled={busy || loading || !!dbError || !!editing}
                    >
                      手动记账
                    </button>
                  </div>
                  <div className="mobile-input-feedback">
                    {error && !modal && (
                      <div className="banner error" role="alert">
                        {error}
                      </div>
                    )}
                    {!drafts.length &&
                      warnings.map((w, i) => (
                        <div className="banner warning" role="alert" key={i}>
                          {w}
                        </div>
                      ))}
                  </div>
                  <div className="confirmation-tip">
                    <Icon name="shield" size={15} />
                    识别只是建议，确认后才会保存
                  </div>
                </section>
                <aside className="gentle-card">
                  <div className="gentle-illustration">
                    <svg viewBox="0 0 180 120" aria-hidden="true">
                      <ellipse cx="90" cy="106" rx="57" ry="7" fill="#d8dfcb" />
                      <path
                        d="M47 26h67l19 15v61H58l-11-9Z"
                        fill="#f7f7ec"
                        stroke="#698069"
                        strokeWidth="2"
                      />
                      <path
                        d="M114 26v18h19M62 53h41M62 65h48M62 77h26"
                        fill="none"
                        stroke="#a7b49b"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                      <path
                        d="m102 103 33-51 8 5-33 51Z"
                        fill="#cbaa75"
                        stroke="#806b4c"
                        strokeWidth="1.5"
                      />
                      <path d="m136 52 4-6 8 5-5 6" fill="#55765d" />
                      <path
                        d="M35 89c-12-20-5-36 9-37 7 13 6 24-9 37Z"
                        fill="#9eb48c"
                      />
                      <path d="M35 101V69" stroke="#617858" strokeWidth="2" />
                    </svg>
                  </div>
                  <h3>记账，是为了更自在的生活。</h3>
                  <p>
                    区分生活所需与小小欢喜，
                    <br />
                    让每一次消费都更心中有数。
                  </p>
                  <span>
                    不必完美，坚持就好 <span>↗</span>
                  </span>
                </aside>
              </div>
              {composer && (
                <section
                  className={`panel drafts-panel ${drafts.length ? "" : "empty-composer"}`}
                  aria-label="确认账目"
                >
                  <div className="section-title">
                    <h2>{editing ? "编辑账目" : "核对后，再保存"}</h2>
                    <span className="sub-label">{drafts.length} 笔待确认</span>
                  </div>
                  <div className="mobile-draft-total">
                    {drafts.length} 笔待确认 ·{" "}
                    {draftTotal === null
                      ? "合计待核对：请填写有效金额"
                      : `合计 ¥ ${money(draftTotal)}`}
                  </div>
                  {warnings.map((w, i) => (
                    <div className="banner warning" key={i}>
                      {w}
                    </div>
                  ))}
                  {drafts.map((d, i) => (
                    <div className="draft-row" key={i}>
                      <button
                        className="draft-summary"
                        type="button"
                        aria-expanded={expandedDraft === i || !!editing}
                        aria-controls={`draft-fields-${i}`}
                        aria-label={`编辑待确认 ${i + 1}`}
                        disabled={busy}
                        onClick={() =>
                          setExpandedDraft(expandedDraft === i ? null : i)
                        }
                      >
                        <span>
                          {d.description || "请填写消费内容"}
                          <small>
                            {d.category ? categories[d.category] : "分类待确认"}
                          </small>
                        </span>
                        <strong>¥ {d.amount || "待填写"}</strong>
                      </button>
                      <div
                        id={`draft-fields-${i}`}
                        className={`draft-fields ${expandedDraft === i || editing ? "expanded" : ""}`}
                      >
                        <label>
                          消费内容
                          <input
                            aria-label={`消费内容 ${i + 1}`}
                            value={d.description}
                            maxLength={120}
                            onChange={(e) =>
                              patch(i, "description", e.target.value)
                            }
                            onBlur={() => {
                              if (!d.category)
                                patch(
                                  i,
                                  "category",
                                  suggestCategory(d.description, entries),
                                );
                            }}
                            disabled={busy}
                          />
                        </label>
                        <label>
                          金额（元）
                          <input
                            aria-label={`金额 ${i + 1}`}
                            inputMode="decimal"
                            value={d.amount}
                            placeholder="0.00"
                            onChange={(e) => patch(i, "amount", e.target.value)}
                            disabled={busy}
                          />
                        </label>
                        <label>
                          消费日期
                          <input
                            aria-label={`消费日期 ${i + 1}`}
                            type="date"
                            value={d.spent_on}
                            onChange={(e) =>
                              patch(i, "spent_on", e.target.value)
                            }
                            disabled={busy}
                          />
                        </label>
                        <label>
                          分类
                          <select
                            aria-label={`分类 ${i + 1}`}
                            value={d.category}
                            onChange={(e) =>
                              patch(i, "category", e.target.value)
                            }
                            disabled={busy}
                          >
                            <option value="">待确认，请选择</option>
                            <option value="necessary">必要生活开支</option>
                            <option value="discretionary">非必要开支</option>
                          </select>
                        </label>
                        {!editing && (
                          <button
                            className="icon-button"
                            aria-label={`移除待确认 ${i + 1}`}
                            onClick={() => {
                              setExpandedDraft(null);
                              setDrafts((old) => old.filter((_, j) => j !== i));
                            }}
                            disabled={busy}
                          >
                            <Icon name="close" size={17} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="draft-footer">
                    <button
                      className="secondary"
                      onClick={cancel}
                      disabled={busy}
                    >
                      取消{editing ? "编辑" : "待确认"}
                    </button>
                    <button
                      className="primary"
                      onClick={save}
                      disabled={busy || !drafts.length || !!dbError}
                    >
                      {busy
                        ? "保存中…"
                        : editing
                          ? "保存修改"
                          : `确认保存${drafts.length ? ` ${drafts.length} 笔` : ""}`}
                    </button>
                  </div>
                </section>
              )}
              <section className="panel recent-panel">
                <div className="section-title">
                  <h2>
                    最近记录 <span className="count">{entries.length} 笔</span>
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => setPage("ledger")}
                  >
                    查看全部 <Icon name="chevron" size={15} />
                  </button>
                </div>
                {rows(sorted.slice(0, 5))}
              </section>
            </div>
          )}
          {page === "ledger" && !loading && !dbError && (
            <section className="panel">
              <div className="section-title">
                <h2>
                  消费流水 <span className="count">{selected.length} 笔</span>
                </h2>
                <MonthPicker />
              </div>
              <div className="ledger-total">
                <span>{monthLabel(month)}支出</span>
                <strong>¥ {money(stats.total)}</strong>
              </div>
              {rows(selected)}
            </section>
          )}
          {page === "stats" && !loading && !dbError && (
            <>
              <div className="stats-header">
                <h2>月度概览</h2>
                <MonthPicker />
              </div>
              <section className="stats-grid">
                <div className="panel breakdown">
                  <div className="section-title">
                    <h2>支出构成</h2>
                    <span className="sub-label">{monthLabel(month)}</span>
                  </div>
                  <div
                    className="donut"
                    role="img"
                    aria-label={`必要生活开支 ${money(stats.necessary)} 元，非必要开支 ${money(stats.discretionary)} 元`}
                    style={{
                      background: stats.total
                        ? `conic-gradient(var(--chart-necessary, #49745d) 0 ${(stats.necessary / stats.total) * 100}%, var(--chart-discretionary, #c9a26f) ${(stats.necessary / stats.total) * 100}% 100%)`
                        : "var(--chart-empty, #e8ece4)",
                    }}
                  >
                    <div>
                      <span>月总支出</span>
                      <strong>¥ {money(stats.total)}</strong>
                    </div>
                  </div>
                  <div className="legend">
                    <div>
                      <span className="legend-dot" />
                      必要生活开支<strong>¥ {money(stats.necessary)}</strong>
                      <small>
                        {stats.total
                          ? ((stats.necessary / stats.total) * 100).toFixed(1)
                          : "0"}
                        %
                      </small>
                    </div>
                    <div>
                      <span className="legend-dot warm" />
                      非必要开支<strong>¥ {money(stats.discretionary)}</strong>
                      <small>
                        {stats.total
                          ? ((stats.discretionary / stats.total) * 100).toFixed(
                              1,
                            )
                          : "0"}
                        %
                      </small>
                    </div>
                  </div>
                </div>
                <div className="panel trend-panel">
                  <div className="section-title">
                    <h2>月度消费趋势</h2>
                    <span className="sub-label">截至所选月份的 6 个月</span>
                  </div>
                  <div
                    className="bar-chart"
                    role="img"
                    aria-label="最近六个月的实际消费趋势"
                  >
                    {trend.map((t) => (
                      <div className="bar-column" key={t.key}>
                        <span className="bar-value">¥ {money(t.total)}</span>
                        <div className="bar-track">
                          <div
                            className="bar-stack"
                            style={{ height: `${(t.total / max) * 100}%` }}
                          >
                            <i
                              style={{
                                height: `${t.total ? (t.discretionary / t.total) * 100 : 0}%`,
                              }}
                            />
                            <b
                              style={{
                                height: `${t.total ? (t.necessary / t.total) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                        <span>{t.label}</span>
                        <small>{t.key.slice(0, 4)}</small>
                      </div>
                    ))}
                  </div>
                  <div className="chart-foot">
                    <span>
                      <i />
                      必要生活开支
                    </span>
                    <span>
                      <i className="warm" />
                      非必要开支
                    </span>
                  </div>
                  {!stats.total && (
                    <p className="chart-empty">
                      该月暂无消费，统计只计算已保存的真实账目。
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
          {undo && (
            <div className="undo-toast" role="status">
              已删除“{undo.description}”
              <button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    async () => {
                      if (
                        (await getRepo().list()).some((e) => e.id === undo.id)
                      )
                        throw new Error("该账目已恢复，请刷新查看");
                      await getRepo().put([undo]);
                    },
                    "已撤销删除",
                    () => setUndo(null),
                  )
                }
              >
                撤销删除
              </button>
              <button
                className="icon-button"
                aria-label="关闭撤销提示"
                onClick={() => setUndo(null)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          <footer className="page-footer">
            <span>
              <Icon name="shield" size={14} />
              数据保存在当前浏览器，请定期备份
            </span>
            <span>少一点负担，多一点清晰。</span>
          </footer>
        </main>
      </div>
      <dialog
        ref={modalRef}
        onCancel={(e) => {
          e.preventDefault();
          closeModal();
        }}
      >
        <div className="modal-title">
          <h2>
            {settings
              ? "设置与备份"
              : deleteEntry
                ? "删除这笔账目？"
                : "恢复 JSON 备份"}
          </h2>
          <button
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={closeModal}
            disabled={busy}
          >
            <Icon name="close" />
          </button>
        </div>
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        {settings && (
          <>
            <div className="settings-info">
              <Icon name="shield" size={25} />
              <div>
                <strong>本地账本，属于你自己</strong>
                <p>
                  当前没有账户登录或云同步。手机、电脑以及不同浏览器的数据各自独立。同一浏览器配置下共用账本，请勿在共享设备上记录私密消费。
                </p>
              </div>
            </div>
            <div className="backup-section">
              <h3>备份与恢复</h3>
              <p>
                {dbError || loading
                  ? "尚无法确认记录数量。"
                  : `共 ${entries.length} 笔记录。`}
                清除网站数据、卸载或设备故障可能造成丢失，建议定期导出 JSON。
              </p>
              <button
                className="secondary full"
                disabled={loading || !!dbError}
                onClick={() => {
                  download(
                    JSON.stringify(
                      {
                        version: 1,
                        exported_at: new Date().toISOString(),
                        entries: sorted,
                      },
                      null,
                      2,
                    ),
                    `小账备份-${localDate()}.json`,
                    "application/json",
                  );
                  setNotice("JSON 备份已生成，请确认下载文件已保存");
                }}
              >
                <Icon name="download" />
                导出 JSON 完整备份
              </button>
              <button
                className="secondary full"
                disabled={loading || !!dbError}
                onClick={() =>
                  download(
                    exportCSV(sorted),
                    `小账流水-${localDate()}.csv`,
                    "text/csv;charset=utf-8",
                  )
                }
              >
                <Icon name="download" />
                导出 CSV 流水
              </button>
              <button
                className="secondary full"
                disabled={busy || loading || !!dbError}
                onClick={() => fileRef.current?.click()}
              >
                从 JSON 备份恢复
              </button>
            </div>
            <div className="install-info">
              <h3>添加到手机桌面</h3>
              <p>
                iPhone Safari：点击分享按钮
                →「添加到主屏幕」。首次打开需联网加载；安装后可离线记账。网页需要通过
                HTTPS 提供。
              </p>
              <p>
                语音优先使用系统键盘听写。网页麦克风取决于浏览器支持和网络，不能保证离线可用。
              </p>
            </div>
          </>
        )}
        {deleteEntry && (
          <>
            <p className="modal-copy">
              确认删除“{deleteEntry.description}”（¥{" "}
              {money(deleteEntry.amount_cents)}）？删除后可在当前页面撤销。
            </p>
            <div className="draft-footer">
              <button
                className="secondary"
                disabled={busy}
                onClick={closeModal}
              >
                保留账目
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () => getRepo().remove(deleteEntry.id),
                    "账目已删除",
                    () => {
                      setUndo(deleteEntry);
                      setDeleteEntry(null);
                    },
                  )
                }
              >
                {busy ? "删除中…" : "确认删除"}
              </button>
            </div>
          </>
        )}
        {incoming !== null && (
          <>
            <p className="modal-copy">
              备份包含 {incoming.length} 笔账目。恢复会合并到本地账本；相同 ID
              的相同账目跳过，不会覆盖已有修改。
            </p>
            <div className="draft-footer">
              <button
                className="secondary"
                disabled={busy}
                onClick={closeModal}
              >
                取消恢复
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  let added = 0,
                    skipped = 0;
                  void mutate(
                    async () => {
                      const plan = planImport(await getRepo().list(), incoming);
                      added = plan.add.length;
                      skipped = plan.skipped;
                      await getRepo().put(plan.add);
                    },
                    "备份恢复完成",
                    () => {
                      setNotice(
                        `恢复完成：新增 ${added} 笔，跳过 ${skipped} 笔重复账目`,
                      );
                      setIncoming(null);
                    },
                  );
                }}
              >
                {busy ? "恢复中…" : "确认恢复"}
              </button>
            </div>
          </>
        )}
      </dialog>
      <input
        className="hidden"
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        aria-label="选择 JSON 备份"
        onChange={(e) => void readBackup(e.target.files?.[0])}
      />
    </div>
  );
}
