// Sof Excel/Google Sheets darajasidagi 2D jadval boshqaruv mexanizmi (navigatsiya, tanlash, nusxalash/qo'yish, fill handle, Ctrl+D/R)

import {
  SKLAD_COLUMNS,
  SkladColumnKey,
  SkladRow,
} from '../types';
import { createEmptySkladRow, normalizeDateInput } from '../validators/validators';

export interface CellCoord {
  row: number;
  col: number;
}

export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface GridSelection {
  active: CellCoord | null;
  anchor: CellCoord | null;
  ranges: CellRange[];
}

export const INTEGER_SKLAD_COLUMNS = new Set<SkladColumnKey>([
  '2XS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  '7XL',
  '8XL',
  '9XL',
  '10XL',
  '11XL',
  '12XL',
  'Всего',
  'Кол.кор.',
]);

export const DECIMAL_SKLAD_COLUMNS = new Set<SkladColumnKey>([
  'Куб.м.',
  'Вес нетто',
  'Вес брутто',
]);

export const DATE_SKLAD_COLUMNS = new Set<SkladColumnKey>([
  'Дата упак.',
  'Дата склад.',
]);

export const DROPDOWN_SKLAD_OPTIONS: Partial<Record<SkladColumnKey, string[]>> = {
  Выд: ['', 'Да'],
  Сорт: ['1-сорт', '2-сорт', '3-сорт'],
};

/** 0-indeksli ustunni Excel harfiga aylantirish: 0 -> A, 25 -> Z, 26 -> AA */
export function colIndexToExcelLetters(colIdx: number): string {
  let n = colIdx + 1;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result || 'A';
}

/** Katak manzili: masalan (11, 3) -> D12 */
export function formatCellAddress(coord: CellCoord | null): string {
  if (!coord) return '—';
  return `${colIndexToExcelLetters(coord.col)}${coord.row + 1}`;
}

export function normalizeRange(a: CellCoord, b: CellCoord): CellRange {
  return {
    r1: Math.min(a.row, b.row),
    c1: Math.min(a.col, b.col),
    r2: Math.max(a.row, b.row),
    c2: Math.max(a.col, b.col),
  };
}

export function clampCoord(coord: CellCoord, rowCount: number, colCount: number): CellCoord {
  return {
    row: Math.max(0, Math.min(Math.max(0, rowCount - 1), coord.row)),
    col: Math.max(0, Math.min(Math.max(0, colCount - 1), coord.col)),
  };
}

export function isCellInRange(range: CellRange, row: number, col: number): boolean {
  return row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2;
}

export function isCellSelected(selection: GridSelection, row: number, col: number): boolean {
  for (let i = 0; i < selection.ranges.length; i++) {
    if (isCellInRange(selection.ranges[i], row, col)) return true;
  }
  return false;
}

export function isRowInAnySelection(selection: GridSelection, row: number): boolean {
  for (let i = 0; i < selection.ranges.length; i++) {
    const r = selection.ranges[i];
    if (row >= r.r1 && row <= r.r2) return true;
  }
  return false;
}

export function isColInAnySelection(selection: GridSelection, col: number): boolean {
  for (let i = 0; i < selection.ranges.length; i++) {
    const r = selection.ranges[i];
    if (col >= r.c1 && col <= r.c2) return true;
  }
  return false;
}

export function createSingleCellSelection(row: number, col: number): GridSelection {
  return {
    active: { row, col },
    anchor: { row, col },
    ranges: [{ r1: row, c1: col, r2: row, c2: col }],
  };
}

