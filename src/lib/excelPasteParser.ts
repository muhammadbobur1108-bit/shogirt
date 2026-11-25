import {
  FactoryLedgerRow,
  OrderSizeMatrix,
  SizeCellValues,
  SizePresetId,
  SIZE_PRESETS,
  ROST_OPTIONS,
  detectSizePresetForRow,
  recalcLedgerRowFromMatrix
} from './ordersSizeStore';

export type DetectedExcelLayout =
  | 'matrix_stages_block'
  | 'color_rost_rows'
  | 'transposed_sizes'
  | 'headerless_stages'
  | 'flat_summary'
  | 'unknown';

export interface ParsedExcelOrderItem {
  key: string;
  month: string;
  brand: string;
  orderNo: string;
  model: string;
  color: string;
  colorCode: string;
  rost: string;
  defect: number;
  qtyShipped: number;
  notes: string;
  sizes: string[];
  values: Record<string, SizeCellValues>;
  totals: {
    order: number;
    cut: number;
    dist: number;
    sew: number;
    pack: number;
  };
  scalarTotalsOnly?: {
    order: number;
    cut: number;
    dist: number;
    sew: number;
    pack: number;
  };
}

export interface ParsedExcelGridResult {
  layout: DetectedExcelLayout;
  layoutLabel: string;
  detectedSizes: string[];
  items: ParsedExcelOrderItem[];
  warnings: string[];
}

export interface ExcelPasteDefaults {
  month: string;
  brand: string;
  orderNo: string;
  model: string;
  defaultColor: string;
  defaultRost: string;
  singleStageTarget: keyof SizeCellValues;
  fallbackSizes?: string[];
}

const ALPHA_SIZES_SET = new Set([
  '3xs', '2xs', 'xxs', 'xs', 's', 'm', 'l', 'xl', '2xl', 'xxl', '3xl', 'xxxl',
  '4xl', '5xl', '6xl', '7xl', '8xl', '9xl', '10xl', '11xl', '12xl',
  'xs/s', 's/m', 'm/l', 'l/xl', 'xl/2xl'
]);

const KNOWN_NUMERIC_SIZE_SET = new Set([
  '24-26', '28-30', '32-34', '36-38', '40-42',
  '44', '46', '48', '50', '52', '54', '56', '58', '60', '62', '64', '66', '68',
  '74', '80', '84', '86', '88', '92', '96', '98', '100', '104', '108', '110',
  '112', '116', '120', '122', '124', '128', '132', '134', '136', '140', '144',
  '146', '148', '152', '156', '158', '160', '164', '168', '170', '176',
  '158-164', '170-176', '182-188', '194-200',
  '40-42', '44-46', '48-50', '52-54', '56-58', '60-62', '64-66'
]);

export function parseClipboardToGrid(htmlData: string, plainText: string): string[][] {
  if (htmlData && /<table[\s>]/i.test(htmlData)) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlData, 'text/html');
      const tables = Array.from(doc.querySelectorAll('table'));
      // Choose the largest table if multiple exist
      let bestTable: HTMLTableElement | null = null;
      let maxCells = 0;
      for (const tbl of tables) {
        const count = tbl.querySelectorAll('td, th').length;
        if (count > maxCells) {
          maxCells = count;
          bestTable = tbl;
        }
      }

      if (bestTable) {
        const trs = Array.from(bestTable.querySelectorAll('tr'));
        const grid: string[][] = [];
        const occupied = new Map<string, boolean>();

        trs.forEach((tr, rIdx) => {
          if (!grid[rIdx]) grid[rIdx] = [];
          let cIdx = 0;
          const cells = Array.from(tr.children).filter(
            el => el.tagName === 'TD' || el.tagName === 'TH'
          ) as HTMLTableCellElement[];

          for (const cell of cells) {
            while (occupied.get(`${rIdx}:${cIdx}`)) {
              cIdx++;
            }
            const rawText = (cell.textContent || '')
              .replace(/\u00a0/g, ' ')
              .replace(/\s*\r?\n\s*/g, ' ')
              .trim();

            const rowSpan = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1', 10) || 1);
            const colSpan = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10) || 1);

            for (let rs = 0; rs < rowSpan; rs++) {
              const targetR = rIdx + rs;
              if (!grid[targetR]) grid[targetR] = [];
              for (let cs = 0; cs < colSpan; cs++) {
                const targetC = cIdx + cs;
                occupied.set(`${targetR}:${targetC}`, true);
                // Put the cell value in the top-left of merged area and keep rest empty
                // (Wait: empty merged continuation cells will naturally inherit vertically!)
                if (rs === 0 && cs === 0) {
                  grid[targetR][targetC] = rawText;
                } else if (grid[targetR][targetC] === undefined) {
                  grid[targetR][targetC] = '';
                }
              }
            }
            cIdx += colSpan;
          }
        });

        // Normalize rectangular row lengths
        const maxCols = grid.reduce((m, row) => Math.max(m, row.length), 0);
        const normalized = grid
          .map(row => {
            const out = new Array(maxCols).fill('');
            for (let i = 0; i < maxCols; i++) {
              out[i] = row[i] ?? '';
            }
            return out;
          })
          .filter(row => row.some(c => c !== ''));

        if (normalized.length > 0) {
          return normalized;
        }
      }
    } catch {
      // Fallback cleanly to plain text TSV
    }
  }

  const cleaned = (plainText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleaned.split('\n');
  // Trim trailing completely empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  if (lines.length === 0) return [];

  const splitLine = (line: string): string[] => {
    if (line.includes('\t')) return line.split('\t').map(s => s.trim());
    if (line.includes(';')) return line.split(';').map(s => s.trim());
    return [line.trim()];
  };

  const rows = lines.map(splitLine);
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map(r => {
    const out = new Array(maxCols).fill('');
    for (let i = 0; i < maxCols; i++) out[i] = r[i] ?? '';
    return out;
  });
}

