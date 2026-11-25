import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Plus,
  Search,
  X,
  Trash2,
  CopyPlus,
  Image as ImageIcon,
  ClipboardPaste,
  FileText,
  CheckCircle2,
  Table as TableIcon,
  Sparkles,
  Archive,
  Eraser,
  Check,
  Layers
} from 'lucide-react';
import {
  FactoryLedgerRow,
  OrderSizeMatrix,
  SizeCellValues,
  SizePresetId,
  SIZE_PRESETS,
  COMMON_COLORS,
  ROST_OPTIONS,
  DEFAULT_MONTHS,
  getPopulatedSizes
} from '../lib/ordersSizeStore';
import { parseClipboardToGrid } from '../lib/excelPasteParser';
import { Language } from '../locales';

interface OrdersExcelGridProps {
  rows: FactoryLedgerRow[];
  savedOrdersCount?: number;
  showSavedArchive?: boolean;
  onToggleShowSavedArchive?: () => void;
  onClearEntrySheet?: () => void;
  sizeMatrices: Record<string, OrderSizeMatrix>;
  monthsList: string[];
  brandsList: string[];
  selectedRowId: string;
  onSelectRow: (rowId: string) => void;
  onUpdateRowField: (
    rowId: string,
    field: 'brand' | 'orderNo' | 'model' | 'color' | 'colorCode' | 'rost' | 'month' | 'notes' | 'qtyShipped',
    rawVal: string
  ) => void;
  onUpdateSizeCell: (rowId: string, sizeName: string, stage: keyof SizeCellValues, rawVal: string) => void;
  onUpdateDefect: (rowId: string, rawVal: string) => void;
  onAddBlankExcelRow: (sizes: string[], cloneFromRow?: FactoryLedgerRow) => string;
  onBulkPasteCells: (
    startRowIdx: number,
    startColIdx: number,
    visibleRows: FactoryLedgerRow[],
    colKeys: ExcelColumnDef[],
    stage: keyof SizeCellValues,
    pastedGrid: string[][],
    defaultSizes: string[],
    subRowTargets?: Array<{ row: FactoryLedgerRow; stage: keyof SizeCellValues }>
  ) => void;
  onStructuredExcelPaste: (parsedGrid: string[][]) => void;
  onOpenPhotoForRow: (rowId: string) => void;
  onRequestDeleteRow: (row: FactoryLedgerRow) => void;
  onExportActivePdf: () => void;
  onOpenExcelPasteTab: () => void;
  modelImages: Record<string, string>;
  hasUnsavedChanges: boolean;
  lastSavedAt: string | null;
  onNotice: (msg: string) => void;
  lang: Language;
}

export interface ExcelColumnDef {
  key: string;
  kind: 'meta' | 'size' | 'defect' | 'shipped' | 'notes';
  label: string;
  sizeName?: string;
}

const STAGE_TABS: Array<{
  id: keyof SizeCellValues;
  labelRu: string;
  labelUz: string;
  badgeCls: string;
  colHdrCls: string;
  totalCls: string;
}> = [
  {
    id: 'order',
    labelRu: 'Заказ',
    labelUz: 'Zakaz',
    badgeCls: 'bg-indigo-600 text-white border-indigo-400',
    colHdrCls: 'bg-indigo-100 text-indigo-950',
    totalCls: 'bg-indigo-100/90 text-indigo-950'
  },
  {
    id: 'cut',
    labelRu: 'Крой',
    labelUz: 'Bichuv',
    badgeCls: 'bg-sky-600 text-white border-sky-400',
    colHdrCls: 'bg-sky-100 text-sky-950',
    totalCls: 'bg-sky-100/90 text-sky-950'
  },
  {
    id: 'dist',
    labelRu: 'Раздача',
    labelUz: 'Tarqatish',
    badgeCls: 'bg-amber-500 text-slate-950 border-amber-300',
    colHdrCls: 'bg-amber-100 text-amber-950',
    totalCls: 'bg-amber-100/90 text-amber-950'
  },
  {
    id: 'sew',
    labelRu: 'Пошив',
    labelUz: 'Tikuv',
    badgeCls: 'bg-purple-600 text-white border-purple-400',
    colHdrCls: 'bg-purple-100 text-purple-950',
    totalCls: 'bg-purple-100/90 text-purple-950'
  },
  {
    id: 'pack',
    labelRu: 'Упаковка',
    labelUz: 'Qadoqlash',
    badgeCls: 'bg-emerald-600 text-white border-emerald-400',
    colHdrCls: 'bg-yellow-200 text-slate-950',
    totalCls: 'bg-yellow-100 text-slate-950'
  }
];