/** Tanlangan barcha noyob kataklar soni va yig'indisini hisoblash */
export function getSelectionMetrics(
  rows: SkladRow[],
  selection: GridSelection,
  colKeys: readonly SkladColumnKey[] = SKLAD_COLUMNS
): { cellCount: number; numericSum: number; numericCount: number } {
  if (selection.ranges.length === 0 || rows.length === 0) {
    return { cellCount: 0, numericSum: 0, numericCount: 0 };
  }

  // Bitta diapazon bo'lsa O(area), bir nechta kesishuvchi diapazon bo'lsa Set bilan
  if (selection.ranges.length === 1) {
    const { r1, c1, r2, c2 } = selection.ranges[0];
    const maxR = Math.min(r2, rows.length - 1);
    const maxC = Math.min(c2, colKeys.length - 1);
    if (maxR < r1 || maxC < c1) {
      return { cellCount: 0, numericSum: 0, numericCount: 0 };
    }
    const cellCount = (maxR - r1 + 1) * (maxC - c1 + 1);
    let numericSum = 0;
    let numericCount = 0;
    for (let r = r1; r <= maxR; r++) {
      const rowObj = rows[r];
      for (let c = c1; c <= maxC; c++) {
        const raw = (rowObj[colKeys[c]] || '').trim();
        if (raw !== '' && /^-?\d+(?:[.,]\d+)?$/.test(raw)) {
          const num = Number(raw.replace(',', '.'));
          if (Number.isFinite(num)) {
            numericSum += num;
            numericCount++;
          }
        }
      }
    }
    return { cellCount, numericSum, numericCount };
  }

  const seen = new Set<number>();
  let numericSum = 0;
  let numericCount = 0;
  const colLen = colKeys.length;
  for (const rng of selection.ranges) {
    const maxR = Math.min(rng.r2, rows.length - 1);
    const maxC = Math.min(rng.c2, colLen - 1);
    for (let r = rng.r1; r <= maxR; r++) {
      const rowObj = rows[r];
      for (let c = rng.c1; c <= maxC; c++) {
        const key = r * colLen + c;
        if (seen.has(key)) continue;
        seen.add(key);
        const raw = (rowObj[colKeys[c]] || '').trim();
        if (raw !== '' && /^-?\d+(?:[.,]\d+)?$/.test(raw)) {
          const num = Number(raw.replace(',', '.'));
          if (Number.isFinite(num)) {
            numericSum += num;
            numericCount++;
          }
        }
      }
    }
  }
  return { cellCount: seen.size, numericSum, numericCount };
}

/** Tanlovga tushgan barcha qator indekslarini olish */
export function getSelectedRowIndices(selection: GridSelection, rowCount: number): number[] {
  const rowSet = new Set<number>();
  for (const rng of selection.ranges) {
    const r1 = Math.max(0, rng.r1);
    const r2 = Math.min(rowCount - 1, rng.r2);
    for (let r = r1; r <= r2; r++) {
      rowSet.add(r);
    }
  }
  if (rowSet.size === 0 && selection.active && selection.active.row < rowCount) {
    rowSet.add(selection.active.row);
  }
  return Array.from(rowSet).sort((a, b) => a - b);
}

/** Qo'lda kiritishda raqamli ustunlarni tozalash (harf kiritishni bloklaydi) */
export function sanitizeManualNumericInput(colKey: SkladColumnKey, value: string): string {
  if (INTEGER_SKLAD_COLUMNS.has(colKey)) {
    return value.replace(/[^\d]/g, '');
  }
  if (DECIMAL_SKLAD_COLUMNS.has(colKey)) {
    // Faqat raqam va bitta nuqta/vergul ruxsat etiladi
    let out = '';
    let hasDot = false;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch >= '0' && ch <= '9') {
        out += ch;
      } else if ((ch === '.' || ch === ',') && !hasDot) {
        out += '.';
        hasDot = true;
      }
    }
    return out;
  }
  return value;
}

/** Qo'lda tahrirlash yakunida qiymatni ustun turiga ko'ra normallashtirish */
export function normalizeCommittedCellValue(colKey: SkladColumnKey, value: string): string {
  if (INTEGER_SKLAD_COLUMNS.has(colKey) || DECIMAL_SKLAD_COLUMNS.has(colKey)) {
    return sanitizeManualNumericInput(colKey, value);
  }
  if (DATE_SKLAD_COLUMNS.has(colKey)) {
    return normalizeDateInput(value);
  }
  return value;
}

