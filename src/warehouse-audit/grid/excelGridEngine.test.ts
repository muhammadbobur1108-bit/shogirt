import { describe, it, expect } from 'vitest';
import {
  applyFillHandleDrag,
  applyPasteMatrixToRows,
  clearSelectedCellsInRows,
  computeCtrlJumpTarget,
  createSingleCellSelection,
  fillDownSelection,
  fillRightSelection,
  findLastPopulatedCell,
  formatCellAddress,
  getSelectionMetrics,
  normalizeCommittedCellValue,
  sanitizeManualNumericInput,
  serializeSelectionToTsv,
} from './excelGridEngine';
import { parseClipboardToMatrix } from '../services/excelService';
import { createEmptySkladRow, normalizeDateInput } from '../validators/validators';

describe('excelGridEngine.ts — Excel/Google Sheets darajasidagi Склад grid operatsiyalari', () => {
  const DEFAULT_DATE = '20.11.2026';

  it("Excel dan 50x10 jadvalni qo'yganda yangi qatorlar avtomatik qo'shilishi va probellar saqlanishi kerak", () => {
    const initialRows = [
      createEmptySkladRow({ id: 'r-0' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r-1' }, DEFAULT_DATE),
    ];

    // 50 qator x 10 ustun TSV matn tayyorlaymiz (boshida va oxirida ataylab probel bilan)
    const tsvLines: string[] = [];
    for (let r = 0; r < 50; r++) {
      const cols: string[] = [];
      for (let c = 0; c < 10; c++) {
        if (r === 0 && c === 3) {
          cols.push(' MOS-2610.01 '); // Boshida va oxirida probel saqlanishi shart
        } else {
          cols.push(`V_${r}_${c}`);
        }
      }
      tsvLines.push(cols.join('\t'));
    }
    const rawClipboard = tsvLines.join('\r\n') + '\r\n';
    const matrix = parseClipboardToMatrix('', rawClipboard);

    expect(matrix.length).toBe(50);
    expect(matrix[0].length).toBe(10);
    expect(matrix[0][3]).toBe(' MOS-2610.01 ');

    const res = applyPasteMatrixToRows({
      rows: initialRows,
      selection: createSingleCellSelection(0, 0),
      matrix,
      defaultDate: DEFAULT_DATE,
    });

    expect(res.nextRows.length).toBe(50);
    expect(res.addedRowsCount).toBe(48);
    expect(res.pastedCellsCount).toBe(500);
    expect(res.nextRows[0].Заказ).toBe(' MOS-2610.01 ');
    expect(res.nextRows[49].Документ).toBe('V_49_9');
    expect(res.nextSelection.ranges[0]).toEqual({ r1: 0, c1: 0, r2: 49, c2: 9 });
  });

  it("Bitta katak nusxasi ko'p tanlangan kataklarga qo'yilganda hammasini to'ldirishi kerak", () => {
    const rows = [
      createEmptySkladRow({ id: 'r-0' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r-1' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r-2' }, DEFAULT_DATE),
    ];

    const res = applyPasteMatrixToRows({
      rows,
      selection: {
        active: { row: 0, col: 2 },
        anchor: { row: 0, col: 2 },
        ranges: [{ r1: 0, c1: 2, r2: 2, c2: 3 }],
      },
      matrix: [['1-сорт']],
      defaultDate: DEFAULT_DATE,
    });

    expect(res.pastedCellsCount).toBe(6);
    expect(res.nextRows[0].Сорт).toBe('1-сорт');
    expect(res.nextRows[1].Сорт).toBe('1-сорт');
    expect(res.nextRows[2].Заказ).toBe('1-сорт');
  });

  it("Delete bilan tanlangan kataklarni tozalash va Ctrl+C TSV serializatsiyasi to'g'ri ishlashi kerak", () => {
    const rows = [
      createEmptySkladRow({ id: 'r-0', Выд: 'Да', '№ тары': '101', Сорт: '1-сорт' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r-1', Выд: '', '№ тары': '102', Сорт: '2-сорт' }, DEFAULT_DATE),
    ];
    const sel = {
      active: { row: 0, col: 1 },
      anchor: { row: 0, col: 1 },
      ranges: [{ r1: 0, c1: 1, r2: 1, c2: 2 }],
    };

    const tsv = serializeSelectionToTsv(rows, sel);
    expect(tsv).toBe('101\t1-сорт\n102\t2-сорт');

    const cleared = clearSelectedCellsInRows(rows, sel);
    expect(cleared[0]['№ тары']).toBe('');
    expect(cleared[0].Сорт).toBe('');
    expect(cleared[0].Выд).toBe('Да'); // Tashqaridagi katak o'chmaydi
    expect(cleared[1]['№ тары']).toBe('');
  });

  it("Fill Handle: № тары dagi 243, 244 ketma-ketligini 245, 246, 247 qilib davom ettirishi kerak", () => {
    const rows = [
      createEmptySkladRow({ id: 'r0', '№ тары': '243' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r1', '№ тары': '244' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r2', '№ тары': '' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r3', '№ тары': '' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r4', '№ тары': '' }, DEFAULT_DATE),
    ];

    const res = applyFillHandleDrag({
      rows,
      sourceRange: { r1: 0, c1: 1, r2: 1, c2: 1 },
      targetEndRow: 4,
      targetEndCol: 1,
    });

    expect(res.nextRows.map(r => r['№ тары'])).toEqual(['243', '244', '245', '246', '247']);
  });

  it("Ctrl+D va Ctrl+R qiymatlarni yuqoridan pastga va chapdan o'ngga ko'chirishi kerak", () => {
    const rows = [
      createEmptySkladRow({ id: 'r0', Сорт: '1-сорт', Заказ: '' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r1', Сорт: '', Заказ: '' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r2', Сорт: '', Заказ: '' }, DEFAULT_DATE),
    ];

    const down = fillDownSelection(rows, {
      active: { row: 0, col: 2 },
      anchor: { row: 0, col: 2 },
      ranges: [{ r1: 0, c1: 2, r2: 2, c2: 2 }],
    });
    expect(down.map(r => r.Сорт)).toEqual(['1-сорт', '1-сорт', '1-сорт']);

    const right = fillRightSelection(down, {
      active: { row: 0, col: 2 },
      anchor: { row: 0, col: 2 },
      ranges: [{ r1: 0, c1: 2, r2: 1, c2: 3 }],
    });
    expect(right[0].Заказ).toBe('1-сорт');
    expect(right[1].Заказ).toBe('1-сорт');
  });

  it("Sana formatlari (20.11.2026, 20/11/2026, 20112026) va raqamli ustun filtratsiyasi ishlashi kerak", () => {
    expect(normalizeDateInput('20112026')).toBe('20.11.2026');
    expect(normalizeDateInput('20/11/2026')).toBe('20.11.2026');
    expect(normalizeDateInput('20.11.2026')).toBe('20.11.2026');
    // Qo'yilgan matndagi bosh/oxirgi probel saqlanishi kerak
    expect(normalizeDateInput(' 20.11.2026 ')).toBe(' 20.11.2026 ');
    expect(normalizeCommittedCellValue('Дата упак.', '20112026')).toBe('20.11.2026');

    expect(sanitizeManualNumericInput('XS', '12ab3')).toBe('123');
    expect(sanitizeManualNumericInput('Куб.м.', '1,25kg')).toBe('1.25');
  });

  it("Ctrl+Strelka blok chetiga sakrashi, Ctrl+End oxirgi katakni topishi va D12/yig'indi ishlashi kerak", () => {
    const rows = [
      createEmptySkladRow({ id: 'r0', Заказ: 'A', XS: '10' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r1', Заказ: 'B', XS: '25' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r2', Заказ: 'C', XS: '' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r3', Заказ: '', XS: '' }, DEFAULT_DATE),
      createEmptySkladRow({ id: 'r4', Заказ: 'D', XS: '15' }, DEFAULT_DATE),
    ];

    expect(formatCellAddress({ row: 11, col: 3 })).toBe('D12');
    expect(computeCtrlJumpTarget(rows, { row: 0, col: 3 }, 1, 0)).toEqual({ row: 2, col: 3 });
    expect(computeCtrlJumpTarget(rows, { row: 2, col: 3 }, 1, 0)).toEqual({ row: 4, col: 3 });
    expect(findLastPopulatedCell(rows).row).toBe(4);

    // XS ustuni (index 12) bo'yicha yig'indi: 10 + 25 + 15 = 50
    const metrics = getSelectionMetrics(rows, {
      active: { row: 0, col: 12 },
      anchor: { row: 0, col: 12 },
      ranges: [{ r1: 0, c1: 12, r2: 4, c2: 12 }],
    });
    expect(metrics.cellCount).toBe(5);
    expect(metrics.numericCount).toBe(3);
    expect(metrics.numericSum).toBe(50);
  });
});