function getExcelColLetter(idx: number): string {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

const STAGE_ORDER: Array<keyof SizeCellValues> = ['order', 'cut', 'dist', 'sew', 'pack'];

export default function OrdersExcelGrid({
  rows,
  savedOrdersCount = 0,
  showSavedArchive = false,
  onToggleShowSavedArchive,
  onClearEntrySheet,
  sizeMatrices,
  monthsList,
  brandsList,
  selectedRowId,
  onSelectRow,
  onUpdateRowField,
  onUpdateSizeCell,
  onUpdateDefect,
  onAddBlankExcelRow,
  onBulkPasteCells,
  onStructuredExcelPaste,
  onOpenPhotoForRow,
  onRequestDeleteRow,
  onExportActivePdf,
  onOpenExcelPasteTab,
  modelImages,
  hasUnsavedChanges,
  lastSavedAt,
  onNotice,
  lang
}: OrdersExcelGridProps) {
  const isUz = lang === 'uz';
  const [selectedStages, setSelectedStages] = useState<Array<keyof SizeCellValues>>(['order']);
  const activeStage: keyof SizeCellValues = selectedStages[0] || 'order';
  const isMultiStage = selectedStages.length > 1;
  const allStagesSelected = selectedStages.length === STAGE_ORDER.length;

  const [activePresetId, setActivePresetId] = useState<Exclude<SizePresetId, 'custom'>>('alpha_xs_3xl');
  const [customAddedSizes, setCustomAddedSizes] = useState<string[]>([]);
  const [newSizeDraft, setNewSizeDraft] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [activeCellCoord, setActiveCellCoord] = useState<{ r: number; c: number } | null>(null);
  const [anchorCell, setAnchorCell] = useState<{ r: number; c: number } | null>(null);
  const [rangeEndCell, setRangeEndCell] = useState<{ r: number; c: number } | null>(null);
  const [colorDropdown, setColorDropdown] = useState<{
    rowId: string;
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const suppressFocusResetRef = useRef<boolean>(false);
  const manualCaretRef = useRef<boolean>(false);

  useEffect(() => {
    const onWinMouseUp = () => {
      isDraggingRef.current = false;
    };
    const onWinResize = () => setColorDropdown(null);
    window.addEventListener('mouseup', onWinMouseUp);
    window.addEventListener('resize', onWinResize);
    return () => {
      window.removeEventListener('mouseup', onWinMouseUp);
      window.removeEventListener('resize', onWinResize);
    };
  }, []);

  const toggleStageSelection = (stageId: keyof SizeCellValues) => {
    setSelectedStages(prev => {
      const exists = prev.includes(stageId);
      if (exists) {
        if (prev.length === 1) return prev;
        return STAGE_ORDER.filter(s => s !== stageId && prev.includes(s));
      }
      return STAGE_ORDER.filter(s => s === stageId || prev.includes(s));
    });
  };

  const isolateStage = (stageId: keyof SizeCellValues) => {
    setSelectedStages([stageId]);
  };

  const toggleAllStages = () => {
    setSelectedStages(prev => (prev.length === STAGE_ORDER.length ? ['order'] : [...STAGE_ORDER]));
  };

  // Стабильный ID для пустой стартовой строки, чтобы при первом нажатии фокус не сбрасывался
  const [blankStarterId, setBlankStarterId] = useState<string>(
    () => `ord-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );

  useEffect(() => {
    if (rows.some(r => r.id === blankStarterId)) {
      setBlankStarterId(`ord-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    }
  }, [rows, blankStarterId]);

  const starterBlankRow = useMemo<FactoryLedgerRow>(
    () => ({
      id: blankStarterId,
      brand: '',
      orderNo: '',
      model: '',
      color: '',
      colorCode: '',
      rost: '',
      qtyOrder: 0,
      qtyCut: 0,
      qtyDistribution: 0,
      qtySewing: 0,
      qtyPackaging: 0,
      qtyDefect: 0,
      qtyTotalPack: 0,
      difference: 0,
      qtyShipped: 0,
      qtyStock: 0,
      percent: 0,
      month: monthsList[0] || DEFAULT_MONTHS[0],
      notes: ''
    }),
    [blankStarterId, monthsList]
  );

  const filteredRows = useMemo(() => {
    if (rows.length === 0 && !showSavedArchive && !searchTerm.trim() && monthFilter === 'all' && brandFilter === 'all') {
      return [starterBlankRow];
    }
    const q = searchTerm.trim().toLowerCase();
    return rows.filter(r => {
      if (monthFilter !== 'all' && r.month !== monthFilter) return false;
      if (brandFilter !== 'all' && (r.brand || '') !== brandFilter) return false;
      if (q) {
        const hay = `${r.orderNo} ${r.model} ${r.color} ${r.colorCode || ''} ${r.brand || ''} ${r.rost || ''} ${r.month}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, showSavedArchive, searchTerm, monthFilter, brandFilter, starterBlankRow]);

  // Combine selected preset sizes + any populated/custom sizes present in visible rows so no entered values disappear
  const visibleSizes = useMemo(() => {
    const base = [...SIZE_PRESETS[activePresetId].sizes];
    const extraSet = new Set<string>(base);
    customAddedSizes.forEach(s => {
      if (s.trim()) extraSet.add(s.trim());
    });
    filteredRows.forEach(r => {
      const m = sizeMatrices[r.id];
      if (!m) return;
      getPopulatedSizes(m).forEach(sz => {
        if (!extraSet.has(sz)) extraSet.add(sz);
      });
    });
    return Array.from(extraSet);
  }, [activePresetId, customAddedSizes, filteredRows, sizeMatrices]);

  const editableColumns = useMemo<ExcelColumnDef[]>(() => {
    const metaCols: ExcelColumnDef[] = [
      { key: 'month', kind: 'meta', label: isUz ? 'Oy' : 'Месяц' },
      { key: 'brand', kind: 'meta', label: isUz ? 'Brend' : 'Бренд' },
      { key: 'orderNo', kind: 'meta', label: isUz ? 'Zakaz №' : 'Заказ №' },
      { key: 'model', kind: 'meta', label: isUz ? 'Model' : 'Модель' },
      { key: 'color', kind: 'meta', label: isUz ? 'Rang' : 'Цвет' },
      { key: 'colorCode', kind: 'meta', label: isUz ? 'Artikul' : 'Артикул' },
      { key: 'rost', kind: 'meta', label: isUz ? 'Rost' : 'Рост' }
    ];
    const sizeCols: ExcelColumnDef[] = visibleSizes.map(sz => ({
      key: `sz:${sz}`,
      kind: 'size',
      label: sz,
      sizeName: sz
    }));
    const tailCols: ExcelColumnDef[] = [
      { key: 'defect', kind: 'defect', label: isUz ? 'Brak' : 'Брак' },
      { key: 'qtyShipped', kind: 'shipped', label: isUz ? "Jo'nat." : 'Отгр.' },
      { key: 'notes', kind: 'notes', label: isUz ? 'Izoh' : 'Прим.' }
    ];
    return [...metaCols, ...sizeCols, ...tailCols];
  }, [visibleSizes, isUz]);

  const activeStageMeta = STAGE_TABS.find(s => s.id === activeStage) || STAGE_TABS[0];

  const displayedSubRows = useMemo(() => {
    const list: Array<{
      row: FactoryLedgerRow;
      orderIdx: number;
      stage: keyof SizeCellValues;
      stageSubIdx: number;
      isFirstSubRow: boolean;
      isLastSubRow: boolean;
      visualR: number;
    }> = [];
    let visualR = 0;
    filteredRows.forEach((row, orderIdx) => {
      selectedStages.forEach((st, stageSubIdx) => {
        list.push({
          row,
          orderIdx,
          stage: st,
          stageSubIdx,
          isFirstSubRow: stageSubIdx === 0,
          isLastSubRow: stageSubIdx === selectedStages.length - 1,
          visualR: visualR++
        });
      });
    });
    return list;
  }, [filteredRows, selectedStages]);

  const activeRowObj = useMemo(() => {
    return filteredRows.find(r => r.id === selectedRowId) || filteredRows[0] || null;
  }, [filteredRows, selectedRowId]);

  const totalsSummary = useMemo(() => {
    const sizeTotalsByStage = {} as Record<keyof SizeCellValues, Record<string, number>>;
    const stageGrandTotals = {} as Record<keyof SizeCellValues, number>;
    STAGE_ORDER.forEach(st => {
      sizeTotalsByStage[st] = {};
      visibleSizes.forEach(sz => {
        sizeTotalsByStage[st][sz] = 0;
      });
      stageGrandTotals[st] = 0;
    });

    let totalDefect = 0;
    let totalShipped = 0;
    let totalStock = 0;

    filteredRows.forEach(r => {
      const m = sizeMatrices[r.id];
      STAGE_ORDER.forEach(st => {
        visibleSizes.forEach(sz => {
          const v = Number(m?.values?.[sz]?.[st]) || 0;
          sizeTotalsByStage[st][sz] += v;
          stageGrandTotals[st] += v;
        });
      });
      totalDefect += r.qtyDefect || 0;
      totalShipped += r.qtyShipped || 0;
      totalStock += r.qtyStock || 0;
    });

    return {
      sizeTotals: sizeTotalsByStage[activeStage],
      stageGrandTotal: stageGrandTotals[activeStage],
      sizeTotalsByStage,
      stageGrandTotals,
      totalDefect,
      totalShipped,
      totalStock
    };
  }, [filteredRows, sizeMatrices, visibleSizes, activeStage]);

  const normRange = useMemo(() => {
    if (!anchorCell || !rangeEndCell) return null;
    return {
      minR: Math.min(anchorCell.r, rangeEndCell.r),
      maxR: Math.max(anchorCell.r, rangeEndCell.r),
      minC: Math.min(anchorCell.c, rangeEndCell.c),
      maxC: Math.max(anchorCell.c, rangeEndCell.c)
    };
  }, [anchorCell, rangeEndCell]);

  const selectedCellCount = normRange
    ? (normRange.maxR - normRange.minR + 1) * (normRange.maxC - normRange.minC + 1)
    : activeCellCoord
    ? 1
    : 0;

  const isCellInRange = (r: number, c: number) => {
    if (!normRange) return false;
    return r >= normRange.minR && r <= normRange.maxR && c >= normRange.minC && c <= normRange.maxC;
  };

  const getCellRawValue = (
    row: FactoryLedgerRow,
    colDef: ExcelColumnDef,
    stageForRow: keyof SizeCellValues = activeStage
  ): string => {
    if (colDef.kind === 'size' && colDef.sizeName) {
      const v = sizeMatrices[row.id]?.values?.[colDef.sizeName]?.[stageForRow] ?? 0;
      return v > 0 ? String(v) : '';
    }
    if (colDef.kind === 'defect') {
      const d = sizeMatrices[row.id]?.defect ?? row.qtyDefect ?? 0;
      return d > 0 ? String(d) : '';
    }
    if (colDef.kind === 'shipped') {
      return row.qtyShipped > 0 ? String(row.qtyShipped) : '';
    }
    if (colDef.kind === 'notes') {
      return row.notes || '';
    }
    switch (colDef.key) {
      case 'month':
        return row.month || DEFAULT_MONTHS[0];
      case 'brand':
        return row.brand || '';
      case 'orderNo':
        return row.orderNo || '';
      case 'model':
        return row.model || '';
      case 'color':
        return row.color || '';
      case 'colorCode':
        return row.colorCode || '';
      case 'rost':
        return row.rost || '';
      default:
        return '';
    }
  };

  const setCellRawValue = (
    row: FactoryLedgerRow,
    colDef: ExcelColumnDef,
    val: string,
    stageForRow: keyof SizeCellValues = activeStage
  ) => {
    if (colDef.kind === 'size' && colDef.sizeName) {
      onUpdateSizeCell(row.id, colDef.sizeName, stageForRow, val);
    } else if (colDef.kind === 'defect') {
      onUpdateDefect(row.id, val);
    } else if (colDef.kind === 'shipped') {
      onUpdateRowField(row.id, 'qtyShipped', val);
    } else if (colDef.kind === 'notes') {
      onUpdateRowField(row.id, 'notes', val);
    } else if (
      colDef.key === 'month' ||
      colDef.key === 'brand' ||
      colDef.key === 'orderNo' ||
      colDef.key === 'model' ||
      colDef.key === 'color' ||
      colDef.key === 'colorCode' ||
      colDef.key === 'rost'
    ) {
      onUpdateRowField(row.id, colDef.key, val);
    }
  };

  const focusCell = (rIdx: number, cIdx: number, preserveRange = false, dirR: 1 | -1 = 1) => {
    const maxR = Math.max(0, displayedSubRows.length - 1);
    const clampedR = Math.max(0, Math.min(maxR, rIdx));
    const clampedC = Math.max(0, Math.min(editableColumns.length - 1, cIdx));

    let foundR = clampedR;
    let el = document.querySelector<HTMLInputElement>(
      `input[data-og-r="${foundR}"][data-og-c="${clampedC}"]`
    );

    if (!el && displayedSubRows.length > 0) {
      // Handle rowSpan meta/tail cells by stepping in movement direction, then opposite if at boundary
      for (let step = 1; step <= selectedStages.length; step++) {
        const probe = clampedR + step * dirR;
        if (probe >= 0 && probe <= maxR) {
          const cand = document.querySelector<HTMLInputElement>(
            `input[data-og-r="${probe}"][data-og-c="${clampedC}"]`
          );
          if (cand) {
            el = cand;
            foundR = probe;
            break;
          }
        }
      }
      if (!el) {
        for (let step = 1; step <= selectedStages.length; step++) {
          const probe = clampedR - step * dirR;
          if (probe >= 0 && probe <= maxR) {
            const cand = document.querySelector<HTMLInputElement>(
              `input[data-og-r="${probe}"][data-og-c="${clampedC}"]`
            );
            if (cand) {
              el = cand;
              foundR = probe;
              break;
            }
          }
        }
      }
    }

    if (el) {
      if (preserveRange) {
        suppressFocusResetRef.current = true;
        setRangeEndCell({ r: foundR, c: clampedC });
      } else {
        setAnchorCell({ r: foundR, c: clampedC });
        setRangeEndCell({ r: foundR, c: clampedC });
      }
      setActiveCellCoord({ r: foundR, c: clampedC });
      el.focus();
      if (!preserveRange) {
        el.select();
      }
    }
  };

  const handleAddInlineRow = (cloneSource?: FactoryLedgerRow) => {
    const newId = onAddBlankExcelRow(visibleSizes, cloneSource);
    onSelectRow(newId);
    setTimeout(() => {
      const targetEl = document.querySelector<HTMLInputElement>(`input[data-row-id="${newId}"][data-col-key="orderNo"]`);
      if (targetEl) {
        const r = Number(targetEl.dataset.ogR ?? 0);
        const c = Number(targetEl.dataset.ogC ?? 2);
        setActiveCellCoord({ r, c });
        setAnchorCell({ r, c });
        setRangeEndCell({ r, c });
        targetEl.focus();
        targetEl.select();
      }
    }, 30);
  };

  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rIdx: number,
    cIdx: number
  ) => {
    const maxR = Math.max(0, displayedSubRows.length - 1);
    const maxC = editableColumns.length - 1;

    // Multi-cell Copy (Ctrl+C / Cmd+C)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && normRange && selectedCellCount > 1) {
      e.preventDefault();
      const lines: string[] = [];
      for (let r = normRange.minR; r <= normRange.maxR; r++) {
        const sub = displayedSubRows[r];
        if (!sub) continue;
        const cells: string[] = [];
        for (let c = normRange.minC; c <= normRange.maxC; c++) {
          const colDef = editableColumns[c];
          if (!colDef) {
            cells.push('');
          } else if (colDef.kind !== 'size' && !sub.isFirstSubRow) {
            cells.push('');
          } else {
            cells.push(getCellRawValue(sub.row, colDef, sub.stage));
          }
        }
        lines.push(cells.join('\t'));
      }
      const tsv = lines.join('\n');
      navigator.clipboard?.writeText(tsv).catch(() => {});
      onNotice(
        isUz
          ? `Nusxalandi: ${selectedCellCount} ta katak`
          : `Скопировано ячеек: ${selectedCellCount}`
      );
      return;
    }

    // Multi-cell Delete / Backspace
    if ((e.key === 'Delete' || e.key === 'Backspace') && normRange && selectedCellCount > 1) {
      e.preventDefault();
      for (let r = normRange.minR; r <= normRange.maxR; r++) {
        const sub = displayedSubRows[r];
        if (!sub) continue;
        for (let c = normRange.minC; c <= normRange.maxC; c++) {
          const colDef = editableColumns[c];
          if (!colDef) continue;
          if (colDef.kind === 'size' || sub.isFirstSubRow) {
            setCellRawValue(sub.row, colDef, '', sub.stage);
          }
        }
      }
      onNotice(
        isUz
          ? `Tozalandi: ${selectedCellCount} ta katak`
          : `Очищено ячеек: ${selectedCellCount}`
      );
      return;
    }

    // Shift + Arrow Excel Range Selection
    if (e.shiftKey && ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) {
      e.preventDefault();
      const baseAnchor = anchorCell || { r: rIdx, c: cIdx };
      const curEnd = rangeEndCell || { r: rIdx, c: cIdx };
      let endR = curEnd.r;
      let endC = curEnd.c;
      let dir: 1 | -1 = 1;
      if (e.key === 'ArrowDown') {
        endR = Math.min(maxR, curEnd.r + 1);
        dir = 1;
      } else if (e.key === 'ArrowUp') {
        endR = Math.max(0, curEnd.r - 1);
        dir = -1;
      } else if (e.key === 'ArrowRight') {
        endC = Math.min(maxC, curEnd.c + 1);
      } else if (e.key === 'ArrowLeft') {
        endC = Math.max(0, curEnd.c - 1);
      }

      manualCaretRef.current = false;
      setAnchorCell(baseAnchor);
      setRangeEndCell({ r: endR, c: endC });
      focusCell(endR, endC, true, dir);
      return;
    }

    let nextR = rIdx;
    let nextC = cIdx;
    let dirR: 1 | -1 = 1;

    if (e.key === 'F2') {
      e.preventDefault();
      manualCaretRef.current = true;
      const len = e.currentTarget.value.length;
      e.currentTarget.setSelectionRange(len, len);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (colorDropdown) {
        setColorDropdown(null);
        return;
      }
      manualCaretRef.current = false;
      e.currentTarget.blur();
      setActiveCellCoord(null);
      setAnchorCell(null);
      setRangeEndCell(null);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      setColorDropdown(null);
      if (e.shiftKey) {
        nextR = Math.max(0, rIdx - 1);
        dirR = -1;
      } else if (rIdx < maxR) {
        nextR = rIdx + 1;
        dirR = 1;
      } else {
        const newId = onAddBlankExcelRow(visibleSizes, undefined);
        onSelectRow(newId);
        setTimeout(() => {
          const el =
            document.querySelector<HTMLInputElement>(
              `input[data-row-id="${newId}"][data-og-c="${cIdx}"]`
            ) ||
            document.querySelector<HTMLInputElement>(
              `input[data-row-id="${newId}"][data-col-key="orderNo"]`
            );
          if (el) {
            const newR = Number(el.dataset.ogR ?? 0);
            const newC = Number(el.dataset.ogC ?? cIdx);
            setActiveCellCoord({ r: newR, c: newC });
            setAnchorCell({ r: newR, c: newC });
            setRangeEndCell({ r: newR, c: newC });
            el.focus();
            el.select();
          }
        }, 35);
        return;
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setColorDropdown(null);
      nextR = Math.min(maxR, rIdx + 1);
      dirR = 1;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setColorDropdown(null);
      nextR = Math.max(0, rIdx - 1);
      dirR = -1;
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setColorDropdown(null);
      if (e.shiftKey) {
        if (cIdx > 0) nextC = cIdx - 1;
        else if (rIdx > 0) {
          nextR = rIdx - 1;
          nextC = maxC;
          dirR = -1;
        }
      } else {
        if (cIdx < maxC) nextC = cIdx + 1;
        else if (rIdx < maxR) {
          nextR = rIdx + 1;
          nextC = 0;
          dirR = 1;
        }
      }
    } else if (e.key === 'ArrowRight') {
      const selAll = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === e.currentTarget.value.length;
      const atEnd = e.currentTarget.selectionStart === e.currentTarget.value.length;
      if (!manualCaretRef.current || selAll || atEnd) {
        e.preventDefault();
        setColorDropdown(null);
        if (cIdx < maxC) nextC = cIdx + 1;
        else if (rIdx < maxR) {
          nextR = rIdx + 1;
          nextC = 0;
          dirR = 1;
        }
      } else {
        return;
      }
    } else if (e.key === 'ArrowLeft') {
      const selAll = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === e.currentTarget.value.length;
      const atStart = e.currentTarget.selectionStart === 0;
      if (!manualCaretRef.current || selAll || atStart) {
        e.preventDefault();
        setColorDropdown(null);
        if (cIdx > 0) nextC = cIdx - 1;
        else if (rIdx > 0) {
          nextR = rIdx - 1;
          nextC = maxC;
          dirR = -1;
        }
      } else {
        return;
      }
    } else {
      return;
    }

    manualCaretRef.current = false;
    focusCell(nextR, nextC, false, dirR);
  };

  const handleCellPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    rIdx: number,
    cIdx: number
  ) => {
    const html = e.clipboardData?.getData('text/html') || '';
    const text = e.clipboardData?.getData('text') || '';
    if (!text.includes('\t') && !text.includes('\n')) return;

    const parsedGrid = parseClipboardToGrid(html, text);
    if (parsedGrid.length === 0) return;

    // If pasted table contains multi-column header keywords (e.g. "Заказ", "Модель", "XS", "Упаковка"), open smart parser sheet
    const firstRowStr = (parsedGrid[0] || []).join(' ');
    const hasHeaderRow = /(заказ|модел|цвет|крой|разд|пошив|упак|этикет|xs|xl|всего)/i.test(firstRowStr);
    if (hasHeaderRow && parsedGrid.length >= 2) {
      e.preventDefault();
      onStructuredExcelPaste(parsedGrid);
      return;
    }

    e.preventDefault();
    const subRowTargets = displayedSubRows.map(s => ({ row: s.row, stage: s.stage }));
    onBulkPasteCells(
      rIdx,
      cIdx,
      filteredRows,
      editableColumns,
      displayedSubRows[rIdx]?.stage || activeStage,
      parsedGrid,
      visibleSizes,
      subRowTargets
    );
  };

  const handleAddCustomSize = () => {
    const clean = newSizeDraft.trim();
    if (!clean) return;
    if (!visibleSizes.includes(clean)) {
      setCustomAddedSizes(prev => [...prev, clean]);
    }
    setNewSizeDraft('');
    onNotice(
      isUz
        ? `Razmer ustuni qo'shildi: «${clean}»`
        : `Добавлен столбец размера «${clean}»`
    );
  };

  const activeCellAddress =
    normRange && selectedCellCount > 1
      ? `${getExcelColLetter(normRange.minC)}${normRange.minR + 1}:${getExcelColLetter(normRange.maxC)}${normRange.maxR + 1}`
      : activeCellCoord
      ? `${getExcelColLetter(activeCellCoord.c)}${activeCellCoord.r + 1}`
      : 'A1';

  return (
    <div className="space-y-2.5 animate-fadeIn">
      <datalist id="excel-months-datalist">
        {monthsList.map(m => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id="excel-brands-datalist">
        {brandsList.map(b => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <datalist id="excel-rost-datalist">
        {ROST_OPTIONS.map(ro => (
          <option key={ro} value={ro} />
        ))}
      </datalist>

      {/* Компактный выпадающий список цветов (небольшой по высоте и удобный для выбора) */}
      {colorDropdown && (() => {
        const targetRow = filteredRows.find(r => r.id === colorDropdown.rowId);
        const rawQuery = (targetRow?.color || '').trim().toLowerCase();
        const exactMatch = COMMON_COLORS.some(c => c.toLowerCase() === rawQuery);
        const filteredColors =
          !rawQuery || exactMatch
            ? COMMON_COLORS
            : COMMON_COLORS.filter(c => c.toLowerCase().includes(rawQuery));
        const optionsToShow = filteredColors.length > 0 ? filteredColors : COMMON_COLORS;
        return (
          <div
            style={{
              top: colorDropdown.top,
              left: colorDropdown.left,
              width: Math.max(138, Math.min(176, colorDropdown.width + 24))
            }}
            className="fixed z-50 bg-white border border-slate-300 rounded-lg shadow-xl max-h-36 overflow-y-auto py-1 text-slate-900"
          >
            {optionsToShow.map(c => {
              const isSelected = (targetRow?.color || '').toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  onMouseDown={e => {
                    e.preventDefault();
                    onUpdateRowField(colorDropdown.rowId, 'color', c);
                    setColorDropdown(null);
                  }}
                  className={`w-full px-2.5 py-1 text-left text-[11px] font-bold flex items-center justify-between transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-100 text-indigo-950'
                      : 'hover:bg-slate-100 text-slate-800'
                  }`}
                >
                  <span className="truncate">{c}</span>
                  {isSelected && <Check className="w-3 h-3 text-indigo-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* ПАНЕЛЬ УПРАВЛЕНИЯ EXCEL-ТАБЛИЦЕЙ */}
      <div className="bg-slate-900/85 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-xl space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Этапы ввода (Все сразу или выборочно: Заказ / Крой / Раздача / Пошив / Упаковка) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-300 mr-0.5 flex items-center gap-1.5">
              <TableIcon className="w-3.5 h-3.5 text-emerald-400" />
              <span>{lang === 'uz' ? 'Bosqich:' : 'Этап ввода:'}</span>
            </span>

            <button
              type="button"
              onClick={toggleAllStages}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-black border cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 ${
                allStagesSelected
                  ? 'bg-emerald-500 text-slate-950 border-emerald-300 shadow-md'
                  : 'bg-slate-950/90 text-emerald-300 border-emerald-700/60 hover:bg-slate-800 hover:border-emerald-400'
              }`}
              title={
                isUz
                  ? "Barcha bosqichlarni birdaniga kiritish uchun ochish/yopish"
                  : 'Включить или отключить ввод сразу по всем этапам'
              }
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{isUz ? 'Barchasi' : 'Все этапы'}</span>
            </button>

            {STAGE_TABS.map(st => {
              const isAct = selectedStages.includes(st.id);
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => toggleStageSelection(st.id)}
                  onDoubleClick={() => isolateStage(st.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-black border cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 ${
                    isAct
                      ? `${st.badgeCls} shadow-md`
                      : 'bg-slate-950/90 text-slate-300 border-slate-700 hover:bg-slate-800 hover:text-white'
                  }`}
                  title={
                    isUz
                      ? 'Bosish — qo‘shish/olib tashlash • Ikki marta bosish — faqat shu bosqich'
                      : 'Клик — добавить/убрать этап • Двойной клик — только этот этап'
                  }
                >
                  <span
                    className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center ${
                      isAct ? 'bg-white/25 border-white/60' : 'border-slate-600 bg-slate-900'
                    }`}
                  >
                    {isAct && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <span>{lang === 'uz' ? st.labelUz : st.labelRu}</span>
                </button>
              );
            })}
          </div>

          {/* Кнопки быстрого добавления строк и экспорта */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleAddInlineRow()}
              className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black rounded-lg text-xs flex items-center gap-1.5 cursor-pointer shadow whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Yangi qator' : 'Добавить строку'}</span>
            </button>

            {activeRowObj && (
              <button
                type="button"
                onClick={() => handleAddInlineRow(activeRowObj)}
                className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer whitespace-nowrap"
                title={isUz ? 'Tanlangan zakazga yangi rang / rost qo‘shish' : 'Добавить новый цвет / рост к выбранному заказу'}
              >
                <CopyPlus className="w-3.5 h-3.5" />
                <span>{isUz ? '+ Rang / rost' : '+ Цвет / рост'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenExcelPasteTab}
              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer whitespace-nowrap"
              title={isUz ? 'Excel’dan murakkab jadvallarni joylash' : 'Мастер вставки сложных таблиц из Excel'}
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span>{isUz ? 'Ctrl+V varaq' : 'Ctrl+V лист'}</span>
            </button>

            {activeRowObj && (
              <button
                type="button"
                onClick={onExportActivePdf}
                className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer whitespace-nowrap"
                title={isUz ? 'Tanlangan zakaz PDF faylini yuklab olish' : 'Скачать PDF выбранного заказа'}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
            )}
          </div>
        </div>

        {/* Строка выбора размерной сетки и фильтров */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-bold uppercase text-slate-400 mr-1">
              {isUz ? 'Razmerlar:' : 'Размеры:'}
            </span>
            {(Object.keys(SIZE_PRESETS) as Exclude<SizePresetId, 'custom'>[]).map(pKey => (
              <button
                key={pKey}
                type="button"
                onClick={() => setActivePresetId(pKey)}
                className={`px-2 py-1 rounded-md text-[11px] font-bold border cursor-pointer transition-colors whitespace-nowrap ${
                  activePresetId === pKey
                    ? 'bg-cyan-500 text-slate-950 border-cyan-300 font-black'
                    : 'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                {SIZE_PRESETS[pKey].shortLabel}
              </button>
            ))}

            <div className="flex items-center gap-1 pl-1.5">
              <input
                type="text"
                value={newSizeDraft}
                onChange={e => setNewSizeDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddCustomSize();
                }}
                placeholder={isUz ? '+ razmer' : '+ размер'}
                className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-[11px] text-white font-mono focus:border-amber-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCustomSize}
                className="px-2 py-1 bg-slate-800 hover:bg-amber-400 hover:text-slate-950 text-amber-300 border border-slate-700 rounded-md text-[11px] font-black cursor-pointer"
                title={isUz ? "Jadvalga yangi razmer ustuni qo'shish" : 'Добавить свой столбец размера в таблицу'}
              >
                +
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder={isUz ? 'Qidirish №, model, rang...' : 'Поиск №, модель, цвет...'}
                className="pl-7 pr-6 py-1 bg-slate-950 border border-slate-700 rounded-md text-[11px] text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none w-44"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <select
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              className="px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-[11px] text-cyan-300 font-bold focus:outline-none cursor-pointer"
            >
              <option value="all">{isUz ? 'Barcha oylar' : 'Все месяцы'}</option>
              {monthsList.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>

            <select
              value={brandFilter}
              onChange={e => setBrandFilter(e.target.value)}
              className="px-2 py-1 bg-slate-950 border border-slate-700 rounded-md text-[11px] text-indigo-300 font-bold focus:outline-none cursor-pointer"
            >
              <option value="all">{isUz ? 'Barcha brendlar' : 'Все бренды'}</option>
              {brandsList.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            {rows.length > 0 && !showSavedArchive && onClearEntrySheet && (
              <button
                type="button"
                onClick={onClearEntrySheet}
                className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-600 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                title={
                  isUz
                    ? "Yangi zakaz kiritish uchun varaqni tozalash (saqlanganlar bazada qoladi)"
                    : 'Очистить лист для ввода нового заказа (сохранённые заказы останутся в базе)'
                }
              >
                <Eraser className="w-3 h-3" />
                <span>{isUz ? 'Yangi toza jadval' : 'Чистый лист'}</span>
              </button>
            )}

            {savedOrdersCount > 0 && onToggleShowSavedArchive && (
              <button
                type="button"
                onClick={onToggleShowSavedArchive}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold border flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap ${
                  showSavedArchive
                    ? 'bg-amber-400 text-slate-950 border-amber-300 font-black'
                    : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-500'
                }`}
                title={
                  isUz
                    ? "Avval saqlangan zakazlarni ko'rsatish yoki yashirish"
                    : 'Показать или скрыть ранее сохранённые заказы'
                }
              >
                <Archive className="w-3 h-3" />
                <span>
                  {showSavedArchive
                    ? (isUz ? 'Yangi zakazlarga qaytish' : 'Скрыть старые')
                    : `${isUz ? 'Avvalgi zakazlar' : 'Старые заказы'} (${savedOrdersCount})`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ЛИСТ В СТИЛЕ MICROSOFT EXCEL */}
      <div className="bg-white border-2 border-slate-700 rounded-xl shadow-2xl overflow-hidden text-slate-950">
        {/* Строка формул / адрес активной ячейки Excel */}
        <div className="bg-[#f3f4f6] border-b border-slate-300 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 bg-white border border-slate-400 rounded font-mono font-black text-slate-900 min-w-[54px] text-center">
              {activeCellAddress}
            </span>
            {selectedCellCount > 1 && (
              <span className="px-2 py-0.5 bg-blue-100 border border-blue-300 rounded font-bold text-blue-900 text-[11px]">
                {isUz ? `${selectedCellCount} katak` : `Выбрано: ${selectedCellCount}`}
              </span>
            )}
            <span className="text-slate-400 font-serif italic font-bold px-1">fx</span>
            <span className="text-slate-700 font-semibold">
              {isUz ? (
                <>
                  Excel kabi belgilash: <strong>Shift + ↓ ↑ ← →</strong>, <strong>Shift + Klik</strong>, <strong>Ctrl+C / Ctrl+V</strong>, <strong>Delete</strong>
                </>
              ) : (
                <>
                  Выделение как в Excel: <strong>Shift + ↓ ↑ ← →</strong>, <strong>Shift + Клик</strong>, <strong>Ctrl+C / Ctrl+V</strong>, <strong>Delete</strong>
                </>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {activeRowObj && (
              <div className="hidden xl:flex items-center gap-1.5 text-[11px] font-mono bg-white border border-slate-300 rounded px-2 py-0.5">
                <span className="font-bold text-slate-700">
                  {activeRowObj.orderNo || (isUz ? '№ yo‘q' : 'Без №')}:
                </span>
                <button type="button" onClick={() => toggleStageSelection('order')} className="hover:underline text-indigo-700 font-bold cursor-pointer">
                  {isUz ? 'Zak' : 'Зак'}:{activeRowObj.qtyOrder}
                </button>
                <span className="text-slate-300">|</span>
                <button type="button" onClick={() => toggleStageSelection('cut')} className="hover:underline text-sky-700 font-bold cursor-pointer">
                  {isUz ? 'Kroy' : 'Крой'}:{activeRowObj.qtyCut}
                </button>
                <span className="text-slate-300">|</span>
                <button type="button" onClick={() => toggleStageSelection('dist')} className="hover:underline text-amber-700 font-bold cursor-pointer">
                  {isUz ? 'Taqs' : 'Разд'}:{activeRowObj.qtyDistribution}
                </button>
                <span className="text-slate-300">|</span>
                <button type="button" onClick={() => toggleStageSelection('sew')} className="hover:underline text-purple-700 font-bold cursor-pointer">
                  {isUz ? 'Tikuv' : 'Пошив'}:{activeRowObj.qtySewing}
                </button>
                <span className="text-slate-300">|</span>
                <button type="button" onClick={() => toggleStageSelection('pack')} className="hover:underline text-emerald-700 font-bold cursor-pointer">
                  {isUz ? 'Qad' : 'Упак'}:{activeRowObj.qtyPackaging}
                </button>
              </div>
            )}

            {hasUnsavedChanges ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 border border-amber-400 text-amber-950 font-bold text-[11px]">
                <Sparkles className="w-3 h-3 text-amber-700" />
                <span>{isUz ? 'Saqlanmagan (Ctrl+S)' : 'Не сохранено (Ctrl+S)'}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 border border-emerald-400 text-emerald-900 font-bold text-[11px]">
                <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                <span>
                  {lastSavedAt
                    ? isUz
                      ? `Saqlangan ${lastSavedAt}`
                      : `Сохранено ${lastSavedAt}`
                    : isUz
                    ? 'Saqlangan'
                    : 'Сохранено'}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Основная прокручиваемая таблица Excel */}
        <div
          onScroll={() => {
            if (colorDropdown) setColorDropdown(null);
          }}
          className="overflow-x-auto max-h-[68vh] overflow-y-auto"
        >
          <table className="w-full border-collapse text-xs font-sans select-none">
            <thead className="sticky top-0 z-20 shadow-xs">
              {/* Заголовки столбцов Excel (A, B, C...) */}
              <tr className="bg-[#e5e7eb] text-slate-600 text-[10px] font-mono font-bold select-none">
                <th className="border border-slate-300 px-1.5 py-0.5 w-9 text-center bg-[#d1d5db]">#</th>
                {editableColumns.map((col, idx) => {
                  const colHighlighted =
                    normRange ? idx >= normRange.minC && idx <= normRange.maxC : activeCellCoord?.c === idx;
                  return (
                    <React.Fragment key={`xl-let-${col.key}`}>
                      {isMultiStage && idx === 7 && (
                        <th className="border border-slate-300 px-1 py-0.5 text-center bg-[#e5e7eb] text-slate-500">
                          •
                        </th>
                      )}
                      <th
                        className={`border border-slate-300 px-1 py-0.5 text-center ${
                          colHighlighted ? 'bg-blue-200 text-blue-950' : ''
                        }`}
                      >
                        {getExcelColLetter(idx)}
                      </th>
                    </React.Fragment>
                  );
                })}
                <th className="border border-slate-300 px-1 py-0.5 text-center">Σ</th>
                <th className="border border-slate-300 px-1 py-0.5 text-center">{isUz ? 'Qol' : 'Ост'}</th>
                <th className="border border-slate-300 px-1 py-0.5 text-center">%</th>
                <th className="border border-slate-300 px-1 py-0.5 text-center">—</th>
              </tr>

              {/* Названия колонок */}
              <tr className="bg-[#f8fafc] text-slate-900 font-black text-[11px] uppercase tracking-tight">
                <th className="border border-slate-400 px-2 py-2 bg-[#e2e8f0] text-center">№</th>
                <th className="border border-slate-400 px-2 py-2 min-w-[118px] text-left">{isUz ? 'Oy' : 'Месяц'}</th>
                <th className="border border-slate-400 px-2 py-2 min-w-[115px] text-left">{isUz ? 'Brend' : 'Бренд'}</th>
                <th className="border border-slate-400 px-2 py-2 min-w-[115px] text-left">{isUz ? 'Zakaz №' : 'Заказ №'}</th>
                <th className="border border-slate-400 px-2 py-2 min-w-[130px] text-left">{isUz ? 'Model' : 'Модель'}</th>
                <th className="border border-slate-400 px-2 py-2 min-w-[105px] text-left">{isUz ? 'Rang' : 'Цвет'}</th>
                <th className="border border-slate-400 px-2 py-2 min-w-[88px] text-left">{isUz ? 'Artikul' : 'Артикул'}</th>
                <th className="border border-slate-400 px-2 py-2 min-w-[82px] text-center">{isUz ? 'Rost' : 'Рост'}</th>
                {isMultiStage && (
                  <th className="border border-slate-400 px-2 py-2 min-w-[86px] text-center bg-slate-200 text-slate-900">
                    {isUz ? 'Bosqich' : 'Этап'}
                  </th>
                )}
                {visibleSizes.map(sz => (
                  <th
                    key={`xl-h-${sz}`}
                    className={`border border-slate-400 px-1.5 py-2 min-w-[58px] text-center font-black ${
                      isMultiStage ? 'bg-slate-100 text-slate-950' : activeStageMeta.colHdrCls
                    }`}
                  >
                    <div>{sz}</div>
                    <div className="text-[9px] font-bold opacity-75 normal-case">
                      {isMultiStage
                        ? `${selectedStages.length} ${isUz ? 'bosqich' : 'эт.'}`
                        : isUz
                        ? activeStageMeta.labelUz
                        : activeStageMeta.labelRu}
                    </div>
                  </th>
                ))}
                <th
                  className={`border border-slate-400 px-2.5 py-2 min-w-[74px] text-center font-black ${
                    isMultiStage ? 'bg-slate-200 text-slate-950' : activeStageMeta.totalCls
                  }`}
                >
                  {isUz ? 'JAMI' : 'ВСЕГО'}
                </th>
                <th className="border border-slate-400 px-2 py-2 min-w-[62px] text-center text-rose-800 bg-rose-50">
                  {isUz ? 'Brak' : 'Брак'}
                </th>
                <th className="border border-slate-400 px-2 py-2 min-w-[68px] text-center text-emerald-900 bg-emerald-50">
                  {isUz ? "Jo'nat." : 'Отгр.'}
                </th>
                <th className="border border-slate-400 px-2 py-2 min-w-[68px] text-center text-indigo-900 bg-indigo-50">
                  {isUz ? 'Qoldiq' : 'Остаток'}
                </th>
                <th className="border border-slate-400 px-2 py-2 min-w-[56px] text-center bg-emerald-50 text-emerald-950">
                  {isUz ? 'Yop%' : 'Закр%'}
                </th>
                <th className="border border-slate-400 px-2 py-2 min-w-[125px] text-left">
                  {isUz ? 'Izoh' : 'Примечание'}
                </th>
                <th className="border border-slate-400 px-2 py-2 min-w-[80px] text-center">
                  {isUz ? 'Amallar' : 'Действия'}
                </th>
              </tr>
            </thead>

            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={editableColumns.length + (isMultiStage ? 6 : 5)}
                    className="border border-slate-300 px-6 py-12 text-center bg-slate-50"
                  >
                    <div className="max-w-md mx-auto space-y-3">
                      <p className="text-sm font-black text-slate-800">
                        {rows.length === 0
                          ? (isUz ? 'Buyurtmalar jadvali hozircha bo‘sh' : 'Таблица заказов пока пуста')
                          : (isUz ? "Tanlangan filtr bo'yicha qator topilmadi" : 'По выбранному фильтру строки не найдены')}
                      </p>
                      <p className="text-xs text-slate-600">
                        {isUz
                          ? 'Yangi qator qo‘shing yoki Excel’dan Ctrl+V orqali ma’lumotlarni joylang.'
                          : 'Добавьте первую строку заказа прямо в таблицу или вставьте данные через Ctrl+V.'}
                      </p>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAddInlineRow()}
                          className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black rounded-lg text-xs inline-flex items-center gap-1.5 cursor-pointer shadow"
                        >
                          <Plus className="w-4 h-4" />
                          <span>{isUz ? 'Birinchi qatorni qo‘shish' : 'Добавить первую строку'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={onOpenExcelPasteTab}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <ClipboardPaste className="w-4 h-4" />
                          <span>{isUz ? 'Excel’dan joylash' : 'Вставить из Excel'}</span>
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                displayedSubRows.map(sub => {
                  const { row, orderIdx, stage, isFirstSubRow, isLastSubRow, visualR: rIdx } = sub;
                  const matrix = sizeMatrices[row.id];
                  const isRowSelected = row.id === selectedRowId;
                  const stMeta = STAGE_TABS.find(s => s.id === stage) || STAGE_TABS[0];
                  const rowSpanCount = selectedStages.length;
                  const rowStageTotal = visibleSizes.reduce(
                    (sum, sz) => sum + (Number(matrix?.values?.[sz]?.[stage]) || 0),
                    0
                  );
                  const hasPhoto = Boolean(modelImages[row.id] || modelImages[row.model]);

                  const openColorDropdownForEl = (el: HTMLInputElement) => {
                    const rect = el.getBoundingClientRect();
                    const openUpward = window.innerHeight - rect.bottom < 160;
                    setColorDropdown({
                      rowId: row.id,
                      top: openUpward ? Math.max(8, rect.top - 148) : rect.bottom + 2,
                      left: Math.min(rect.left, Math.max(8, window.innerWidth - 180)),
                      width: rect.width
                    });
                  };

                  const renderEditableCell = (
                    cIdx: number,
                    colKey: string,
                    val: string,
                    onChangeVal: (v: string) => void,
                    opts?: {
                      placeholder?: string;
                      listId?: string;
                      align?: 'left' | 'center';
                      extraInputCls?: string;
                      tdBgCls?: string;
                      rowSpan?: number;
                      isColorField?: boolean;
                    }
                  ) => {
                    const isActive = activeCellCoord?.r === rIdx && activeCellCoord?.c === cIdx;
                    const inRange = isCellInRange(rIdx, cIdx);
                    const isMultiRange = inRange && selectedCellCount > 1 && normRange !== null;
                    const topEdge = isMultiRange && rIdx === normRange!.minR ? 'border-t-2 border-t-blue-600' : '';
                    const botEdge = isMultiRange && rIdx === normRange!.maxR ? 'border-b-2 border-b-blue-600' : '';
                    const leftEdge = isMultiRange && cIdx === normRange!.minC ? 'border-l-2 border-l-blue-600' : '';
                    const rightEdge = isMultiRange && cIdx === normRange!.maxC ? 'border-r-2 border-r-blue-600' : '';

                    return (
                      <td
                        key={`${row.id}-${stage}-${colKey}`}
                        rowSpan={opts?.rowSpan && opts.rowSpan > 1 ? opts.rowSpan : undefined}
                        onMouseEnter={() => {
                          if (isDraggingRef.current) {
                            setRangeEndCell({ r: rIdx, c: cIdx });
                            setActiveCellCoord({ r: rIdx, c: cIdx });
                          }
                        }}
                        className={`p-0 border border-slate-300 align-middle ${opts?.tdBgCls || ''} ${
                          isMultiRange
                            ? `bg-sky-100/80 ${topEdge} ${botEdge} ${leftEdge} ${rightEdge}`
                            : isActive
                            ? 'ring-2 ring-inset ring-blue-600 bg-sky-50/70'
                            : ''
                        }`}
                      >
                        <input
                          type="text"
                          data-og-r={rIdx}
                          data-og-c={cIdx}
                          data-row-id={row.id}
                          data-col-key={colKey}
                          list={opts?.listId}
                          value={val}
                          placeholder={opts?.placeholder ?? ''}
                          onMouseDown={e => {
                            if (e.shiftKey && (anchorCell || activeCellCoord)) {
                              e.preventDefault();
                              const baseAnchor = anchorCell || activeCellCoord!;
                              suppressFocusResetRef.current = true;
                              isDraggingRef.current = true;
                              setAnchorCell(baseAnchor);
                              setRangeEndCell({ r: rIdx, c: cIdx });
                              setActiveCellCoord({ r: rIdx, c: cIdx });
                              e.currentTarget.focus();
                            } else {
                              isDraggingRef.current = true;
                              setAnchorCell({ r: rIdx, c: cIdx });
                              setRangeEndCell({ r: rIdx, c: cIdx });
                              setActiveCellCoord({ r: rIdx, c: cIdx });
                            }
                            if (opts?.isColorField) {
                              openColorDropdownForEl(e.currentTarget);
                            }
                          }}
                          onFocus={e => {
                            setActiveCellCoord({ r: rIdx, c: cIdx });
                            if (!suppressFocusResetRef.current) {
                              if (!isDraggingRef.current) {
                                setAnchorCell({ r: rIdx, c: cIdx });
                                setRangeEndCell({ r: rIdx, c: cIdx });
                              }
                              e.currentTarget.select();
                            }
                            suppressFocusResetRef.current = false;
                            onSelectRow(row.id);
                            if (opts?.isColorField) {
                              openColorDropdownForEl(e.currentTarget);
                            } else if (colorDropdown) {
                              setColorDropdown(null);
                            }
                          }}
                          onBlur={() => {
                            if (opts?.isColorField) {
                              setColorDropdown(null);
                            }
                          }}
                          onDoubleClick={() => {
                            manualCaretRef.current = true;
                          }}
                          onChange={e => onChangeVal(e.target.value)}
                          onKeyDown={e => handleCellKeyDown(e, rIdx, cIdx)}
                          onPaste={e => handleCellPaste(e, rIdx, cIdx)}
                          className={`w-full px-1.5 py-1.5 bg-transparent focus:outline-none text-xs ${
                            opts?.align === 'center' ? 'text-center' : 'text-left'
                          } ${opts?.extraInputCls || 'text-slate-950 font-semibold'}`}
                        />
                      </td>
                    );
                  };

                  let colCounter = 7;
                  const defectColIdx = 7 + visibleSizes.length;
                  const shippedColIdx = defectColIdx + 1;
                  const notesColIdx = defectColIdx + 2;

                  return (
                    <tr
                      key={`${row.id}-${stage}`}
                      onClick={() => onSelectRow(row.id)}
                      className={`${isRowSelected ? 'bg-amber-50/65' : 'bg-white hover:bg-slate-50/90'} ${
                        isMultiStage && isLastSubRow ? 'border-b-2 border-b-slate-500' : ''
                      }`}
                    >
                      {isFirstSubRow && (
                        <>
                          <td
                            rowSpan={rowSpanCount > 1 ? rowSpanCount : undefined}
                            className={`border border-slate-300 px-1.5 py-1.5 text-center font-mono text-[11px] font-bold select-none align-middle ${
                              isRowSelected ? 'bg-amber-200 text-slate-950' : 'bg-[#f1f5f9] text-slate-600'
                            }`}
                          >
                            {orderIdx + 1}
                          </td>

                          {renderEditableCell(
                            0,
                            'month',
                            row.month || DEFAULT_MONTHS[0],
                            v => onUpdateRowField(row.id, 'month', v),
                            { listId: 'excel-months-datalist', extraInputCls: 'font-semibold text-cyan-900', rowSpan: rowSpanCount }
                          )}
                          {renderEditableCell(
                            1,
                            'brand',
                            row.brand || '',
                            v => onUpdateRowField(row.id, 'brand', v),
                            { listId: 'excel-brands-datalist', placeholder: isUz ? 'Brend' : 'Бренд', extraInputCls: 'font-bold text-indigo-950', rowSpan: rowSpanCount }
                          )}
                          {renderEditableCell(
                            2,
                            'orderNo',
                            row.orderNo || '',
                            v => onUpdateRowField(row.id, 'orderNo', v),
                            { placeholder: isUz ? 'Zakaz №' : '№ заказа', extraInputCls: 'font-mono font-black text-slate-950', rowSpan: rowSpanCount }
                          )}
                          {renderEditableCell(
                            3,
                            'model',
                            row.model || '',
                            v => onUpdateRowField(row.id, 'model', v),
                            { placeholder: isUz ? 'Model' : 'Модель', extraInputCls: 'font-bold text-slate-900', rowSpan: rowSpanCount }
                          )}
                          {renderEditableCell(
                            4,
                            'color',
                            row.color || '',
                            v => onUpdateRowField(row.id, 'color', v),
                            { isColorField: true, placeholder: isUz ? 'Rang' : 'Цвет', extraInputCls: 'font-bold text-slate-900', rowSpan: rowSpanCount }
                          )}
                          {renderEditableCell(
                            5,
                            'colorCode',
                            row.colorCode || '',
                            v => onUpdateRowField(row.id, 'colorCode', v),
                            { placeholder: isUz ? 'Artikul' : 'Артикул', extraInputCls: 'font-mono text-slate-700', rowSpan: rowSpanCount }
                          )}
                          {renderEditableCell(
                            6,
                            'rost',
                            row.rost || '',
                            v => onUpdateRowField(row.id, 'rost', v),
                            { listId: 'excel-rost-datalist', placeholder: isUz ? 'Rost' : 'Рост', align: 'center', extraInputCls: 'font-mono font-bold text-slate-800', rowSpan: rowSpanCount }
                          )}
                        </>
                      )}

                      {isMultiStage && (
                        <td className={`border border-slate-300 px-1.5 py-1 text-center font-black text-[10px] whitespace-nowrap ${stMeta.colHdrCls}`}>
                          {isUz ? stMeta.labelUz : stMeta.labelRu}
                        </td>
                      )}

                      {visibleSizes.map(sz => {
                        const val = matrix?.values?.[sz]?.[stage] ?? 0;
                        const cIdx = colCounter++;
                        return renderEditableCell(
                          cIdx,
                          `sz:${sz}`,
                          val > 0 ? String(val) : '',
                          v => onUpdateSizeCell(row.id, sz, stage, v),
                          {
                            placeholder: '0',
                            align: 'center',
                            extraInputCls:
                              stage === 'pack'
                                ? 'font-mono tabular-nums font-black text-slate-950 placeholder:text-slate-300'
                                : 'font-mono tabular-nums font-bold text-slate-950 placeholder:text-slate-300',
                            tdBgCls: stage === 'pack' ? 'bg-yellow-50/70' : ''
                          }
                        );
                      })}

                      {/* ВСЕГО для этапа строки */}
                      <td className={`border border-slate-300 px-2 py-1.5 text-center font-mono tabular-nums font-black ${stMeta.totalCls}`}>
                        {rowStageTotal}
                      </td>

                      {isFirstSubRow && (
                        <>
                          {/* Брак */}
                          {renderEditableCell(
                            defectColIdx,
                            'defect',
                            (matrix?.defect ?? row.qtyDefect) > 0 ? String(matrix?.defect ?? row.qtyDefect) : '',
                            v => onUpdateDefect(row.id, v),
                            {
                              placeholder: '0',
                              align: 'center',
                              tdBgCls: 'bg-rose-50/40',
                              extraInputCls: 'font-mono tabular-nums font-bold text-rose-700 placeholder:text-rose-200',
                              rowSpan: rowSpanCount
                            }
                          )}

                          {/* Отгрузка */}
                          {renderEditableCell(
                            shippedColIdx,
                            'qtyShipped',
                            row.qtyShipped > 0 ? String(row.qtyShipped) : '',
                            v => onUpdateRowField(row.id, 'qtyShipped', v),
                            {
                              placeholder: '0',
                              align: 'center',
                              tdBgCls: 'bg-emerald-50/40',
                              extraInputCls: 'font-mono tabular-nums font-bold text-emerald-800 placeholder:text-emerald-200',
                              rowSpan: rowSpanCount
                            }
                          )}

                          {/* Остаток на складе */}
                          <td
                            rowSpan={rowSpanCount > 1 ? rowSpanCount : undefined}
                            className="border border-slate-300 px-2 py-1.5 text-center font-mono tabular-nums font-black bg-indigo-50/60 text-indigo-950 align-middle"
                          >
                            {row.qtyStock}
                          </td>

                          {/* Закр % */}
                          <td
                            rowSpan={rowSpanCount > 1 ? rowSpanCount : undefined}
                            className="border border-slate-300 px-1.5 py-1.5 text-center font-mono tabular-nums font-black text-[11px] bg-emerald-50/70 text-emerald-900 align-middle"
                          >
                            {row.percent}%
                          </td>

                          {/* Примечание */}
                          {renderEditableCell(
                            notesColIdx,
                            'notes',
                            row.notes || '',
                            v => onUpdateRowField(row.id, 'notes', v),
                            { placeholder: isUz ? 'Izoh...' : 'Примечание...', extraInputCls: 'text-slate-700', rowSpan: rowSpanCount }
                          )}

                          {/* Действия */}
                          <td
                            rowSpan={rowSpanCount > 1 ? rowSpanCount : undefined}
                            className="border border-slate-300 px-1.5 py-1 text-center align-middle"
                            onClick={e => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleAddInlineRow(row)}
                                className="p-1 rounded bg-indigo-100 hover:bg-indigo-600 text-indigo-800 hover:text-white cursor-pointer"
                                title={isUz ? "Yangi rang/rost uchun zakazni nusxalash" : 'Дублировать заказ для нового цвета/роста'}
                              >
                                <CopyPlus className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectRow(row.id);
                                  onOpenPhotoForRow(row.id);
                                }}
                                className={`p-1 rounded cursor-pointer ${
                                  hasPhoto
                                    ? 'bg-amber-200 text-amber-950'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                }`}
                                title={isUz ? 'Model rasmi / eskizi' : 'Фото / эскиз модели'}
                              >
                                <ImageIcon className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (rows.some(r => r.id === row.id)) {
                                    onRequestDeleteRow(row);
                                  } else {
                                    setBlankStarterId(`ord-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
                                  }
                                }}
                                className="p-1 rounded bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white cursor-pointer"
                                title={isUz ? "Qatorni o'chirish" : 'Удалить строку'}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>

            {filteredRows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                {selectedStages.map((st, sIdx) => {
                  const stMeta = STAGE_TABS.find(s => s.id === st) || STAGE_TABS[0];
                  const stageSizes = totalsSummary.sizeTotalsByStage[st];
                  const stageGrand = totalsSummary.stageGrandTotals[st];
                  return (
                    <tr key={`tot-${st}`} className="bg-[#ffff00] text-slate-950 font-black text-xs">
                      {sIdx === 0 && (
                        <td
                          colSpan={8}
                          rowSpan={isMultiStage ? selectedStages.length : undefined}
                          className="border border-slate-400 px-3 py-2 text-right uppercase align-middle"
                        >
                          {isUz ? 'JAMI' : 'ИТОГО'} ({filteredRows.length} {isUz ? 'qator' : 'стр.'}
                          {!isMultiStage && ` • ${isUz ? stMeta.labelUz : stMeta.labelRu}`}):
                        </td>
                      )}
                      {isMultiStage && (
                        <td className={`border border-slate-400 px-1.5 py-1.5 text-center font-black text-[10px] ${stMeta.colHdrCls}`}>
                          {isUz ? stMeta.labelUz : stMeta.labelRu}
                        </td>
                      )}
                      {visibleSizes.map(sz => (
                        <td key={`xl-tot-${st}-${sz}`} className="border border-slate-400 px-1.5 py-1.5 text-center font-mono tabular-nums">
                          {stageSizes[sz] > 0 ? stageSizes[sz].toLocaleString() : '0'}
                        </td>
                      ))}
                      <td className="border border-slate-400 px-2.5 py-1.5 text-center font-mono tabular-nums text-sm">
                        {stageGrand.toLocaleString()}
                      </td>
                      {sIdx === 0 && (
                        <>
                          <td
                            rowSpan={isMultiStage ? selectedStages.length : undefined}
                            className="border border-slate-400 px-2 py-2 text-center font-mono tabular-nums text-rose-800 align-middle"
                          >
                            {totalsSummary.totalDefect.toLocaleString()}
                          </td>
                          <td
                            rowSpan={isMultiStage ? selectedStages.length : undefined}
                            className="border border-slate-400 px-2 py-2 text-center font-mono tabular-nums text-emerald-900 align-middle"
                          >
                            {totalsSummary.totalShipped.toLocaleString()}
                          </td>
                          <td
                            rowSpan={isMultiStage ? selectedStages.length : undefined}
                            className="border border-slate-400 px-2 py-2 text-center font-mono tabular-nums text-indigo-950 align-middle"
                          >
                            {totalsSummary.totalStock.toLocaleString()}
                          </td>
                          <td
                            colSpan={3}
                            rowSpan={isMultiStage ? selectedStages.length : undefined}
                            className="border border-slate-400 px-2 py-2 text-left text-[11px] font-bold align-middle"
                          >
                            <button
                              type="button"
                              onClick={() => handleAddInlineRow()}
                              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-amber-300 rounded font-black inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>{isUz ? 'Yangi qator' : 'Добавить строку'}</span>
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
