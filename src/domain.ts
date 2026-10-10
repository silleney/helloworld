export type Category = "necessary" | "discretionary";
export type Entry = {
  id: string;
  description: string;
  amount_cents: number;
  category: Category;
  spent_on: string;
  source: "voice" | "manual";
  created_at: string;
  updated_at: string;
};
export type Draft = {
  description: string;
  amount: string;
  category: Category | "";
  spent_on: string;
  source: Entry["source"];
};
export const categories = {
  necessary: "必要生活开支",
  discretionary: "非必要开支",
};
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  return y >= 1900 && y <= 9999 && localDate(date) === s;
}
export function toCents(s: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(s.trim()))
    throw new Error("金额请填写大于零的数字，最多两位小数");
  const [a, b = ""] = s.trim().split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n <= 0 || n > 99999999900)
    throw new Error("金额须大于零且不超过 999,999,999 元");
  return n;
}
export const money = (n: number) =>
  (n / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const amountText = (n: number) =>
  `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
export function makeEntry(d: Draft, previous?: Entry): Entry {
  const description = d.description.trim();
  if (!description || description.length > 120)
    throw new Error("请填写消费内容（最多 120 字）");
  if (!validDate(d.spent_on)) throw new Error("请选择有效日期");
  if (!["necessary", "discretionary"].includes(d.category))
    throw new Error("请选择必要或非必要分类");
  const now = new Date().toISOString();
  return {
    id: previous?.id ?? crypto.randomUUID(),
    description,
    amount_cents: toCents(d.amount),
    category: d.category as Category,
    spent_on: d.spent_on,
    source: previous?.source ?? d.source,
    created_at: previous?.created_at ?? now,
    updated_at: now,
  };
}
export function suggestCategory(
  description: string,
  history: Entry[],
): Category | "" {
  const name = description.trim().replace(/^(买了?|购买)/, "");
  const previous = [...history]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .find((e) => e.description.trim().replace(/^(买了?|购买)/, "") === name);
  if (previous) return previous.category;
  if (/衣服|外卖|咖啡|礼物/.test(name)) return "";
  if (/零食|玩具|电影|游戏|娱乐|装饰|奶茶/.test(name)) return "discretionary";
  if (
    /^菜$|买菜|蔬菜|大米|米饭|水费|电费|水电|公交|地铁|通勤|生活用品|牙膏|卫生纸|基础食品/.test(
      name,
    )
  )
    return "necessary";
  return "";
}
const digits: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
function numberValue(s: string): number {
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (!s || !/^[零〇一二两三四五六七八九十百千万点]+$/.test(s)) return NaN;
  if (s.includes("点")) {
    const [whole, fraction, ...rest] = s.split("点");
    if (rest.length || !fraction || ![...fraction].every((c) => c in digits))
      return NaN;
    return (
      numberValue(whole) +
      Number("0." + [...fraction].map((c) => digits[c]).join(""))
    );
  }
  if (!/[十百千万]/.test(s))
    return Number([...s].map((c) => digits[c]).join(""));
  let total = 0,
    section = 0,
    current = 0;
  for (const c of s) {
    if (c in digits) {
      current = digits[c];
      continue;
    }
    const unit: Record<string, number> = {
      十: 10,
      百: 100,
      千: 1000,
      万: 10000,
    };
    if (c === "万") {
      total += (section + current) * 10000;
      section = 0;
      current = 0;
    } else {
      section += (current || 1) * unit[c];
      current = 0;
    }
  }
  return total + section + current;
}
// Only an exact two-part comma repetition is unambiguous enough to collapse.
export function cleanDescription(description: string): string {
  const parts = description.split(/[，,]/).map((part) => part.trim());
  return parts.length === 2 && parts[0] && parts[0] === parts[1]
    ? parts[0]
    : description;
}
const num = "[0-9零〇一二两三四五六七八九十百千万点]+(?:\\.[0-9]+)?";
const unitAmount = `(${num})\\s*(?:元|块)(?:钱)?(?:\\s*(${num})\\s*(?:角|毛)(?:\\s*(${num})\\s*分)?|\\s*(${num})\\s*分|([0-9一二两三四五六七八九]))?`;
// Unit form first: ¥38元 is one token, never two candidates.
const amountPattern = new RegExp(
  `(?:[¥￥]\\s*)?${unitAmount}|[¥￥]\\s*(${num})`,
  "g",
);
export function parseExpenses(
  text: string,
  history: Entry[] = [],
  today = localDate(),
  source: Entry["source"] = "manual",
): { drafts: Draft[]; warnings: string[] } {
  const drafts: Draft[] = [],
    warnings: string[] = [];
  let cursor = 0;
  const matches = [...text.matchAll(amountPattern)];
  if (!matches.length)
    return {
      drafts,
      warnings: ["没有识别到明确金额。请使用“买菜 38 元”，或切换手动记账。"],
    };
  if (
    /[¥￥]\s*[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?\d|[,，]\d{3})/.test(text) ||
    new RegExp(
      `(?:[¥￥]\\s*${num}|${num}\\s*(?:元|块))\\s*[-~～—]\\s*(?:[¥￥]\\s*)?${num}`,
    ).test(text) ||
    /还是|或者|大约|大概|左右|可能|(?:到|至|或)\s*(?:[¥￥]\s*\d+|\d+\s*(?:元|块))/.test(
      text,
    )
  )
    return {
      drafts,
      warnings: [
        "金额或描述存在歧义，请拆成每笔明确的消费后再识别，或手动填写。",
      ],
    };
  for (const match of matches) {
    const start = match.index!;
    const prefix = text.slice(cursor, start);
    cursor = start + match[0].length;
    let date = today;
    const relative = prefix.match(/前天|昨天|今天/);
    if (relative) {
      const d = new Date(today + "T12:00:00");
      d.setDate(
        d.getDate() -
          (relative[0] === "昨天" ? 1 : relative[0] === "前天" ? 2 : 0),
      );
      date = localDate(d);
    }
    const explicit = prefix.match(/\d{4}-\d{2}-\d{2}/);
    if (explicit) date = explicit[0];
    const description = cleanDescription(
      prefix
        .replace(/\d{4}-\d{2}-\d{2}|前天|昨天|今天/g, "")
        .replace(/^[\s，,。；;、和然后]+/, "")
        .replace(
          /(?:花了?|用了?|支付了?|付了?|总共|一共|共计|是|为|价格|费用|花费|消费了?)\s*$/,
          "",
        )
        .trim(),
    );
    if (
      /[0-9.\-−负¥￥]\s*$/.test(prefix) ||
      /[¥￥]\s*[-−负]/.test(prefix) ||
      (match[6] !== undefined &&
        /^(?:[eE][+-]?\d|[,，]\d{3}(?:\D|$))/.test(text.slice(cursor))) ||
      /^[0-9零〇一二两三四五六七八九]/.test(text.slice(cursor))
    ) {
      warnings.push("金额格式存在歧义，请手动填写，最多两位小数。");
      continue;
    }
    const base = numberValue(match[1] ?? match[6]);
    const cents =
      Math.round(base * 100) +
      (match[2] ? numberValue(match[2]) * 10 : 0) +
      (match[3] ? numberValue(match[3]) : 0) +
      (match[4] ? numberValue(match[4]) : 0) +
      (match[5] ? numberValue(match[5]) * 10 : 0);
    if (
      Math.abs(base * 100 - Math.round(base * 100)) > 0.00001 ||
      (match[1]?.includes(".") && match[1].split(".")[1].length > 2) ||
      (match[6]?.includes(".") && match[6].split(".")[1].length > 2) ||
      /^[.零〇一二两三四五六七八九0-9]/.test(text.slice(cursor)) ||
      !description ||
      !Number.isSafeInteger(cents) ||
      cents <= 0 ||
      cents > 99999999900 ||
      !validDate(date)
    ) {
      warnings.push(`“${prefix}${match[0]}”无法准确识别，请手动填写。`);
      continue;
    }
    drafts.push({
      description,
      amount: amountText(cents),
      category: suggestCategory(description, history),
      spent_on: date,
      source,
    });
  }
  const tail = text.slice(cursor).replace(/[\s，,。；;、！!]/g, "");
  if (tail) warnings.push(`末尾“${tail}”未识别，请核对是否有遗漏。`);
  return { drafts, warnings };
}
export function totals(entries: Entry[]) {
  const necessary = entries
      .filter((e) => e.category === "necessary")
      .reduce((s, e) => s + e.amount_cents, 0),
    discretionary = entries
      .filter((e) => e.category === "discretionary")
      .reduce((s, e) => s + e.amount_cents, 0);
  return { necessary, discretionary, total: necessary + discretionary };
}
export function validateBackup(input: unknown): Entry[] {
  const obj = input as { version?: number; entries?: unknown[] };
  if (
    !obj ||
    obj.version !== 1 ||
    !Array.isArray(obj.entries) ||
    obj.entries.length > 100000
  )
    throw new Error("备份格式不正确，需为小账 V1 JSON 备份（最多 10 万条）");
  const seen = new Set<string>();
  return obj.entries.map((row, i) => {
    const e = row as Entry;
    if (
      !e ||
      typeof e.id !== "string" ||
      !e.id ||
      e.id.length > 128 ||
      seen.has(e.id) ||
      typeof e.description !== "string" ||
      !e.description.trim() ||
      e.description.length > 120 ||
      !Number.isSafeInteger(e.amount_cents) ||
      e.amount_cents <= 0 ||
      e.amount_cents > 99999999900 ||
      !["necessary", "discretionary"].includes(e.category) ||
      typeof e.spent_on !== "string" ||
      !validDate(e.spent_on) ||
      !["voice", "manual"].includes(e.source) ||
      typeof e.created_at !== "string" ||
      !Number.isFinite(Date.parse(e.created_at)) ||
      typeof e.updated_at !== "string" ||
      !Number.isFinite(Date.parse(e.updated_at))
    )
      throw new Error(`第 ${i + 1} 条记录无效或 ID 重复，未导入任何数据`);
    seen.add(e.id);
    return {
      id: e.id,
      description: e.description,
      amount_cents: e.amount_cents,
      category: e.category,
      spent_on: e.spent_on,
      source: e.source,
      created_at: e.created_at,
      updated_at: e.updated_at,
    };
  });
}
export function planImport(
  existing: Entry[],
  incoming: Entry[],
): { add: Entry[]; skipped: number } {
  const map = new Map(existing.map((e) => [e.id, e]));
  let skipped = 0;
  const add: Entry[] = [];
  for (const e of incoming) {
    const old = map.get(e.id);
    if (old) {
      if (
        (
          [
            "id",
            "description",
            "amount_cents",
            "category",
            "spent_on",
            "source",
            "created_at",
            "updated_at",
          ] as const
        ).some((key) => old[key] !== e[key])
      )
        throw new Error(
          `“${e.description}”与已有记录 ID 相同但内容不同。为保护本地修改，已取消导入。`,
        );
      skipped++;
    } else add.push(e);
  }
  return { add, skipped };
}
export function exportCSV(entries: Entry[]): string {
  const cell = (v: string) =>
    '"' +
    (/^(?:\s*[=+\-@]|[\t\r\n])/.test(v) ? "'" + v : v).replace(/"/g, '""') +
    '"';
  return (
    "\uFEFF日期,消费内容,金额（元）,分类,来源,ID\r\n" +
    entries
      .map((e) =>
        [
          e.spent_on,
          e.description,
          amountText(e.amount_cents),
          categories[e.category],
          e.source,
          e.id,
        ]
          .map(cell)
          .join(","),
      )
      .join("\r\n")
  );
}
