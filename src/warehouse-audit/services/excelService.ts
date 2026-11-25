// SheetJS (xlsx) Excel import/export, clipboard jadval tahlili va jsPDF hisobot generatsiyasi

import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { registerCyrillicFonts } from '../../lib/pdfCyrillicFonts';
import {
  AuditSettings,
  InfoReportResult,
  OPTION_COLUMNS,
  OptionColumnKey,
  OptionRow,
  RowValidationResult,
  SKLAD_COLUMNS,
  SkladColumnKey,
  SkladRow,
  VALIDATED_SKLAD_FIELDS,
} from '../types';
import {
  createEmptyOptionRow,
  createEmptySkladRow,
  normalizeDateInput,
  safeStr,
} from '../validators/validators';

const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

function normalizeHeaderName(name: unknown): string {
  return safeStr(name)
    .toLowerCase()
    .replace(/[\s\u00A0._-]+/g, '')
    .trim();
}

const SKLAD_HEADER_LOOKUP = new Map<string, SkladColumnKey>(
  SKLAD_COLUMNS.map(col => [normalizeHeaderName(col), col])
);

const OPTION_HEADER_LOOKUP = new Map<string, OptionColumnKey>(
  OPTION_COLUMNS.map(col => [normalizeHeaderName(col), col])
);

/** TSV matnni Excel qoidalari bo'yicha ajratish (katak boshidagi/oxiridagi probellar saqlanadi) */
function parseTsvPreservingSpaces(text: string): string[][] {
  // Excel nusxalashda oxiriga bitta \r\n qo'shadi — faqat o'sha yakuniy qator uzilishini olamiz
  let cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (cleaned.endsWith('\n')) {
    cleaned = cleaned.slice(0, -1);
  }
  if (cleaned === '') return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.length === 0) {
      inQuotes = true;
    } else if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** Clipboard (TSV matn yoki HTML table) dan 2D massiv ajratib olish (probellarni saqlab) */
export function parseClipboardToMatrix(html: string, text: string): string[][] {
  if (text && text.length > 0) {
    return parseTsvPreservingSpaces(text);
  }

  if (html && /<tr[\s>]/i.test(html) && typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const trs = Array.from(doc.querySelectorAll('table tr'));
      if (trs.length > 0) {
        const matrix = trs
          .map(tr =>
            Array.from(tr.querySelectorAll('th, td')).map(c =>
              (c.textContent || '').replace(/\u00A0/g, ' ').replace(/\r?\n/g, ' ')
            )
          )
          .filter(r => r.length > 0);
        if (matrix.length > 0) return matrix;
      }
    } catch {
      // Fallback to empty
    }
  }

  return [];
}