export function normalizeSizeLabel(raw: string): string {
  return raw
    .replace(/^размер\s*[:№]?\s*/i, '')
    .replace(/^р\.?\s*(?=\d)/i, '')
    .replace(/\s*\((?:заказ|крой|раздача|пошив|упаковка)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSizeHeaderCell(raw: string): boolean {
  const s = normalizeSizeLabel(raw);
  if (!s) return false;
  const low = s.toLowerCase();

  // Reject explicit non-size keywords and percentages
  if (
    low.includes('%') ||
    low.includes('всего') ||
    low.includes('итого') ||
    low.includes('total') ||
    low.includes('сумм') ||
    low.includes('заказ') ||
    low.includes('модел') ||
    low.includes('цвет') ||
    low.includes('код') ||
    low.includes('рост') ||
    low.includes('этап') ||
    low.includes('бренд') ||
    low.includes('месяц') ||
    low.includes('остат') ||
    low.includes('крой') ||
    low.includes('разд') ||
    low.includes('пошив') ||
    low.includes('упак') ||
    low.includes('брак') ||
    low.includes('отгруз') ||
    low.includes('разниц') ||
    low.includes('примеч') ||
    low.includes('этикет') ||
    low.includes('пакет') ||
    low.includes('статус') ||
    low.includes('номер') ||
    low === '№'
  ) {
    return false;
  }

  // Strip parenthesized alpha tags or + suffix, e.g., "80 (XS)" -> "80", "84 (XS)+" -> "84"
  const stripped = low
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/\+$/, '')
    .trim();

  if (ALPHA_SIZES_SET.has(low) || ALPHA_SIZES_SET.has(stripped)) {
    return true;
  }
  if (KNOWN_NUMERIC_SIZE_SET.has(low) || KNOWN_NUMERIC_SIZE_SET.has(stripped)) {
    return true;
  }

  // Size notation like "132 (3XL)+" or "80(XS)"
  if (/^\d{2,3}\s*\([a-z0-9]+\)\+?$/i.test(s)) {
    return true;
  }

  // Dashed or slashed size range (e.g. 24-26, 44-46, 158-164, 38/40)
  if (/^\d{2,3}\s*[-–/]\s*\d{2,3}$/.test(stripped)) {
    const firstNum = parseInt(stripped, 10);
    if (firstNum >= 20 && firstNum <= 220) return true;
  }

  // Standalone numeric garment sizes (e.g. 42, 76, 174, 180) excluding years like 2026
  if (/^\d{2,3}$/.test(stripped)) {
    const numVal = parseInt(stripped, 10);
    if (numVal >= 20 && numVal <= 210) return true;
  }

  return false;
}

export type StageRowKind = keyof SizeCellValues | 'ignore' | null;

export function detectStageCell(raw: string): StageRowKind {
  const s = (raw || '').toLowerCase().trim();
  if (!s) return null;

  if (
    s === '%' ||
    s.endsWith('%') ||
    s.includes('крой %') ||
    s.includes('закр') ||
    s.includes('брак %') ||
    s.includes('остат') ||
    s.includes('разниц') ||
    s.includes('итого') ||
    s.includes('всего') ||
    s.includes('total')
  ) {
    return 'ignore';
  }

  if (s === 'заказ' || s.startsWith('заказ ') || s === 'buyurtma' || s === 'план') {
    return 'order';
  }
  if (s === 'крой' || s.startsWith('крой ') || s.startsWith('kesim') || s.includes('раскрой')) {
    return 'cut';
  }
  if (s === 'раздача' || s.startsWith('раздач') || s.startsWith('разд') || s.startsWith('выдач')) {
    return 'dist';
  }
  if (s === 'пошив' || s.startsWith('пошив') || s.startsWith('tikuv')) {
    return 'sew';
  }
  if (
    s === 'упаковка' ||
    s.startsWith('упаков') ||
    s === 'упак' ||
    s.includes('общ-упак') ||
    s.startsWith('qadoq')
  ) {
    return 'pack';
  }

  return null;
}

export function parseIntCell(raw: string): number | null {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed === '-' || trimmed === '—') return null;
  // Ignore percentage values like "78,8%" or "81.5%"
  if (trimmed.includes('%')) return null;
  // Remove spaces and NBSP used as thousand separators ("1 080", "29 520")
  const compact = trimmed.replace(/[\s\u00a0]/g, '');
  // If formatted like "123.4" or "78,8" with fractional part, ignore decimals for piece qty unless whole
  if (!/^-?\d+([.,]\d+)?$/.test(compact)) return null;
  const num = Math.round(parseFloat(compact.replace(',', '.')));
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function emptyCell(): SizeCellValues {
  return { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
}

function finalizeItem(item: ParsedExcelOrderItem): ParsedExcelOrderItem {
  let order = 0;
  let cut = 0;
  let dist = 0;
  let sew = 0;
  let pack = 0;

  // Keep only sizes that exist in header list
  item.sizes.forEach(sz => {
    const c = item.values[sz];
    if (!c) return;
    order += Number(c.order) || 0;
    cut += Number(c.cut) || 0;
    dist += Number(c.dist) || 0;
    sew += Number(c.sew) || 0;
    pack += Number(c.pack) || 0;
  });

  if (item.scalarTotalsOnly && order === 0 && cut === 0 && dist === 0 && sew === 0 && pack === 0) {
    order = item.scalarTotalsOnly.order;
    cut = item.scalarTotalsOnly.cut;
    dist = item.scalarTotalsOnly.dist;
    sew = item.scalarTotalsOnly.sew;
    pack = item.scalarTotalsOnly.pack;
  }

  return {
    ...item,
    totals: { order, cut, dist, sew, pack }
  };
}

function extractInlineMetadata(rows: string[][]): { orderNo?: string; model?: string; brand?: string } {
  const res: { orderNo?: string; model?: string; brand?: string } = {};
  const IGNORE_META_WORDS = /^(модель|цвет|код|рост|этап|бренд|месяц|номер|№|шт|по|для)$/i;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const txt = (rows[r][c] || '').trim();
      if (!txt) continue;
      const ordMatch = txt.match(/заказ\s*(?:№|#|:)?\s*([A-Za-zА-Яа-я0-9._/-]{3,})/i);
      if (
        ordMatch &&
        !IGNORE_META_WORDS.test(ordMatch[1]) &&
        !/полотна|оформлен|укажите|заполн/i.test(txt) &&
        !res.orderNo
      ) {
        res.orderNo = ordMatch[1];
      }
      const modMatch = txt.match(/модель\s*[:№]?\s*([A-Za-zА-Яа-я0-9._/-]{2,})/i);
      if (modMatch && !IGNORE_META_WORDS.test(modMatch[1]) && !res.model) {
        res.model = modMatch[1];
      }
      if (/складской код[:\s]*$/i.test(txt) && rows[r][c + 1]) {
        res.model = rows[r][c + 1].trim();
      }
    }
  }
  return res;
}

export function parsePastedProductionGrid(
  rawGrid: string[][],
  defaults: ExcelPasteDefaults
): ParsedExcelGridResult {
  // Crop out completely empty outer rows and columns
  let nonEmptyRows = rawGrid.filter(r => r.some(c => (c || '').trim() !== ''));
  if (nonEmptyRows.length === 0) {
    return {
      layout: 'unknown',
      layoutLabel: 'Лист пуст — вставьте таблицу из Excel (Ctrl+V)',
      detectedSizes: [],
      items: [],
      warnings: []
    };
  }

  // Determine active column span
  let minCol = Infinity;
  let maxCol = -1;
  nonEmptyRows.forEach(r => {
    r.forEach((cell, idx) => {
      if ((cell || '').trim() !== '') {
        if (idx < minCol) minCol = idx;
        if (idx > maxCol) maxCol = idx;
      }
    });
  });

  const grid = nonEmptyRows.map(r => r.slice(minCol, maxCol + 1).map(c => (c || '').trim()));
  const inlineMeta = extractInlineMetadata(grid);
  const effectiveDefaultOrder = defaults.orderNo.trim() || inlineMeta.orderNo || 'НОВЫЙ-ЗАКАЗ';
  const effectiveDefaultModel = defaults.model.trim() || inlineMeta.model || 'МОДЕЛЬ-1';

  const warnings: string[] = [];

  // ---------------------------------------------------------------------------
  // CASE 1: TRANSPOSED MATRIX (Rows are Sizes: XS, S, M... Columns are Stages: Заказ, Крой, Раздача...)
  // ---------------------------------------------------------------------------
  for (let r = 0; r < Math.min(grid.length, 6); r++) {
    const lowRow = grid[r].map(c => c.toLowerCase().trim());
    const colOrderStage = lowRow.findIndex(h => h === 'заказ' || h.startsWith('заказ '));
    const colCutStage = lowRow.findIndex(h => h === 'крой' || h.startsWith('крой'));
    const colDistStage = lowRow.findIndex(h => h.startsWith('разд'));
    const colSewStage = lowRow.findIndex(h => h.startsWith('пошив'));
    const colPackStage = lowRow.findIndex(h => h.startsWith('упак'));
    const colSize = lowRow.findIndex(h => h.includes('размер') || h === 'size');

    const stageColsFound = [colOrderStage, colCutStage, colDistStage, colSewStage, colPackStage].filter(
      x => x !== -1
    ).length;

    if (colSize !== -1 && stageColsFound >= 2) {
      const sizes: string[] = [];
      const values: Record<string, SizeCellValues> = {};

      for (let i = r + 1; i < grid.length; i++) {
        const row = grid[i];
        const szRaw = row[colSize] || '';
        const lowSz = szRaw.toLowerCase();
        if (!szRaw || lowSz.includes('итого') || lowSz.includes('всего')) continue;
        const sz = normalizeSizeLabel(szRaw);
        if (!sizes.includes(sz)) sizes.push(sz);
        values[sz] = {
          order: colOrderStage !== -1 ? parseIntCell(row[colOrderStage]) ?? 0 : 0,
          cut: colCutStage !== -1 ? parseIntCell(row[colCutStage]) ?? 0 : 0,
          dist: colDistStage !== -1 ? parseIntCell(row[colDistStage]) ?? 0 : 0,
          sew: colSewStage !== -1 ? parseIntCell(row[colSewStage]) ?? 0 : 0,
          pack: colPackStage !== -1 ? parseIntCell(row[colPackStage]) ?? 0 : 0
        };
      }

      if (sizes.length > 0) {
        const item = finalizeItem({
          key: `tr|${effectiveDefaultOrder}|${effectiveDefaultModel}|${defaults.defaultColor}|${defaults.defaultRost}`,
          month: defaults.month,
          brand: defaults.brand,
          orderNo: effectiveDefaultOrder,
          model: effectiveDefaultModel,
          color: defaults.defaultColor || 'Основной',
          colorCode: '',
          rost: defaults.defaultRost || '',
          defect: 0,
          qtyShipped: 0,
          notes: '',
          sizes,
          values,
          totals: { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }
        });

        return {
          layout: 'transposed_sizes',
          layoutLabel: `Вертикальные размеры (${sizes.length} разм. × этапы)`,
          detectedSizes: sizes,
          items: [item],
          warnings
        };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CASE 2: FIND ANY HEADER ROW WITH >= 2 SIZE COLUMNS (Images 2, 4, 5, etc.)
  // ---------------------------------------------------------------------------
  interface HeaderSpec {
    rowIdx: number;
    colBrand: number;
    colMonth: number;
    colOrder: number;
    colModel: number;
    colColor: number;
    colColorCode: number;
    colRost: number;
    colStage: number;
    colTotal: number;
    colDefect: number;
    colShip: number;
    colNotes: number;
    sizeCols: { idx: number; label: string }[];
  }

  const parseHeaderSpec = (row: string[], rowIdx: number): HeaderSpec | null => {
    const low = row.map(c => c.toLowerCase().trim());

    // Reject obvious data rows that carry a production stage token without table header words
    const hasTableHeaderWords = low.some(
      h =>
        h.includes('модел') ||
        h === 'model' ||
        h.includes('цвет') ||
        h.includes('этикет') ||
        h === 'color' ||
        h.includes('заказ №') ||
        h.includes('заказ№') ||
        h === 'order' ||
        h.includes('этап') ||
        h.includes('стад') ||
        h.includes('размер') ||
        h === 'size' ||
        h === 'рост' ||
        h.includes('ростов') ||
        h.includes('бренд') ||
        h.includes('месяц')
    );

    const hasStageCell = row.some(c => {
      const st = detectStageCell(c);
      return st !== null;
    });
    if (hasStageCell && !hasTableHeaderWords) {
      return null;
    }

    const sizeCols: { idx: number; label: string }[] = [];
    row.forEach((cell, idx) => {
      if (isSizeHeaderCell(cell)) {
        sizeCols.push({ idx, label: normalizeSizeLabel(cell) });
      }
    });

    if (sizeCols.length < 2) return null;

    // If all matched "size" cells are purely numeric (e.g. 50, 60, 70 or 100, 200),
    // require either explicit header keywords in the row OR this is the very first row with standard sizes.
    const hasAlphaSize = sizeCols.some(sc => /[a-zа-я]/i.test(sc.label));
    if (!hasAlphaSize && !hasTableHeaderWords) {
      const allKnownNumeric = sizeCols.every(sc =>
        KNOWN_NUMERIC_SIZE_SET.has(sc.label.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').replace(/\+$/, '').trim())
      );
      if (!(rowIdx === 0 && allKnownNumeric)) {
        return null;
      }
    }

    const firstSizeIdx = sizeCols[0].idx;
    const colOrder = low.findIndex(
      (h, i) =>
        i < firstSizeIdx &&
        (h === 'заказ' ||
          h === 'order' ||
          h.includes('заказ №') ||
          h.includes('заказ№') ||
          (h.includes('заказ') && !h.includes('кол') && !h.includes('шт') && !h.includes('всего') && !h.includes('итого')))
    );
    const colModel = low.findIndex((h, i) => i < firstSizeIdx && (h.includes('модел') || h === 'model'));
    const colColorCode = low.findIndex((h, i) => i < firstSizeIdx && h.includes('код') && h.includes('цвет'));
    const colColor = low.findIndex(
      (h, i) =>
        i < firstSizeIdx &&
        i !== colColorCode &&
        (h === 'цвет' || h.includes('этикетка') || h === 'color' || (h.includes('цвет') && !h.includes('код')))
    );
    const colRost = low.findIndex((h, i) => i < firstSizeIdx && (h === 'рост' || h.includes('ростов')));
    const colBrand = low.findIndex((h, i) => i < firstSizeIdx && (h.includes('бренд') || h.includes('brand')));
    const colMonth = low.findIndex((h, i) => i < firstSizeIdx && (h.includes('месяц') || h.includes('oy')));
    let colStage = low.findIndex((h, i) => i < firstSizeIdx && (h.includes('этап') || h.includes('стад')));
    if (colStage === -1 && firstSizeIdx > 0 && low[firstSizeIdx - 1] === '') {
      // Exact match to Image 2! Blank column header right before "XS" holds "Заказ / Крой / Раздача / Пошив / Упаковка"
      colStage = firstSizeIdx - 1;
    }

    const colTotal = low.findIndex((h, i) => i > firstSizeIdx && (h === 'всего' || h === 'итого' || h === 'total'));
    const colDefect = low.findIndex(h => h === 'брак' || (h.includes('брак') && !h.includes('%')));
    const colShip = low.findIndex(h => h.includes('отгруз'));
    const colNotes = low.findIndex(h => h.includes('примеч') || h.includes('коммент'));

    return {
      rowIdx,
      colBrand,
      colMonth,
      colOrder,
      colModel,
      colColor,
      colColorCode: colColorCode === colColor ? -1 : colColorCode,
      colRost,
      colStage,
      colTotal,
      colDefect,
      colShip,
      colNotes,
      sizeCols
    };
  };

  const headerSpecs: HeaderSpec[] = [];
  for (let r = 0; r < grid.length; r++) {
    const spec = parseHeaderSpec(grid[r], r);
    if (spec) headerSpecs.push(spec);
  }

  if (headerSpecs.length > 0) {
    const itemsMap = new Map<string, ParsedExcelOrderItem>();
    const allSizesOrdered: string[] = [];
    let hasStageRows = false;
    let currentHeaderIdx = 0;
    let activeSpec = headerSpecs[0];

    let carryOrderNo = effectiveDefaultOrder;
    let carryModel = effectiveDefaultModel;
    let carryColor = defaults.defaultColor || '';
    let carryColorCode = '';
    let carryRost = defaults.defaultRost || '';
    let carryBrand = defaults.brand;
    let carryMonth = defaults.month;

    const addSizeGlobal = (sz: string) => {
      if (!allSizesOrdered.includes(sz)) allSizesOrdered.push(sz);
    };
    activeSpec.sizeCols.forEach(sc => addSizeGlobal(sc.label));

    let skipNextSummaryValuesRow = false;

    for (let r = activeSpec.rowIdx + 1; r < grid.length; r++) {
      // Check if this row is another size header row (multi-block Excel sheet)
      if (currentHeaderIdx + 1 < headerSpecs.length && r === headerSpecs[currentHeaderIdx + 1].rowIdx) {
        currentHeaderIdx++;
        activeSpec = headerSpecs[currentHeaderIdx];
        activeSpec.sizeCols.forEach(sc => addSizeGlobal(sc.label));
        carryColorCode = '';
        carryRost = activeSpec.colRost !== -1 ? '' : (defaults.defaultRost || '');
        skipNextSummaryValuesRow = false;
        continue;
      }

      const row = grid[r];
      if (!row || row.every(c => !c)) continue;

      const rowJoinedLow = row.join(' ').toLowerCase();
      // Detect summary banner row ("Всего заказа | Всего крой | ...") and skip its value row right beneath it
      if (rowJoinedLow.includes('всего заказа') || rowJoinedLow.includes('сводка:')) {
        skipNextSummaryValuesRow = true;
        continue;
      }
      if (skipNextSummaryValuesRow) {
        skipNextSummaryValuesRow = false;
        const firstNonEmpty = row.find(c => c.trim() !== '') || '';
        if (parseIntCell(firstNonEmpty) !== null || firstNonEmpty.includes('%')) {
          continue;
        }
      }

      // Skip explicit summary / footnote / header-banner / instruction rows
      if (
        row.some(c => /^(итого:?|всего:?|total)$/i.test(c.trim())) ||
        rowJoinedLow.includes('отправляем вам') ||
        rowJoinedLow.includes('заказ полотна') ||
        rowJoinedLow.includes('шаблон для загрузки') ||
        rowJoinedLow.includes('инструкция:')
      ) {
        continue;
      }

      // Skip percentage distribution rows like "0% 1% 8% 3% 44%..."
      const sizeCellStrings = activeSpec.sizeCols.map(sc => row[sc.idx] || '').filter(Boolean);
      if (sizeCellStrings.length > 0 && sizeCellStrings.every(v => v.includes('%'))) {
        continue;
      }

      // Determine whether this row has a stage column or inline stage token
      let detectedStage: StageRowKind = null;
      if (activeSpec.colStage !== -1) {
        detectedStage = detectStageCell(row[activeSpec.colStage] || '');
      }
      if (!detectedStage) {
        // Also inspect columns before the first size column (in case Excel had no blank col gap)
        const firstSz = activeSpec.sizeCols[0].idx;
        for (let c = 0; c < firstSz; c++) {
          if (
            c === activeSpec.colOrder ||
            c === activeSpec.colModel ||
            c === activeSpec.colColor ||
            c === activeSpec.colColorCode ||
            c === activeSpec.colRost ||
            c === activeSpec.colBrand ||
            c === activeSpec.colMonth
          ) {
            continue;
          }
          const st = detectStageCell(row[c] || '');
          if (st) {
            detectedStage = st;
            break;
          }
        }
      }

      // Also check colColor or colOrder in case a row ONLY wrote stage name in column A
      if (!detectedStage && activeSpec.colOrder !== -1 && activeSpec.colStage === -1) {
        const stOrder = detectStageCell(row[activeSpec.colOrder] || '');
        if (stOrder) detectedStage = stOrder;
      }

      if (detectedStage === 'ignore') {
        continue;
      }

      const rawOrd = activeSpec.colOrder !== -1 ? (row[activeSpec.colOrder] || '').trim() : '';
      const rawMod = activeSpec.colModel !== -1 ? (row[activeSpec.colModel] || '').trim() : '';
      const rawCol = activeSpec.colColor !== -1 ? (row[activeSpec.colColor] || '').trim() : '';
      const rawColCode = activeSpec.colColorCode !== -1 ? (row[activeSpec.colColorCode] || '').trim() : '';
      const rawRost = activeSpec.colRost !== -1 ? (row[activeSpec.colRost] || '').trim() : '';
      const rawBrand = activeSpec.colBrand !== -1 ? (row[activeSpec.colBrand] || '').trim() : '';
      const rawMonth = activeSpec.colMonth !== -1 ? (row[activeSpec.colMonth] || '').trim() : '';

      // Detect Excel summary banner line above color rows in Color/Rost sheet ("Техноавиа мужское | 1", "Stark kids | 1")
      if (
        !detectedStage &&
        activeSpec.colOrder === -1 &&
        rawCol &&
        (row[activeSpec.colColor + 1] === '1' || /мужск|женск|kids|детск|collection/i.test(rawCol))
      ) {
        if (!defaults.brand && /техноавиа/i.test(rawCol)) carryBrand = 'Texnoavia';
        if (!defaults.brand && /stark/i.test(rawCol)) carryBrand = 'Stark Cotton';
        continue;
      }

      // Update carry-forward identity ONLY on non-ignored real data rows
      const isNewOrder = Boolean(rawOrd && !detectStageCell(rawOrd) && rawOrd !== carryOrderNo);
      const isNewModel = Boolean(rawMod && rawMod !== carryModel);
      const isNewColor = Boolean(rawCol && rawCol !== carryColor);

      if (isNewOrder || isNewModel || isNewColor) {
        if (rawOrd && !detectStageCell(rawOrd)) carryOrderNo = rawOrd;
        if (rawMod) carryModel = rawMod;
        if (rawCol) carryColor = rawCol;
        carryColorCode = rawColCode || '';
        carryRost = rawRost || (activeSpec.colRost !== -1 ? '' : (defaults.defaultRost || ''));
      } else {
        if (rawOrd && !detectStageCell(rawOrd)) carryOrderNo = rawOrd;
        if (rawMod) carryModel = rawMod;
        if (rawCol) carryColor = rawCol;
        if (rawColCode) carryColorCode = rawColCode;
        if (rawRost) carryRost = rawRost;
      }

      if (rawBrand) carryBrand = rawBrand;
      if (rawMonth) carryMonth = rawMonth;

      // Parse numeric values for each size column
      let anySizeNumeric = false;
      const parsedPerSize: Record<string, number> = {};
      activeSpec.sizeCols.forEach(sc => {
        const val = parseIntCell(row[sc.idx] || '');
        if (val !== null) {
          parsedPerSize[sc.label] = val;
          if (val > 0) anySizeNumeric = true;
        }
      });

      const stageField: keyof SizeCellValues =
        detectedStage ?? (defaults.singleStageTarget || 'order');

      if (detectedStage) {
        hasStageRows = true;
      }

      // Skip rows that have neither numbers nor a valid color/order label
      if (!anySizeNumeric && !rawCol && !rawOrd) continue;

      const resolvedOrder = carryOrderNo || effectiveDefaultOrder;
      const resolvedModel = carryModel || effectiveDefaultModel;
      const resolvedColor = carryColor || defaults.defaultColor || 'Основной';
      const resolvedRost = rawRost || carryRost;
      const resolvedBrand = carryBrand || defaults.brand;
      const resolvedMonth = carryMonth || defaults.month;

      const itemKey = `${resolvedOrder}||${resolvedModel}||${resolvedColor}||${resolvedRost}`;
      let item = itemsMap.get(itemKey);
      if (!item) {
        const headerSizes = activeSpec.sizeCols.map(sc => sc.label);
        const initValues: Record<string, SizeCellValues> = {};
        headerSizes.forEach(sz => {
          initValues[sz] = emptyCell();
        });
        item = {
          key: itemKey,
          month: resolvedMonth,
          brand: resolvedBrand,
          orderNo: resolvedOrder,
          model: resolvedModel,
          color: resolvedColor,
          colorCode: carryColorCode,
          rost: resolvedRost,
          defect: 0,
          qtyShipped: 0,
          notes: '',
          sizes: [...headerSizes],
          values: initValues,
          totals: { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }
        };
        itemsMap.set(itemKey, item);
      }

      // Populate size values for this stage
      activeSpec.sizeCols.forEach(sc => {
        if (!item!.sizes.includes(sc.label)) item!.sizes.push(sc.label);
        if (!item!.values[sc.label]) item!.values[sc.label] = emptyCell();
        const num = parsedPerSize[sc.label];
        if (num !== undefined) {
          item!.values[sc.label][stageField] = num;
        }
      });

      if (activeSpec.colDefect !== -1) {
        const d = parseIntCell(row[activeSpec.colDefect] || '');
        if (d !== null && d > 0) item.defect = d;
      }
      if (activeSpec.colShip !== -1) {
        const sh = parseIntCell(row[activeSpec.colShip] || '');
        if (sh !== null && sh > 0) item.qtyShipped = sh;
      }
      if (activeSpec.colNotes !== -1 && row[activeSpec.colNotes]) {
        item.notes = row[activeSpec.colNotes];
      }
    }

    const items = Array.from(itemsMap.values()).map(finalizeItem);
    const layout: DetectedExcelLayout = hasStageRows ? 'matrix_stages_block' : 'color_rost_rows';
    const layoutLabel = hasStageRows
      ? `Матрица этапов по заказам (${allSizesOrdered.join(', ')})`
      : `Таблица цветов / ростовок (${allSizesOrdered.join(', ')})`;

    return {
      layout,
      layoutLabel,
      detectedSizes: allSizesOrdered,
      items,
      warnings
    };
  }

  // ---------------------------------------------------------------------------
  // CASE 3: HEADERLESS STAGE ROWS (User copied rows like Заказ / Крой / Раздача / Пошив / Упаковка WITHOUT header!)
  // ---------------------------------------------------------------------------
  const stageRowHits = grid
    .map((row, idx) => {
      const stageCol = row.findIndex(c => {
        const st = detectStageCell(c);
        return st !== null && st !== 'ignore';
      });
      return { idx, stageCol, stage: stageCol !== -1 ? detectStageCell(row[stageCol]) : null };
    })
    .filter(x => x.stageCol !== -1);

  if (stageRowHits.length >= 1) {
    const firstHit = stageRowHits[0];
    const startNumCol = firstHit.stageCol + 1;
    // Detect how many numeric columns exist before trailing total/empty
    let numColCount = 0;
    for (let c = startNumCol; c < grid[0].length; c++) {
      const hasNum = grid.some(r => parseIntCell(r[c] || '') !== null);
      if (hasNum) numColCount = c - startNumCol + 1;
    }

    const baseSizes =
      defaults.fallbackSizes && defaults.fallbackSizes.length >= numColCount
        ? defaults.fallbackSizes.slice(0, Math.max(1, numColCount))
        : SIZE_PRESETS.alpha_xs_3xl.sizes.slice(0, Math.max(1, numColCount));

    // Fill extra column labels if user pasted wider data
    const effectiveSizes = [...baseSizes];
    while (effectiveSizes.length < numColCount) {
      effectiveSizes.push(`Р-${effectiveSizes.length + 1}`);
    }

    const values: Record<string, SizeCellValues> = {};
    effectiveSizes.forEach(sz => {
      values[sz] = emptyCell();
    });

    let foundOrderNo = effectiveDefaultOrder;
    let foundModel = effectiveDefaultModel;
    let foundColor = defaults.defaultColor || 'Основной';

    grid.forEach(row => {
      if (firstHit.stageCol >= 1 && row[0] && !detectStageCell(row[0])) {
        if (firstHit.stageCol >= 3) {
          if (row[0]) foundOrderNo = row[0];
          if (row[1]) foundModel = row[1];
          if (row[2]) foundColor = row[2];
        } else if (firstHit.stageCol >= 1 && row[0]) {
          foundColor = row[0];
        }
      }
      const st = detectStageCell(row[firstHit.stageCol] || '');
      if (!st || st === 'ignore') return;

      effectiveSizes.forEach((sz, idx) => {
        const n = parseIntCell(row[startNumCol + idx] || '');
        if (n !== null) {
          values[sz][st] = n;
        }
      });
    });

    warnings.push(
      'Строка с названиями размеров (XS, S, M или 88, 92...) не найдена — применена выбранная линейка размеров. Вы можете добавить шапку размеров в строку 1!'
    );

    const item = finalizeItem({
      key: `headless|${foundOrderNo}|${foundModel}|${foundColor}`,
      month: defaults.month,
      brand: defaults.brand,
      orderNo: foundOrderNo,
      model: foundModel,
      color: foundColor,
      colorCode: '',
      rost: defaults.defaultRost || '',
      defect: 0,
      qtyShipped: 0,
      notes: '',
      sizes: effectiveSizes,
      values,
      totals: { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }
    });

    return {
      layout: 'headerless_stages',
      layoutLabel: `Строки этапов без шапки размеров (${effectiveSizes.join(', ')})`,
      detectedSizes: effectiveSizes,
      items: [item],
      warnings
    };
  }

  // ---------------------------------------------------------------------------
  // CASE 4: FLAT PRODUCTION SUMMARY TABLE (Заказ№ | Модель | Цвет | Заказ кол-во | Крой | Раздача | Пошив | Упаковка | Брак | Отгрузка)
  // ---------------------------------------------------------------------------
  for (let r = 0; r < Math.min(grid.length, 6); r++) {
    const low = grid[r].map(c => c.toLowerCase().trim());
    const colMonth = low.findIndex(h => h.includes('месяц') || h.includes('oy'));
    const colBrand = low.findIndex(h => h.includes('бренд') || h.includes('brand'));
    const colOrder = low.findIndex(
      h =>
        h === 'заказ' ||
        h.includes('заказ №') ||
        h.includes('заказ№') ||
        (h.includes('заказ') && !h.includes('кол') && !h.includes('шт') && !h.includes('всего'))
    );
    const colModel = low.findIndex(h => h.includes('модел'));
    const colColorCode = low.findIndex(h => h.includes('код') && h.includes('цвет'));
    const colColor = low.findIndex((h, idx) => idx !== colColorCode && (h === 'цвет' || (h.includes('цвет') && !h.includes('код'))));
    const colRost = low.findIndex(h => h === 'рост' || h.includes('ростов'));
    const colQtyOrder = low.findIndex(
      h => (h.includes('заказ') && (h.includes('кол') || h.includes('шт'))) || h === 'всего заказа'
    );
    const colCut = low.findIndex(h => h.includes('крой') && !h.includes('%'));
    const colDist = low.findIndex(h => h.includes('раздач'));
    const colSew = low.findIndex(h => h.includes('пошив'));
    const colPack = low.findIndex(h => h.includes('упаков') && !h.includes('общ'));
    const colDefect = low.findIndex(h => h === 'брак' || (h.includes('брак') && !h.includes('%')));
    const colShip = low.findIndex(h => h.includes('отгруз'));
    const colNotes = low.findIndex(h => h.includes('примеч') || h.includes('коммент'));

    if ((colOrder !== -1 || colModel !== -1) && (colQtyOrder !== -1 || colCut !== -1 || colPack !== -1)) {
      const items: ParsedExcelOrderItem[] = [];
      for (let i = r + 1; i < grid.length; i++) {
        const row = grid[i];
        const ord = colOrder !== -1 ? row[colOrder] : '';
        const mod = colModel !== -1 ? row[colModel] : '';
        const col = colColor !== -1 ? row[colColor] : '';
        if (!ord && !mod && !col) continue;
        if (/^(итого:?|всего:?)$/i.test(ord || mod || col) || row.some(c => /^итого:?$/i.test(c.trim()))) continue;

        const qOrd = colQtyOrder !== -1 ? parseIntCell(row[colQtyOrder]) ?? 0 : 0;
        const qCut = colCut !== -1 ? parseIntCell(row[colCut]) ?? 0 : 0;
        const qDist = colDist !== -1 ? parseIntCell(row[colDist]) ?? 0 : 0;
        const qSew = colSew !== -1 ? parseIntCell(row[colSew]) ?? 0 : 0;
        const qPack = colPack !== -1 ? parseIntCell(row[colPack]) ?? 0 : 0;
        const qDef = colDefect !== -1 ? parseIntCell(row[colDefect]) ?? 0 : 0;
        const qShip = colShip !== -1 ? parseIntCell(row[colShip]) ?? 0 : 0;

        items.push(
          finalizeItem({
            key: `flat|${i}|${ord}|${mod}|${col}`,
            month: colMonth !== -1 && row[colMonth] ? row[colMonth] : defaults.month,
            brand: colBrand !== -1 && row[colBrand] ? row[colBrand] : defaults.brand,
            orderNo: ord || effectiveDefaultOrder,
            model: mod || effectiveDefaultModel,
            color: col || 'Основной',
            colorCode: colColorCode !== -1 ? row[colColorCode] || '' : '',
            rost: colRost !== -1 ? row[colRost] || '' : '',
            defect: qDef,
            qtyShipped: qShip,
            notes: colNotes !== -1 ? row[colNotes] || '' : '',
            sizes: [],
            values: {},
            scalarTotalsOnly: { order: qOrd, cut: qCut, dist: qDist, sew: qSew, pack: qPack },
            totals: { order: qOrd, cut: qCut, dist: qDist, sew: qSew, pack: qPack }
          })
        );
      }

      if (items.length > 0) {
        return {
          layout: 'flat_summary',
          layoutLabel: `Общая таблица производства (${items.length} строк без разбивки по размерам)`,
          detectedSizes: [],
          items,
          warnings
        };
      }
    }
  }

  return {
    layout: 'unknown',
    layoutLabel: 'Не удалось автоматически определить структуру — убедитесь, что в первой строке есть названия размеров (XS, S, M... или 88, 92...)',
    detectedSizes: [],
    items: [],
    warnings
  };
}

/**
 * Converts a parsed item into a FactoryLedgerRow + OrderSizeMatrix ready to be saved into OrdersView store.
 */
export function buildLedgerEntryFromParsedItem(
  item: ParsedExcelOrderItem,
  id: string
): { row: FactoryLedgerRow; matrix: OrderSizeMatrix } {
  const sizes =
    item.sizes.length > 0
      ? [...item.sizes]
      : [...SIZE_PRESETS[detectSizePresetForRow({ orderNo: item.orderNo, model: item.model, color: item.color, notes: item.notes, brand: item.brand })].sizes];

  let matchedPreset: SizePresetId = 'custom';
  (Object.keys(SIZE_PRESETS) as Exclude<SizePresetId, 'custom'>[]).forEach(pKey => {
    const presetSizes = SIZE_PRESETS[pKey].sizes;
    if (
      sizes.length > 0 &&
      sizes.every(sz => presetSizes.includes(sz) || presetSizes.some(ps => ps === sz.replace(/\s*\(.*?\)\s*/g, '').replace(/\+$/, '')))
    ) {
      matchedPreset = pKey;
    }
  });

  const values: Record<string, SizeCellValues> = {};
  sizes.forEach(sz => {
    values[sz] = item.values[sz] ? { ...item.values[sz] } : emptyCell();
  });

  // If flat summary only (no per-size matrix), record raw totals on row and leave matrix clean
  const matrix: OrderSizeMatrix = {
    rowId: id,
    presetId: matchedPreset,
    sizes,
    values,
    defect: item.defect
  };

  const baseRow: FactoryLedgerRow = {
    id,
    brand: item.brand || '',
    orderNo: item.orderNo,
    model: item.model,
    color: item.color,
    colorCode: item.colorCode || '',
    rost: ROST_OPTIONS.includes(item.rost) ? item.rost : item.rost || '',
    qtyOrder: item.scalarTotalsOnly ? item.scalarTotalsOnly.order : item.totals.order,
    qtyCut: item.scalarTotalsOnly ? item.scalarTotalsOnly.cut : item.totals.cut,
    qtyDistribution: item.scalarTotalsOnly ? item.scalarTotalsOnly.dist : item.totals.dist,
    qtySewing: item.scalarTotalsOnly ? item.scalarTotalsOnly.sew : item.totals.sew,
    qtyPackaging: item.scalarTotalsOnly ? item.scalarTotalsOnly.pack : item.totals.pack,
    qtyDefect: item.defect,
    qtyTotalPack: 0,
    difference: 0,
    qtyShipped: item.qtyShipped,
    qtyStock: 0,
    percent: 0,
    month: item.month,
    notes: item.notes
  };

  const recalculated =
    item.sizes.length > 0 ? recalcLedgerRowFromMatrix(baseRow, matrix) : recalcLedgerRowFromMatrix(baseRow, null);

  return { row: recalculated, matrix };
}
