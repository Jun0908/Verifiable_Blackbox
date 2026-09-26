export type Usage = {
  source: "sample";
  usageId: string;
  occurredAt: string;
  counterpartyId: string;
  counterpartyName: string;
  description: string;
  asset: string;
  decimals: number;
  amountMinor: string;
  evidenceRef: string;
};

export function formatAmount(value: string | bigint, decimals = 6): string {
  const n = BigInt(value);
  const sign = n < 0n ? "-" : "";
  const digits = (n < 0n ? -n : n).toString().padStart(decimals + 1, "0");
  if (!decimals) return sign + digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, "").padEnd(2, "0");
  return `${sign}${digits.slice(0, -decimals)}.${fraction}`;
}

export function monthInTokyo(date: string): string {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) throw new Error("作業日時が不正です。");
  return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

export function validateUsage(rows: unknown): Usage[] {
  if (!Array.isArray(rows)) throw new Error("サンプル形式が不正です。");
  const ids = new Set<string>();
  return rows.map((row) => {
    if (!row || row.source !== "sample" || typeof row.usageId !== "string" || ids.has(row.usageId)
      || typeof row.amountMinor !== "string" || !/^\d+$/.test(row.amountMinor)
      || row.decimals !== 6 || row.asset !== "mUSDC") throw new Error("サンプル明細が不正または重複しています。");
    for (const key of ["occurredAt", "counterpartyId", "counterpartyName", "description", "evidenceRef"]) {
      if (typeof row[key] !== "string" || !row[key]) throw new Error("サンプル項目が不足しています。");
    }
    monthInTokyo(row.occurredAt);
    ids.add(row.usageId);
    return row as Usage;
  });
}

export function summarize(rows: Usage[], period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("対象月が不正です。");
  const selected = validateUsage(rows).filter(row => monthInTokyo(row.occurredAt) === period);
  const groups = new Map<string, {counterpartyId: string; counterpartyName: string; asset: string; decimals: number; usageCount: number; amountMinor: string; amountDisplay: string}>();
  for (const row of selected) {
    const key = `${row.counterpartyId}:${row.asset}:${row.decimals}`;
    const group = groups.get(key) ?? {counterpartyId: row.counterpartyId, counterpartyName: row.counterpartyName, asset: row.asset, decimals: row.decimals, usageCount: 0, amountMinor: "0", amountDisplay: "0.00"};
    group.usageCount++;
    group.amountMinor = (BigInt(group.amountMinor) + BigInt(row.amountMinor)).toString();
    group.amountDisplay = formatAmount(group.amountMinor, group.decimals);
    groups.set(key, group);
  }
  const amountMinor = selected.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n).toString();
  return {source: "sample", period, usageCount: selected.length, counterpartyCount: groups.size, amountMinor, amountDisplay: formatAmount(amountMinor), asset: "mUSDC", groups: [...groups.values()], rows: selected};
}

export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function monthlyCsv(rows: Usage[], period: string, kind: "summary" | "details"): string {
  if (!["summary", "details"].includes(kind)) throw new Error("INVALID_CSV_KIND");
  const result = summarize(rows, period);
  const headers = kind === "summary"
    ? ["source", "period", "counterpartyId", "counterpartyName", "asset", "decimals", "usageCount", "amountMinor", "amountDisplay"]
    : ["source", "period", "usageId", "occurredAt", "counterpartyId", "counterpartyName", "description", "asset", "decimals", "amountMinor", "amountDisplay", "evidenceRef"];
  const records = kind === "summary" ? result.groups : result.rows;
  const lines = records.map(record => {
    const expanded: Record<string, unknown> = {...record, source: "sample", period, amountDisplay: formatAmount(record.amountMinor, record.decimals)};
    return headers.map(key => csvCell(expanded[key])).join(",");
  });
  return "\uFEFF" + [headers.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