/** 2D massivni (Excel yoki Ctrl+V) Склад qatorlariga o'tkazish */
export function mapMatrixToSkladRows(
  matrix: string[][],
  defaultDate: string
): { rows: SkladRow[]; detectedHeader: boolean } {
  if (!matrix || matrix.length === 0) return { rows: [], detectedHeader: false };

  const firstRow = matrix[0] || [];
  const matchedHeaders = firstRow.map(cell => SKLAD_HEADER_LOOKUP.get(normalizeHeaderName(cell)) || null);
  const matchedCount = matchedHeaders.filter(Boolean).length;
  const detectedHeader = matchedCount >= 3;

  const dataRows = detectedHeader ? matrix.slice(1) : matrix;
  const result: SkladRow[] = [];
  const baseTime = Date.now();

  dataRows.forEach((rawRow, idx) => {
    if (!rawRow || rawRow.every(cell => safeStr(cell).trim() === '')) return;
    const partial: Partial<SkladRow> = {
      id: `skl-imp-${baseTime}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      updatedAt: baseTime + idx,
    };

    if (detectedHeader) {
      matchedHeaders.forEach((colKey, colIdx) => {
        if (!colKey) return;
        const val = safeStr(rawRow[colIdx]);
        if (colKey === 'Дата упак.' || colKey === 'Дата склад.') {
          partial[colKey] = normalizeDateInput(val);
        } else {
          partial[colKey] = val;
        }
      });
    } else {
      SKLAD_COLUMNS.forEach((colKey, colIdx) => {
        if (colIdx >= rawRow.length) return;
        const val = safeStr(rawRow[colIdx]);
        if (colKey === 'Дата упак.' || colKey === 'Дата склад.') {
          partial[colKey] = normalizeDateInput(val);
        } else {
          partial[colKey] = val;
        }
      });
    }

    result.push(createEmptySkladRow(partial, defaultDate));
  });

  return { rows: result, detectedHeader };
}

/** 2D massivni Опции qatorlariga o'tkazish */
export function mapMatrixToOptionRows(
  matrix: string[][]
): { rows: OptionRow[]; detectedHeader: boolean } {
  if (!matrix || matrix.length === 0) return { rows: [], detectedHeader: false };

  const firstRow = matrix[0] || [];
  const matchedHeaders = firstRow.map(cell => OPTION_HEADER_LOOKUP.get(normalizeHeaderName(cell)) || null);
  const matchedCount = matchedHeaders.filter(Boolean).length;
  const detectedHeader = matchedCount >= 2;

  const dataRows = detectedHeader ? matrix.slice(1) : matrix;
  const result: OptionRow[] = [];
  const baseTime = Date.now();

  dataRows.forEach((rawRow, idx) => {
    if (!rawRow || rawRow.every(cell => safeStr(cell).trim() === '')) return;
    const partial: Partial<OptionRow> = {
      id: `opt-imp-${baseTime}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      updatedAt: baseTime + idx,
    };

    if (detectedHeader) {
      matchedHeaders.forEach((colKey, colIdx) => {
        if (!colKey) return;
        partial[colKey] = safeStr(rawRow[colIdx]);
      });
    } else {
      OPTION_COLUMNS.forEach((colKey, colIdx) => {
        if (colIdx >= rawRow.length) return;
        partial[colKey] = safeStr(rawRow[colIdx]);
      });
    }

    result.push(createEmptyOptionRow(partial));
  });

  return { rows: result, detectedHeader };
}

function readSheetRowsAsStrings(ws: XLSX.WorkSheet): string[][] {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: '',
  });
  return raw.map(r =>
    (Array.isArray(r) ? r : []).map(cell => {
      if (cell instanceof Date) {
        const dd = String(cell.getDate()).padStart(2, '0');
        const mm = String(cell.getMonth() + 1).padStart(2, '0');
        const yyyy = String(cell.getFullYear());
        return `${dd}.${mm}.${yyyy}`;
      }
      if (typeof cell === 'number') {
        // Agar sana ustunida Excel serial raqami kelsa normalizeDateInput buni ajratadi,
        // boshqa raqamlar esa asl string sifatida saqlanadi
        return String(cell);
      }
      return safeStr(cell);
    })
  );
}

/** Excel/CSV fayldan Склад ma'lumotlarini import qilish */
export async function importSkladFromExcelFile(
  file: File,
  defaultDate: string
): Promise<{ rows: SkladRow[]; detectedHeader: boolean }> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error("Fayl hajmi juda katta (maksimal 25 MB ruxsat etilgan).");
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const sheetName = wb.SheetNames.find(n => normalizeHeaderName(n) === 'склад') || wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel fayl ichida varaq (sheet) topilmadi.");
  }
  const matrix = readSheetRowsAsStrings(wb.Sheets[sheetName]);
  // Excel serial sanalarni faqat sana ustunlari uchun konvertatsiya qilish
  const rawAoA = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: '',
  });

  const firstRow = (rawAoA[0] || []).map(c => SKLAD_HEADER_LOOKUP.get(normalizeHeaderName(c)) || null);
  const hasHdr = firstRow.filter(Boolean).length >= 3;
  const fixedMatrix = matrix.map((row, rIdx) => {
    if (rIdx === 0 && hasHdr) return row;
    return row.map((val, cIdx) => {
      const colKey = hasHdr ? firstRow[cIdx] : SKLAD_COLUMNS[cIdx];
      const rawCell = rawAoA[rIdx]?.[cIdx];
      if ((colKey === 'Дата упак.' || colKey === 'Дата склад.') && typeof rawCell === 'number') {
        return normalizeDateInput(rawCell);
      }
      return val;
    });
  });

  return mapMatrixToSkladRows(fixedMatrix, defaultDate);
}

