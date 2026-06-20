import fs from "fs";

export type ParsedPaymentReceiveRow = {
  accountNo: string;
  learnerName: string;
  balance: number;
  gradeSection?: string;
};

export type PaymentReceiveListParseAudit = {
  pdfPath: string;
  rawRowCount: number;
  uniqueAccountCount: number;
  duplicateRowCount: number;
  balanceConflictCount: number;
  balanceConflicts: Array<{ accountNo: string; balances: number[] }>;
  exportDate?: string;
};

const BALANCE_SUFFIX_RE = /(-?\d[\d ]*,\d{2})\s*$/;
const HEADER_RE = /^AccountBalanceAmountTypeDateReceipt No$/i;
const SKIP_LINE_RE = /^Payment Receive List$/i;
const EXPORT_DATE_RE = /^(\d{4}\/\d{2}\/\d{2})/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parsePaymentReceiveAmount(value: string): number {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s/g, "").replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return 0;
  return round2(n);
}

function isGradeHeading(line: string): boolean {
  const v = String(line || "").trim();
  if (!v) return false;
  if (/^Creche\b/i.test(v)) return true;
  if (/^GRADE\s/i.test(v)) return true;
  if (/^Grade\s/i.test(v)) return true;
  return false;
}

type PartialRow = {
  accountNo: string;
  learnerName: string;
  balance: number | null;
  done: boolean;
};

function parseAccountLine(line: string): PartialRow | null {
  const m = line.match(/^([A-Z]{2,5}\d{2,5})(.*)$/i);
  if (!m) return null;
  const accountNo = String(m[1] || "").trim().toUpperCase();
  const rest = String(m[2] || "").trim();
  const balM = rest.match(BALANCE_SUFFIX_RE);
  if (balM) {
    const name = rest.slice(0, rest.length - balM[0].length).trim();
    return {
      accountNo,
      learnerName: name,
      balance: parsePaymentReceiveAmount(balM[1]),
      done: true,
    };
  }
  return { accountNo, learnerName: rest, balance: null, done: false };
}

function extractPdfText(pdfPath: string): Promise<string> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Payment Receive List PDF not found: ${pdfPath}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as
    | ((buffer: Buffer) => Promise<{ text: string }>)
    | { PDFParse?: new (input: { data: Buffer }) => { getText(): Promise<{ text: string }>; destroy?: () => Promise<void> | void } };
  const buffer = fs.readFileSync(pdfPath);
  if (typeof pdfParse === "function") {
    return pdfParse(buffer).then((data) => String(data.text || ""));
  }
  if (pdfParse && typeof pdfParse.PDFParse === "function") {
    const parser = new pdfParse.PDFParse({ data: buffer });
    return parser.getText().then(async (data) => {
      await parser.destroy?.();
      return String(data.text || "");
    });
  }
  throw new Error("Unsupported pdf-parse export shape");
}

export async function parsePaymentReceiveListPdf(pdfPath: string): Promise<{
  rows: ParsedPaymentReceiveRow[];
  uniqueByAccount: Record<string, ParsedPaymentReceiveRow>;
  audit: PaymentReceiveListParseAudit;
}> {
  const text = await extractPdfText(pdfPath);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: ParsedPaymentReceiveRow[] = [];
  let currentSection = "";
  let exportDate: string | undefined;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (SKIP_LINE_RE.test(line) || HEADER_RE.test(line)) {
      i += 1;
      continue;
    }

    const dateM = line.match(EXPORT_DATE_RE);
    if (dateM) {
      exportDate = dateM[1];
      i += 1;
      continue;
    }

    if (isGradeHeading(line)) {
      currentSection = line;
      i += 1;
      continue;
    }

    if (/^\d+$/.test(line) && i + 1 < lines.length) {
      const partial = parseAccountLine(lines[i + 1]);
      if (partial) {
        i += 2;
        const nameParts = partial.learnerName ? [partial.learnerName] : [];

        if (partial.done) {
          rows.push({
            accountNo: partial.accountNo,
            learnerName: nameParts.join(" ").trim(),
            balance: partial.balance ?? 0,
            gradeSection: currentSection || undefined,
          });
          continue;
        }

        while (i < lines.length) {
          const balM = lines[i].match(BALANCE_SUFFIX_RE);
          if (balM) {
            rows.push({
              accountNo: partial.accountNo,
              learnerName: nameParts.join(" ").trim(),
              balance: parsePaymentReceiveAmount(balM[1]),
              gradeSection: currentSection || undefined,
            });
            i += 1;
            break;
          }
          if (/^\d+$/.test(lines[i]) && parseAccountLine(lines[i + 1] || "")) break;
          if (HEADER_RE.test(lines[i]) || SKIP_LINE_RE.test(lines[i])) break;
          nameParts.push(lines[i]);
          i += 1;
        }
        continue;
      }
    }

    i += 1;
  }

  const uniqueByAccount: Record<string, ParsedPaymentReceiveRow> = {};
  const balanceConflicts: PaymentReceiveListParseAudit["balanceConflicts"] = [];

  for (const row of rows) {
    const acct = row.accountNo;
    if (!uniqueByAccount[acct]) {
      uniqueByAccount[acct] = row;
      continue;
    }
    if (Math.abs(uniqueByAccount[acct].balance - row.balance) > 0.001) {
      const conflict = balanceConflicts.find((c) => c.accountNo === acct);
      if (conflict) {
        if (!conflict.balances.includes(row.balance)) conflict.balances.push(row.balance);
      } else {
        balanceConflicts.push({
          accountNo: acct,
          balances: [uniqueByAccount[acct].balance, row.balance],
        });
      }
    }
  }

  const audit: PaymentReceiveListParseAudit = {
    pdfPath,
    rawRowCount: rows.length,
    uniqueAccountCount: Object.keys(uniqueByAccount).length,
    duplicateRowCount: rows.length - Object.keys(uniqueByAccount).length,
    balanceConflictCount: balanceConflicts.length,
    balanceConflicts,
    exportDate,
  };

  return { rows, uniqueByAccount, audit };
}