/** Ctrl+Strelka bilan ma'lumot bloki chetiga sakrash (Excel xatti-harakati) */
export function computeCtrlJumpTarget(
  rows: SkladRow[],
  start: CellCoord,
  dr: number,
  dc: number,
  colKeys: readonly SkladColumnKey[] = SKLAD_COLUMNS
): CellCoord {
  const rowCount = rows.length;
  const colCount = colKeys.length;
  if (rowCount === 0 || colCount === 0) return start;

  const isNonEmpty = (r: number, c: number) => (rows[r]?.[colKeys[c]] ?? '') !== '';
  let r = start.row;
  let c = start.col;

  const nextR = r + dr;
  const nextC = c + dc;
  if (nextR < 0 || nextR >= rowCount || nextC < 0 || nextC >= colCount) {
    return start;
  }

  const startNonEmpty = isNonEmpty(r, c);
  const nextNonEmpty = isNonEmpty(nextR, nextC);

  if (startNonEmpty && nextNonEmpty) {
    // To'ldirilgan blok oxirigacha yurish
    while (
      r + dr >= 0 &&
      r + dr < rowCount &&
      c + dc >= 0 &&
      c + dc < colCount &&
      isNonEmpty(r + dr, c + dc)
    ) {
      r += dr;
      c += dc;
    }
    return { row: r, col: c };
  }

  // Bo'sh kataklardan sakrab keyingi birinchi to'ldirilgan katakkacha (yoki chekkagacha) yurish
  r = nextR;
  c = nextC;
  while (
    r + dr >= 0 &&
    r + dr < rowCount &&
    c + dc >= 0 &&
    c + dc < colCount &&
    !isNonEmpty(r, c)
  ) {
    r += dr;
    c += dc;
  }
  return { row: r, col: c };
}

/** Jadvaldagi oxirgi to'ldirilgan katak manzilini topish (Ctrl+End uchun) */
export function findLastPopulatedCell(
  rows: SkladRow[],
  colKeys: readonly SkladColumnKey[] = SKLAD_COLUMNS
): CellCoord {
  if (rows.length === 0) return { row: 0, col: 0 };
  let maxR = 0;
  let maxC = 0;
  for (let r = 0; r < rows.length; r++) {
    const rowObj = rows[r];
    for (let c = 0; c < colKeys.length; c++) {
      if ((rowObj[colKeys[c]] || '') !== '') {
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      }
    }
  }
  return { row: maxR, col: maxC };
}

