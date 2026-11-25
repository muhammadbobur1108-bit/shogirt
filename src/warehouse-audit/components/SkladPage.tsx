// 1-sahifa: «Склад» — 15 000 qatorgacha virtualizatsiyali, Excel/Google Sheets darajasidagi to'liq interaktiv jadval

import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Plus,
  Trash2,
  CopyPlus,
  Undo2,
  Redo2,
  FileSpreadsheet,
  Download,
  ClipboardPaste,
  Search,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  X,
  DatabaseZap,
  ChevronDown,
  Scissors,
  Copy,
  ArrowDownToLine,
  ArrowUpToLine,
} from 'lucide-react';
import {
  RowValidationResult,
  SKLAD_COLUMNS,
  SkladColumnKey,
  SkladRow,
  UNVALIDATED_SKLAD_COLUMNS,
} from '../types';
import {
  exportSkladToExcel,
  importSkladFromExcelFile,
  mapMatrixToSkladRows,
  parseClipboardToMatrix,
} from '../services/excelService';
import { createEmptySkladRow } from '../validators/validators';
import {
  CellCoord,
  CellRange,
  DATE_SKLAD_COLUMNS,
  DECIMAL_SKLAD_COLUMNS,
  DROPDOWN_SKLAD_OPTIONS,
  GridSelection,
  INTEGER_SKLAD_COLUMNS,
  applyFillHandleDrag,
  applyPasteMatrixToRows,
  clampCoord,
  clearSelectedCellsInRows,
  computeAutoColumnWidth,
  computeCtrlJumpTarget,
  createSingleCellSelection,
  fillDownSelection,
  fillRightSelection,
  findLastPopulatedCell,
  formatCellAddress,
  getSelectedRowIndices,
  getSelectionMetrics,
  isCellSelected,
  isColInAnySelection,
  isRowInAnySelection,
  normalizeCommittedCellValue,
  normalizeRange,
  sanitizeManualNumericInput,
  serializeSelectionToTsv,
} from '../grid/excelGridEngine';

