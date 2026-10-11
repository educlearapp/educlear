import { jsPDF } from "jspdf";
import { formatMoney } from "./billingLedger";
import {
  buildOutstandingFeesFileName,
  rowClassLabels,
  type OutstandingClassGroup,
  type OutstandingClassView,
} from "./outstandingFeesByClass";
import type { OutstandingFeesExportMeta, OutstandingFeesExportRow } from "./buildOutstandingFeesExcel";

const MARGIN = 14;
const LINE_H = 4;
const FOOTER_SPACE = 14;

type Column = { title: string; width: number; align?: "left" | "right" };

const COLUMNS: Column[] = [
  { title: "Learner(s)", width: 60 },
  { title: "Account No", width: 26 },
  { title: "Parent / Guardian", width: 46 },
  { title: "Days Overdue", width: 18, align: "right" },
  { title: "Outstanding", width: 32, align: "right" },
];

/** jsPDF core fonts are WinAnsi; map spacing characters some locales emit. */
function pdfText(value: string): string {
  return String(value ?? "").replace(/[\u202F\u2009\u2007]/g, "\u00A0");
}

export type OutstandingFeesPdfResult = {
  doc: jsPDF;
  /** Every text line drawn, in order (used to verify totals match the screen). */
  lines: string[];
};

export function buildOutstandingFeesPdf(
  view: OutstandingClassView<OutstandingFeesExportRow>,
  meta: OutstandingFeesExportMeta
): OutstandingFeesPdfResult {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const lines: string[] = [];
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;

  const text = (value: string, x: number, y: number, opts?: { align?: "left" | "right" }) => {
    const s = pdfText(value);
    lines.push(s);
    doc.text(s, x, y, opts);
  };

  const setBody = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
  };

  let y = MARGIN;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(184, 147, 41);
  text("EduClear", MARGIN, y + 2);
  y += 9;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(16);
  text(meta.schoolName || "School", MARGIN, y);
  y += 7;
  doc.setFontSize(12);
  text("Outstanding Fees Report", MARGIN, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  text(`Class: ${view.selectionLabel}`, MARGIN, y);
  y += 4.5;
  text(
    `Generated: ${meta.generatedAt.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}`,
    MARGIN,
    y
  );
  y += 4.5;
  if (meta.filtersNote) {
    for (const l of doc.splitTextToSize(pdfText(`Filters: ${meta.filtersNote}`), contentW) as string[]) {
      text(l, MARGIN, y);
      y += 4.5;
    }
  }
  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  y += 8;

  const newPage = () => {
    doc.addPage("a4", "portrait");
    y = MARGIN + 4;
  };

  const ensureSpace = (needed: number): boolean => {
    if (y + needed <= pageH - FOOTER_SPACE) return false;
    newPage();
    return true;
  };

  const drawTableHeader = () => {
    doc.setFillColor(248, 250, 252);
    doc.rect(MARGIN, y - 4, contentW, 6.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    let x = MARGIN;
    for (const col of COLUMNS) {
      if (col.align === "right") text(col.title, x + col.width - 1.5, y, { align: "right" });
      else text(col.title, x + 1.5, y);
      x += col.width;
    }
    y += 6.5;
  };

  const drawSectionBand = (title: string, subtitle: string) => {
    doc.setFillColor(253, 246, 227);
    doc.rect(MARGIN, y - 4.5, contentW, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    text(title, MARGIN + 2, y + 0.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    text(subtitle, pageW - MARGIN - 2, y + 0.5, { align: "right" });
    y += 9;
  };

  const rowCells = (row: OutstandingFeesExportRow, showClasses: boolean): string[][] => {
    const names = (row.learnerNames || []).filter(Boolean).join(", ") || "—";
    const learnerText = showClasses ? `${names}\nClasses: ${rowClassLabels(row).join(", ") || "—"}` : names;
    const values = [
      learnerText,
      row.accountNumber || "—",
      row.parentGuardianName || "—",
      row.daysOverdue != null && Number.isFinite(row.daysOverdue) ? String(row.daysOverdue) : "Unknown",
      formatMoney(row.outstandingBalance),
    ];
    setBody();
    return values.map((v, i) => doc.splitTextToSize(pdfText(v), COLUMNS[i].width - 3) as string[]);
  };

  const drawRows = (
    rows: OutstandingFeesExportRow[],
    sectionTitle: string,
    showClasses: boolean
  ) => {
    for (const row of rows) {
      const cells = rowCells(row, showClasses);
      const rowH = Math.max(...cells.map((c) => c.length)) * LINE_H + 2;
      if (ensureSpace(rowH)) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        text(`${sectionTitle} (continued)`, MARGIN, y);
        y += 6;
        drawTableHeader();
      }
      setBody();
      let x = MARGIN;
      cells.forEach((cellLines, i) => {
        const col = COLUMNS[i];
        if (i === COLUMNS.length - 1) doc.setFont("helvetica", "bold");
        cellLines.forEach((l, li) => {
          const ly = y + li * LINE_H;
          if (col.align === "right") text(l, x + col.width - 1.5, ly, { align: "right" });
          else text(l, x + 1.5, ly);
        });
        x += col.width;
      });
      y += rowH;
      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y - LINE_H + 0.5, pageW - MARGIN, y - LINE_H + 0.5);
    }
  };

  const drawTotalLine = (label: string, amount: number, strong: boolean) => {
    ensureSpace(10);
    doc.setDrawColor(strong ? 15 : 212, strong ? 23 : 175, strong ? 42 : 55);
    doc.setLineWidth(strong ? 0.6 : 0.4);
    doc.line(MARGIN, y - 2.5, pageW - MARGIN, y - 2.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(strong ? 12 : 10);
    doc.setTextColor(15, 23, 42);
    text(label, MARGIN + 1.5, y + 2);
    text(formatMoney(amount), pageW - MARGIN - 1.5, y + 2, { align: "right" });
    y += strong ? 10 : 9;
  };

  const countLabel = (accounts: number, learners: number) =>
    `${accounts} account${accounts === 1 ? "" : "s"} · ${learners} learner${learners === 1 ? "" : "s"}`;

  const drawGroup = (group: OutstandingClassGroup<OutstandingFeesExportRow>) => {
    ensureSpace(8 + 6.5 + 10 + LINE_H * 2);
    drawSectionBand(group.label, countLabel(group.outstandingAccountCount, group.learnersAffected));
    if (!group.rows.length) {
      setBody();
      doc.setTextColor(100, 116, 139);
      text("No outstanding accounts in this class.", MARGIN + 2, y);
      y += 7;
    } else {
      drawTableHeader();
      drawRows(group.rows, group.label, group.kind === "multiple");
    }
    drawTotalLine(`Class Total: ${group.label}`, group.totalOutstanding, false);
    y += 3;
  };

  for (const group of view.groups) drawGroup(group);

  if (!view.isAllClasses && view.sharedRows.length) {
    ensureSpace(8 + 12 + 6.5 + LINE_H * 3);
    drawSectionBand(
      "Also linked to this class (shared family accounts)",
      countLabel(view.sharedTotals.outstandingAccountCount, view.sharedTotals.learnersAffected)
    );
    setBody();
    doc.setTextColor(100, 116, 139);
    for (const l of doc.splitTextToSize(
      "These accounts have learners in more than one class. Their balances are counted once under " +
        '"Multiple classes" and are NOT included in the Class Total above.',
      contentW - 4
    ) as string[]) {
      text(l, MARGIN + 2, y);
      y += LINE_H;
    }
    y += 3;
    drawTableHeader();
    drawRows(view.sharedRows, "Shared family accounts", true);
  }

  if (view.isAllClasses) {
    const summaryRowH = 5.5;
    const summaryH = 8 + 6.5 + view.groups.length * summaryRowH + 4 + 18;
    if (summaryH <= pageH - FOOTER_SPACE - MARGIN - 4) ensureSpace(summaryH);
    drawSectionBand("Summary by class", countLabel(view.totals.outstandingAccountCount, view.totals.learnersAffected));
    doc.setFillColor(248, 250, 252);
    doc.rect(MARGIN, y - 4, contentW, 6.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    text("Class", MARGIN + 1.5, y);
    text("Accounts", MARGIN + 110, y, { align: "right" });
    text("Learners", MARGIN + 140, y, { align: "right" });
    text("Outstanding Total", pageW - MARGIN - 1.5, y, { align: "right" });
    y += 6.5;
    for (const group of view.groups) {
      if (ensureSpace(summaryRowH)) y += 2;
      setBody();
      text(group.label, MARGIN + 1.5, y);
      text(String(group.outstandingAccountCount), MARGIN + 110, y, { align: "right" });
      text(String(group.learnersAffected), MARGIN + 140, y, { align: "right" });
      text(formatMoney(group.totalOutstanding), pageW - MARGIN - 1.5, y, { align: "right" });
      y += summaryRowH;
    }
    if (!view.groups.length) {
      setBody();
      doc.setTextColor(100, 116, 139);
      text("No outstanding accounts match the current view.", MARGIN + 1.5, y);
      y += summaryRowH;
    }
    y += 4;
    ensureSpace(16);
    drawTotalLine("GRAND TOTAL", view.totals.totalOutstanding, true);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    text(countLabel(view.totals.outstandingAccountCount, view.totals.learnersAffected), MARGIN + 1.5, y - 3);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    text(`EduClear · ${meta.schoolName || "School"} · Outstanding Fees · ${view.selectionLabel}`, MARGIN, pageH - 7);
    text(`Page ${i} of ${pages}`, pageW - MARGIN, pageH - 7, { align: "right" });
  }

  return { doc, lines };
}

export function downloadOutstandingFeesPdf(
  view: OutstandingClassView<OutstandingFeesExportRow>,
  meta: OutstandingFeesExportMeta
): string {
  const { doc } = buildOutstandingFeesPdf(view, meta);
  const filename = buildOutstandingFeesFileName({
    schoolName: meta.schoolName,
    selectionLabel: view.selectionLabel,
    date: meta.generatedAt,
    extension: "pdf",
  });
  doc.save(filename);
  return filename;
}