/** Tanlovni TSV matnga aylantirish (Excel/Google Sheets uchun Ctrl+C / Ctrl+X) */
export function serializeSelectionToTsv(
  rows: SkladRow[],
  selection: GridSelection,
  colKeys: readonly SkladColumnKey[] = SKLAD_COLUMNS
): string {
  if (rows.length === 0 || selection.ranges.length === 0) return '';

  let minR = Infinity;
  let minC = Infinity;
  let maxR = -1;
  let maxC = -1;

  for (const rng of selection.ranges) {
    if (rng.r1 < minR) minR = rng.r1;
    if (rng.c1 < minC) minC = rng.c1;
    if (rng.r2 > maxR) maxR = rng.r2;
    if (rng.c2 > maxC) maxC = rng.c2;
  }

  minR = Math.max(0, minR);
  minC = Math.max(0, minC);
  maxR = Math.min(rows.length - 1, maxR);
  maxC = Math.min(colKeys.length - 1, maxC);
  if (maxR < minR || maxC < minC) return '';

  const lines: string[] = [];
  for (let r = minR; r <= maxR; r++) {
    const rowObj = rows[r];
    const cells: string[] = [];
    for (let c = minC; c <= maxC; c++) {
      // Agar ko'p tarqoq range tanlangan bo'lsa, faqat tanlangan kataklarni yozamiz
      const include = selection.ranges.length === 1 || isCellSelected(selection, r, c);
      const raw = include ? rowObj[colKeys[c]] ?? '' : '';
      cells.push(raw);
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

/** Tanlangan barcha kataklarni tozalash (Delete / Backspace / Ctrl+X) */
export function clearSelectedCellsInRows(
  rows: SkladRow[],
  selection: GridSelection,
  colKeys: readonly SkladColumnKey[] = SKLAD_COLUMNS
): SkladRow[] {
  if (rows.length === 0 || selection.ranges.length === 0) return rows;

  const updatedByRow = new Map<number, SkladRow>();
  const now = Date.now();

  for (const rng of selection.ranges) {
    const r1 = Math.max(0, rng.r1);
    const r2 = Math.min(rows.length - 1, rng.r2);
    const c1 = Math.max(0, rng.c1);
    const c2 = Math.min(colKeys.length - 1, rng.c2);

    for (let r = r1; r <= r2; r++) {
      let rowCopy = updatedByRow.get(r);
      for (let c = c1; c <= c2; c++) {
        const key = colKeys[c];
        const currentVal = (rowCopy ?? rows[r])[key];
        if (currentVal !== '') {
          if (!rowCopy) {
            rowCopy = { ...rows[r], updatedAt: now };
            updatedByRow.set(r, rowCopy);
          }
          rowCopy[key] = '';
        }
      }
    }
  }

  if (updatedByRow.size === 0) return rows;
  return rows.map((row, idx) => updatedByRow.get(idx) ?? row);
}

/**
 * Clipboard 2D massivini (Ctrl+V) faol katak yoki tanlangan diapazonga qo'yish.
 * - Boshidagi/oxiridagi probellar SAQLANADI.
 * - 1x1 nusxa ko'p katakka qo'yilsa hammasini to'ldiradi.
 * - Qatorlar yetmasa avtomatik yangi qatorlar qo'shiladi.
 */
export function applyPasteMatrixToRows(params: {
  rows: SkladRow[];
  selection: GridSelection;
  matrix: string[][];
  defaultDate: string;
  colKeys?: readonly SkladColumnKey[];
}): {
  nextRows: SkladRow[];
  nextSelection: GridSelection;
  addedRowsCount: number;
  pastedCellsCount: number;
} {
  const { rows, selection, matrix, defaultDate, colKeys = SKLAD_COLUMNS } = params;
  if (!matrix || matrix.length === 0) {
    return { nextRows: rows, nextSelection: selection, addedRowsCount: 0, pastedCellsCount: 0 };
  }

  const now = Date.now();
  const singleValue =
    matrix.length === 1 && matrix[0].length === 1 ? matrix[0][0] : null;
  const selMetrics = getSelectionMetrics(rows, selection, colKeys);

  // 1x1 nusxa ko'p tanlangan kataklarga qo'yilganda hammasini to'ldirish
  if (singleValue !== null && selMetrics.cellCount > 1 && rows.length > 0) {
    const updatedByRow = new Map<number, SkladRow>();
    let pastedCellsCount = 0;

    for (const rng of selection.ranges) {
      const r1 = Math.max(0, rng.r1);
      const r2 = Math.min(rows.length - 1, rng.r2);
      const c1 = Math.max(0, rng.c1);
      const c2 = Math.min(colKeys.length - 1, rng.c2);

      for (let r = r1; r <= r2; r++) {
        let rowCopy = updatedByRow.get(r);
        for (let c = c1; c <= c2; c++) {
          const key = colKeys[c];
          const val = DATE_SKLAD_COLUMNS.has(key) ? normalizeDateInput(singleValue) : singleValue;
          if (!rowCopy) {
            rowCopy = { ...rows[r], updatedAt: now };
            updatedByRow.set(r, rowCopy);
          }
          rowCopy[key] = val;
          pastedCellsCount++;
        }
      }
    }

    const nextRows = rows.map((row, idx) => updatedByRow.get(idx) ?? row);
    return {
      nextRows,
      nextSelection: selection,
      addedRowsCount: 0,
      pastedCellsCount,
    };
  }

  // Ko'p katakli (yoki yakka katakka 1x1) qo'yish: boshlanish koordinatasi
  let startRow = 0;
  let startCol = 0;
  if (selection.active) {
    startRow = Math.max(0, selection.active.row);
    startCol = Math.max(0, selection.active.col);
  } else if (selection.ranges.length > 0) {
    startRow = Math.max(0, selection.ranges[0].r1);
    startCol = Math.max(0, selection.ranges[0].c1);
  }
  if (selection.ranges.length > 0) {
    // Agar foydalanuvchi diapazon tanlagan bo'lsa, chap-yuqori burchagidan boshlanadi
    startRow = Math.min(...selection.ranges.map(r => r.r1));
    startCol = Math.min(...selection.ranges.map(r => r.c1));
  }

  const neededRows = startRow + matrix.length;
  const addedRowsCount = Math.max(0, neededRows - rows.length);
  const nextRows: SkladRow[] = rows.map((r, i) =>
    i >= startRow && i < neededRows ? { ...r, updatedAt: now } : r
  );

  for (let i = 0; i < addedRowsCount; i++) {
    nextRows.push(
      createEmptySkladRow(
        {
          id: `skl-paste-${now}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          updatedAt: now + i,
        },
        defaultDate
      )
    );
  }

  let maxMatrixWidth = 1;
  let pastedCellsCount = 0;

  for (let rOff = 0; rOff < matrix.length; rOff++) {
    const srcRow = matrix[rOff] || [];
    if (srcRow.length > maxMatrixWidth) maxMatrixWidth = srcRow.length;
    const targetRowIdx = startRow + rOff;
    const rowObj = nextRows[targetRowIdx];

    for (let cOff = 0; cOff < srcRow.length; cOff++) {
      const targetColIdx = startCol + cOff;
      if (targetColIdx >= colKeys.length) break;
      const key = colKeys[targetColIdx];
      const rawCell = srcRow[cOff] ?? '';
      // Boshidagi va oxiridagi probellarni saqlaymiz!
      rowObj[key] = DATE_SKLAD_COLUMNS.has(key) ? normalizeDateInput(rawCell) : rawCell;
      pastedCellsCount++;
    }
  }

  const endRow = Math.max(startRow, startRow + matrix.length - 1);
  const endCol = Math.min(colKeys.length - 1, startCol + maxMatrixWidth - 1);

  return {
    nextRows,
    nextSelection: {
      active: { row: startRow, col: startCol },
      anchor: { row: startRow, col: startCol },
      ranges: [{ r1: startRow, c1: startCol, r2: endRow, c2: endCol }],
    },
    addedRowsCount,
    pastedCellsCount,
  };
}

/** Ctrl+D: tanlangan diapazon bo'yicha yuqoridagi qiymatni pastga ko'chirish */
export function fillDownSelection(
  rows: SkladRow[],
  selection: GridSelection,
  colKeys: readonly SkladColumnKey[] = SKLAD_COLUMNS
): SkladRow[] {
  if (rows.length === 0 || selection.ranges.length === 0) return rows;
  const rng = selection.ranges[0];
  const r1 = Math.max(0, rng.r1);
  const r2 = Math.min(rows.length - 1, rng.r2);
  const c1 = Math.max(0, rng.c1);
  const c2 = Math.min(colKeys.length - 1, rng.c2);

  const now = Date.now();
  const nextRows = [...rows];
  let changed = false;

  if (r1 === r2) {
    // 1 qator tanlangan bo'lsa, r1 - 1 dagi qiymatni r1 ga ko'chirish (Excel Ctrl+D)
    if (r1 === 0) return rows;
    const src = rows[r1 - 1];
    const dst = { ...rows[r1], updatedAt: now };
    for (let c = c1; c <= c2; c++) {
      const key = colKeys[c];
      if (dst[key] !== src[key]) {
        dst[key] = src[key];
        changed = true;
      }
    }
    if (!changed) return rows;
    nextRows[r1] = dst;
    return nextRows;
  }

  const src = rows[r1];
  for (let r = r1 + 1; r <= r2; r++) {
    const dst = { ...rows[r], updatedAt: now };
    let rowChanged = false;
    for (let c = c1; c <= c2; c++) {
      const key = colKeys[c];
      if (dst[key] !== src[key]) {
        dst[key] = src[key];
        rowChanged = true;
      }
    }
    if (rowChanged) {
      nextRows[r] = dst;
      changed = true;
    }
  }
  return changed ? nextRows : rows;
}

/** Ctrl+R: chapdagi katak qiymatini o'ngga ko'chirish */
export function fillRightSelection(
  rows: SkladRow[],
  selection: GridSelection,
  colKeys: readonly SkladColumnKey[] = SKLAD_COLUMNS
): SkladRow[] {
  if (rows.length === 0 || selection.ranges.length === 0) return rows;
  const rng = selection.ranges[0];
  const r1 = Math.max(0, rng.r1);
  const r2 = Math.min(rows.length - 1, rng.r2);
  const c1 = Math.max(0, rng.c1);
  const c2 = Math.min(colKeys.length - 1, rng.c2);

  const now = Date.now();
  const nextRows = [...rows];
  let changed = false;

  if (c1 === c2) {
    if (c1 === 0) return rows;
    const srcKey = colKeys[c1 - 1];
    const dstKey = colKeys[c1];
    for (let r = r1; r <= r2; r++) {
      if (rows[r][dstKey] !== rows[r][srcKey]) {
        nextRows[r] = { ...rows[r], [dstKey]: rows[r][srcKey], updatedAt: now };
        changed = true;
      }
    }
    return changed ? nextRows : rows;
  }

  const srcKey = colKeys[c1];
  for (let r = r1; r <= r2; r++) {
    const srcVal = rows[r][srcKey];
    const dst = { ...rows[r], updatedAt: now };
    let rowChanged = false;
    for (let c = c1 + 1; c <= c2; c++) {
      const dstKey = colKeys[c];
      if (dst[dstKey] !== srcVal) {
        dst[dstKey] = srcVal;
        rowChanged = true;
      }
    }
    if (rowChanged) {
      nextRows[r] = dst;
      changed = true;
    }
  }
  return changed ? nextRows : rows;
}

/** Raqamli yoki prefiks+raqamli ketma-ketlikni aniqlash va keyingi qiymatni chiqarish */
function generateFillSequenceValue(sourceValues: string[], targetOffset: number): string {
  if (sourceValues.length === 0) return '';
  if (sourceValues.length === 1) {
    return sourceValues[0];
  }

  // 1) Sof butun/o'nlik sonlar ketma-ketligi: masalan ['243', '244'] -> '245', '246'
  const nums = sourceValues.map(v => (/^-?\d+$/.test(v.trim()) ? Number(v.trim()) : null));
  if (nums.every(n => n !== null)) {
    const validNums = nums as number[];
    const step = validNums[1] - validNums[0];
    let isArithmetic = true;
    for (let i = 2; i < validNums.length; i++) {
      if (validNums[i] - validNums[i - 1] !== step) {
        isArithmetic = false;
        break;
      }
    }
    if (isArithmetic) {
      const last = validNums[validNums.length - 1];
      return String(last + step * targetOffset);
    }
  }

  // 2) Prefiks + oxirgi raqam ketma-ketligi: masalan ['T-243', 'T-244'] -> 'T-245'
  const parsedPrefixed = sourceValues.map(v => /^(.*?)(\d+)$/.exec(v));
  if (parsedPrefixed.every(Boolean)) {
    const matches = parsedPrefixed as RegExpExecArray[];
    const prefix = matches[0][1];
    if (matches.every(m => m[1] === prefix)) {
      const tails = matches.map(m => Number(m[2]));
      const step = tails[1] - tails[0];
      let isArith = true;
      for (let i = 2; i < tails.length; i++) {
        if (tails[i] - tails[i - 1] !== step) {
          isArith = false;
          break;
        }
      }
      if (isArith) {
        const nextNum = tails[tails.length - 1] + step * targetOffset;
        if (nextNum >= 0) {
          const padLen = matches[0][2].length;
          const formattedNum =
            matches[0][2].startsWith('0') && padLen > 1
              ? String(nextNum).padStart(padLen, '0')
              : String(nextNum);
          return `${prefix}${formattedNum}`;
        }
      }
    }
  }

  // 3) Ketma-ketlik bo'lmasa qiymatlarni tsiklik takrorlash
  return sourceValues[(targetOffset - 1) % sourceValues.length];
}

/**
 * To'ldirish dastagi (Fill Handle) sudraganda qiymatlarni ko'paytirish / ketma-ketlikni davom ettirish
 */
export function applyFillHandleDrag(params: {
  rows: SkladRow[];
  sourceRange: CellRange;
  targetEndRow: number;
  targetEndCol: number;
  colKeys?: readonly SkladColumnKey[];
}): { nextRows: SkladRow[]; finalRange: CellRange } {
  const { rows, sourceRange, targetEndRow, targetEndCol, colKeys = SKLAD_COLUMNS } = params;
  if (rows.length === 0) return { nextRows: rows, finalRange: sourceRange };

  const srcR1 = Math.max(0, sourceRange.r1);
  const srcR2 = Math.min(rows.length - 1, sourceRange.r2);
  const srcC1 = Math.max(0, sourceRange.c1);
  const srcC2 = Math.min(colKeys.length - 1, sourceRange.c2);

  const now = Date.now();
  const nextRows = [...rows];
  let changed = false;

  // Pastga sudrash (asosiy Excel fill-down stsenariysi)
  if (targetEndRow > srcR2) {
    const endR = Math.min(rows.length - 1, targetEndRow);
    for (let c = srcC1; c <= srcC2; c++) {
      const key = colKeys[c];
      const srcVals: string[] = [];
      for (let r = srcR1; r <= srcR2; r++) {
        srcVals.push(rows[r][key] ?? '');
      }
      for (let r = srcR2 + 1; r <= endR; r++) {
        const offset = r - srcR2;
        const val = generateFillSequenceValue(srcVals, offset);
        if (nextRows[r][key] !== val) {
          nextRows[r] = { ...nextRows[r], [key]: val, updatedAt: now };
          changed = true;
        }
      }
    }
    return {
      nextRows: changed ? nextRows : rows,
      finalRange: { r1: srcR1, c1: srcC1, r2: endR, c2: srcC2 },
    };
  }

  // O'ngga sudrash
  if (targetEndCol > srcC2) {
    const endC = Math.min(colKeys.length - 1, targetEndCol);
    for (let r = srcR1; r <= srcR2; r++) {
      const srcVals: string[] = [];
      for (let c = srcC1; c <= srcC2; c++) {
        srcVals.push(rows[r][colKeys[c]] ?? '');
      }
      const dst = { ...nextRows[r], updatedAt: now };
      let rowChanged = false;
      for (let c = srcC2 + 1; c <= endC; c++) {
        const key = colKeys[c];
        const val = generateFillSequenceValue(srcVals, c - srcC2);
        if (dst[key] !== val) {
          dst[key] = val;
          rowChanged = true;
        }
      }
      if (rowChanged) {
        nextRows[r] = dst;
        changed = true;
      }
    }
    return {
      nextRows: changed ? nextRows : rows,
      finalRange: { r1: srcR1, c1: srcC1, r2: srcR2, c2: endC },
    };
  }

  return { nextRows: rows, finalRange: sourceRange };
}

/** Ustun kengligini avtomatik hisoblash (sarlavha chetiga ikki marta bosganda) */
export function computeAutoColumnWidth(
  rows: SkladRow[],
  colKey: SkladColumnKey,
  baseWidth: number
): number {
  let maxLen = colKey.length + 3;
  const step = rows.length > 1500 ? Math.floor(rows.length / 1500) : 1;
  for (let i = 0; i < rows.length; i += step) {
    const val = rows[i][colKey];
    if (val && val.length > maxLen) {
      maxLen = val.length;
    }
  }
  const estimated = Math.round(maxLen * 7.6 + 24);
  return Math.max(60, Math.min(360, Math.max(baseWidth, estimated)));
}