/** Excel/CSV fayldan Опции ma'lumotlarini import qilish */
export async function importOptionsFromExcelFile(
  file: File
): Promise<{ rows: OptionRow[]; detectedHeader: boolean }> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error("Fayl hajmi juda katta (maksimal 25 MB ruxsat etilgan).");
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const sheetName = wb.SheetNames.find(n => normalizeHeaderName(n) === 'опции') || wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel fayl ichida varaq (sheet) topilmadi.");
  }
  const matrix = readSheetRowsAsStrings(wb.Sheets[sheetName]);
  return mapMatrixToOptionRows(matrix);
}

/** Склад jadvalini Excel (.xlsx) ga eksport qilish */
export function exportSkladToExcel(
  rows: SkladRow[],
  validations?: Map<string, RowValidationResult>
): void {
  const headers = [...SKLAD_COLUMNS, 'Holat', 'Xatolar soni', 'Xato tafsiloti'];
  const aoa: unknown[][] = [headers];

  for (const r of rows) {
    const val = validations?.get(r.id);
    const statusLabel =
      val?.status === 'error' ? 'Xato' : val?.status === 'warning' ? 'Ogohlantirish' : "To'g'ri";
    aoa.push([
      ...SKLAD_COLUMNS.map(col => r[col]),
      statusLabel,
      val?.errorCount ?? 0,
      val?.combinedText ?? '',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Склад');
  XLSX.writeFile(wb, `Ombor_Sklad_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** Опции jadvalini Excel (.xlsx) ga eksport qilish */
export function exportOptionsToExcel(rows: OptionRow[]): void {
  const aoa: unknown[][] = [[...OPTION_COLUMNS]];
  for (const r of rows) {
    aoa.push(OPTION_COLUMNS.map(col => r[col]));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Опции');
  XLSX.writeFile(wb, `Ombor_Optsii_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** «Tekshiruv» sahifasini batafsil Excel (.xlsx) ga eksport qilish */
export function exportTekshiruvToExcel(
  rows: SkladRow[],
  validations: Map<string, RowValidationResult>
): void {
  const headers = [
    '№ тары',
    'Заказ',
    'Модель',
    'Holat',
    'Xatolar soni',
    'Ogohlantirish soni',
    ...VALIDATED_SKLAD_FIELDS,
    'Barcha xatolar',
  ];
  const aoa: unknown[][] = [headers];

  for (const r of rows) {
    const val = validations.get(r.id);
    const statusLabel =
      val?.status === 'error' ? 'Xato bor' : val?.status === 'warning' ? 'Ogohlantirish' : "To'g'ri";
    aoa.push([
      r['№ тары'],
      r.Заказ,
      r.Модель,
      statusLabel,
      val?.errorCount ?? 0,
      val?.warningCount ?? 0,
      ...VALIDATED_SKLAD_FIELDS.map(f => (val?.fieldMessages[f] || []).join(' | ')),
      val?.combinedText ?? '',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tekshiruv');
  XLSX.writeFile(wb, `Ombor_Tekshiruv_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

const INFO_REPORT_FIELDS: SkladColumnKey[] = [
  'Выд',
  'Сорт',
  'Заказ',
  'Модель',
  'Этикетка',
  'Наименование',
  'Описание',
  'Группа',
  'Документ',
  'Цвет',
  'Кол.кор.',
  'Фабрика',
  'Упаковка',
  'Цвет бирки',
  'Надпись',
  'Примечание',
];

function getStatusLabelUz(status: InfoReportResult['rows'][number]['status']): string {
  switch (status) {
    case 'ok':
      return "✓ To'g'ri";
    case 'error':
      return '✗ Xato bor';
    case 'missing_in_warehouse':
      return "⚠ Omborda yo'q";
    case 'incomplete_option':
      return "⚠ Опция to'liq emas";
  }
}

/** «Инфо проверка» hisobotini Excel (.xlsx) ga eksport qilish */
export function exportInfoReportToExcel(report: InfoReportResult): void {
  const wb = XLSX.utils.book_new();

  const summaryHeader = [
    'Заказ',
    'Модель',
    'Цвет',
    'Holat',
    'Qutilar soni',
    'Xatoli qutilar',
    ...INFO_REPORT_FIELDS,
  ];
  const summaryAoa: unknown[][] = [
    ['Zakazlar:', report.totalOrdersCount, 'Qutilar:', report.totalBoxesCount, 'Xatoli qutilar:', report.errorBoxesCount],
    [],
    summaryHeader,
  ];

  for (const r of report.rows) {
    summaryAoa.push([
      r.Заказ,
      r.Модель,
      r.Цвет,
      getStatusLabelUz(r.status),
      r.boxCount,
      r.errorBoxCount,
      ...INFO_REPORT_FIELDS.map(f => {
        const cnt = r.fieldErrorCounts[f] || 0;
        return cnt > 0 ? cnt : r.boxCount > 0 ? '✓' : '—';
      }),
    ]);
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Инфо проверка');

  // 2-varaq: Xatoli qutilar tafsiloti
  const detailsAoa: unknown[][] = [['Заказ', 'Модель', '№ тары', 'Maydon', 'Turi', 'Xabar']];
  for (const r of report.rows) {
    for (const d of r.boxDetails) {
      detailsAoa.push([
        d.order,
        d.model,
        d.taraNo,
        d.field,
        d.level === 'error' ? 'Xato' : 'Ogohlantirish',
        d.message,
      ]);
    }
  }
  const wsDetails = XLSX.utils.aoa_to_sheet(detailsAoa);
  XLSX.utils.book_append_sheet(wb, wsDetails, 'Xatoli qutilar');

  XLSX.writeFile(wb, `Info_Proverka_${report.expectedDate.replace(/\./g, '-')}.xlsx`);
}

/** «Инфо проверка» hisobotini PDF ga eksport qilish (kirill shriftlari bilan) */
export async function exportInfoReportToPdf(report: InfoReportResult): Promise<void> {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });
  const fontName = await registerCyrillicFonts(doc);

  doc.setFont(fontName, 'bold');
  doc.setFontSize(14);
  doc.text(`Инфо проверка — Ombor ma'lumotlari hisoboti`, 14, 14);

  doc.setFont(fontName, 'normal');
  doc.setFontSize(9);
  doc.text(
    `Zakazlar: ${report.totalOrdersCount}   |   Ombor qutilari: ${report.totalBoxesCount}   |   Xatoli qutilar: ${report.errorBoxesCount}   |   Опцияда yo'q qutilar: ${report.unlinkedBoxesCount}`,
    14,
    21
  );

  const head = [
    [
      'Заказ',
      'Модель',
      'Цвет',
      'Holat',
      'Quti',
      'Xato',
      'Выд',
      'Сорт',
      'Этик.',
      'Наим.',
      'Опис.',
      'Груп.',
      'Док.',
      'Цвет',
      'Кол.к',
      'Фабр.',
      'Упак.',
      'Бирка',
      'Надп.',
      'Прим.',
    ],
  ];

  const body = report.rows.map(r => [
    r.Заказ,
    r.Модель,
    r.Цвет,
    getStatusLabelUz(r.status).replace('✓ ', '').replace('✗ ', '').replace('⚠ ', ''),
    String(r.boxCount),
    String(r.errorBoxCount),
    ...INFO_REPORT_FIELDS.filter(f => f !== 'Заказ' && f !== 'Модель').map(f => {
      const cnt = r.fieldErrorCounts[f] || 0;
      return cnt > 0 ? String(cnt) : r.boxCount > 0 ? 'OK' : '-';
    }),
  ]);

  autoTable(doc, {
    startY: 25,
    head,
    body,
    styles: {
      font: fontName,
      fontSize: 6.5,
      cellPadding: 1.4,
      overflow: 'linebreak',
    },
    headStyles: {
      font: fontName,
      fontStyle: 'bold',
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
    },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index >= 5) {
        const text = String(data.cell.raw || '');
        if (/^\d+$/.test(text) && Number(text) > 0) {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fontStyle = 'bold';
        } else if (text === 'OK') {
          data.cell.styles.textColor = [22, 163, 74];
        }
      }
    },
  });

  doc.save(`Info_Proverka_${report.expectedDate.replace(/\./g, '-')}.pdf`);
}

/** To'liq Excel zaxira nusxasini yuklab olish (Склад + Опции + Sozlamalar) */
export function exportFullBackupExcel(
  sklad: SkladRow[],
  options: OptionRow[],
  settings: AuditSettings
): void {
  const wb = XLSX.utils.book_new();
  const wsSklad = XLSX.utils.aoa_to_sheet([
    [...SKLAD_COLUMNS],
    ...sklad.map(r => SKLAD_COLUMNS.map(col => r[col])),
  ]);
  const wsOptions = XLSX.utils.aoa_to_sheet([
    [...OPTION_COLUMNS],
    ...options.map(r => OPTION_COLUMNS.map(col => r[col])),
  ]);
  const wsMeta = XLSX.utils.aoa_to_sheet([
    ['expectedDate', settings.expectedDate],
    ['colorAbbreviations', settings.colorAbbreviations.join(',')],
    ['theme', settings.theme],
  ]);

  XLSX.utils.book_append_sheet(wb, wsSklad, 'Склад');
  XLSX.utils.book_append_sheet(wb, wsOptions, 'Опции');
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Sozlamalar');
  XLSX.writeFile(wb, `Ombor_Zaxira_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** To'liq Excel zaxira nusxasidan qayta yuklash */
export async function importFullBackupExcel(
  file: File,
  fallbackDate: string
): Promise<{
  sklad: SkladRow[];
  options: OptionRow[];
  expectedDate?: string;
  colorAbbreviations?: string[];
}> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error("Fayl hajmi juda katta (maksimal 25 MB).");
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });

  const skladSheet = wb.SheetNames.find(n => normalizeHeaderName(n) === 'склад');
  const optionsSheet = wb.SheetNames.find(n => normalizeHeaderName(n) === 'опции');
  const settingsSheet = wb.SheetNames.find(n => normalizeHeaderName(n) === 'sozlamalar');

  if (!skladSheet && !optionsSheet) {
    throw new Error("Excel zaxira faylida 'Склад' yoki 'Опции' varaqlari topilmadi.");
  }

  let expectedDate: string | undefined;
  let colorAbbreviations: string[] | undefined;

  if (settingsSheet) {
    const metaRows = readSheetRowsAsStrings(wb.Sheets[settingsSheet]);
    for (const [k, v] of metaRows) {
      if (k === 'expectedDate' && v) expectedDate = normalizeDateInput(v);
      if (k === 'colorAbbreviations' && v) {
        const list = v.split(',').map(s => s.trim()).filter(Boolean);
        if (list.length > 0) colorAbbreviations = list;
      }
    }
  }

  const sklad = skladSheet
    ? mapMatrixToSkladRows(readSheetRowsAsStrings(wb.Sheets[skladSheet]), expectedDate || fallbackDate).rows
    : [];
  const options = optionsSheet
    ? mapMatrixToOptionRows(readSheetRowsAsStrings(wb.Sheets[optionsSheet])).rows
    : [];

  return { sklad, options, expectedDate, colorAbbreviations };
}