interface SkladPageProps {
  rows: SkladRow[];
  validations: Map<string, RowValidationResult>;
  expectedDate: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onUpdateCell: (rowId: string, field: SkladColumnKey, value: string) => void;
  onCommitRows: (nextRows: SkladRow[]) => void;
  onAddRow: (partial?: Partial<SkladRow>, afterRowId?: string) => void;
  onDeleteRows: (ids: string[]) => void;
  onAppendRows: (newRows: SkladRow[], replaceAll?: boolean) => void;
  onLoadSampleData: () => void;
  onNotify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const ROW_HEIGHT = 32;
const ROW_NUM_WIDTH = 52;
const FROZEN_COUNT = 3; // Выд (0), № тары (1), Сорт (2) -> tartib saqlanadi, № тары va Сорт muzlatiladi

const DEFAULT_COLUMN_WIDTHS: Partial<Record<SkladColumnKey, number>> = {
  Выд: 64,
  '№ тары': 86,
  Сорт: 92,
  Заказ: 135,
  Этикетка: 130,
  Модель: 155,
  Наименование: 170,
  Описание: 170,
  Группа: 120,
  Документ: 120,
  Цвет: 125,
  Всего: 78,
  'Кол.кор.': 82,
  Фабрика: 115,
  Упаковка: 115,
  'Куб.м.': 78,
  'Цвет бирки': 115,
  Надпись: 165,
  'Вес нетто': 88,
  'Вес брутто': 94,
  'Дата упак.': 108,
  'Дата склад.': 108,
  '№ отгруз.': 102,
  Примечание: 175,
};

function getInitialColWidth(col: SkladColumnKey): number {
  if (DEFAULT_COLUMN_WIDTHS[col]) return DEFAULT_COLUMN_WIDTHS[col]!;
  if (UNVALIDATED_SKLAD_COLUMNS.has(col)) return 62;
  return 110;
}

export default function SkladPage({
  rows,
  validations,
  expectedDate,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onUpdateCell,
  onCommitRows,
  onAddRow,
  onDeleteRows,
  onAppendRows,
  onLoadSampleData,
  onNotify,
}: SkladPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'error' | 'warning'>('all');
  const [orderFilter, setOrderFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [sortConfig, setSortConfig] = useState<{ key: SkladColumnKey; dir: 'asc' | 'desc' } | null>(null);

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const c of SKLAD_COLUMNS) map[c] = getInitialColWidth(c);
    return map;
  });

  const [selection, setSelection] = useState<GridSelection>({
    active: { row: 0, col: 0 },
    anchor: { row: 0, col: 0 },
    ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }],
  });

  const [editingCell, setEditingCell] = useState<{
    row: number;
    col: number;
    draft: string;
    original: string;
  } | null>(null);

  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowIdx: number;
    colIdx: number;
  } | null>(null);

  const [fillDragTarget, setFillDragTarget] = useState<{
    sourceRange: CellRange;
    targetEndRow: number;
    targetEndCol: number;
  } | null>(null);

  const [isDesktopFreeze, setIsDesktopFreeze] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 640 : true
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const editorInputRef = useRef<HTMLInputElement | null>(null);
  const mouseDragAnchorRef = useRef<CellCoord | null>(null);
  const isMouseDraggingRef = useRef(false);
  const dragModeRef = useRef<'cell' | 'row' | 'col'>('cell');
  const internalClipboardRef = useRef<string>('');

  useEffect(() => {
    const onResize = () => setIsDesktopFreeze(window.innerWidth >= 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Ustun chap pozitsiyalarini hisoblash (muzlatilgan ustunlar uchun)
  const colLeftPositions = useMemo(() => {
    const lefts: number[] = [];
    let acc = ROW_NUM_WIDTH;
    for (let i = 0; i < SKLAD_COLUMNS.length; i++) {
      lefts.push(acc);
      acc += colWidths[SKLAD_COLUMNS[i]] ?? 100;
    }
    return { lefts, totalWidth: acc };
  }, [colWidths]);

  // Zakazlar ro'yxati filtr uchun
  const distinctOrders = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const ord = (r.Заказ || '').trim();
      if (ord) set.add(ord);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Filtr va tartiblashdan keyingi ko'rinadigan qatorlar
  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const df = dateFilter.trim();

    let result = rows.filter(r => {
      const val = validations.get(r.id);
      if (statusFilter === 'error' && val?.status !== 'error') return false;
      if (statusFilter === 'warning' && val?.status !== 'warning') return false;
      if (orderFilter !== 'all' && r.Заказ.trim() !== orderFilter) return false;
      if (df && r['Дата упак.'] !== df && r['Дата склад.'] !== df) return false;
      if (q) {
        const hay = `${r['№ тары']} ${r.Заказ} ${r.Модель} ${r.Цвет} ${r.Наименование} ${r.Примечание} ${r.Документ}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortConfig) {
      const { key, dir } = sortConfig;
      const mult = dir === 'asc' ? 1 : -1;
      const isNum = INTEGER_SKLAD_COLUMNS.has(key) || DECIMAL_SKLAD_COLUMNS.has(key) || key === '№ тары';
      result = [...result].sort((a, b) => {
        const av = a[key] || '';
        const bv = b[key] || '';
        if (isNum) {
          const an = Number(av.replace(',', '.'));
          const bn = Number(bv.replace(',', '.'));
          if (Number.isFinite(an) && Number.isFinite(bn) && av !== '' && bv !== '') {
            return (an - bn) * mult;
          }
        }
        return av.localeCompare(bv) * mult;
      });
    }

    return result;
  }, [rows, validations, searchQuery, statusFilter, orderFilter, dateFilter, sortConfig]);

  const masterIndexById = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, i) => map.set(r.id, i));
    return map;
  }, [rows]);

  const stats = useMemo(() => {
    let err = 0;
    let warn = 0;
    for (const r of rows) {
      const v = validations.get(r.id);
      if (v?.status === 'error') err++;
      else if (v?.status === 'warning') warn++;
    }
    return { total: rows.length, err, warn };
  }, [rows, validations]);

  // Qatorlar o'zgarganda tanlovni chegarada ushlab turish
  useEffect(() => {
    if (visibleRows.length === 0) return;
    setSelection(prev => {
      if (!prev.active) return createSingleCellSelection(0, 0);
      const maxR = visibleRows.length - 1;
      const maxC = SKLAD_COLUMNS.length - 1;
      if (prev.active.row <= maxR && prev.ranges.every(r => r.r2 <= maxR)) return prev;
      const nextActive = clampCoord(prev.active, visibleRows.length, SKLAD_COLUMNS.length);
      const nextAnchor = clampCoord(prev.anchor ?? nextActive, visibleRows.length, SKLAD_COLUMNS.length);
      const nextRanges = prev.ranges.map(rng => ({
        r1: Math.min(rng.r1, maxR),
        c1: Math.min(rng.c1, maxC),
        r2: Math.min(rng.r2, maxR),
        c2: Math.min(rng.c2, maxC),
      }));
      return { active: nextActive, anchor: nextAnchor, ranges: nextRanges };
    });
  }, [visibleRows.length]);

  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => gridContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalVirtualHeight = rowVirtualizer.getTotalSize();

  // Faol katakni ko'rinishga keltirish
  const scrollCellIntoView = useCallback(
    (coord: CellCoord) => {
      if (visibleRows.length === 0) return;
      rowVirtualizer.scrollToIndex(coord.row, { align: 'auto' });
      const container = gridContainerRef.current;
      if (!container) return;
      const colLeft = colLeftPositions.lefts[coord.col] ?? 0;
      const colW = colWidths[SKLAD_COLUMNS[coord.col]] ?? 100;
      const frozenWidth = isDesktopFreeze ? colLeftPositions.lefts[FROZEN_COUNT] ?? ROW_NUM_WIDTH : ROW_NUM_WIDTH;

      if (coord.col >= (isDesktopFreeze ? FROZEN_COUNT : 0)) {
        const minScrollLeft = colLeft + colW - container.clientWidth + 16;
        const maxScrollLeft = colLeft - frozenWidth - 4;
        if (container.scrollLeft < minScrollLeft) {
          container.scrollLeft = minScrollLeft;
        } else if (container.scrollLeft > maxScrollLeft) {
          container.scrollLeft = Math.max(0, maxScrollLeft);
        }
      }
    },
    [visibleRows.length, rowVirtualizer, colLeftPositions, colWidths, isDesktopFreeze]
  );

  // Ko'rinadigan qatorlar ustida amal bajarganda asosiy `rows` ga aks ettirish
  const applyUpdatedVisibleRows = useCallback(
    (nextVisible: SkladRow[]) => {
      const baseLen = visibleRows.length;
      if (baseLen === rows.length && !sortConfig && statusFilter === 'all' && orderFilter === 'all' && !dateFilter && !searchQuery) {
        onCommitRows(nextVisible);
        return;
      }
      const nextMaster = [...rows];
      for (let i = 0; i < Math.min(baseLen, nextVisible.length); i++) {
        const updated = nextVisible[i];
        const mIdx = masterIndexById.get(updated.id);
        if (mIdx !== undefined) {
          nextMaster[mIdx] = updated;
        }
      }
      if (nextVisible.length > baseLen) {
        for (let i = baseLen; i < nextVisible.length; i++) {
          nextMaster.push(nextVisible[i]);
        }
      }
      onCommitRows(nextMaster);
    },
    [visibleRows.length, rows, sortConfig, statusFilter, orderFilter, dateFilter, searchQuery, masterIndexById, onCommitRows]
  );

  // Tahrirlashni boshlash
  const startEditing = useCallback(
    (rowIdx: number, colIdx: number, initialDraft?: string) => {
      const rowObj = visibleRows[rowIdx];
      if (!rowObj) return;
      const colKey = SKLAD_COLUMNS[colIdx];
      const orig = rowObj[colKey] ?? '';
      const draft = initialDraft !== undefined ? initialDraft : orig;
      setEditingCell({ row: rowIdx, col: colIdx, draft, original: orig });
      setSelection(createSingleCellSelection(rowIdx, colIdx));
    },
    [visibleRows]
  );

  useEffect(() => {
    if (editingCell && editorInputRef.current) {
      editorInputRef.current.focus();
      const len = editorInputRef.current.value.length;
      editorInputRef.current.setSelectionRange(len, len);
    }
  }, [editingCell?.row, editingCell?.col]);

  // Tahrirlashni saqlash
  const commitEdit = useCallback(
    (overrideValue?: string) => {
      if (!editingCell) return;
      const rowObj = visibleRows[editingCell.row];
      if (!rowObj) {
        setEditingCell(null);
        return;
      }
      const colKey = SKLAD_COLUMNS[editingCell.col];
      const rawDraft = overrideValue !== undefined ? overrideValue : editingCell.draft;
      const normalized = normalizeCommittedCellValue(colKey, rawDraft);
      if (normalized !== editingCell.original) {
        onUpdateCell(rowObj.id, colKey, normalized);
      }
      setEditingCell(null);
      gridContainerRef.current?.focus();
    },
    [editingCell, visibleRows, onUpdateCell]
  );

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    gridContainerRef.current?.focus();
  }, []);

  // Active cell harakatlantirish
  const moveActive = useCallback(
    (targetRow: number, targetCol: number, extendSelection = false) => {
      if (visibleRows.length === 0) return;
      const clamped = clampCoord({ row: targetRow, col: targetCol }, visibleRows.length, SKLAD_COLUMNS.length);
      setSelection(prev => {
        if (extendSelection) {
          const anchor = prev.anchor ?? prev.active ?? clamped;
          const rng = normalizeRange(anchor, clamped);
          const nextRanges = prev.ranges.length > 1 ? [...prev.ranges.slice(0, -1), rng] : [rng];
          return { active: clamped, anchor, ranges: nextRanges };
        }
        return createSingleCellSelection(clamped.row, clamped.col);
      });
      scrollCellIntoView(clamped);
    },
    [visibleRows.length, scrollCellIntoView]
  );

  // Matnli clipboard qo'yish (Ctrl+V yoki Paste modaldan)
  const executePasteMatrix = useCallback(
    (matrix: string[][]) => {
      if (matrix.length === 0) return;
      const res = applyPasteMatrixToRows({
        rows: visibleRows,
        selection,
        matrix,
        defaultDate: expectedDate,
      });
      if (res.pastedCellsCount === 0 && res.addedRowsCount === 0) return;
      applyUpdatedVisibleRows(res.nextRows);
      setSelection(res.nextSelection);
      if (res.addedRowsCount > 0) {
        onNotify(
          `${res.pastedCellsCount} ta katak qo'yildi va ${res.addedRowsCount} ta yangi qator qo'shildi.`,
          'success'
        );
      }
    },
    [visibleRows, selection, expectedDate, applyUpdatedVisibleRows, onNotify]
  );

  // Ctrl+C / Ctrl+X / Ctrl+V event handlerlari
  const handleGridCopy = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (editingCell) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !target.dataset.gridEditor) {
        return;
      }
      e.preventDefault();
      const tsv = serializeSelectionToTsv(visibleRows, selection);
      if (!tsv) return;
      internalClipboardRef.current = tsv;
      e.clipboardData.setData('text/plain', tsv);
    },
    [editingCell, visibleRows, selection]
  );

  const handleGridCut = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (editingCell) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !target.dataset.gridEditor) {
        return;
      }
      e.preventDefault();
      const tsv = serializeSelectionToTsv(visibleRows, selection);
      if (!tsv) return;
      internalClipboardRef.current = tsv;
      e.clipboardData.setData('text/plain', tsv);
      const cleared = clearSelectedCellsInRows(visibleRows, selection);
      applyUpdatedVisibleRows(cleared);
    },
    [editingCell, visibleRows, selection, applyUpdatedVisibleRows]
  );

  const handleGridPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (editingCell || isPasteModalOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      e.preventDefault();
      const html = e.clipboardData.getData('text/html') || '';
      const text = e.clipboardData.getData('text/plain') || '';
      const matrix = parseClipboardToMatrix(html, text);
      if (matrix.length > 0) {
        executePasteMatrix(matrix);
      }
    },
    [editingCell, isPasteModalOpen, executePasteMatrix]
  );

  // Global Ctrl+F va modal bo'lmaganda gridga fokus beruvchi klaviatura boshqaruvi
  useEffect(() => {
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (isPasteModalOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, [isPasteModalOpen]);

  // Asosiy Grid klaviatura navigatsiyasi va buyruqlari
  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isPasteModalOpen) return;

      // Agar boshqa UI input (masalan qidiruv) fokusda bo'lsa, grid aralashmaydi
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') &&
        !target.dataset.gridEditor
      ) {
        return;
      }

      // Agar katak tahrirlanayotgan bo'lsa
      if (editingCell) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const { row, col } = editingCell;
          commitEdit();
          const nextRow = e.shiftKey ? Math.max(0, row - 1) : Math.min(Math.max(0, visibleRows.length - 1), row + 1);
          moveActive(nextRow, col, false);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const { row, col } = editingCell;
          commitEdit();
          const colCount = SKLAD_COLUMNS.length;
          if (e.shiftKey) {
            if (col > 0) moveActive(row, col - 1, false);
            else if (row > 0) moveActive(row - 1, colCount - 1, false);
          } else {
            if (col < colCount - 1) moveActive(row, col + 1, false);
            else if (row < visibleRows.length - 1) moveActive(row + 1, 0, false);
          }
          return;
        }
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      const lower = e.key.toLowerCase();

      // Undo / Redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
      if (mod && lower === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) onUndo();
        return;
      }
      if (mod && (lower === 'y' || (lower === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (canRedo) onRedo();
        return;
      }

      if (visibleRows.length === 0) return;

      const cur = selection.active ?? { row: 0, col: 0 };
      const maxR = visibleRows.length - 1;
      const maxC = SKLAD_COLUMNS.length - 1;

      // Ctrl+A: hammasi
      if (mod && lower === 'a') {
        e.preventDefault();
        setSelection({
          active: cur,
          anchor: { row: 0, col: 0 },
          ranges: [{ r1: 0, c1: 0, r2: maxR, c2: maxC }],
        });
        return;
      }

      // Ctrl+D: yuqoridan pastga
      if (mod && lower === 'd') {
        e.preventDefault();
        const next = fillDownSelection(visibleRows, selection);
        if (next !== visibleRows) applyUpdatedVisibleRows(next);
        return;
      }

      // Ctrl+R: chapdan o'ngga
      if (mod && lower === 'r') {
        e.preventDefault();
        const next = fillRightSelection(visibleRows, selection);
        if (next !== visibleRows) applyUpdatedVisibleRows(next);
        return;
      }

      // Strelkalar (+ Shift, + Ctrl/Cmd)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dr = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        const dc = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        if (mod) {
          const jump = computeCtrlJumpTarget(visibleRows, cur, dr, dc);
          moveActive(jump.row, jump.col, e.shiftKey);
        } else {
          moveActive(cur.row + dr, cur.col + dc, e.shiftKey);
        }
        return;
      }

      // Tab / Shift+Tab
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          if (cur.col > 0) moveActive(cur.row, cur.col - 1, false);
          else if (cur.row > 0) moveActive(cur.row - 1, maxC, false);
        } else {
          if (cur.col < maxC) moveActive(cur.row, cur.col + 1, false);
          else if (cur.row < maxR) moveActive(cur.row + 1, 0, false);
        }
        return;
      }

      // Enter / Shift+Enter
      if (e.key === 'Enter') {
        e.preventDefault();
        moveActive(e.shiftKey ? Math.max(0, cur.row - 1) : Math.min(maxR, cur.row + 1), cur.col, false);
        return;
      }

      // Home / End / Ctrl+Home / Ctrl+End
      if (e.key === 'Home') {
        e.preventDefault();
        if (mod) moveActive(0, 0, e.shiftKey);
        else moveActive(cur.row, 0, e.shiftKey);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        if (mod) {
          const last = findLastPopulatedCell(visibleRows);
          moveActive(last.row, last.col, e.shiftKey);
        } else {
          moveActive(cur.row, maxC, e.shiftKey);
        }
        return;
      }

      // PageUp / PageDown
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        const containerH = gridContainerRef.current?.clientHeight || 480;
        const pageRows = Math.max(5, Math.floor((containerH - 40) / ROW_HEIGHT));
        const delta = e.key === 'PageUp' ? -pageRows : pageRows;
        moveActive(cur.row + delta, cur.col, e.shiftKey);
        return;
      }

      // Delete / Backspace -> tanlangan kataklarni tozalash
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const next = clearSelectedCellsInRows(visibleRows, selection);
        if (next !== visibleRows) applyUpdatedVisibleRows(next);
        return;
      }

      // F2 -> eski qiymatni saqlab tahrirlash
      if (e.key === 'F2') {
        e.preventDefault();
        startEditing(cur.row, cur.col);
        return;
      }

      // Oddiy belgi yozilganda — eski qiymatni o'chirib tahrirlashni boshlash
      if (!mod && !e.altKey && e.key.length === 1) {
        const colKey = SKLAD_COLUMNS[cur.col];
        if (INTEGER_SKLAD_COLUMNS.has(colKey) && !/^\d$/.test(e.key)) {
          e.preventDefault();
          return;
        }
        if (DECIMAL_SKLAD_COLUMNS.has(colKey) && !/^[\d.,]$/.test(e.key)) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        const initialChar = DECIMAL_SKLAD_COLUMNS.has(colKey) && e.key === ',' ? '.' : e.key;
        startEditing(cur.row, cur.col, initialChar);
      }
    },
    [
      isPasteModalOpen,
      editingCell,
      visibleRows,
      selection,
      canUndo,
      canRedo,
      onUndo,
      onRedo,
      cancelEdit,
      commitEdit,
      moveActive,
      applyUpdatedVisibleRows,
      startEditing,
    ]
  );

  // Sichqoncha bilan sudrab tanlash va Fill Handle drag
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isMouseDraggingRef.current && !fillDragTarget) return;
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const cellEl = el?.closest('[data-r]') as HTMLElement | null;
      if (!cellEl) return;
      const r = Number(cellEl.dataset.r);
      const c = Number(cellEl.dataset.c);
      if (!Number.isFinite(r) || !Number.isFinite(c)) return;

      if (fillDragTarget) {
        setFillDragTarget(prev =>
          prev ? { ...prev, targetEndRow: Math.max(prev.sourceRange.r2, r), targetEndCol: prev.sourceRange.c2 } : null
        );
        return;
      }

      if (isMouseDraggingRef.current && mouseDragAnchorRef.current) {
        const anchor = mouseDragAnchorRef.current;
        if (dragModeRef.current === 'row') {
          const rng: CellRange = {
            r1: Math.min(anchor.row, r),
            c1: 0,
            r2: Math.max(anchor.row, r),
            c2: SKLAD_COLUMNS.length - 1,
          };
          setSelection(prev => ({
            ...prev,
            ranges: prev.ranges.length > 1 ? [...prev.ranges.slice(0, -1), rng] : [rng],
          }));
        } else if (dragModeRef.current === 'col') {
          const rng: CellRange = {
            r1: 0,
            c1: Math.min(anchor.col, c),
            r2: Math.max(0, visibleRows.length - 1),
            c2: Math.max(anchor.col, c),
          };
          setSelection(prev => ({
            ...prev,
            ranges: prev.ranges.length > 1 ? [...prev.ranges.slice(0, -1), rng] : [rng],
          }));
        } else {
          const rng = normalizeRange(anchor, { row: r, col: c });
          setSelection(prev => ({
            ...prev,
            ranges: prev.ranges.length > 1 ? [...prev.ranges.slice(0, -1), rng] : [rng],
          }));
        }
      }
    };

    const onMouseUp = () => {
      if (fillDragTarget) {
        const res = applyFillHandleDrag({
          rows: visibleRows,
          sourceRange: fillDragTarget.sourceRange,
          targetEndRow: fillDragTarget.targetEndRow,
          targetEndCol: fillDragTarget.targetEndCol,
        });
        if (res.nextRows !== visibleRows) {
          applyUpdatedVisibleRows(res.nextRows);
          setSelection({
            active: { row: res.finalRange.r1, col: res.finalRange.c1 },
            anchor: { row: res.finalRange.r1, col: res.finalRange.c1 },
            ranges: [res.finalRange],
          });
        }
        setFillDragTarget(null);
      }
      isMouseDraggingRef.current = false;
      mouseDragAnchorRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [fillDragTarget, visibleRows, applyUpdatedVisibleRows]);

  // Kontekst menyuni tashqariga bosganda yopish
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // Katakni bosish
  const handleCellMouseDown = (e: React.MouseEvent, rowIdx: number, colIdx: number) => {
    if (e.button === 2) {
      // O'ng tugma — kontekst menyu
      if (!isCellSelected(selection, rowIdx, colIdx)) {
        setSelection(createSingleCellSelection(rowIdx, colIdx));
      }
      return;
    }
    if (e.button !== 0) return;

    if (editingCell && (editingCell.row !== rowIdx || editingCell.col !== colIdx)) {
      commitEdit();
    } else if (!editingCell) {
      gridContainerRef.current?.focus({ preventScroll: true });
    }

    const mod = e.ctrlKey || e.metaKey;
    dragModeRef.current = 'cell';
    isMouseDraggingRef.current = true;

    if (e.shiftKey) {
      const anchor = selection.anchor ?? selection.active ?? { row: rowIdx, col: colIdx };
      mouseDragAnchorRef.current = anchor;
      const rng = normalizeRange(anchor, { row: rowIdx, col: colIdx });
      setSelection(prev => ({
        active: { row: rowIdx, col: colIdx },
        anchor,
        ranges: mod ? [...prev.ranges, rng] : [rng],
      }));
    } else if (mod) {
      const coord = { row: rowIdx, col: colIdx };
      mouseDragAnchorRef.current = coord;
      const rng: CellRange = { r1: rowIdx, c1: colIdx, r2: rowIdx, c2: colIdx };
      setSelection(prev => ({
        active: coord,
        anchor: coord,
        ranges: [...prev.ranges, rng],
      }));
    } else {
      mouseDragAnchorRef.current = { row: rowIdx, col: colIdx };
      setSelection(createSingleCellSelection(rowIdx, colIdx));
    }
  };

  // Qator raqamini bosish (butun qatorni tanlash)
  const handleRowHeaderMouseDown = (e: React.MouseEvent, rowIdx: number) => {
    if (e.button !== 0) return;
    if (editingCell) commitEdit();
    gridContainerRef.current?.focus({ preventScroll: true });

    const mod = e.ctrlKey || e.metaKey;
    const maxC = SKLAD_COLUMNS.length - 1;
    dragModeRef.current = 'row';
    isMouseDraggingRef.current = true;

    if (e.shiftKey && selection.anchor) {
      const aRow = selection.anchor.row;
      mouseDragAnchorRef.current = { row: aRow, col: 0 };
      const rng: CellRange = {
        r1: Math.min(aRow, rowIdx),
        c1: 0,
        r2: Math.max(aRow, rowIdx),
        c2: maxC,
      };
      setSelection({
        active: { row: rowIdx, col: 0 },
        anchor: { row: aRow, col: 0 },
        ranges: [rng],
      });
    } else if (mod) {
      mouseDragAnchorRef.current = { row: rowIdx, col: 0 };
      const rng: CellRange = { r1: rowIdx, c1: 0, r2: rowIdx, c2: maxC };
      setSelection(prev => ({
        active: { row: rowIdx, col: 0 },
        anchor: { row: rowIdx, col: 0 },
        ranges: [...prev.ranges, rng],
      }));
    } else {
      mouseDragAnchorRef.current = { row: rowIdx, col: 0 };
      setSelection({
        active: { row: rowIdx, col: 0 },
        anchor: { row: rowIdx, col: 0 },
        ranges: [{ r1: rowIdx, c1: 0, r2: rowIdx, c2: maxC }],
      });
    }
  };

  // Ustun sarlavhasini bosish (butun ustunni tanlash)
  const handleColHeaderMouseDown = (e: React.MouseEvent, colIdx: number) => {
    if (e.button !== 0) return;
    if (visibleRows.length === 0) return;
    if (editingCell) commitEdit();
    gridContainerRef.current?.focus({ preventScroll: true });

    const mod = e.ctrlKey || e.metaKey;
    const maxR = visibleRows.length - 1;
    dragModeRef.current = 'col';
    isMouseDraggingRef.current = true;

    if (e.shiftKey && selection.anchor) {
      const aCol = selection.anchor.col;
      mouseDragAnchorRef.current = { row: 0, col: aCol };
      const rng: CellRange = {
        r1: 0,
        c1: Math.min(aCol, colIdx),
        r2: maxR,
        c2: Math.max(aCol, colIdx),
      };
      setSelection({
        active: { row: 0, col: colIdx },
        anchor: { row: 0, col: aCol },
        ranges: [rng],
      });
    } else if (mod) {
      mouseDragAnchorRef.current = { row: 0, col: colIdx };
      const rng: CellRange = { r1: 0, c1: colIdx, r2: maxR, c2: colIdx };
      setSelection(prev => ({
        active: { row: 0, col: colIdx },
        anchor: { row: 0, col: colIdx },
        ranges: [...prev.ranges, rng],
      }));
    } else {
      mouseDragAnchorRef.current = { row: 0, col: colIdx };
      setSelection({
        active: { row: 0, col: colIdx },
        anchor: { row: 0, col: colIdx },
        ranges: [{ r1: 0, c1: colIdx, r2: maxR, c2: colIdx }],
      });
    }
  };

  // Ustun kengligini sudrab o'zgartirish
  const startColumnResize = (e: React.MouseEvent, colKey: SkladColumnKey) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidths[colKey] ?? 100;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const nextW = Math.max(52, Math.min(480, startW + delta));
      setColWidths(prev => ({ ...prev, [colKey]: nextW }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Qator qo'shish / nusxalash / o'chirish amallari
  const selectedRowIndices = useMemo(
    () => getSelectedRowIndices(selection, visibleRows.length),
    [selection, visibleRows.length]
  );

  const handleInsertRowAt = (position: 'above' | 'below', targetVisRowIdx?: number) => {
    const refVisIdx = targetVisRowIdx ?? selection.active?.row ?? 0;
    const refRow = visibleRows[refVisIdx];
    const newRow = createEmptySkladRow({}, expectedDate);

    if (!refRow || rows.length === 0) {
      onAddRow(newRow);
      return;
    }

    const masterIdx = masterIndexById.get(refRow.id);
    if (masterIdx === undefined) {
      onAddRow(newRow);
      return;
    }

    const insertAt = position === 'above' ? masterIdx : masterIdx + 1;
    const next = [...rows];
    next.splice(insertAt, 0, newRow);
    onCommitRows(next);
    const nextVisFocus = position === 'above' ? refVisIdx : refVisIdx + 1;
    setSelection(createSingleCellSelection(Math.min(next.length - 1, nextVisFocus), 0));
  };

  const handleDuplicateSelectedRows = () => {
    if (selectedRowIndices.length === 0) return;
    const copies = selectedRowIndices
      .map(vi => visibleRows[vi])
      .filter(Boolean)
      .map((r, idx) =>
        createEmptySkladRow({ ...r, id: `skl-dup-${Date.now()}-${idx}` }, expectedDate)
      );
    if (copies.length === 0) return;
    const lastRow = visibleRows[selectedRowIndices[selectedRowIndices.length - 1]];
    const masterIdx = lastRow ? masterIndexById.get(lastRow.id) ?? rows.length - 1 : rows.length - 1;
    const next = [...rows];
    next.splice(masterIdx + 1, 0, ...copies);
    onCommitRows(next);
    onNotify(`${copies.length} ta qator nusxalandi.`, 'success');
  };

  const handleDeleteSelectedRows = () => {
    const ids = selectedRowIndices
      .map(vi => visibleRows[vi]?.id)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) return;
    onDeleteRows(ids);
  };

  const handleExcelFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { rows: imported } = await importSkladFromExcelFile(file, expectedDate);
      if (imported.length === 0) {
        onNotify("Excel fayldan ma'lumot topilmadi.", 'error');
        return;
      }
      onAppendRows(imported, replaceOnImport);
      onNotify(
        `Exceldan ${imported.length} ta Склад qatori ${replaceOnImport ? 'almashtirildi' : "qo'shildi"}.`,
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Excel faylni o'qishda xatolik.", 'error');
    }
  };

  const handlePasteModalConfirm = () => {
    const matrix = parseClipboardToMatrix('', pasteText);
    if (matrix.length === 0) {
      onNotify("Qo'yish uchun jadval matni topilmadi.", 'error');
      return;
    }
    if (replaceOnImport) {
      const { rows: imported } = mapMatrixToSkladRows(matrix, expectedDate);
      onAppendRows(imported, true);
      onNotify(`${imported.length} ta qator bilan almashtirildi.`, 'success');
    } else {
      executePasteMatrix(matrix);
    }
    setPasteText('');
    setIsPasteModalOpen(false);
  };

  // Faol katak ma'lumoti va pastki holat satri ko'rsatkichlari
  const activeCoord = selection.active;
  const activeRowObj = activeCoord ? visibleRows[activeCoord.row] : undefined;
  const activeColKey = activeCoord ? SKLAD_COLUMNS[activeCoord.col] : undefined;
  const activeValidation = activeRowObj ? validations.get(activeRowObj.id) : undefined;
  const activeCellMessages =
    activeValidation && activeColKey ? activeValidation.fieldMessages[activeColKey] : undefined;
  const activeCellStatus =
    activeValidation && activeColKey && !UNVALIDATED_SKLAD_COLUMNS.has(activeColKey)
      ? activeValidation.fieldStatuses[activeColKey] || 'ok'
      : 'ok';

  const selMetrics = useMemo(
    () => getSelectionMetrics(visibleRows, selection),
    [visibleRows, selection]
  );

  const primaryRange = selection.ranges[selection.ranges.length - 1];
  const frozenDividerIndex = FROZEN_COUNT - 1;

  return (
    <div className="flex flex-col gap-2.5 h-full">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleExcelFileSelect}
        className="hidden"
      />

      {/* Yuqori sarlavha va Excel amallar paneli */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Склад — Excel ma&apos;lumot kiritish jadvali
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Jami: <span className="font-mono tabular-nums font-semibold">{stats.total}</span> · Xatoli:{' '}
              <span className="font-mono tabular-nums font-semibold text-rose-600 dark:text-rose-400">{stats.err}</span>{' '}
              · Ogohlantirishli:{' '}
              <span className="font-mono tabular-nums font-semibold text-amber-600 dark:text-amber-400">{stats.warn}</span>
              <span className="hidden xl:inline text-slate-400">
                {' '}· Excel kabi: Strelkalar, Tab/Enter, Ctrl+C/X/V/D/R, Shift+tanlash, Fill Handle
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 flex items-center gap-1 cursor-pointer whitespace-nowrap"
              title="Bekor qilish (Ctrl+Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Bekor</span>
            </button>

            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 flex items-center gap-1 cursor-pointer whitespace-nowrap"
              title="Qaytarish (Ctrl+Y)"
            >
              <Redo2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Qayta</span>
            </button>

            <button
              type="button"
              onClick={() => handleInsertRowAt('below')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 text-xs font-semibold hover:opacity-90 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Qator qo&apos;shish</span>
            </button>

            {selectedRowIndices.length > 0 && visibleRows.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleDuplicateSelectedRows}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  title="Tanlangan qator(lar)ni nusxalash"
                >
                  <CopyPlus className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Nusxa ({selectedRowIndices.length})</span>
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelectedRows}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  title="Tanlangan qator(lar)ni o'chirish"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>O&apos;chirish ({selectedRowIndices.length})</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Excel import</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPasteModalOpen(true)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <ClipboardPaste className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>Qo&apos;yish oynasi</span>
            </button>

            <button
              type="button"
              onClick={() => exportSkladToExcel(visibleRows, validations)}
              disabled={visibleRows.length === 0}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
              <span>Excel eksport</span>
            </button>
          </div>
        </div>

        {/* Filtr va Ctrl+F qidiruv satri */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setSearchQuery('');
                  gridContainerRef.current?.focus();
                }
              }}
              placeholder="Qidirish (Ctrl+F): tara, zakaz, model, rang..."
              className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors whitespace-nowrap ${
                statusFilter === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              Barchasi
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('error')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap ${
                statusFilter === 'error'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-rose-600'
              }`}
            >
              <AlertCircle className="w-3 h-3" />
              <span>Xatoli ({stats.err})</span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('warning')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap ${
                statusFilter === 'warning'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-amber-600'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Tekshirilmagan ({stats.warn})</span>
            </button>
          </div>

          <select
            value={orderFilter}
            onChange={e => setOrderFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="all">Barcha zakazlar</option>
            {distinctOrders.map(ord => (
              <option key={ord} value={ord}>
                {ord}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            placeholder="Sana (dd.mm.yyyy)"
            className="w-32 px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />

          {sortConfig && (
            <button
              type="button"
              onClick={() => setSortConfig(null)}
              className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
              title="Tartiblashni bekor qilish"
            >
              <span>Tartib: {sortConfig.key}</span>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Asosiy Excel/Google Sheets Virtual Grid Konteyneri */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col flex-1 min-h-[430px]">
        {rows.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-md">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Склад jadvali hozircha bo&apos;sh
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Exceldan fayl yuklang, jadvalni qo&apos;shib Ctrl+V qiling yoki tekshiruvni sinab ko&apos;rish uchun tayyor namunani yuklang.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
              <button
                type="button"
                onClick={() => onAddRow()}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Birinchi qatorni qo&apos;shish</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Excel yuklash</span>
              </button>
              <button
                type="button"
                onClick={() => setIsPasteModalOpen(true)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <ClipboardPaste className="w-4 h-4 text-sky-600" />
                <span>Ctrl+V oynasi</span>
              </button>
              <button
                type="button"
                onClick={onLoadSampleData}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <DatabaseZap className="w-4 h-4 text-amber-500" />
                <span>Tekshiruv namunasini yuklash</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            ref={gridContainerRef}
            tabIndex={0}
            role="grid"
            aria-label="Склад Excel jadvali"
            data-testid="sklad-excel-grid"
            onKeyDown={handleGridKeyDown}
            onCopy={handleGridCopy}
            onCut={handleGridCut}
            onPaste={handleGridPaste}
            className="excel-grid-viewport relative flex-1 overflow-auto max-h-[65vh] focus:outline-none select-none"
          >
            {/* Virtual kenglik konteyneri */}
            <div style={{ width: `${colLeftPositions.totalWidth}px`, minWidth: '100%' }}>
              {/* Muzlatilgan (sticky top) ustun sarlavhalari */}
              <div
                role="row"
                className="sticky top-0 z-30 flex bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700"
                style={{ height: '34px' }}
              >
                {/* Chap yuqori burchak: barchasini tanlash */}
                <button
                  type="button"
                  data-testid="grid-corner-select-all"
                  onClick={() => {
                    if (visibleRows.length === 0) return;
                    setSelection({
                      active: { row: 0, col: 0 },
                      anchor: { row: 0, col: 0 },
                      ranges: [{ r1: 0, c1: 0, r2: visibleRows.length - 1, c2: SKLAD_COLUMNS.length - 1 }],
                    });
                    gridContainerRef.current?.focus();
                  }}
                  style={{ width: `${ROW_NUM_WIDTH}px`, left: 0 }}
                  className="sticky z-40 shrink-0 h-full bg-slate-200 dark:bg-slate-800 border-r border-slate-300 dark:border-slate-700 flex items-center justify-center text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 cursor-pointer"
                  title="Hammasini tanlash (Ctrl+A)"
                >
                  №
                </button>

                {SKLAD_COLUMNS.map((colKey, colIdx) => {
                  const width = colWidths[colKey] ?? 100;
                  const isFrozen = isDesktopFreeze && colIdx < FROZEN_COUNT;
                  const isFrozenEdge = isDesktopFreeze && colIdx === frozenDividerIndex;
                  const colSelected = isColInAnySelection(selection, colIdx);
                  const isSorted = sortConfig?.key === colKey;

                  return (
                    <div
                      key={colKey}
                      role="columnheader"
                      data-col-header={colIdx}
                      onMouseDown={e => handleColHeaderMouseDown(e, colIdx)}
                      style={{
                        width: `${width}px`,
                        left: isFrozen ? `${colLeftPositions.lefts[colIdx]}px` : undefined,
                      }}
                      className={`relative shrink-0 h-full flex items-center justify-between px-1.5 border-r text-[11px] font-semibold cursor-pointer transition-colors ${
                        isFrozen ? 'sticky z-35' : ''
                      } ${
                        isFrozenEdge
                          ? 'border-r-2 border-r-slate-400 dark:border-r-slate-500'
                          : 'border-slate-200 dark:border-slate-700'
                      } ${
                        colSelected
                          ? 'bg-sky-100 dark:bg-sky-900/60 text-sky-900 dark:text-sky-100'
                          : isFrozen
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/70'
                      }`}
                    >
                      <span className="truncate flex items-center gap-1" title={`${colKey} (bosish = ustunni tanlash)`}>
                        <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 hidden xl:inline">
                          {/* Excel harfi emas, aniq sarlavha */}
                        </span>
                        <span className="truncate">{colKey}</span>
                      </span>

                      <button
                        type="button"
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => {
                          e.stopPropagation();
                          setSortConfig(prev => {
                            if (!prev || prev.key !== colKey) return { key: colKey, dir: 'asc' };
                            if (prev.dir === 'asc') return { key: colKey, dir: 'desc' };
                            return null;
                          });
                        }}
                        className={`p-0.5 rounded hover:bg-slate-300/70 dark:hover:bg-slate-600/70 cursor-pointer shrink-0 ${
                          isSorted ? 'text-sky-600 dark:text-sky-400' : 'text-slate-400'
                        }`}
                        title="Ustun bo'yicha tartiblash"
                      >
                        {isSorted && sortConfig.dir === 'asc' ? (
                          <ArrowUp className="w-3 h-3" />
                        ) : isSorted && sortConfig.dir === 'desc' ? (
                          <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3" />
                        )}
                      </button>

                      {/* Ustun kengligini o'zgartirish dastagi (drag + dblclick auto-width) */}
                      <div
                        data-testid={`col-resize-${colIdx}`}
                        onMouseDown={e => startColumnResize(e, colKey)}
                        onDoubleClick={e => {
                          e.stopPropagation();
                          const nextW = computeAutoColumnWidth(rows, colKey, getInitialColWidth(colKey));
                          setColWidths(prev => ({ ...prev, [colKey]: nextW }));
                        }}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-sky-500/70 z-10"
                        title="Kenglikni o'zgartirish (ikki marta bosish = avtomatik)"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Virtualizatsiyalangan qatorlar sohasi */}
              <div style={{ height: `${totalVirtualHeight}px`, position: 'relative' }}>
                {virtualRows.map(vRow => {
                  const rowIdx = vRow.index;
                  const rowObj = visibleRows[rowIdx];
                  const val = validations.get(rowObj.id);
                  const rowSelected = isRowInAnySelection(selection, rowIdx);

                  const rowNumAccent =
                    val?.status === 'error'
                      ? 'text-rose-600 dark:text-rose-400 font-bold'
                      : val?.status === 'warning'
                      ? 'text-amber-600 dark:text-amber-400 font-bold'
                      : 'text-slate-500 dark:text-slate-400';

                  return (
                    <div
                      key={rowObj.id}
                      role="row"
                      data-row-index={rowIdx}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${ROW_HEIGHT}px`,
                        transform: `translateY(${vRow.start}px)`,
                      }}
                      className="flex border-b border-slate-200 dark:border-slate-800"
                    >
                      {/* Chap muzlatilgan qator raqami */}
                      <div
                        role="rowheader"
                        data-row-header={rowIdx}
                        onMouseDown={e => handleRowHeaderMouseDown(e, rowIdx)}
                        onContextMenu={e => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, rowIdx, colIdx: 0 });
                        }}
                        style={{ width: `${ROW_NUM_WIDTH}px`, left: 0 }}
                        className={`sticky z-20 shrink-0 h-full border-r border-slate-300 dark:border-slate-700 flex items-center justify-center font-mono tabular-nums text-[11px] cursor-pointer ${rowNumAccent} ${
                          rowSelected
                            ? 'bg-sky-100 dark:bg-sky-900/60'
                            : 'bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                        title="Butun qatorni tanlash"
                      >
                        {rowIdx + 1}
                      </div>

                      {SKLAD_COLUMNS.map((colKey, colIdx) => {
                        const width = colWidths[colKey] ?? 100;
                        const isFrozen = isDesktopFreeze && colIdx < FROZEN_COUNT;
                        const isFrozenEdge = isDesktopFreeze && colIdx === frozenDividerIndex;
                        const isActive =
                          selection.active?.row === rowIdx && selection.active?.col === colIdx;
                        const selected = isCellSelected(selection, rowIdx, colIdx);
                        const isEditing =
                          editingCell?.row === rowIdx && editingCell?.col === colIdx;

                        const isFillPreview =
                          fillDragTarget &&
                          rowIdx >= fillDragTarget.sourceRange.r1 &&
                          rowIdx <= fillDragTarget.targetEndRow &&
                          colIdx >= fillDragTarget.sourceRange.c1 &&
                          colIdx <= fillDragTarget.targetEndCol;

                        const showFillHandle =
                          !isEditing &&
                          !editingCell &&
                          primaryRange &&
                          rowIdx === primaryRange.r2 &&
                          colIdx === primaryRange.c2;

                        const isUnvalidated = UNVALIDATED_SKLAD_COLUMNS.has(colKey);
                        const cellStatus = isUnvalidated
                          ? 'unvalidated'
                          : val?.fieldStatuses[colKey] || 'ok';
                        const messages = val?.fieldMessages[colKey];
                        const tooltip = messages && messages.length > 0 ? messages.join('\n') : undefined;

                        const isNumeric =
                          INTEGER_SKLAD_COLUMNS.has(colKey) ||
                          DECIMAL_SKLAD_COLUMNS.has(colKey);
                        const isDate = DATE_SKLAD_COLUMNS.has(colKey);
                        const dropdownOptions = DROPDOWN_SKLAD_OPTIONS[colKey];

                        let bgClass = isFrozen
                          ? 'bg-white dark:bg-slate-900'
                          : 'bg-white dark:bg-slate-900';
                        let textClass = 'text-slate-900 dark:text-slate-100';

                        if (cellStatus === 'error') {
                          bgClass = 'bg-rose-50 dark:bg-rose-950/75';
                          textClass = 'text-rose-900 dark:text-rose-100';
                        } else if (cellStatus === 'warning') {
                          bgClass = 'bg-amber-50 dark:bg-amber-950/65';
                          textClass = 'text-amber-950 dark:text-amber-100';
                        } else if (selected && !isActive) {
                          bgClass = 'bg-sky-50 dark:bg-sky-900/35';
                        }

                        return (
                          <div
                            key={colKey}
                            role="gridcell"
                            data-r={rowIdx}
                            data-c={colIdx}
                            data-cell={`${rowIdx},${colIdx}`}
                            data-status={cellStatus}
                            aria-selected={selected}
                            title={tooltip}
                            onMouseDown={e => handleCellMouseDown(e, rowIdx, colIdx)}
                            onDoubleClick={() => startEditing(rowIdx, colIdx)}
                            onContextMenu={e => {
                              e.preventDefault();
                              if (!isCellSelected(selection, rowIdx, colIdx)) {
                                setSelection(createSingleCellSelection(rowIdx, colIdx));
                              }
                              setContextMenu({ x: e.clientX, y: e.clientY, rowIdx, colIdx });
                            }}
                            style={{
                              width: `${width}px`,
                              left: isFrozen ? `${colLeftPositions.lefts[colIdx]}px` : undefined,
                            }}
                            className={`relative shrink-0 h-full border-r flex items-center text-xs transition-none ${
                              isFrozen ? 'sticky z-10' : ''
                            } ${
                              isFrozenEdge
                                ? 'border-r-2 border-r-slate-400 dark:border-r-slate-500'
                                : 'border-slate-200 dark:border-slate-800'
                            } ${bgClass} ${textClass} ${
                              isActive
                                ? 'ring-2 ring-inset ring-sky-600 dark:ring-sky-400 z-15'
                                : cellStatus === 'error'
                                ? 'ring-1 ring-inset ring-rose-400/80 dark:ring-rose-500/70'
                                : cellStatus === 'warning'
                                ? 'ring-1 ring-inset ring-amber-400/80 dark:ring-amber-500/70'
                                : ''
                            } ${
                              isFillPreview ? 'outline-1 outline-dashed outline-sky-600 dark:outline-sky-400' : ''
                            } ${isActive && isFrozen ? '!z-25' : ''}`}
                          >
                            {isEditing ? (
                              <div className="relative w-full h-full">
                                <input
                                  ref={editorInputRef}
                                  data-grid-editor="true"
                                  data-testid="grid-cell-editor"
                                  type="text"
                                  value={editingCell.draft}
                                  onChange={e => {
                                    const raw = e.target.value;
                                    const cleaned = sanitizeManualNumericInput(colKey, raw);
                                    setEditingCell(prev => (prev ? { ...prev, draft: cleaned } : null));
                                  }}
                                  onBlur={e => {
                                    // Agar dropdown variantiga bosilayotgan bo'lsa onMouseDown ishlaydi
                                    const related = e.relatedTarget as HTMLElement | null;
                                    if (related?.dataset?.dropdownOption) return;
                                    commitEdit(e.currentTarget.value);
                                  }}
                                  className={`w-full h-full px-1.5 text-xs bg-white dark:bg-slate-950 text-slate-950 dark:text-white focus:outline-none ${
                                    isNumeric || isDate ? 'font-mono tabular-nums' : ''
                                  } ${isNumeric ? 'text-right' : 'text-left'}`}
                                />
                                {dropdownOptions && (
                                  <div
                                    role="listbox"
                                    className="absolute left-0 top-full mt-0.5 min-w-[120px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg shadow-xl py-1 z-50"
                                  >
                                    {dropdownOptions.map(opt => (
                                      <button
                                        key={opt || '__empty'}
                                        type="button"
                                        data-dropdown-option="true"
                                        onMouseDown={ev => {
                                          ev.preventDefault();
                                          commitEdit(opt);
                                        }}
                                        className="w-full px-2.5 py-1 text-left text-xs hover:bg-sky-50 dark:hover:bg-sky-900/50 text-slate-800 dark:text-slate-100 cursor-pointer flex items-center justify-between"
                                      >
                                        <span>{opt === '' ? '(Bo\'sh)' : opt}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <>
                                <div
                                  className={`w-full px-1.5 truncate leading-[30px] whitespace-pre ${
                                    isNumeric || isDate ? 'font-mono tabular-nums' : ''
                                  } ${isNumeric ? 'text-right' : 'text-left'}`}
                                >
                                  {rowObj[colKey]}
                                </div>

                                {/* Сорт va Выд faol kataklarida ochiluvchi dropdown tugmasi */}
                                {isActive && dropdownOptions && (
                                  <button
                                    type="button"
                                    onMouseDown={e => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      startEditing(rowIdx, colIdx);
                                    }}
                                    className="shrink-0 mr-1 p-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                                    title="Ro'yxatdan tanlash"
                                  >
                                    <ChevronDown className="w-3 h-3" />
                                  </button>
                                )}

                                {(cellStatus === 'error' || cellStatus === 'warning') && !dropdownOptions && (
                                  <span
                                    className={`shrink-0 pr-1 pointer-events-none ${
                                      cellStatus === 'error'
                                        ? 'text-rose-600 dark:text-rose-400'
                                        : 'text-amber-600 dark:text-amber-400'
                                    }`}
                                    aria-hidden="true"
                                  >
                                    {cellStatus === 'error' ? (
                                      <AlertCircle className="w-3 h-3" />
                                    ) : (
                                      <AlertTriangle className="w-3 h-3" />
                                    )}
                                  </span>
                                )}

                                {/* To'ldirish dastagi (Fill Handle) */}
                                {showFillHandle && (
                                  <div
                                    data-testid="fill-handle"
                                    onMouseDown={e => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      setFillDragTarget({
                                        sourceRange: primaryRange,
                                        targetEndRow: primaryRange.r2,
                                        targetEndCol: primaryRange.c2,
                                      });
                                    }}
                                    className="absolute -right-[3px] -bottom-[3px] w-2.5 h-2.5 bg-sky-600 dark:bg-sky-400 border border-white dark:border-slate-950 cursor-crosshair z-30"
                                    title="Sudrab qiymat yoki ketma-ketlikni to'ldirish"
                                  />
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {visibleRows.length === 0 && (
              <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                Tanlangan filtr bo&apos;yicha qatorlar topilmadi.
              </div>
            )}
          </div>
        )}

        {/* Excel uslubidagi pastki holat satri (Status Bar) */}
        <div
          data-testid="grid-status-bar"
          className="px-3 py-1.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span
              data-testid="status-active-address"
              className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono tabular-nums font-semibold shrink-0"
            >
              {formatCellAddress(activeCoord)}
              {activeColKey ? ` · ${activeColKey}` : ''}
            </span>

            {activeCellMessages && activeCellMessages.length > 0 ? (
              <span
                data-testid="status-active-message"
                className={`truncate font-medium flex items-center gap-1 ${
                  activeCellStatus === 'error'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {activeCellStatus === 'error' ? (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="truncate">{activeCellMessages[0]}</span>
              </span>
            ) : activeValidation && activeRowObj ? (
              <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 truncate">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Katak to&apos;g&apos;ri</span>
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-3 font-mono tabular-nums shrink-0">
            {selMetrics.numericCount > 0 && (
              <span data-testid="status-numeric-sum" className="text-slate-800 dark:text-slate-200 font-semibold">
                Yig&apos;indi: {Number.isInteger(selMetrics.numericSum) ? selMetrics.numericSum : selMetrics.numericSum.toFixed(2)}
              </span>
            )}
            <span data-testid="status-selected-count">Tanlangan: {selMetrics.cellCount}</span>
            <span data-testid="status-row-count">
              Qator: {visibleRows.length}/{rows.length}
            </span>
            <span
              data-testid="status-error-count"
              className={stats.err > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''}
            >
              Xatoli qator: {stats.err}
            </span>
          </div>
        </div>
      </div>

      {/* O'ng tugma kontekst menyusi */}
      {contextMenu && (
        <div
          style={{
            left: `${Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 230)}px`,
            top: `${Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 280)}px`,
          }}
          className="fixed z-50 w-56 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl py-1.5 text-xs"
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              handleInsertRowAt('above', contextMenu.rowIdx);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <ArrowUpToLine className="w-3.5 h-3.5 text-slate-500" />
            <span>Tepaga qator qo&apos;shish</span>
          </button>
          <button
            type="button"
            onClick={() => {
              handleInsertRowAt('below', contextMenu.rowIdx);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <ArrowDownToLine className="w-3.5 h-3.5 text-slate-500" />
            <span>Pastga qator qo&apos;shish</span>
          </button>
          <button
            type="button"
            onClick={() => {
              handleDuplicateSelectedRows();
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <CopyPlus className="w-3.5 h-3.5 text-slate-500" />
            <span>Qatorni nusxalash</span>
          </button>
          <button
            type="button"
            onClick={() => {
              handleDeleteSelectedRows();
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-rose-50 dark:hover:bg-rose-950/50 flex items-center gap-2 text-rose-600 dark:text-rose-400 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Qator(lar)ni o&apos;chirish</span>
          </button>

          <div className="my-1 border-t border-slate-200 dark:border-slate-800" />

          <button
            type="button"
            onClick={async () => {
              const tsv = serializeSelectionToTsv(visibleRows, selection);
              internalClipboardRef.current = tsv;
              try {
                await navigator.clipboard.writeText(tsv);
              } catch {
                // fallback internal clipboard
              }
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Copy className="w-3.5 h-3.5 text-slate-500" />
              <span>Nusxalash</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400">Ctrl+C</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              const tsv = serializeSelectionToTsv(visibleRows, selection);
              internalClipboardRef.current = tsv;
              try {
                await navigator.clipboard.writeText(tsv);
              } catch {
                // fallback
              }
              const cleared = clearSelectedCellsInRows(visibleRows, selection);
              applyUpdatedVisibleRows(cleared);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Scissors className="w-3.5 h-3.5 text-slate-500" />
              <span>Kesib olish</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400">Ctrl+X</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              setContextMenu(null);
              try {
                const txt = await navigator.clipboard.readText();
                const mat = parseClipboardToMatrix('', txt || internalClipboardRef.current);
                if (mat.length > 0) executePasteMatrix(mat);
              } catch {
                if (internalClipboardRef.current) {
                  executePasteMatrix(parseClipboardToMatrix('', internalClipboardRef.current));
                } else {
                  setIsPasteModalOpen(true);
                }
              }
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <ClipboardPaste className="w-3.5 h-3.5 text-slate-500" />
              <span>Qo&apos;yish</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400">Ctrl+V</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const cleared = clearSelectedCellsInRows(visibleRows, selection);
              applyUpdatedVisibleRows(cleared);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <span>Katak(lar)ni tozalash</span>
            <span className="text-[10px] font-mono text-slate-400">Del</span>
          </button>
        </div>
      )}

      {/* Ctrl+V oynasi modali */}
      {isPasteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Excel / Google Sheets dan qo&apos;yish
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Jadval ichida to&apos;g&apos;ridan-to&apos;g&apos;ri Ctrl+V bosish ham ishlaydi. Probellar tekshiruv uchun saqlanadi.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPasteModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={8}
              placeholder="Exceldan nusxalangan kataklarni shu yerga Ctrl+V qiling..."
              className="w-full p-2.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              autoFocus
            />

            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={replaceOnImport}
                onChange={e => setReplaceOnImport(e.target.checked)}
                className="rounded accent-sky-600"
              />
              <span>Butun Склад jadvalini yangi ma&apos;lumot bilan almashtirish (ustun sarlavhalari bilan)</span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsPasteModalOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handlePasteModalConfirm}
                className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 text-xs font-semibold cursor-pointer"
              >
                Jadvalga qo&apos;yish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
