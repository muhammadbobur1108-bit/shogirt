import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FileSpreadsheet,
  ClipboardPaste,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Check,
  Ruler
} from 'lucide-react';
import {
  SizeCellValues,
  SizePresetId,
  SIZE_PRESETS,
  COMMON_COLORS
} from '../lib/ordersSizeStore';
import {
  parseClipboardToGrid,
  parsePastedProductionGrid,
  ParsedExcelGridResult,
  ParsedExcelOrderItem
} from '../lib/excelPasteParser';
import { Language } from '../locales';

interface ExcelPasteSheetProps {
  monthsList: string[];
  brandsList: string[];
  defaultMonth: string;
  initialGrid?: string[][] | null;
  onConsumeInitialGrid?: () => void;
  onApplyParsedItems: (items: ParsedExcelOrderItem[], mergeExisting: boolean) => void;
  onNotice: (msg: string) => void;
  lang?: Language;
}

const DEFAULT_ROWS = 26;
const DEFAULT_COLS = 18;

function getColLetter(idx: number): string {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function createBlankGrid(rows = DEFAULT_ROWS, cols = DEFAULT_COLS): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
}

export default function ExcelPasteSheet({
  monthsList,
  brandsList,
  defaultMonth,
  initialGrid,
  onConsumeInitialGrid,
  onApplyParsedItems,
  onNotice,
  lang = 'ru'
}: ExcelPasteSheetProps) {
  const isUz = lang === 'uz';
  const [sheetGrid, setSheetGrid] = useState<string[][]>(() => createBlankGrid());
  const [activeCell, setActiveCell] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [mergeExisting, setMergeExisting] = useState(true);

  // Параметры по умолчанию (если в скопированном фрагменте нет Заказа / Модели / Бренда / Месяца)
  const [defMonth, setDefMonth] = useState<string>(defaultMonth || monthsList[0] || 'Сентябрь 2026');
  const [defBrand, setDefBrand] = useState<string>('');
  const [defOrderNo, setDefOrderNo] = useState<string>('');
  const [defModel, setDefModel] = useState<string>('');
  const [defColor, setDefColor] = useState<string>('');
  const [defRost, setDefRost] = useState<string>('');
  const [singleStageTarget, setSingleStageTarget] = useState<keyof SizeCellValues>('order');
  const [fallbackPresetId, setFallbackPresetId] = useState<Exclude<SizePresetId, 'custom'>>('alpha_xs_3xl');

  const sheetWrapRef = useRef<HTMLDivElement>(null);

  // Если таблица пришла через Ctrl+V напрямую из обычной матрицы размеров
  useEffect(() => {
    if (!initialGrid || initialGrid.length === 0) return;
    const targetRows = Math.max(DEFAULT_ROWS, initialGrid.length + 4);
    const maxPasteCols = initialGrid.reduce((m, r) => Math.max(m, r.length), 0);
    const targetCols = Math.max(DEFAULT_COLS, maxPasteCols + 2);
    const next = createBlankGrid(targetRows, targetCols);
    initialGrid.forEach((row, rIdx) => {
      row.forEach((val, cIdx) => {
        next[rIdx][cIdx] = val;
      });
    });
    setSheetGrid(next);
    setActiveCell({ r: 0, c: 0 });
    onConsumeInitialGrid?.();
  }, [initialGrid, onConsumeInitialGrid]);

  const rowCount = sheetGrid.length;
  const colCount = sheetGrid[0]?.length || DEFAULT_COLS;

  const hasAnyContent = useMemo(
    () => sheetGrid.some(row => row.some(cell => cell.trim() !== '')),
    [sheetGrid]
  );

  // Живое распознавание структуры Excel-листа при любом изменении
  const parsedResult: ParsedExcelGridResult = useMemo(() => {
    return parsePastedProductionGrid(sheetGrid, {
      month: defMonth || monthsList[0] || 'Сентябрь 2026',
      brand: defBrand,
      orderNo: defOrderNo,
      model: defModel,
      defaultColor: defColor,
      defaultRost: defRost,
      singleStageTarget,
      fallbackSizes: SIZE_PRESETS[fallbackPresetId].sizes
    });
  }, [sheetGrid, defMonth, defBrand, defOrderNo, defModel, defColor, defRost, singleStageTarget, fallbackPresetId, monthsList]);

  const applyGridPasteAt = (pasted: string[][], startR: number, startC: number) => {
    if (!pasted || pasted.length === 0) return;
    const pasteCols = pasted.reduce((m, row) => Math.max(m, row.length), 0);
    const neededRows = Math.max(sheetGrid.length, startR + pasted.length + 3);
    const neededCols = Math.max(colCount, startC + pasteCols + 2);

    const next = Array.from({ length: neededRows }, (_, r) => {
      const existingRow = sheetGrid[r] || [];
      const row = new Array(neededCols).fill('');
      for (let c = 0; c < Math.min(neededCols, existingRow.length); c++) {
        row[c] = existingRow[c] || '';
      }
      return row;
    });

    pasted.forEach((pRow, rOff) => {
      pRow.forEach((val, cOff) => {
        next[startR + rOff][startC + cOff] = val;
      });
    });

    setSheetGrid(next);
    onNotice(
      isUz
        ? `Excel’dan joylandi: ${pasted.length} qator × ${pasteCols} ustun.`
        : `Вставлено из Excel: ${pasted.length} стр. × ${pasteCols} стлб.`
    );
  };

  const handleSheetPaste = (e: React.ClipboardEvent, originR?: number, originC?: number) => {
    const html = e.clipboardData?.getData('text/html') || '';
    const plain = e.clipboardData?.getData('text/plain') || e.clipboardData?.getData('text') || '';
    if (!plain && !html) return;

    const pastedGrid = parseClipboardToGrid(html, plain);
    if (pastedGrid.length === 0) return;

    // Если одиночное значение без табуляции/переносов и пользователь уже печатает в input
    if (pastedGrid.length === 1 && pastedGrid[0].length === 1 && originR !== undefined && originC !== undefined) {
      return;
    }

    e.preventDefault();
    const r0 = originR !== undefined ? originR : hasAnyContent ? activeCell.r : 0;
    const c0 = originC !== undefined ? originC : hasAnyContent ? activeCell.c : 0;
    applyGridPasteAt(pastedGrid, r0, c0);
  };

  const handlePasteButtonClick = async () => {
    try {
      if (navigator.clipboard && 'read' in navigator.clipboard) {
        try {
          const clipItems = await navigator.clipboard.read();
          let html = '';
          let plain = '';
          for (const item of clipItems) {
            if (item.types.includes('text/html')) {
              const blob = await item.getType('text/html');
              html = await blob.text();
            }
            if (item.types.includes('text/plain')) {
              const blob = await item.getType('text/plain');
              plain = await blob.text();
            }
          }
          const pastedGrid = parseClipboardToGrid(html, plain);
          if (pastedGrid.length > 0) {
            const r0 = hasAnyContent ? activeCell.r : 0;
            const c0 = hasAnyContent ? activeCell.c : 0;
            applyGridPasteAt(pastedGrid, r0, c0);
            return;
          }
        } catch {
          // fallback below to readText
        }
      }

      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        const pastedGrid = parseClipboardToGrid('', text);
        if (pastedGrid.length > 0) {
          const r0 = hasAnyContent ? activeCell.r : 0;
          const c0 = hasAnyContent ? activeCell.c : 0;
          applyGridPasteAt(pastedGrid, r0, c0);
          return;
        }
      }
      onNotice(
        isUz
          ? 'Istalgan katakka (masalan A1) bosib Ctrl+V bosing.'
          : 'Нажмите Ctrl+V прямо на любую ячейку листа (например A1).'
      );
    } catch {
      onNotice(
        isUz
          ? 'Brauzer tugma orqali o‘qishni chekladi — A1 katakka bosib Ctrl+V bosing.'
          : 'Браузер ограничил доступ к кнопке — кликните ячейку A1 и нажмите Ctrl+V.'
      );
    }
  };

  const updateCell = (r: number, c: number, val: string) => {
    setSheetGrid(prev => {
      const next = prev.map((row, rIdx) => {
        if (rIdx !== r) return row;
        const copy = [...row];
        copy[c] = val;
        return copy;
      });
      return next;
    });
  };

  const moveFocus = (nextR: number, nextC: number) => {
    const clampedR = Math.max(0, Math.min(rowCount - 1, nextR));
    const clampedC = Math.max(0, Math.min(colCount - 1, nextC));
    setActiveCell({ r: clampedR, c: clampedC });
    const el = document.querySelector<HTMLInputElement>(
      `input[data-xl-r="${clampedR}"][data-xl-c="${clampedC}"]`
    );
    if (el) {
      el.focus();
      el.select();
    }
  };

  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      moveFocus(r + 1, c);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(r - 1, c);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      moveFocus(r, e.shiftKey ? c - 1 : c + 1);
    } else if (e.key === 'ArrowRight') {
      const el = e.currentTarget;
      if (el.selectionStart === el.value.length) {
        e.preventDefault();
        moveFocus(r, c + 1);
      }
    } else if (e.key === 'ArrowLeft') {
      const el = e.currentTarget;
      if (el.selectionStart === 0) {
        e.preventDefault();
        moveFocus(r, c - 1);
      }
    } else if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  };

  const activeCellLabel = `${getColLetter(activeCell.c)}${activeCell.r + 1}`;
  const activeCellValue = sheetGrid[activeCell.r]?.[activeCell.c] || '';

  return (
    <div
      ref={sheetWrapRef}
      onPaste={e => {
        // Ловим Ctrl+V даже если фокус не в конкретном input, а на самом листе
        if ((e.target as HTMLElement)?.tagName !== 'INPUT') {
          handleSheetPaste(e, hasAnyContent ? activeCell.r : 0, hasAnyContent ? activeCell.c : 0);
        }
      }}
      tabIndex={0}
      className="space-y-3 focus:outline-none animate-fadeIn"
    >
      {/* ПАНЕЛЬ ПАРАМЕТРОВ ПО УМОЛЧАНИЮ ДЛЯ EXCEL-ВСТАВКИ */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs font-black text-white">
              {isUz
                ? 'Jadvallarni joylash uchun erkin Excel varag‘i (Ctrl+V)'
                : 'Свободная Excel-среда для вставки таблиц (Ctrl+V)'}
            </span>
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              {isUz
                ? '• Bosqichli jadvallar, rang/rost ro‘yxatlari, vertikal razmerlar va yig‘ma jadvallarni taniydi'
                : '• Поддерживает таблицы с этапами, списки цветов/ростов, вертикальные размеры и сводные таблицы'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handlePasteButtonClick}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span>{isUz ? 'Joylash (Ctrl+V)' : 'Вставить (Ctrl+V)'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSheetGrid(createBlankGrid());
                setActiveCell({ r: 0, c: 0 });
                onNotice(isUz ? 'Excel varaq tozalandi' : 'Excel-лист очищен');
              }}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>{isUz ? 'Varaqni tozalash' : 'Очистить лист'}</span>
            </button>
          </div>
        </div>

        {/* Поля по умолчанию (используются, если в скопированном куске их нет) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-[11px] pt-2 border-t border-slate-800">
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">
              {isUz ? 'Oy' : 'Месяц'}
            </label>
            <select
              value={defMonth}
              onChange={e => setDefMonth(e.target.value)}
              className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-cyan-300 font-bold focus:outline-none cursor-pointer"
            >
              {monthsList.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[9px] font-bold text-indigo-300 uppercase block mb-0.5">
              {isUz ? 'Brend (standart)' : 'Бренд (по умолч.)'}
            </label>
            <select
              value={defBrand}
              onChange={e => setDefBrand(e.target.value)}
              className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-indigo-200 font-bold focus:outline-none cursor-pointer"
            >
              <option value="">{isUz ? '— Avto / Brendsiz —' : '— Авто / Без бренда —'}</option>
              {brandsList.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">
              {isUz ? 'Zakaz № (bo‘lmasa)' : 'Заказ № (если не указан)'}
            </label>
            <input
              type="text"
              value={defOrderNo}
              onChange={e => setDefOrderNo(e.target.value)}
              placeholder={isUz ? 'Masalan: ZLL-363-714' : 'Напр.: ZLL-363-714'}
              className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-white font-mono focus:border-amber-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">
              {isUz ? 'Model (bo‘lmasa)' : 'Модель (если не указана)'}
            </label>
            <input
              type="text"
              value={defModel}
              onChange={e => setDefModel(e.target.value)}
              placeholder={isUz ? 'Masalan: LI2304_01' : 'Напр.: LI2304_01'}
              className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-white focus:border-amber-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">
              {isUz ? 'Rang (bo‘lmasa)' : 'Цвет (если не указан)'}
            </label>
            <input
              type="text"
              list="xl-common-colors"
              value={defColor}
              onChange={e => setDefColor(e.target.value)}
              placeholder={isUz ? 'Asosiy...' : 'Основной...'}
              className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-white focus:border-amber-400 focus:outline-none"
            />
            <datalist id="xl-common-colors">
              {COMMON_COLORS.map(c => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">
              {isUz ? 'Bosqich' : 'Этап (для таблиц без этапа)'}
            </label>
            <select
              value={singleStageTarget}
              onChange={e => setSingleStageTarget(e.target.value as keyof SizeCellValues)}
              className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-amber-300 font-bold focus:outline-none cursor-pointer"
            >
              <option value="order">{isUz ? 'Buyurtma' : 'Заказ'}</option>
              <option value="cut">{isUz ? 'Kroy' : 'Крой'}</option>
              <option value="dist">{isUz ? 'Taqsimot' : 'Раздача'}</option>
              <option value="sew">{isUz ? 'Tikuv' : 'Пошив'}</option>
              <option value="pack">{isUz ? 'Qadoqlash' : 'Упаковка'}</option>
            </select>
          </div>
          <div>
            <label className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">
              {isUz ? 'Razmer to‘ri' : 'Сетка (если без шапки)'}
            </label>
            <select
              value={fallbackPresetId}
              onChange={e => setFallbackPresetId(e.target.value as Exclude<SizePresetId, 'custom'>)}
              className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-slate-200 font-bold focus:outline-none cursor-pointer"
            >
              {(Object.keys(SIZE_PRESETS) as Exclude<SizePresetId, 'custom'>[]).map(k => (
                <option key={k} value={k}>{SIZE_PRESETS[k].shortLabel}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* РЕАЛЬНЫЙ БЕЛЫЙ EXCEL-ЛИСТ С ЯЧЕЙКАМИ, ЗАГОЛОВКАМИ A..Z И СТРОКОЙ ФОРМУЛ */}
      <div className="bg-white border border-slate-400 rounded-lg overflow-hidden shadow-xl text-slate-900">
        {/* Строка адреса и формулы Excel */}
        <div className="bg-[#f3f4f6] border-b border-slate-300 px-2 py-1 flex items-center gap-2 text-xs">
          <div className="w-16 px-2 py-1 bg-white border border-slate-300 rounded font-mono font-bold text-center text-slate-800 shrink-0">
            {activeCellLabel}
          </div>
          <span className="font-serif italic font-bold text-slate-500 px-1 select-none">fx</span>
          <input
            type="text"
            value={activeCellValue}
            onChange={e => updateCell(activeCell.r, activeCell.c, e.target.value)}
            onPaste={e => handleSheetPaste(e, activeCell.r, activeCell.c)}
            placeholder={
              isUz
                ? 'Quyidagi istalgan katakni bosing (masalan A1) va Ctrl+V qiling...'
                : 'Кликните любую ячейку таблицы ниже (например A1) и нажмите Ctrl+V...'
            }
            className="flex-1 px-2.5 py-1 bg-white border border-slate-300 rounded font-sans text-xs text-slate-900 focus:border-[#107c41] focus:outline-none"
          />
          <span className="text-[11px] font-semibold text-slate-500 hidden md:inline shrink-0">
            {isUz ? 'Varaq o‘lchami:' : 'Размер листа:'} {rowCount} × {colCount}
          </span>
        </div>

        {/* Сетка Excel A1 */}
        <div className="overflow-auto max-h-[380px] bg-white relative">
          <table className="border-collapse table-fixed select-none text-xs font-sans">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="w-10 min-w-[40px] bg-[#f3f4f6] border-r border-b border-slate-300 text-slate-500 font-bold text-[11px] sticky left-0 z-30">
                  ◢
                </th>
                {Array.from({ length: colCount }, (_, cIdx) => {
                  const isActiveCol = activeCell.c === cIdx;
                  return (
                    <th
                      key={cIdx}
                      className={`min-w-[84px] w-[84px] py-1 border-r border-b border-slate-300 font-bold text-[11px] text-center ${
                        isActiveCol
                          ? 'bg-[#d1fae5] text-[#065f46] border-b-2 border-b-[#107c41]'
                          : 'bg-[#f3f4f6] text-slate-600'
                      }`}
                    >
                      {getColLetter(cIdx)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sheetGrid.map((row, rIdx) => {
                const isActiveRow = activeCell.r === rIdx;
                return (
                  <tr key={rIdx} className="h-[24px]">
                    <td
                      className={`w-10 min-w-[40px] border-r border-b border-slate-300 text-center text-[11px] font-semibold sticky left-0 z-10 ${
                        isActiveRow
                          ? 'bg-[#d1fae5] text-[#065f46] font-bold border-r-2 border-r-[#107c41]'
                          : 'bg-[#f3f4f6] text-slate-500'
                      }`}
                    >
                      {rIdx + 1}
                    </td>
                    {row.map((val, cIdx) => {
                      const isSel = activeCell.r === rIdx && activeCell.c === cIdx;
                      return (
                        <td
                          key={cIdx}
                          className={`p-0 border-r border-b border-[#d1d5db] relative ${
                            isSel ? 'outline-2 outline-[#107c41] -outline-offset-2 z-10 bg-emerald-50/40' : ''
                          }`}
                        >
                          <input
                            type="text"
                            data-xl-r={rIdx}
                            data-xl-c={cIdx}
                            value={val}
                            onFocus={() => setActiveCell({ r: rIdx, c: cIdx })}
                            onChange={e => updateCell(rIdx, cIdx, e.target.value)}
                            onKeyDown={e => handleCellKeyDown(e, rIdx, cIdx)}
                            onPaste={e => handleSheetPaste(e, rIdx, cIdx)}
                            className="w-full h-[24px] px-1.5 text-xs text-slate-900 bg-transparent focus:outline-none font-sans truncate"
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ЖИВАЯ ПАНЕЛЬ РАСПОЗНАВАНИЯ РАЗМЕРОВ И ЭТАПОВ */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-950 border border-slate-700 text-xs font-bold text-cyan-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {isUz ? 'Avto-aniqlash' : 'Автораспознавание'}: {parsedResult.layoutLabel}
              </span>
            </span>

            {parsedResult.detectedSizes.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap text-[11px]">
                <span className="text-slate-400 font-bold flex items-center gap-1">
                  <Ruler className="w-3 h-3 text-amber-400" />
                  {isUz ? 'Razmerlar:' : 'Размеры:'}
                </span>
                {parsedResult.detectedSizes.map(sz => (
                  <span
                    key={sz}
                    className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded font-mono font-bold text-amber-300"
                  >
                    {sz}
                  </span>
                ))}
              </div>
            )}
          </div>

          {parsedResult.items.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={mergeExisting}
                  onChange={e => setMergeExisting(e.target.checked)}
                />
                <span>
                  {isUz
                    ? 'Mos kelganlarini yangilash (Zakaz + Model + Rang)'
                    : 'Обновлять совпадения (Заказ + Модель + Цвет)'}
                </span>
              </label>

              <button
                type="button"
                onClick={() => onApplyParsedItems(parsedResult.items, mergeExisting)}
                className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-lg text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Check className="w-4 h-4" />
                <span>
                  {isUz
                    ? `Zakazlarga yuklash (${parsedResult.items.length})`
                    : `Загрузить в заказы (${parsedResult.items.length})`}
                </span>
              </button>
            </div>
          )}
        </div>

        {parsedResult.warnings.length > 0 && (
          <div className="px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{parsedResult.warnings[0]}</span>
          </div>
        )}

        {parsedResult.items.length > 0 ? (
          <div className="overflow-x-auto border border-slate-800 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 text-[10px] uppercase">
                  <th className="px-2.5 py-1.5">{isUz ? 'Oy' : 'Месяц'}</th>
                  <th className="px-2.5 py-1.5">{isUz ? 'Brend' : 'Бренд'}</th>
                  <th className="px-2.5 py-1.5">{isUz ? 'Zakaz №' : 'Заказ №'}</th>
                  <th className="px-2.5 py-1.5">{isUz ? 'Model' : 'Модель'}</th>
                  <th className="px-2.5 py-1.5">{isUz ? 'Rang / Rost' : 'Цвет / Рост'}</th>
                  {parsedResult.detectedSizes.map(sz => (
                    <th key={`pv-h-${sz}`} className="px-2 py-1.5 text-right font-mono text-amber-300">
                      {sz}
                    </th>
                  ))}
                  <th className="px-2.5 py-1.5 text-right">{isUz ? 'Buyurtma' : 'Заказ'}</th>
                  <th className="px-2.5 py-1.5 text-right">{isUz ? 'Kroy' : 'Крой'}</th>
                  <th className="px-2.5 py-1.5 text-right">{isUz ? 'Taqsimot' : 'Раздача'}</th>
                  <th className="px-2.5 py-1.5 text-right">{isUz ? 'Tikuv' : 'Пошив'}</th>
                  <th className="px-2.5 py-1.5 text-right text-emerald-400">{isUz ? 'Qadoq' : 'Упаковка'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {parsedResult.items.map(item => (
                  <tr key={item.key} className="hover:bg-slate-800/40 text-slate-200">
                    <td className="px-2.5 py-1.5 whitespace-nowrap text-cyan-300">{item.month}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap text-indigo-300">{item.brand || '—'}</td>
                    <td className="px-2.5 py-1.5 font-mono font-bold text-white whitespace-nowrap">{item.orderNo}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{item.model}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      <span className="font-semibold text-amber-200">{item.color}</span>
                      {item.rost && <span className="ml-1 font-mono text-[10px] text-indigo-300">[{item.rost}]</span>}
                    </td>
                    {parsedResult.detectedSizes.map(sz => {
                      const c = item.values[sz];
                      const showVal = c ? (c.order || c.pack || c.cut || c.dist || c.sew || 0) : 0;
                      return (
                        <td key={`pv-${item.key}-${sz}`} className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-300">
                          {showVal > 0 ? showVal.toLocaleString() : '—'}
                        </td>
                      );
                    })}
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums font-bold text-white">
                      {item.totals.order.toLocaleString()}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                      {item.totals.cut.toLocaleString()}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                      {item.totals.dist.toLocaleString()}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                      {item.totals.sew.toLocaleString()}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums font-bold text-emerald-400">
                      {item.totals.pack.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-slate-400 flex items-center gap-2 py-1">
            <CheckCircle2 className="w-4 h-4 text-slate-500 shrink-0" />
            <span>
              {isUz ? (
                <>
                  Microsoft Excel’dan istalgan jadvalni nusxalab <strong className="text-slate-200">A1</strong> katakka <strong className="text-slate-200">Ctrl+V</strong> bosing — tizim razmer va bosqichlarni avtomatik taniydi.
                </>
              ) : (
                <>
                  Скопируйте любую таблицу в Microsoft Excel и нажмите <strong className="text-slate-200">Ctrl+V</strong> в ячейке <strong className="text-slate-200">A1</strong> — система автоматически распознает размеры, этапы и заказы.
                </>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
