import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  FileText,
  FileSpreadsheet,
  Plus,
  Trash2,
  Search,
  Table as TableIcon,
  Sliders,
  Settings,
  AlertTriangle,
  CheckCircle2,
  Package,
  Layers,
  Info,
  Calendar,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Lock,
  X,
  Copy,
  Ruler,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Check,
  Pencil,
  Tag,
  ArrowLeftRight,
  Eye,
  ClipboardPaste,
  Save,
  List,
  FolderOpen
} from 'lucide-react';
import { Order, Customer, AppUser, WarehouseBox } from '../types';
import { Language } from '../locales';
import ExcelPasteSheet from './ExcelPasteSheet';
import OrdersExcelGrid, { ExcelColumnDef } from './OrdersExcelGrid';
import OrdersFoldersView from './OrdersFoldersView';
import OrdersMonitoringDashboard from './OrdersMonitoringDashboard';
import { registerCyrillicFonts } from '../lib/pdfCyrillicFonts';
import {
  parseClipboardToGrid,
  parsePastedProductionGrid,
  buildLedgerEntryFromParsedItem,
  ParsedExcelOrderItem,
  ParsedExcelGridResult
} from '../lib/excelPasteParser';
import {
  FactoryLedgerRow,
  SizePresetId,
  SizeCellValues,
  OrderSizeMatrix,
  DEFAULT_MONTHS,
  DEFAULT_BRANDS,
  ROST_OPTIONS,
  COMMON_COLORS,
  SIZE_PRESETS,
  INITIAL_FACTORY_DATA,
  STORAGE_MONTHS_KEY,
  STORAGE_BRANDS_KEY,
  STORAGE_ROWS_KEY,
  STORAGE_MATRICES_KEY,
  STORAGE_IMAGES_KEY,
  detectSizePresetForRow,
  normalizePresetId,
  getPopulatedSizes,
  getEffectiveDisplaySizes,
  loadBrandsList,
  recalcLedgerRowFromMatrix,
  loadOrdersAndMatrices,
  ledgerRowsToAppOrders,
  notifyOrdersStoreUpdated,
  getDeletePassword
} from '../lib/ordersSizeStore';

export type { FactoryLedgerRow, SizePresetId, SizeCellValues, OrderSizeMatrix };
export { DEFAULT_MONTHS, INITIAL_FACTORY_DATA };

const RUSSIAN_MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

type GridColKey =
  | 'month'
  | 'brand'
  | 'orderNo'
  | 'model'
  | 'color'
  | 'rost'
  | 'qtyOrder'
  | 'qtyCut'
  | 'cutPercent'
  | 'qtyDistribution'
  | 'qtySewing'
  | 'qtyPackaging'
  | 'qtyDefect'
  | 'defectPercent'
  | 'qtyTotalPack'
  | 'difference'
  | 'qtyShipped'
  | 'qtyStock'
  | 'stockPercent'
  | 'percent'
  | 'notes';

type EntryListSortKey =
  | 'orderNo'
  | 'month'
  | 'brand'
  | 'totalOrder'
  | 'cutPct'
  | 'totalDist'
  | 'totalPack'
  | 'remaining'
  | 'closePct';

type SummarySortKey =
  | 'month'
  | 'brand'
  | 'orderNo'
  | 'model'
  | 'ordQ'
  | 'cutRate'
  | 'distQ'
  | 'packQ'
  | 'diffPure'
  | 'defectRate'
  | 'closeRate'
  | 'shipQ'
  | 'stockQ'
  | 'status';

const RU_MONTH_INDEX: Record<string, number> = {
  январ: 1,
  феврал: 2,
  март: 3,
  апрел: 4,
  май: 5,
  мая: 5,
  июн: 6,
  июл: 7,
  август: 8,
  сентябр: 9,
  октябр: 10,
  ноябр: 11,
  декабр: 12
};

function parseMonthSortValue(raw?: string): number {
  if (!raw) return 0;
  const trimmed = raw.split(',')[0].trim();
  if (!trimmed) return 0;
  const lower = trimmed.toLowerCase();

  let monthNum = 0;
  for (const [stem, idx] of Object.entries(RU_MONTH_INDEX)) {
    if (lower.includes(stem)) {
      monthNum = idx;
      break;
    }
  }
  const yearMatch = trimmed.match(/\b(19|20)\d{2}\b/);
  if (monthNum > 0) {
    const year = yearMatch ? Number(yearMatch[0]) : 2026;
    return year * 100 + monthNum;
  }

  const ddmmyyyy = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (ddmmyyyy) {
    const dd = Number(ddmmyyyy[1]);
    const mm = Number(ddmmyyyy[2]);
    const yy = Number(ddmmyyyy[3].length === 2 ? `20${ddmmyyyy[3]}` : ddmmyyyy[3]);
    return yy * 10000 + mm * 100 + dd;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? 0 : parsed;
}

interface GridColDef {
  key: GridColKey;
  label: string;
  align: 'left' | 'right' | 'center';
  type: 'text' | 'number' | 'select' | 'computed';
  minWidth: string;
  formula?: string;
}

const GRID_COLUMNS: GridColDef[] = [
  { key: 'month', label: 'Месяц', align: 'left', type: 'select', minWidth: '124px' },
  { key: 'brand', label: 'Бренд', align: 'left', type: 'text', minWidth: '120px' },
  { key: 'orderNo', label: 'Заказ№', align: 'left', type: 'text', minWidth: '115px' },
  { key: 'model', label: 'Модель', align: 'left', type: 'text', minWidth: '185px' },
  { key: 'color', label: 'Цвет', align: 'left', type: 'text', minWidth: '140px' },
  { key: 'rost', label: 'Рост', align: 'center', type: 'text', minWidth: '92px' },
  { key: 'qtyOrder', label: 'Заказ кол-во', align: 'right', type: 'number', minWidth: '95px' },
  { key: 'qtyCut', label: 'Крой кол-во', align: 'right', type: 'number', minWidth: '95px' },
  { key: 'cutPercent', label: 'Крой %', align: 'center', type: 'computed', minWidth: '78px', formula: '= Крой кол-во / Заказ кол-во * 100%' },
  { key: 'qtyDistribution', label: 'Раздача кол-во', align: 'right', type: 'number', minWidth: '105px' },
  { key: 'qtySewing', label: 'Пошив кол-во', align: 'right', type: 'number', minWidth: '95px' },
  { key: 'qtyPackaging', label: 'Упаковка кол-во', align: 'right', type: 'number', minWidth: '105px' },
  { key: 'qtyDefect', label: 'Брак', align: 'right', type: 'number', minWidth: '75px' },
  { key: 'defectPercent', label: 'Брак %', align: 'center', type: 'computed', minWidth: '75px', formula: '= Брак / Раздача кол-во * 100%' },
  { key: 'qtyTotalPack', label: 'Общ-упак', align: 'right', type: 'computed', minWidth: '90px', formula: '= Упаковка кол-во + Брак' },
  { key: 'difference', label: 'Разница', align: 'right', type: 'computed', minWidth: '85px', formula: '= Раздача кол-во - Общ-упак' },
  { key: 'qtyShipped', label: 'Отгрузка', align: 'right', type: 'number', minWidth: '85px' },
  { key: 'qtyStock', label: 'Остаток на складе', align: 'right', type: 'computed', minWidth: '115px', formula: '= Упаковка кол-во - Отгрузка' },
  { key: 'stockPercent', label: 'Остаток %', align: 'center', type: 'computed', minWidth: '85px', formula: '= Остаток на складе / Упаковка кол-во * 100%' },
  { key: 'percent', label: 'Закрытие %', align: 'center', type: 'computed', minWidth: '90px', formula: '= Общ-упак / Раздача кол-во * 100%' },
  { key: 'notes', label: 'Примечание', align: 'left', type: 'text', minWidth: '170px' }
];

const EXCEL_COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'];

function getExcelColLetter(idx: number): string {
  if (idx < EXCEL_COL_LETTERS.length) return EXCEL_COL_LETTERS[idx];
  let n = idx;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

type ReportSizeStage = 'all' | 'order' | 'cut' | 'dist' | 'sew' | 'pack' | 'rem';

const REPORT_STAGE_LABELS: Record<ReportSizeStage, string> = {
  all: 'Все этапы',
  order: 'Заказ',
  cut: 'Крой',
  dist: 'Раздача',
  sew: 'Пошив',
  pack: 'Упаковка',
  rem: 'Остаток'
};

// =========================================================================
// АДАПТИВНЫЕ РАЗМЕРНЫЕ СЕТКИ ПО ЗАКАЗАМ (XS-3XL, 88-112, 44-64, 116-164)
// =========================================================================

function distributeQtyAcrossSizes(total: number, sizes: string[], activeSlots: number): number[] {
  const count = sizes.length;
  const result = new Array(count).fill(0);
  if (total <= 0 || count === 0) return result;

  const usable = Math.max(1, Math.min(count, activeSlots));
  // Веса по колоколообразной кривой (середина размерного ряда больше)
  const weights: number[] = [];
  const mid = (usable - 1) / 2;
  for (let i = 0; i < usable; i++) {
    const distFromMid = Math.abs(i - mid);
    weights.push(Math.max(0.45, 1.45 - distFromMid * 0.25));
  }
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const raw = weights.map(w => (total * w) / weightSum);
  const floored = raw.map(v => Math.floor(v));
  let remainder = total - floored.reduce((s, v) => s + v, 0);

  const remainders = raw.map((v, idx) => ({ idx, frac: v - floored[idx] })).sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder; i++) {
    floored[remainders[i % remainders.length].idx] += 1;
  }

  for (let i = 0; i < usable; i++) {
    result[i] = floored[i];
  }
  return result;
}

function buildDefaultSizeMatrixForRow(row: FactoryLedgerRow, presetOverride?: Exclude<SizePresetId, 'custom'>): OrderSizeMatrix {
  const presetId = presetOverride || detectSizePresetForRow(row);
  const sizes = [...SIZE_PRESETS[presetId].sizes];
  // Если в линейке >= 7 размеров (напр. XS..3XL или 88..112), оставляем последние 2 размера пустыми при небольших/средних заказах как в образце фабрики, или заполняем все при крупных
  const activeSlots = sizes.length >= 7 && row.qtyOrder < 6000 ? sizes.length - 2 : sizes.length;

  const ordArr = distributeQtyAcrossSizes(row.qtyOrder, sizes, activeSlots);
  const cutArr = distributeQtyAcrossSizes(row.qtyCut, sizes, activeSlots);
  const distArr = distributeQtyAcrossSizes(row.qtyDistribution, sizes, activeSlots);
  const sewArr = distributeQtyAcrossSizes(row.qtySewing, sizes, activeSlots);
  const packArr = distributeQtyAcrossSizes(row.qtyPackaging, sizes, activeSlots);

  const values: Record<string, SizeCellValues> = {};
  sizes.forEach((sz, idx) => {
    values[sz] = {
      order: ordArr[idx],
      cut: cutArr[idx],
      dist: distArr[idx],
      sew: sewArr[idx],
      pack: packArr[idx]
    };
  });

  return {
    rowId: row.id,
    presetId,
    sizes,
    values,
    defect: row.qtyDefect || 0
  };
}

function isRowEmptyDraft(row: FactoryLedgerRow): boolean {
  return (
    !row.orderNo.trim() &&
    !row.model.trim() &&
    !row.color.trim() &&
    !(row.colorCode || '').trim() &&
    !(row.rost || '').trim() &&
    !(row.notes || '').trim() &&
    row.qtyOrder === 0 &&
    row.qtyCut === 0 &&
    row.qtyDistribution === 0 &&
    row.qtySewing === 0 &&
    row.qtyPackaging === 0 &&
    row.qtyDefect === 0 &&
    row.qtyShipped === 0
  );
}

interface OrdersViewProps {
  orders?: Order[];
  customers?: Customer[];
  boxes?: WarehouseBox[];
  onUpdateBoxes?: (updatedBoxes: WarehouseBox[]) => void;
  onAddOrder?: (order: Order) => void;
  onUpdateOrder?: (order: Order) => void;
  onDeleteOrder?: (id: string) => void;
  onSyncOrdersFromLedger?: (orders: Order[], rows: FactoryLedgerRow[], matrices: Record<string, OrderSizeMatrix>) => void;
  selectedOrderFromDashboard?: Order | null;
  onClearSelectedOrder?: () => void;
  currentUser?: AppUser | null;
  lang?: Language;
  onNavigateToTab?: (tab: string) => void;
}

export default function OrdersView(props: OrdersViewProps) {
  const { onSyncOrdersFromLedger, selectedOrderFromDashboard, onClearSelectedOrder, lang = 'ru' } = props;

  // Разделение на 3 независимых рабочих пространства:
  // 1) Ввод данных (size_matrix, excel_paste, settings_photo5)
  // 2) Обновление заказов по папкам (folders_update)
  // 3) Мониторинг и анализ (строго только просмотр: table_photo1, diff_razd_upak, dashboard_photo2, summary_photo3, colors_photo4)
  const [activeTabMode, setActiveTabMode] = useState<
    'size_matrix' | 'excel_paste' | 'folders_update' | 'table_photo1' | 'diff_razd_upak' | 'dashboard_photo2' | 'summary_photo3' | 'colors_photo4' | 'settings_photo5'
  >('size_matrix');
  const [lastMonitorTab, setLastMonitorTab] = useState<
    'table_photo1' | 'diff_razd_upak' | 'dashboard_photo2' | 'summary_photo3' | 'colors_photo4'
  >('table_photo1');
  const isEntryWorkspace =
    activeTabMode === 'size_matrix' || activeTabMode === 'excel_paste' || activeTabMode === 'settings_photo5';
  const isFoldersWorkspace = activeTabMode === 'folders_update';
  const isMonitorWorkspace = !isEntryWorkspace && !isFoldersWorkspace;

  // Боковая панель ввода данных + модал фото модели + передача вставленной таблицы в Excel-лист
  const [isEntrySidebarCollapsed, setIsEntrySidebarCollapsed] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [entryListSearch, setEntryListSearch] = useState('');
  const [entryListMonth, setEntryListMonth] = useState<string>('all');
  const [entryListBrand, setEntryListBrand] = useState<string>('all');
  const [lastAddedOrderNo, setLastAddedOrderNo] = useState<string | null>(null);
  const matrixEditorTopRef = useRef<HTMLDivElement>(null);
  const ordersListSectionRef = useRef<HTMLDivElement>(null);
  const [isModelImageModalOpen, setIsModelImageModalOpen] = useState(false);
  const [previewOrderRowId, setPreviewOrderRowId] = useState<string>('');
  const [pendingExcelPasteGrid, setPendingExcelPasteGrid] = useState<string[][] | null>(null);

  // Режим отображения размеров в отчетах: по умолчанию горизонтальные столбцы (с переключателем на компактный)
  const [reportSizeDisplayMode, setReportSizeDisplayMode] = useState<'compact' | 'horizontal'>('horizontal');
  const [reportSizeStage, setReportSizeStage] = useState<ReportSizeStage>('all');

  // Режим отображения матрицы ввода: этапы выбранной позиции ИЛИ все цвета/росты заказа горизонтально (размеры в столбцах)
  const [matrixLayoutMode, setMatrixLayoutMode] = useState<'stages' | 'variants'>('stages');
  const [variantsGridStage, setVariantsGridStage] = useState<keyof SizeCellValues>('order');

  // Полноэкранный режим таблицы производства
  const [isTableFullscreen, setIsTableFullscreen] = useState(false);

  // Месяцы (сохраняются в localStorage, можно добавлять новые)
  const [monthsList, setMonthsList] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_MONTHS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn(e);
    }
    return DEFAULT_MONTHS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_MONTHS_KEY, JSON.stringify(monthsList));
    } catch (e) {
      console.warn(e);
    }
  }, [monthsList]);

  // Бренды (Texnoavia, Stark Cotton, Sab collection, TodoModa + пользовательские)
  const [brandsList, setBrandsList] = useState<string[]>(() => loadBrandsList());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_BRANDS_KEY, JSON.stringify(brandsList));
    } catch (e) {
      console.warn(e);
    }
  }, [brandsList]);

  // Единоразовая загрузка данных с автоочисткой старых демо-строк r-1..r-34
  const initialStore = useMemo(() => loadOrdersAndMatrices(), []);

  // Строки производства + матрицы размеров
  const [ledgerRows, setLedgerRows] = useState<FactoryLedgerRow[]>(initialStore.rows);
  const [sizeMatrices, setSizeMatrices] = useState<Record<string, OrderSizeMatrix>>(initialStore.matrices);

  // Сессия ввода новых заказов: ранее сохранённые заказы скрыты из таблицы ввода по умолчанию, чтобы не мешать
  const [entrySessionRowIds, setEntrySessionRowIds] = useState<string[]>([]);
  const [showSavedInExcel, setShowSavedInExcel] = useState<boolean>(false);

  // Все показатели этапов автоматически рассчитываются из «Размеры по заказу»
  const derivedLedgerRows = useMemo(
    () => ledgerRows.map(row => recalcLedgerRowFromMatrix(row, sizeMatrices[row.id])),
    [ledgerRows, sizeMatrices]
  );

  // Только заполненные (не пустые черновые) строки для хранения, Мониторинга и Накладной
  const committedLedgerRows = useMemo(
    () => derivedLedgerRows.filter(row => !isRowEmptyDraft(row)),
    [derivedLedgerRows]
  );

  // Строки для таблицы ввода Excel (по умолчанию — только новые строки текущей сессии)
  const excelEntryRows = useMemo(() => {
    if (showSavedInExcel) return derivedLedgerRows;
    const idSet = new Set(entrySessionRowIds);
    return derivedLedgerRows.filter(row => idSet.has(row.id));
  }, [derivedLedgerRows, entrySessionRowIds, showSavedInExcel]);

  const savedArchiveCount = useMemo(() => {
    const idSet = new Set(entrySessionRowIds);
    return committedLedgerRows.filter(r => !idSet.has(r.id)).length;
  }, [committedLedgerRows, entrySessionRowIds]);

  // Фильтры
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [selectedOrderNo, setSelectedOrderNo] = useState('all');
  const [selectedModel, setSelectedModel] = useState('all');
  const [selectedColor, setSelectedColor] = useState('all');

  // Сортировка по столбцам
  const [sortConfig, setSortConfig] = useState<{ key: GridColKey | null; dir: 'asc' | 'desc' }>({
    key: null,
    dir: 'asc'
  });
  const [entryListSortConfig, setEntryListSortConfig] = useState<{
    key: EntryListSortKey | null;
    dir: 'asc' | 'desc';
  }>({
    key: null,
    dir: 'desc'
  });
  const [summarySortConfig, setSummarySortConfig] = useState<{
    key: SummarySortKey | null;
    dir: 'asc' | 'desc';
  }>({
    key: null,
    dir: 'desc'
  });

  // Добавление нового месяца и нового бренда
  const [isAddMonthOpen, setIsAddMonthOpen] = useState(false);
  const [newMonthName, setNewMonthName] = useState('Декабрь');
  const [newMonthYear, setNewMonthYear] = useState('2026');
  const [customMonthInput, setCustomMonthInput] = useState('');

  const [isAddBrandOpen, setIsAddBrandOpen] = useState(false);
  const [newBrandInput, setNewBrandInput] = useState('');

  // Создание нового заказа прямо в «Размеры по заказу»
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [newOrderForm, setNewOrderForm] = useState<{
    month: string;
    brand: string;
    customBrandInput: string;
    orderNo: string;
    model: string;
    color: string;
    colorCode: string;
    rost: string;
    createAll4Rosts: boolean;
    presetId: SizePresetId;
    selectedSizes: string[];
    customSizesText: string;
    notes: string;
  }>({
    month: DEFAULT_MONTHS[0],
    brand: DEFAULT_BRANDS[0],
    customBrandInput: '',
    orderNo: '',
    model: '',
    color: '',
    colorCode: '',
    rost: '',
    createAll4Rosts: false,
    presetId: 'alpha_xs_3xl',
    selectedSizes: [...SIZE_PRESETS.alpha_xs_3xl.sizes],
    customSizesText: 'XS, S, M, L, XL, 2XL, 3XL',
    notes: ''
  });

  // Добавление дополнительного Цвета / Роста к текущему заказу
  const [isAddVariantOpen, setIsAddVariantOpen] = useState(false);
  const [variantForm, setVariantForm] = useState<{
    color: string;
    colorCode: string;
    rost: string;
    createAll4Rosts: boolean;
  }>({
    color: '',
    colorCode: '',
    rost: '',
    createAll4Rosts: false
  });

  // Модал подтверждения удаления заказа/строки
  const [rowToDelete, setRowToDelete] = useState<FactoryLedgerRow | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [isClearAllConfirmOpen, setIsClearAllConfirmOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState('');

  // Excel-подобная интерактивность таблицы
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [selectionRange, setSelectionRange] = useState<{
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  } | null>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);

  const cellRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  const modelImageInputRef = useRef<HTMLInputElement>(null);

  // Фотографии / эскизы моделей по заказу или модели
  const [modelImages, setModelImages] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_IMAGES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {
      console.warn(e);
    }
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_IMAGES_KEY, JSON.stringify(modelImages));
    } catch (e) {
      console.warn(e);
    }
  }, [modelImages]);

  const [selectedSizeRowId, setSelectedSizeRowId] = useState<string>(() => initialStore.rows[0]?.id || '');
  const [newCustomSizeInput, setNewCustomSizeInput] = useState<string>('');
  const [bulkSizeInput, setBulkSizeInput] = useState<string>('');
  const [showCustomSizeEditor, setShowCustomSizeEditor] = useState(false);
  const [hideEmptyMatrixSizes, setHideEmptyMatrixSizes] = useState(false);
  const [editingSizeCol, setEditingSizeCol] = useState<string | null>(null);
  const [editingSizeColDraft, setEditingSizeColDraft] = useState<string>('');
  const [sizeMatrixActiveCell, setSizeMatrixActiveCell] = useState<{ row: number; col: number } | null>(null);
  const sizeMatrixManualCaretRef = useRef(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const isInitialMountRef = useRef(true);

  // Автосохранение и глобальная синхронизация в Дашборд и остальные вкладки (без пустых черновиков)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ROWS_KEY, JSON.stringify(committedLedgerRows));
      localStorage.setItem(STORAGE_MATRICES_KEY, JSON.stringify(sizeMatrices));
    } catch (e) {
      console.warn('Storage save error:', e);
    }
    notifyOrdersStoreUpdated();
    if (onSyncOrdersFromLedger) {
      onSyncOrdersFromLedger(
        ledgerRowsToAppOrders(committedLedgerRows, sizeMatrices),
        committedLedgerRows,
        sizeMatrices
      );
    }
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
    } else {
      setHasUnsavedChanges(true);
    }
  }, [committedLedgerRows, sizeMatrices, onSyncOrdersFromLedger]);

  // Переход из Дашборда к конкретному заказу в «Размеры по заказу»
  useEffect(() => {
    if (selectedOrderFromDashboard) {
      const exists = ledgerRows.find(r => r.id === selectedOrderFromDashboard.id);
      if (exists) {
        setEntrySessionRowIds(prev => (prev.includes(exists.id) ? prev : [...prev, exists.id]));
        setSelectedSizeRowId(exists.id);
        setActiveTabMode('size_matrix');
      }
      onClearSelectedOrder?.();
    }
  }, [selectedOrderFromDashboard, ledgerRows, onClearSelectedOrder]);

  // Уведомления
  const [notification, setNotification] = useState<string | null>(null);
  const showNotice = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  }, []);

  // Явное сохранение заказа(ов) и всех матриц по кнопке «Сохранить» или Ctrl+S
  const handleSaveOrderChanges = useCallback(() => {
    const savedRows = derivedLedgerRows.filter(r => !isRowEmptyDraft(r));
    try {
      localStorage.setItem(STORAGE_ROWS_KEY, JSON.stringify(savedRows));
      localStorage.setItem(STORAGE_MATRICES_KEY, JSON.stringify(sizeMatrices));
      localStorage.setItem(STORAGE_MONTHS_KEY, JSON.stringify(monthsList));
      localStorage.setItem(STORAGE_BRANDS_KEY, JSON.stringify(brandsList));
      localStorage.setItem(STORAGE_IMAGES_KEY, JSON.stringify(modelImages));
    } catch (e) {
      console.warn('Manual save error:', e);
    }
    notifyOrdersStoreUpdated();
    if (onSyncOrdersFromLedger) {
      onSyncOrdersFromLedger(
        ledgerRowsToAppOrders(savedRows, sizeMatrices),
        savedRows,
        sizeMatrices
      );
    }
    const timeStr = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // Переносим сохранённые заказы в Мониторинг и оставляем чистый лист для новых заказов
    setLedgerRows(prev => prev.filter(r => !isRowEmptyDraft(r)));
    setEntrySessionRowIds([]);
    setShowSavedInExcel(false);
    setHasUnsavedChanges(false);
    setLastSavedAt(timeStr);

    const curRow = savedRows.find(r => r.id === selectedSizeRowId);
    if (curRow?.orderNo) {
      setLastAddedOrderNo(curRow.orderNo);
    }
    showNotice(
      lang === 'uz'
        ? "Yangi zakaz qo'shildi!"
        : 'Новый заказ добавлен!'
    );
  }, [
    derivedLedgerRows,
    sizeMatrices,
    monthsList,
    brandsList,
    modelImages,
    onSyncOrdersFromLedger,
    selectedSizeRowId,
    showNotice,
    lang
  ]);

  // Сохранение из раздела «Папки заказов» без сброса открытой папки и без очистки таблицы ввода
  const handleFolderSaveAll = useCallback(() => {
    const savedRows = derivedLedgerRows.filter(r => !isRowEmptyDraft(r));
    try {
      localStorage.setItem(STORAGE_ROWS_KEY, JSON.stringify(savedRows));
      localStorage.setItem(STORAGE_MATRICES_KEY, JSON.stringify(sizeMatrices));
      localStorage.setItem(STORAGE_MONTHS_KEY, JSON.stringify(monthsList));
      localStorage.setItem(STORAGE_BRANDS_KEY, JSON.stringify(brandsList));
      localStorage.setItem(STORAGE_IMAGES_KEY, JSON.stringify(modelImages));
    } catch (e) {
      console.warn('Folder save error:', e);
    }
    notifyOrdersStoreUpdated();
    if (onSyncOrdersFromLedger) {
      onSyncOrdersFromLedger(
        ledgerRowsToAppOrders(savedRows, sizeMatrices),
        savedRows,
        sizeMatrices
      );
    }
    const timeStr = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    setHasUnsavedChanges(false);
    setLastSavedAt(timeStr);
    showNotice(
      lang === 'uz'
        ? `Papka o'zgarishlari saqlandi va Monitoring bilan sinxronlandi (${timeStr})`
        : `Изменения в папке сохранены и синхронизированы с Мониторингом (${timeStr})`
    );
  }, [
    derivedLedgerRows,
    sizeMatrices,
    monthsList,
    brandsList,
    modelImages,
    onSyncOrdersFromLedger,
    showNotice,
    lang
  ]);

  // Горячая клавиша Ctrl+S / Cmd+S во «Вводе данных» и «Папках заказов»
  useEffect(() => {
    const onKeySave = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (isEntryWorkspace) {
          e.preventDefault();
          handleSaveOrderChanges();
        } else if (isFoldersWorkspace) {
          e.preventDefault();
          handleFolderSaveAll();
        }
      }
    };
    window.addEventListener('keydown', onKeySave);
    return () => window.removeEventListener('keydown', onKeySave);
  }, [isEntryWorkspace, isFoldersWorkspace, handleSaveOrderChanges, handleFolderSaveAll]);

  // Завершение выделения мышкой при отпускании кнопки в любом месте окна
  useEffect(() => {
    const handleMouseUp = () => setIsDraggingSelection(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Выход из полноэкранного режима по Escape
  useEffect(() => {
    const handleEscFullscreen = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isTableFullscreen && !rowToDelete && !folderToDelete && !isClearAllConfirmOpen && !isAddMonthOpen && !isModelImageModalOpen) {
        setIsTableFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleEscFullscreen);
    return () => window.removeEventListener('keydown', handleEscFullscreen);
  }, [isTableFullscreen, rowToDelete, folderToDelete, isClearAllConfirmOpen, isAddMonthOpen, isModelImageModalOpen]);

  // Уникальные значения для фильтров (строго из derivedLedgerRows)
  const uniqueMonths = useMemo(() => {
    const set = new Set<string>(monthsList);
    derivedLedgerRows.forEach(r => {
      if (r.month) set.add(r.month);
    });
    return Array.from(set);
  }, [monthsList, derivedLedgerRows]);

  const uniqueBrands = useMemo(() => {
    const set = new Set<string>(brandsList);
    derivedLedgerRows.forEach(r => {
      if (r.brand) set.add(r.brand);
    });
    return Array.from(set);
  }, [brandsList, derivedLedgerRows]);

  const uniqueOrderNos = useMemo(() => Array.from(new Set(derivedLedgerRows.map(r => r.orderNo))), [derivedLedgerRows]);
  const uniqueModels = useMemo(() => Array.from(new Set(derivedLedgerRows.map(r => r.model))), [derivedLedgerRows]);
  const uniqueColors = useMemo(() => Array.from(new Set(derivedLedgerRows.map(r => r.color))), [derivedLedgerRows]);

  // Вычисление процента кроя к заказу, брака, остатка и закрытия для строки
  const getRowMetrics = useCallback((r: FactoryLedgerRow) => {
    const cutPct = r.qtyOrder > 0 ? (r.qtyCut / r.qtyOrder) * 100 : 0;
    const defectPct = r.qtyDistribution > 0 ? (r.qtyDefect / r.qtyDistribution) * 100 : 0;
    const stockPct = r.qtyPackaging > 0 ? (r.qtyStock / r.qtyPackaging) * 100 : 0;
    const closePct = r.qtyDistribution > 0 ? (r.qtyTotalPack / r.qtyDistribution) * 100 : 0;
    const diffPure = (r.qtyDistribution || 0) - (r.qtyPackaging || 0);
    const diffPurePct = r.qtyDistribution > 0 ? (diffPure / r.qtyDistribution) * 100 : 0;
    return { cutPct, defectPct, stockPct, closePct, diffPure, diffPurePct };
  }, []);

  // Фильтрация + сортировка (без пустых черновых строк)
  const filteredRows = useMemo(() => {
    const base = committedLedgerRows.filter(row => {
      const q = searchFilter.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (row.brand || '').toLowerCase().includes(q) ||
        row.orderNo.toLowerCase().includes(q) ||
        row.model.toLowerCase().includes(q) ||
        row.color.toLowerCase().includes(q) ||
        (row.rost || '').toLowerCase().includes(q) ||
        (row.notes || '').toLowerCase().includes(q) ||
        (row.month || '').toLowerCase().includes(q);

      const matchesMonth = selectedMonth === 'all' || (row.month || DEFAULT_MONTHS[0]) === selectedMonth;
      const matchesBrand = selectedBrand === 'all' || (row.brand || '') === selectedBrand;
      const matchesOrderNo = selectedOrderNo === 'all' || row.orderNo === selectedOrderNo;
      const matchesModel = selectedModel === 'all' || row.model === selectedModel;
      const matchesColor = selectedColor === 'all' || row.color === selectedColor;

      return matchesSearch && matchesMonth && matchesBrand && matchesOrderNo && matchesModel && matchesColor;
    });

    if (!sortConfig.key) return base;

    const k = sortConfig.key;
    const dir = sortConfig.dir === 'asc' ? 1 : -1;

    return [...base].sort((a, b) => {
      if (k === 'month') {
        const av = parseMonthSortValue(a.month || DEFAULT_MONTHS[0]);
        const bv = parseMonthSortValue(b.month || DEFAULT_MONTHS[0]);
        if (av !== bv) return (av - bv) * dir;
        return String(a.month || '').localeCompare(String(b.month || ''), 'ru') * dir;
      }
      if (k === 'cutPercent') {
        const av = a.qtyOrder > 0 ? a.qtyCut / a.qtyOrder : 0;
        const bv = b.qtyOrder > 0 ? b.qtyCut / b.qtyOrder : 0;
        return (av - bv) * dir;
      }
      if (k === 'defectPercent') {
        const av = a.qtyDistribution > 0 ? a.qtyDefect / a.qtyDistribution : 0;
        const bv = b.qtyDistribution > 0 ? b.qtyDefect / b.qtyDistribution : 0;
        return (av - bv) * dir;
      }
      if (k === 'stockPercent') {
        const av = a.qtyPackaging > 0 ? a.qtyStock / a.qtyPackaging : 0;
        const bv = b.qtyPackaging > 0 ? b.qtyStock / b.qtyPackaging : 0;
        return (av - bv) * dir;
      }
      if (k === 'difference') {
        const av = (a.qtyDistribution || 0) - (a.qtyPackaging || 0);
        const bv = (b.qtyDistribution || 0) - (b.qtyPackaging || 0);
        return (av - bv) * dir;
      }
      if (k === 'percent') {
        const av = a.qtyDistribution > 0 ? a.qtyTotalPack / a.qtyDistribution : 0;
        const bv = b.qtyDistribution > 0 ? b.qtyTotalPack / b.qtyDistribution : 0;
        return (av - bv) * dir;
      }
      const valA = a[k as keyof FactoryLedgerRow];
      const valB = b[k as keyof FactoryLedgerRow];
      if (typeof valA === 'number' && typeof valB === 'number') {
        return (valA - valB) * dir;
      }
      return String(valA || '').localeCompare(String(valB || ''), 'ru') * dir;
    });
  }, [derivedLedgerRows, searchFilter, selectedMonth, selectedBrand, selectedOrderNo, selectedModel, selectedColor, sortConfig]);

  const sortedSummaryOrders = useMemo(() => {
    const groups = uniqueOrderNos
      .map(ordNo => {
        const rows = filteredRows.filter(r => r.orderNo === ordNo);
        if (rows.length === 0) return null;
        const model = rows[0]?.model || '';
        const brand = rows.map(r => r.brand).filter(Boolean)[0] || '—';
        const month = Array.from(new Set(rows.map(r => r.month))).join(', ');
        const ordQ = rows.reduce((s, r) => s + r.qtyOrder, 0);
        const cutQ = rows.reduce((s, r) => s + r.qtyCut, 0);
        const distQ = rows.reduce((s, r) => s + r.qtyDistribution, 0);
        const packQ = rows.reduce((s, r) => s + r.qtyPackaging, 0);
        const defectQ = rows.reduce((s, r) => s + r.qtyDefect, 0);
        const totalPackQ = rows.reduce((s, r) => s + r.qtyTotalPack, 0);
        const shipQ = rows.reduce((s, r) => s + r.qtyShipped, 0);
        const stockQ = rows.reduce((s, r) => s + r.qtyStock, 0);
        const cutRateVal = ordQ > 0 ? (cutQ / ordQ) * 100 : 0;
        const diffPure = distQ - packQ;
        const diffPurePct = distQ > 0 ? ((diffPure / distQ) * 100).toFixed(1) : '0.0';
        const defectRateVal = distQ > 0 ? (defectQ / distQ) * 100 : 0;
        const closeRateVal = distQ > 0 ? (totalPackQ / distQ) * 100 : 0;
        const isDone = shipQ >= ordQ && ordQ > 0;
        return {
          ordNo,
          rows,
          model,
          brand,
          month,
          ordQ,
          cutQ,
          distQ,
          packQ,
          defectQ,
          totalPackQ,
          shipQ,
          stockQ,
          cutRateVal,
          cutRate: cutRateVal.toFixed(1),
          diffPure,
          diffPurePct,
          defectRateVal,
          defectRate: defectRateVal.toFixed(1),
          closeRateVal,
          closeRate: closeRateVal.toFixed(1),
          isDone
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (!summarySortConfig.key) return groups;
    const k = summarySortConfig.key;
    const dir = summarySortConfig.dir === 'asc' ? 1 : -1;

    return [...groups].sort((a, b) => {
      if (k === 'month') {
        const av = parseMonthSortValue(a.month);
        const bv = parseMonthSortValue(b.month);
        if (av !== bv) return (av - bv) * dir;
        return a.month.localeCompare(b.month, 'ru') * dir;
      }
      if (k === 'brand') return a.brand.localeCompare(b.brand, 'ru') * dir;
      if (k === 'orderNo') return a.ordNo.localeCompare(b.ordNo, 'ru') * dir;
      if (k === 'model') return a.model.localeCompare(b.model, 'ru') * dir;
      if (k === 'ordQ') return (a.ordQ - b.ordQ) * dir;
      if (k === 'cutRate') return (a.cutRateVal - b.cutRateVal) * dir;
      if (k === 'distQ') return (a.distQ - b.distQ) * dir;
      if (k === 'packQ') return (a.packQ - b.packQ) * dir;
      if (k === 'diffPure') return (a.diffPure - b.diffPure) * dir;
      if (k === 'defectRate') return (a.defectRateVal - b.defectRateVal) * dir;
      if (k === 'closeRate') return (a.closeRateVal - b.closeRateVal) * dir;
      if (k === 'shipQ') return (a.shipQ - b.shipQ) * dir;
      if (k === 'stockQ') return (a.stockQ - b.stockQ) * dir;
      if (k === 'status') return ((a.isDone ? 1 : 0) - (b.isDone ? 1 : 0)) * dir;
      return 0;
    });
  }, [uniqueOrderNos, filteredRows, summarySortConfig]);

  // Итоговые показатели по таблице
  const totals = useMemo(() => {
    let orderQty = 0;
    let cutQty = 0;
    let distQty = 0;
    let sewQty = 0;
    let packQty = 0;
    let defectQty = 0;
    let totalPackQty = 0;
    let diffQty = 0;
    let shipQty = 0;
    let stockQty = 0;

    filteredRows.forEach(r => {
      orderQty += r.qtyOrder || 0;
      cutQty += r.qtyCut || 0;
      distQty += r.qtyDistribution || 0;
      sewQty += r.qtySewing || 0;
      packQty += r.qtyPackaging || 0;
      defectQty += r.qtyDefect || 0;
      totalPackQty += r.qtyTotalPack || 0;
      diffQty += r.difference || 0;
      shipQty += r.qtyShipped || 0;
      stockQty += r.qtyStock || 0;
    });

    const cutRatePercentNum = orderQty > 0 ? (cutQty / orderQty) * 100 : 0;
    const overallPercent = distQty > 0 ? (totalPackQty / distQty) * 100 : 0;
    const defectRatePercent = distQty > 0 ? (defectQty / distQty) * 100 : 0;
    const stockRatePercent = packQty > 0 ? (stockQty / packQty) * 100 : 0;
    const diffPureQty = distQty - packQty;
    const diffPurePct = distQty > 0 ? (diffPureQty / distQty) * 100 : 0;
    const distinctOrdersCount = new Set(
      filteredRows.map(r => (r.orderNo || '').trim().toLowerCase() || r.id)
    ).size;
    const distinctModelsCount = new Set(
      filteredRows.map(r => (r.model || '').trim().toLowerCase()).filter(Boolean)
    ).size;

    return {
      orderQty,
      cutQty,
      cutRatePercent: cutRatePercentNum.toFixed(1),
      distQty,
      sewQty,
      packQty,
      defectQty,
      totalPackQty,
      diffQty,
      diffPureQty,
      diffPurePct: diffPurePct.toFixed(1),
      shipQty,
      stockQty,
      overallPercent: overallPercent.toFixed(1),
      overallPercentNum: Math.round(overallPercent),
      defectRatePercent: defectRatePercent.toFixed(1),
      stockRatePercent: stockRatePercent.toFixed(1),
      distinctOrdersCount,
      distinctModelsCount,
      rowsCount: filteredRows.length
    };
  }, [filteredRows]);

  // Помощник получения значения этапа по конкретному размеру строки
  const getRowSizeStageQty = useCallback(
    (rowId: string, sz: string, stage: ReportSizeStage): number => {
      const cell = sizeMatrices[rowId]?.values?.[sz];
      if (!cell) return 0;
      if (stage === 'all') return Number(cell.order) || 0;
      if (stage === 'rem') return (Number(cell.order) || 0) - (Number(cell.pack) || 0);
      return Number(cell[stage]) || 0;
    },
    [sizeMatrices]
  );

  // Все этапы по конкретному размеру строки
  const getRowSizeAllStages = useCallback(
    (rowId: string, sz: string) => {
      const cell = sizeMatrices[rowId]?.values?.[sz];
      const order = Number(cell?.order) || 0;
      const cut = Number(cell?.cut) || 0;
      const dist = Number(cell?.dist) || 0;
      const sew = Number(cell?.sew) || 0;
      const pack = Number(cell?.pack) || 0;
      const rem = order - pack;
      return { order, cut, dist, sew, pack, rem };
    },
    [sizeMatrices]
  );

  // Горизонтальный список всех заполненных размеров в отфильтрованных строках мониторинга
  const monitoringUnionSizes = useMemo(() => {
    const populatedSet = new Set<string>();
    filteredRows.forEach(r => {
      getPopulatedSizes(sizeMatrices[r.id]).forEach(sz => populatedSet.add(sz));
    });
    if (populatedSet.size > 0) return Array.from(populatedSet);
    const fallbackSet = new Set<string>();
    filteredRows.forEach(r => {
      getEffectiveDisplaySizes(sizeMatrices[r.id]).forEach(sz => fallbackSet.add(sz));
    });
    return Array.from(fallbackSet);
  }, [filteredRows, sizeMatrices]);

  const showHorizontalReportSizes = reportSizeDisplayMode === 'horizontal' && monitoringUnionSizes.length > 0;

  const activeReportStages = useMemo(() => {
    const defs: { key: Exclude<ReportSizeStage, 'all'>; label: string }[] = [
      { key: 'order', label: 'Заказ' },
      { key: 'cut', label: 'Крой' },
      { key: 'dist', label: 'Раздача' },
      { key: 'sew', label: 'Пошив' },
      { key: 'pack', label: 'Упаковка' },
      { key: 'rem', label: 'Остаток' }
    ];
    return reportSizeStage === 'all' ? defs : defs.filter(d => d.key === reportSizeStage);
  }, [reportSizeStage]);

  const getGroupSizeStageNumeric = useCallback(
    (rowsGroup: FactoryLedgerRow[], sz: string, stageKey: Exclude<ReportSizeStage, 'all'>): number | null => {
      if (stageKey === 'rem') {
        let ordSum = 0;
        let packSum = 0;
        rowsGroup.forEach(r => {
          const st = getRowSizeAllStages(r.id, sz);
          ordSum += st.order;
          packSum += st.pack;
        });
        if (ordSum === 0 && packSum === 0) return null;
        return ordSum - packSum;
      }
      const sum = rowsGroup.reduce((s, r) => s + getRowSizeStageQty(r.id, sz, stageKey), 0);
      return sum !== 0 ? sum : null;
    },
    [getRowSizeAllStages, getRowSizeStageQty]
  );

  const monitoringSizeTotals = useMemo(() => {
    const map: Record<string, number> = {};
    monitoringUnionSizes.forEach(sz => {
      let sum = 0;
      filteredRows.forEach(r => {
        sum += getRowSizeStageQty(r.id, sz, reportSizeStage);
      });
      map[sz] = sum;
    });
    return map;
  }, [monitoringUnionSizes, filteredRows, getRowSizeStageQty, reportSizeStage]);

  const monitoringSizeAllTotals = useMemo(() => {
    const map: Record<string, { order: number; cut: number; dist: number; sew: number; pack: number; rem: number }> = {};
    monitoringUnionSizes.forEach(sz => {
      const acc = { order: 0, cut: 0, dist: 0, sew: 0, pack: 0, rem: 0 };
      filteredRows.forEach(r => {
        const st = getRowSizeAllStages(r.id, sz);
        acc.order += st.order;
        acc.cut += st.cut;
        acc.dist += st.dist;
        acc.sew += st.sew;
        acc.pack += st.pack;
        acc.rem += st.rem;
      });
      map[sz] = acc;
    });
    return map;
  }, [monitoringUnionSizes, filteredRows, getRowSizeAllStages]);

  const getTotalSizeStageNumeric = useCallback(
    (sz: string, stageKey: Exclude<ReportSizeStage, 'all'>): number => {
      const acc = monitoringSizeAllTotals[sz] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0, rem: 0 };
      return acc[stageKey] ?? 0;
    },
    [monitoringSizeAllTotals]
  );

  // Группировка заказов по Заказ № для левой боковой панели ввода данных
  const groupedEntryOrders = useMemo(() => {
    const q = sidebarSearch.toLowerCase().trim();
    const map = new Map<
      string,
      {
        orderNo: string;
        model: string;
        brand: string;
        month: string;
        totalOrder: number;
        rows: FactoryLedgerRow[];
      }
    >();
    derivedLedgerRows.forEach(r => {
      const key = (r.orderNo || '').trim().toLowerCase() || r.id;
      let grp = map.get(key);
      if (!grp) {
        grp = {
          orderNo: r.orderNo,
          model: r.model,
          brand: r.brand || '',
          month: r.month || '',
          totalOrder: 0,
          rows: []
        };
        map.set(key, grp);
      }
      grp.totalOrder += r.qtyOrder || 0;
      grp.rows.push(r);
    });
    const list = Array.from(map.values());
    if (!q) return list;
    return list.filter(
      g =>
        g.orderNo.toLowerCase().includes(q) ||
        g.model.toLowerCase().includes(q) ||
        g.brand.toLowerCase().includes(q) ||
        g.rows.some(
          r =>
            r.color.toLowerCase().includes(q) ||
            (r.colorCode || '').toLowerCase().includes(q) ||
            (r.rost || '').toLowerCase().includes(q)
        )
    );
  }, [derivedLedgerRows, sidebarSearch]);

  // Полный реестр добавленных заказов для списка заказов в рабочей зоне «Ввод данных»
  const allGroupedOrdersDirectory = useMemo(() => {
    const map = new Map<
      string,
      {
        orderNo: string;
        model: string;
        brand: string;
        month: string;
        totalOrder: number;
        totalCut: number;
        totalDist: number;
        totalSew: number;
        totalPack: number;
        totalDefect: number;
        totalShipped: number;
        totalStock: number;
        sizesList: string[];
        rows: FactoryLedgerRow[];
      }
    >();

    derivedLedgerRows.forEach(r => {
      const key = (r.orderNo || '').trim().toLowerCase() || r.id;
      let grp = map.get(key);
      if (!grp) {
        grp = {
          orderNo: r.orderNo,
          model: r.model,
          brand: r.brand || '',
          month: r.month || '',
          totalOrder: 0,
          totalCut: 0,
          totalDist: 0,
          totalSew: 0,
          totalPack: 0,
          totalDefect: 0,
          totalShipped: 0,
          totalStock: 0,
          sizesList: [],
          rows: []
        };
        map.set(key, grp);
      }
      grp.totalOrder += r.qtyOrder || 0;
      grp.totalCut += r.qtyCut || 0;
      grp.totalDist += r.qtyDistribution || 0;
      grp.totalSew += r.qtySewing || 0;
      grp.totalPack += r.qtyPackaging || 0;
      grp.totalDefect += r.qtyDefect || 0;
      grp.totalShipped += r.qtyShipped || 0;
      grp.totalStock += r.qtyStock || 0;
      const mat = sizeMatrices[r.id];
      if (mat) {
        getEffectiveDisplaySizes(mat).forEach(sz => {
          if (!grp!.sizesList.includes(sz)) grp!.sizesList.push(sz);
        });
      }
      grp.rows.push(r);
    });

    return Array.from(map.values());
  }, [derivedLedgerRows, sizeMatrices]);

  const filteredEntryOrderGroups = useMemo(() => {
    const q = entryListSearch.toLowerCase().trim();
    const list = allGroupedOrdersDirectory.filter(g => {
      if (entryListMonth !== 'all' && !g.rows.some(r => r.month === entryListMonth)) return false;
      if (entryListBrand !== 'all' && !g.rows.some(r => (r.brand || '') === entryListBrand)) return false;
      if (!q) return true;
      return (
        g.orderNo.toLowerCase().includes(q) ||
        g.model.toLowerCase().includes(q) ||
        g.brand.toLowerCase().includes(q) ||
        g.month.toLowerCase().includes(q) ||
        g.rows.some(
          r =>
            r.color.toLowerCase().includes(q) ||
            (r.colorCode || '').toLowerCase().includes(q) ||
            (r.rost || '').toLowerCase().includes(q)
        )
      );
    });

    if (!entryListSortConfig.key) return list;
    const k = entryListSortConfig.key;
    const dir = entryListSortConfig.dir === 'asc' ? 1 : -1;

    const getMetrics = (g: (typeof list)[number]) => {
      const cutPct = g.totalOrder > 0 ? (g.totalCut / g.totalOrder) * 100 : 0;
      const totalPackAll = g.totalPack + g.totalDefect;
      const closePct =
        g.totalDist > 0
          ? (totalPackAll / g.totalDist) * 100
          : g.totalOrder > 0
          ? (g.totalPack / g.totalOrder) * 100
          : 0;
      const remaining = g.totalOrder - g.totalPack;
      return { cutPct, closePct, remaining };
    };

    return [...list].sort((a, b) => {
      if (k === 'month') {
        const av = parseMonthSortValue(a.month || DEFAULT_MONTHS[0]);
        const bv = parseMonthSortValue(b.month || DEFAULT_MONTHS[0]);
        if (av !== bv) return (av - bv) * dir;
        return String(a.month || '').localeCompare(String(b.month || ''), 'ru') * dir;
      }
      if (k === 'orderNo') return (a.orderNo || '').localeCompare(b.orderNo || '', 'ru') * dir;
      if (k === 'brand') return (a.brand || '').localeCompare(b.brand || '', 'ru') * dir;
      if (k === 'totalOrder') return (a.totalOrder - b.totalOrder) * dir;
      if (k === 'totalDist') return (a.totalDist - b.totalDist) * dir;
      if (k === 'totalPack') return (a.totalPack - b.totalPack) * dir;
      if (k === 'cutPct') return (getMetrics(a).cutPct - getMetrics(b).cutPct) * dir;
      if (k === 'remaining') return (getMetrics(a).remaining - getMetrics(b).remaining) * dir;
      if (k === 'closePct') return (getMetrics(a).closePct - getMetrics(b).closePct) * dir;
      return 0;
    });
  }, [allGroupedOrdersDirectory, entryListSearch, entryListMonth, entryListBrand, entryListSortConfig]);

  const handleSelectOrderFromList = (rowId: string, scrollToEditor = true) => {
    setSelectedSizeRowId(rowId);
    setActiveTabMode('size_matrix');
    if (scrollToEditor) {
      setTimeout(() => {
        matrixEditorTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
  };

  // Пересчет зависимых формул строки
  const recalcRow = (row: FactoryLedgerRow): FactoryLedgerRow => {
    const pack = Number(row.qtyPackaging) || 0;
    const defect = Number(row.qtyDefect) || 0;
    const dist = Number(row.qtyDistribution) || 0;
    const ship = Number(row.qtyShipped) || 0;

    const totalPack = pack + defect;
    const difference = dist - totalPack;
    const stock = Math.max(0, pack - ship);
    const percent = dist > 0 ? Math.round((totalPack / dist) * 100) : 0;

    return {
      ...row,
      qtyTotalPack: totalPack,
      difference,
      qtyStock: stock,
      percent
    };
  };


  // Получить отображаемое/текстовое значение ячейки (для копирования, fx-строки и редактирования)
  const getCellRawValue = useCallback(
    (row: FactoryLedgerRow, key: GridColKey): string | number => {
      if (key === 'cutPercent') {
        return `${getRowMetrics(row).cutPct.toFixed(1)}%`;
      }
      if (key === 'defectPercent') {
        return `${getRowMetrics(row).defectPct.toFixed(1)}%`;
      }
      if (key === 'stockPercent') {
        return `${getRowMetrics(row).stockPct.toFixed(1)}%`;
      }
      if (key === 'percent') {
        return `${getRowMetrics(row).closePct.toFixed(1)}%`;
      }
      return row[key as keyof FactoryLedgerRow] ?? '';
    },
    [getRowMetrics]
  );

  // Нормализация границ выделения
  const normalizedSelection = useMemo(() => {
    if (!selectionRange) return null;
    return {
      minR: Math.min(selectionRange.startRow, selectionRange.endRow),
      maxR: Math.max(selectionRange.startRow, selectionRange.endRow),
      minC: Math.min(selectionRange.startCol, selectionRange.endCol),
      maxC: Math.max(selectionRange.startCol, selectionRange.endCol)
    };
  }, [selectionRange]);

  // Статистика по выделенным ячейкам (как в нижней панели Excel)
  const selectionStats = useMemo(() => {
    if (!normalizedSelection) return null;
    let count = 0;
    let numericCount = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let r = normalizedSelection.minR; r <= normalizedSelection.maxR; r++) {
      const row = filteredRows[r];
      if (!row) continue;
      for (let c = normalizedSelection.minC; c <= normalizedSelection.maxC; c++) {
        count++;
        const colDef = GRID_COLUMNS[c];
        if (!colDef) continue;
        if (colDef.type === 'number' || colDef.key === 'qtyTotalPack' || colDef.key === 'difference' || colDef.key === 'qtyStock') {
          const v = Number(row[colDef.key as keyof FactoryLedgerRow]) || 0;
          numericCount++;
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }

    return {
      count,
      numericCount,
      sum,
      avg: numericCount > 0 ? sum / numericCount : 0,
      min: numericCount > 0 ? min : 0,
      max: numericCount > 0 ? max : 0
    };
  }, [normalizedSelection, filteredRows]);

  // Переход к конкретной ячейке и фокусировка
  const moveToCell = useCallback(
    (nextRow: number, nextCol: number, extendSelection = false) => {
      if (filteredRows.length === 0) return;
      const clampedRow = Math.max(0, Math.min(filteredRows.length - 1, nextRow));
      const clampedCol = Math.max(0, Math.min(GRID_COLUMNS.length - 1, nextCol));

      setActiveCell({ row: clampedRow, col: clampedCol });
      if (extendSelection && selectionRange) {
        setSelectionRange({
          ...selectionRange,
          endRow: clampedRow,
          endCol: clampedCol
        });
      } else {
        setSelectionRange({
          startRow: clampedRow,
          startCol: clampedCol,
          endRow: clampedRow,
          endCol: clampedCol
        });
      }

      const cellEl = cellRefs.current[`${clampedRow}:${clampedCol}`];
      if (cellEl) {
        cellEl.focus();
        cellEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    },
    [filteredRows.length, selectionRange]
  );


  // Копирование выделенных ячеек (Ctrl+C)
  const handleCopySelection = useCallback(async () => {
    if (!normalizedSelection) return;
    const lines: string[] = [];
    for (let r = normalizedSelection.minR; r <= normalizedSelection.maxR; r++) {
      const row = filteredRows[r];
      if (!row) continue;
      const vals: string[] = [];
      for (let c = normalizedSelection.minC; c <= normalizedSelection.maxC; c++) {
        const col = GRID_COLUMNS[c];
        vals.push(String(getCellRawValue(row, col.key)));
      }
      lines.push(vals.join('\t'));
    }
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showNotice(`Скопировано ячеек: ${selectionStats?.count || 1}`);
    } catch {
      showNotice('Готово к вставке');
    }
  }, [normalizedSelection, filteredRows, getCellRawValue, selectionStats]);


  // Обработка клавиш в режиме выделенной ячейки (Таблица производства — строго ТОЛЬКО ПРОСМОТР)
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLTableCellElement>, rIdx: number, cIdx: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveToCell(rIdx + 1, cIdx, e.shiftKey);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveToCell(rIdx - 1, cIdx, e.shiftKey);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveToCell(rIdx, cIdx + 1, e.shiftKey);
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveToCell(rIdx, cIdx - 1, e.shiftKey);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (cIdx > 0) moveToCell(rIdx, cIdx - 1);
        else if (rIdx > 0) moveToCell(rIdx - 1, GRID_COLUMNS.length - 1);
      } else {
        if (cIdx < GRID_COLUMNS.length - 1) moveToCell(rIdx, cIdx + 1);
        else if (rIdx < filteredRows.length - 1) moveToCell(rIdx + 1, 0);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С')) {
      e.preventDefault();
      handleCopySelection();
    }
  };


  // Добавить новый бренд
  const handleCreateNewBrand = (rawName?: string) => {
    const label = (rawName ?? newBrandInput).trim();
    if (!label) return '';
    if (!brandsList.includes(label)) {
      setBrandsList(prev => [...prev, label]);
    }
    setNewBrandInput('');
    setIsAddBrandOpen(false);
    showNotice(`Бренд «${label}» добавлен!`);
    return label;
  };

  // Добавить новый месяц
  const handleCreateNewMonth = () => {
    const label = customMonthInput.trim() || `${newMonthName} ${newMonthYear}`;
    if (!label) return;
    if (!monthsList.includes(label)) {
      setMonthsList(prev => [...prev, label]);
    }
    setSelectedMonth(label);
    setCustomMonthInput('');
    setIsAddMonthOpen(false);
    showNotice(`Месяц «${label}» добавлен и выбран!`);
  };

  // Добавить новую пустую строку заказа напрямую в Excel-таблицу
  const handleAddBlankRow = () => {
    setIsTableFullscreen(false);
    setActiveTabMode('size_matrix');
    const newId = handleAddInlineExcelRow([...SIZE_PRESETS.alpha_xs_3xl.sizes]);
    setSelectedSizeRowId(newId);
    showNotice('Добавлена новая строка заказа в Excel-таблицу!');
  };

  // Создать заказ + чистую матрицу размеров в «Размеры по заказу» (поддерживает все 4 роста)
  const handleCreateOrderInSizeMatrix = () => {
    const orderNo = newOrderForm.orderNo.trim();
    const model = newOrderForm.model.trim();
    const color = newOrderForm.color.trim() || 'Стандарт';
    const customBrand = newOrderForm.customBrandInput.trim();
    const brand = customBrand || newOrderForm.brand || brandsList[0] || DEFAULT_BRANDS[0];
    if (customBrand && !brandsList.includes(customBrand)) {
      setBrandsList(prev => [...prev, customBrand]);
    }

    if (!orderNo || !model) {
      showNotice('Укажите номер заказа (Заказ №) и модель!');
      return;
    }

    let sizes: string[];
    const presetId: SizePresetId = newOrderForm.presetId;
    if (presetId === 'custom') {
      const parsed = newOrderForm.customSizesText
        .split(/[,;\s\t]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const unique = Array.from<string>(new Set(parsed));
      sizes = unique.length > 0 ? unique : ['XS', 'S', 'M', 'L', 'XL'];
    } else {
      sizes = newOrderForm.selectedSizes.length > 0
        ? [...newOrderForm.selectedSizes]
        : [...SIZE_PRESETS[presetId].sizes];
    }

    const rostsToCreate = newOrderForm.createAll4Rosts ? ROST_OPTIONS : [newOrderForm.rost.trim()];
    const createdRows: FactoryLedgerRow[] = [];
    const createdMatrices: Record<string, OrderSizeMatrix> = {};

    rostsToCreate.forEach((rostVal, idx) => {
      const rowId = `ord-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
      const values: Record<string, SizeCellValues> = {};
      sizes.forEach(sz => {
        values[sz] = { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
      });

      createdMatrices[rowId] = {
        rowId,
        presetId,
        sizes: [...sizes],
        values,
        defect: 0
      };

      createdRows.push({
        id: rowId,
        brand,
        orderNo,
        model,
        color,
        colorCode: newOrderForm.colorCode.trim(),
        rost: rostVal,
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
        month: newOrderForm.month || DEFAULT_MONTHS[0],
        notes: newOrderForm.notes.trim()
      });
    });

    setSizeMatrices(prev => ({ ...prev, ...createdMatrices }));
    setLedgerRows(prev => [...createdRows, ...prev]);
    setSelectedSizeRowId(createdRows[0].id);
    setLastAddedOrderNo(orderNo);
    setSelectedMonth('all');
    setSelectedBrand('all');
    setSelectedOrderNo('all');
    setSelectedModel('all');
    setSelectedColor('all');
    setSearchFilter('');
    setIsNewOrderModalOpen(false);
    setActiveTabMode('size_matrix');
    showNotice(
      newOrderForm.createAll4Rosts
        ? `Создан заказ «${orderNo}» (${brand}) для цвета «${color}» с 4 ростовками! Заказ добавлен в список заказов.`
        : `Заказ «${orderNo} — ${color}${newOrderForm.rost ? ' (' + newOrderForm.rost + ')' : ''}» создан и добавлен в список заказов!`
    );
  };

  // Добавить новый Цвет / Рост к текущему заказу прямо в «Размеры по заказу»
  const handleAddVariantToActiveOrder = () => {
    if (!activeSizeRow || !activeSizeMatrix) return;
    const color = variantForm.color.trim() || activeSizeRow.color || 'Новый цвет';
    const rostsToCreate = variantForm.createAll4Rosts ? ROST_OPTIONS : [variantForm.rost.trim()];

    const createdRows: FactoryLedgerRow[] = [];
    const createdMatrices: Record<string, OrderSizeMatrix> = {};

    rostsToCreate.forEach((rostVal, idx) => {
      const rowId = `var-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
      const values: Record<string, SizeCellValues> = {};
      activeSizeMatrix.sizes.forEach(sz => {
        values[sz] = { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
      });
      createdMatrices[rowId] = {
        rowId,
        presetId: activeSizeMatrix.presetId,
        sizes: [...activeSizeMatrix.sizes],
        values,
        defect: 0
      };
      createdRows.push({
        id: rowId,
        brand: activeSizeRow.brand || '',
        orderNo: activeSizeRow.orderNo,
        model: activeSizeRow.model,
        color,
        colorCode: variantForm.colorCode.trim() || activeSizeRow.colorCode || '',
        rost: rostVal,
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
        month: activeSizeRow.month || DEFAULT_MONTHS[0],
        notes: activeSizeRow.notes || ''
      });
    });

    setSizeMatrices(prev => ({ ...prev, ...createdMatrices }));
    setLedgerRows(prev => {
      const idx = prev.findIndex(r => r.id === activeSizeRow.id);
      if (idx === -1) return [...createdRows, ...prev];
      const next = [...prev];
      next.splice(idx + 1, 0, ...createdRows);
      return next;
    });
    setSelectedSizeRowId(createdRows[0].id);
    setVariantForm({ color: '', colorCode: '', rost: '', createAll4Rosts: false });
    setIsAddVariantOpen(false);
    showNotice(
      variantForm.createAll4Rosts
        ? `Добавлено 4 ростовки для цвета «${color}» в заказ ${activeSizeRow.orderNo}!`
        : `Добавлен вариант «${color}${variantForm.rost ? ' • ' + variantForm.rost : ''}» в заказ ${activeSizeRow.orderNo}!`
    );
  };

  // Обновление метаданных/отгрузки активного заказа прямо в «Размеры по заказу»
  const updateActiveRowMeta = (
    field: 'brand' | 'orderNo' | 'model' | 'color' | 'colorCode' | 'rost' | 'month' | 'notes' | 'qtyShipped',
    rawVal: string
  ) => {
    if (!activeSizeRow) return;
    setLedgerRows(prev =>
      prev.map(r => {
        if (r.id !== activeSizeRow.id) return r;
        const val =
          field === 'qtyShipped'
            ? Math.max(0, parseInt(rawVal.replace(/[^\d]/g, ''), 10) || 0)
            : rawVal;
        return recalcLedgerRowFromMatrix({ ...r, [field]: val }, sizeMatrices[r.id]);
      })
    );
  };

  // Прямые Excel-обработчики для любой строки и ячейки в таблице OrdersExcelGrid
  const ensureRowMaterialized = useCallback(
    (
      rowsArr: FactoryLedgerRow[],
      rowId: string,
      overrideSizes?: string[]
    ): { rows: FactoryLedgerRow[]; exists: boolean } => {
      if (rowsArr.some(r => r.id === rowId)) {
        return { rows: rowsArr, exists: true };
      }
      const safeSizes =
        overrideSizes && overrideSizes.length > 0 ? overrideSizes : [...SIZE_PRESETS.alpha_xs_3xl.sizes];
      const blankRow: FactoryLedgerRow = {
        id: rowId,
        brand: selectedBrand !== 'all' ? selectedBrand : '',
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
        month: selectedMonth !== 'all' ? selectedMonth : monthsList[0] || DEFAULT_MONTHS[0],
        notes: ''
      };
      const values: Record<string, SizeCellValues> = {};
      safeSizes.forEach(sz => {
        values[sz] = { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
      });
      setSizeMatrices(prev =>
        prev[rowId]
          ? prev
          : {
              ...prev,
              [rowId]: {
                rowId,
                presetId: 'custom',
                sizes: safeSizes,
                values,
                defect: 0
              }
            }
      );
      return { rows: [...rowsArr, blankRow], exists: false };
    },
    [monthsList, selectedBrand, selectedMonth]
  );

  const registerEntrySessionIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setEntrySessionRowIds(prev => {
      const set = new Set(prev);
      let changed = false;
      ids.forEach(id => {
        if (id && !set.has(id)) {
          set.add(id);
          changed = true;
        }
      });
      return changed ? Array.from(set) : prev;
    });
  }, []);

  const updateRowFieldById = (
    rowId: string,
    field: 'brand' | 'orderNo' | 'model' | 'color' | 'colorCode' | 'rost' | 'month' | 'notes' | 'qtyShipped',
    rawVal: string
  ) => {
    registerEntrySessionIds([rowId]);
    setLedgerRows(prev => {
      const { rows } = ensureRowMaterialized(prev, rowId);
      return rows.map(r => {
        if (r.id !== rowId) return r;
        const val =
          field === 'qtyShipped'
            ? Math.max(0, parseInt(rawVal.replace(/[^\d]/g, ''), 10) || 0)
            : rawVal;
        return recalcLedgerRowFromMatrix({ ...r, [field]: val }, sizeMatrices[r.id]);
      });
    });
  };

  const updateRowSizeCellById = (
    rowId: string,
    sizeName: string,
    stage: keyof SizeCellValues,
    rawVal: string
  ) => {
    const num = Math.max(0, parseInt(rawVal.replace(/[^\d]/g, ''), 10) || 0);
    registerEntrySessionIds([rowId]);
    setLedgerRows(prev => ensureRowMaterialized(prev, rowId, [sizeName]).rows);
    setSizeMatrices(prev => {
      const targetRow = ledgerRows.find(r => r.id === rowId);
      const existing = prev[rowId] || (targetRow ? buildDefaultSizeMatrixForRow(targetRow) : {
        rowId,
        presetId: 'alpha_xs_3xl' as SizePresetId,
        sizes: [sizeName],
        values: {},
        defect: 0
      });
      const nextSizes = existing.sizes.includes(sizeName) ? existing.sizes : [...existing.sizes, sizeName];
      return {
        ...prev,
        [rowId]: {
          ...existing,
          sizes: nextSizes,
          values: {
            ...existing.values,
            [sizeName]: {
              ...(existing.values[sizeName] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }),
              [stage]: num
            }
          }
        }
      };
    });
  };

  const updateRowDefectById = (rowId: string, rawVal: string) => {
    const num = Math.max(0, parseInt(rawVal.replace(/[^\d]/g, ''), 10) || 0);
    registerEntrySessionIds([rowId]);
    setLedgerRows(prev => ensureRowMaterialized(prev, rowId).rows);
    setSizeMatrices(prev => {
      const targetRow = ledgerRows.find(r => r.id === rowId);
      const existing = prev[rowId] || (targetRow ? buildDefaultSizeMatrixForRow(targetRow) : {
        rowId,
        presetId: 'alpha_xs_3xl' as SizePresetId,
        sizes: [...SIZE_PRESETS.alpha_xs_3xl.sizes],
        values: {},
        defect: 0
      });
      return {
        ...prev,
        [rowId]: {
          ...existing,
          defect: num
        }
      };
    });
  };

  // Прямые обработчики для раздела «Папки заказов» (НЕ добавляют старые заказы в лист нового ввода Excel)
  const handleFolderUpdateField = (
    rowId: string,
    field: 'brand' | 'orderNo' | 'model' | 'color' | 'colorCode' | 'rost' | 'month' | 'notes' | 'qtyShipped',
    rawVal: string
  ) => {
    setLedgerRows(prev =>
      prev.map(r => {
        if (r.id !== rowId) return r;
        const val =
          field === 'qtyShipped'
            ? Math.max(0, parseInt(rawVal.replace(/[^\d]/g, ''), 10) || 0)
            : rawVal;
        return recalcLedgerRowFromMatrix({ ...r, [field]: val }, sizeMatrices[r.id]);
      })
    );
  };

  const handleFolderUpdateSizeCell = (
    rowId: string,
    sizeName: string,
    stage: keyof SizeCellValues,
    rawVal: string
  ) => {
    const num = Math.max(0, parseInt(rawVal.replace(/[^\d]/g, ''), 10) || 0);
    setSizeMatrices(prev => {
      const targetRow = ledgerRows.find(r => r.id === rowId);
      const existing = prev[rowId] || (targetRow ? buildDefaultSizeMatrixForRow(targetRow) : {
        rowId,
        presetId: 'alpha_xs_3xl' as SizePresetId,
        sizes: [sizeName],
        values: {},
        defect: 0
      });
      const nextSizes = existing.sizes.includes(sizeName) ? existing.sizes : [...existing.sizes, sizeName];
      return {
        ...prev,
        [rowId]: {
          ...existing,
          sizes: nextSizes,
          values: {
            ...existing.values,
            [sizeName]: {
              ...(existing.values[sizeName] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }),
              [stage]: num
            }
          }
        }
      };
    });
  };

  const handleFolderUpdateDefect = (rowId: string, rawVal: string) => {
    const num = Math.max(0, parseInt(rawVal.replace(/[^\d]/g, ''), 10) || 0);
    setSizeMatrices(prev => {
      const targetRow = ledgerRows.find(r => r.id === rowId);
      const existing = prev[rowId] || (targetRow ? buildDefaultSizeMatrixForRow(targetRow) : {
        rowId,
        presetId: 'alpha_xs_3xl' as SizePresetId,
        sizes: [...SIZE_PRESETS.alpha_xs_3xl.sizes],
        values: {},
        defect: 0
      });
      return {
        ...prev,
        [rowId]: {
          ...existing,
          defect: num
        }
      };
    });
  };

  const handleFolderChangeSizePreset = (rowId: string, presetId: Exclude<SizePresetId, 'custom'>) => {
    const targetSizes = [...SIZE_PRESETS[presetId].sizes];
    setSizeMatrices(prev => {
      const targetRow = ledgerRows.find(r => r.id === rowId);
      const existing = prev[rowId] || (targetRow ? buildDefaultSizeMatrixForRow(targetRow, presetId) : {
        rowId,
        presetId,
        sizes: targetSizes,
        values: {},
        defect: 0
      });
      const nextValues: Record<string, SizeCellValues> = { ...existing.values };
      targetSizes.forEach(sz => {
        if (!nextValues[sz]) {
          nextValues[sz] = { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
        }
      });
      return {
        ...prev,
        [rowId]: {
          ...existing,
          presetId,
          sizes: targetSizes,
          values: nextValues
        }
      };
    });
  };

  const handleFolderAddSizeColumn = (rowId: string, rawSize: string) => {
    const clean = rawSize.trim().toUpperCase();
    if (!clean) return;
    setSizeMatrices(prev => {
      const targetRow = ledgerRows.find(r => r.id === rowId);
      const existing = prev[rowId] || (targetRow ? buildDefaultSizeMatrixForRow(targetRow) : {
        rowId,
        presetId: 'custom' as SizePresetId,
        sizes: [],
        values: {},
        defect: 0
      });
      if (existing.sizes.includes(clean)) return prev;
      return {
        ...prev,
        [rowId]: {
          ...existing,
          sizes: [...existing.sizes, clean],
          values: {
            ...existing.values,
            [clean]: existing.values[clean] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }
          }
        }
      };
    });
  };

  const handleFolderAddColorToFolder = (orderNo: string, templateRow?: FactoryLedgerRow) => {
    const rowId = `ord-clr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const templateMatrix = templateRow ? sizeMatrices[templateRow.id] : undefined;
    const baseSizes =
      templateMatrix && templateMatrix.sizes.length > 0
        ? [...templateMatrix.sizes]
        : [...SIZE_PRESETS.alpha_xs_3xl.sizes];
    const values: Record<string, SizeCellValues> = {};
    baseSizes.forEach(sz => {
      values[sz] = { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
    });
    const newMatrix: OrderSizeMatrix = {
      rowId,
      presetId: templateMatrix?.presetId || 'alpha_xs_3xl',
      sizes: baseSizes,
      values,
      defect: 0
    };
    const newRow: FactoryLedgerRow = {
      id: rowId,
      brand: templateRow?.brand || brandsList[0] || DEFAULT_BRANDS[0],
      orderNo,
      model: templateRow?.model || '',
      color: lang === 'uz' ? 'Yangi rang' : 'Новый цвет',
      colorCode: '',
      rost: templateRow?.rost || '',
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
      month: templateRow?.month || monthsList[0] || DEFAULT_MONTHS[0],
      notes: ''
    };
    setSizeMatrices(prev => ({ ...prev, [rowId]: newMatrix }));
    setLedgerRows(prev => [...prev, newRow]);
    showNotice(
      lang === 'uz'
        ? `«${orderNo}» papkasiga yangi rang qo'shildi`
        : `В папку «${orderNo}» добавлен новый цвет`
    );
  };

  const handleAddInlineExcelRow = (sizes: string[], cloneFromRow?: FactoryLedgerRow): string => {
    const rowId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const safeSizes = sizes.length > 0 ? [...sizes] : [...SIZE_PRESETS.alpha_xs_3xl.sizes];
    const values: Record<string, SizeCellValues> = {};
    safeSizes.forEach(sz => {
      values[sz] = { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
    });

    const newMatrix: OrderSizeMatrix = {
      rowId,
      presetId: 'custom',
      sizes: safeSizes,
      values,
      defect: 0
    };

    const newRow: FactoryLedgerRow = {
      id: rowId,
      brand: cloneFromRow?.brand || (selectedBrand !== 'all' ? selectedBrand : ''),
      orderNo: cloneFromRow?.orderNo || '',
      model: cloneFromRow?.model || '',
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
      month: cloneFromRow?.month || (selectedMonth !== 'all' ? selectedMonth : monthsList[0] || DEFAULT_MONTHS[0]),
      notes: ''
    };

    setSizeMatrices(prev => ({ ...prev, [rowId]: newMatrix }));
    setLedgerRows(prev => {
      if (cloneFromRow) {
        const idx = prev.findIndex(r => r.id === cloneFromRow.id);
        if (idx !== -1) {
          const copy = [...prev];
          copy.splice(idx + 1, 0, newRow);
          return copy;
        }
      }
      return [...prev, newRow];
    });
    registerEntrySessionIds([rowId]);
    setSelectedSizeRowId(rowId);
    return rowId;
  };

  const handleBulkPasteExcelCells = (
    startRowIdx: number,
    startColIdx: number,
    visibleRows: FactoryLedgerRow[],
    colKeys: ExcelColumnDef[],
    stage: keyof SizeCellValues,
    pastedGrid: string[][],
    defaultSizes: string[],
    subRowTargets?: Array<{ row: FactoryLedgerRow; stage: keyof SizeCellValues }>
  ) => {
    if (!pastedGrid || pastedGrid.length === 0) return;
    const safeSizes = defaultSizes.length > 0 ? [...defaultSizes] : [...SIZE_PRESETS.alpha_xs_3xl.sizes];
    const nextRows = [...ledgerRows];
    const nextMatrices: Record<string, OrderSizeMatrix> = { ...sizeMatrices };
    const touchedRowIds: string[] = [];

    pastedGrid.forEach((pRow, rOff) => {
      const slot = subRowTargets && subRowTargets.length > 0 ? subRowTargets[startRowIdx + rOff] : undefined;
      const visibleTarget = slot ? slot.row : (!subRowTargets ? visibleRows[startRowIdx + rOff] : undefined);
      const slotStage: keyof SizeCellValues = slot ? slot.stage : stage;
      let targetRowId = visibleTarget?.id;

      if (!targetRowId) {
        targetRowId = `ord-p-${Date.now()}-${rOff}-${Math.random().toString(36).slice(2, 5)}`;
      }

      let rowIndex = nextRows.findIndex(r => r.id === targetRowId);
      if (rowIndex === -1) {
        const values: Record<string, SizeCellValues> = {};
        safeSizes.forEach(sz => {
          values[sz] = { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
        });
        nextMatrices[targetRowId] = {
          rowId: targetRowId,
          presetId: 'custom',
          sizes: safeSizes,
          values,
          defect: 0
        };
        nextRows.push({
          id: targetRowId,
          brand: selectedBrand !== 'all' ? selectedBrand : '',
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
          month: selectedMonth !== 'all' ? selectedMonth : (monthsList[0] || DEFAULT_MONTHS[0]),
          notes: ''
        });
        rowIndex = nextRows.length - 1;
      }

      if (!touchedRowIds.includes(targetRowId)) {
        touchedRowIds.push(targetRowId);
      }
      let rowDraft = { ...nextRows[rowIndex] };
      const existingM = nextMatrices[targetRowId] || buildDefaultSizeMatrixForRow(rowDraft);
      const nextValues = { ...existingM.values };
      const nextSizes = [...existingM.sizes];
      let nextDefect = existingM.defect || 0;

      pRow.forEach((rawCell, cOff) => {
        const colDef = colKeys[startColIdx + cOff];
        if (!colDef) return;
        const cleanVal = String(rawCell ?? '').trim();

        if (colDef.kind === 'meta') {
          const metaField = colDef.key as 'month' | 'brand' | 'orderNo' | 'model' | 'color' | 'colorCode' | 'rost';
          rowDraft = { ...rowDraft, [metaField]: cleanVal };
        } else if (colDef.kind === 'size' && colDef.sizeName) {
          const sz = colDef.sizeName;
          if (!nextSizes.includes(sz)) nextSizes.push(sz);
          const num = Math.max(0, parseInt(cleanVal.replace(/[^\d]/g, ''), 10) || 0);
          nextValues[sz] = {
            ...(nextValues[sz] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }),
            [slotStage]: num
          };
        } else if (colDef.kind === 'defect') {
          nextDefect = Math.max(0, parseInt(cleanVal.replace(/[^\d]/g, ''), 10) || 0);
        } else if (colDef.kind === 'shipped') {
          rowDraft = { ...rowDraft, qtyShipped: Math.max(0, parseInt(cleanVal.replace(/[^\d]/g, ''), 10) || 0) };
        } else if (colDef.kind === 'notes') {
          rowDraft = { ...rowDraft, notes: cleanVal };
        }
      });

      const updatedMatrix: OrderSizeMatrix = {
        ...existingM,
        sizes: nextSizes,
        values: nextValues,
        defect: nextDefect
      };
      nextMatrices[targetRowId] = updatedMatrix;
      nextRows[rowIndex] = recalcLedgerRowFromMatrix(rowDraft, updatedMatrix);
    });

    setSizeMatrices(nextMatrices);
    setLedgerRows(nextRows);
    registerEntrySessionIds(touchedRowIds);
    if (touchedRowIds[0]) setSelectedSizeRowId(touchedRowIds[0]);
    showNotice(lang === 'uz' ? `Excel'dan joylandi: ${pastedGrid.length} qator` : `Вставлено из Excel: ${pastedGrid.length} стр.`);
  };

  // Удаление строки, папки заказа или полная очистка с проверкой пароля из настроек
  const handleConfirmDeleteRow = () => {
    const expectedPass = getDeletePassword();
    if (deletePassword.trim() !== expectedPass) {
      setDeletePasswordError(lang === 'uz' ? "Parol noto'g'ri!" : 'Неверный пароль!');
      return;
    }

    if (isClearAllConfirmOpen) {
      setLedgerRows([]);
      setSizeMatrices({});
      setEntrySessionRowIds([]);
      setShowSavedInExcel(false);
      setSelectedSizeRowId('');
      setIsClearAllConfirmOpen(false);
      setFolderToDelete(null);
      setDeletePassword('');
      setDeletePasswordError('');
      showNotice(lang === 'uz' ? "Barcha zakazlar tozalandi!" : 'Все заказы полностью очищены!');
      return;
    }

    if (folderToDelete) {
      const targetOrd = folderToDelete.trim();
      const deletedIds = new Set<string>(
        ledgerRows.filter(r => (r.orderNo || '').trim() === targetOrd).map(r => r.id)
      );
      setLedgerRows(prev => {
        const next = prev.filter(r => !deletedIds.has(r.id));
        if (deletedIds.has(selectedSizeRowId)) {
          setSelectedSizeRowId(next[0]?.id || '');
        }
        return next;
      });
      setEntrySessionRowIds(prev => prev.filter(id => !deletedIds.has(id)));
      setSizeMatrices(prev => {
        const next = { ...prev };
        deletedIds.forEach(id => {
          delete next[id];
        });
        return next;
      });
      setFolderToDelete(null);
      setDeletePassword('');
      setDeletePasswordError('');
      showNotice(
        lang === 'uz'
          ? `«${targetOrd}» zakazi va barcha ranglari o'chirildi!`
          : `Заказ «${targetOrd}» и все его цвета удалены!`
      );
      return;
    }

    if (!rowToDelete) return;
    const deletedId = rowToDelete.id;
    setLedgerRows(prev => {
      const next = prev.filter(r => r.id !== deletedId);
      if (selectedSizeRowId === deletedId) {
        setSelectedSizeRowId(next[0]?.id || '');
      }
      return next;
    });
    setEntrySessionRowIds(prev => prev.filter(id => id !== deletedId));
    setSizeMatrices(prev => {
      const next = { ...prev };
      delete next[deletedId];
      return next;
    });
    setRowToDelete(null);
    setDeletePassword('');
    setDeletePasswordError('');
    showNotice(lang === 'uz' ? "Qator muvaffaqiyatli o'chirildi!" : 'Строка заказа успешно удалена!');
  };

  // =========================================================================
  // ЭКСПОРТ В EXCEL (.xlsx) — ВКЛЮЧАЯ ПОЛНУЮ МАТРИЦУ РАЗМЕРОВ И ВСЕ ОТЧЕТЫ
  // =========================================================================
  const handleExportExcel = () => {
    const sourceRows = isEntryWorkspace ? committedLedgerRows : filteredRows;
    if (sourceRows.length === 0) {
      showNotice('Нет данных для экспорта в XLSX — добавьте или выберите заказы.');
      return;
    }

    const withHorizontalSizes = reportSizeDisplayMode === 'horizontal';
    const exportSizes: string[] = withHorizontalSizes
      ? Array.from(new Set<string>(sourceRows.flatMap(r => getPopulatedSizes(sizeMatrices[r.id]))))
      : [];

    // Расчет итогов именно по экспортируемым строкам
    let ordSum = 0;
    let cutSum = 0;
    let distSum = 0;
    let sewSum = 0;
    let packSum = 0;
    let defSum = 0;
    let totalPackSum = 0;
    let shipSum = 0;
    let stockSum = 0;
    sourceRows.forEach(r => {
      ordSum += r.qtyOrder || 0;
      cutSum += r.qtyCut || 0;
      distSum += r.qtyDistribution || 0;
      sewSum += r.qtySewing || 0;
      packSum += r.qtyPackaging || 0;
      defSum += r.qtyDefect || 0;
      totalPackSum += r.qtyTotalPack || 0;
      shipSum += r.qtyShipped || 0;
      stockSum += r.qtyStock || 0;
    });
    const diffSum = distSum - totalPackSum;
    const cutRateSum = ordSum > 0 ? ((cutSum / ordSum) * 100).toFixed(1) : '0.0';
    const defRateSum = distSum > 0 ? ((defSum / distSum) * 100).toFixed(1) : '0.0';
    const stockRateSum = packSum > 0 ? ((stockSum / packSum) * 100).toFixed(1) : '0.0';
    const closeRateSum = distSum > 0 ? ((totalPackSum / distSum) * 100).toFixed(1) : '0.0';

    const getSourceTotalSizeStage = (sz: string, stageKey: Exclude<ReportSizeStage, 'all'>): number => {
      if (stageKey === 'rem') {
        let ord = 0;
        let pack = 0;
        sourceRows.forEach(r => {
          const st = getRowSizeAllStages(r.id, sz);
          ord += st.order;
          pack += st.pack;
        });
        return ord - pack;
      }
      return sourceRows.reduce((s, r) => s + getRowSizeStageQty(r.id, sz, stageKey), 0);
    };

    // ЛИСТ 0 / ОСНОВНОЙ ДЛЯ РЕИМПОРТА: Полная матрица размеров по всем этапам и всем заказам
    const sizeGroupsMap = new Map<string, { sizes: string[]; rows: FactoryLedgerRow[] }>();
    sourceRows.forEach(row => {
      const mat = sizeMatrices[row.id];
      const pop = getPopulatedSizes(mat);
      const rowSizes =
        pop.length > 0
          ? pop
          : mat?.sizes?.length
          ? mat.sizes
          : [...SIZE_PRESETS[detectSizePresetForRow(row)].sizes];
      const sig = rowSizes.join('||');
      const grp = sizeGroupsMap.get(sig);
      if (grp) {
        grp.rows.push(row);
      } else {
        sizeGroupsMap.set(sig, { sizes: rowSizes, rows: [row] });
      }
    });

    const matrixSheetAoa: any[][] = [];
    let maxMatrixSizeCols = 0;
    Array.from(sizeGroupsMap.values()).forEach((grp, gIdx) => {
      if (gIdx > 0) matrixSheetAoa.push([]);
      if (grp.sizes.length > maxMatrixSizeCols) maxMatrixSizeCols = grp.sizes.length;

      matrixSheetAoa.push([
        lang === 'uz' ? 'Oy' : 'Месяц',
        lang === 'uz' ? 'Brend' : 'Бренд',
        lang === 'uz' ? 'Zakaz №' : 'Заказ №',
        lang === 'uz' ? 'Model' : 'Модель',
        lang === 'uz' ? 'Rang' : 'Цвет',
        lang === 'uz' ? 'Artikul' : 'Артикул',
        lang === 'uz' ? 'Rost' : 'Рост',
        lang === 'uz' ? 'Bosqich' : 'Этап',
        ...grp.sizes,
        lang === 'uz' ? 'JAMI' : 'ВСЕГО',
        lang === 'uz' ? 'Brak' : 'Брак',
        lang === 'uz' ? "Jo'natildi" : 'Отгрузка',
        lang === 'uz' ? 'Izoh' : 'Примечание'
      ]);

      grp.rows.forEach(r => {
        const mat = sizeMatrices[r.id];
        const stageDefs: { key: keyof SizeCellValues; label: string; scalarFallback: number }[] = [
          { key: 'order', label: 'Заказ', scalarFallback: r.qtyOrder || 0 },
          { key: 'cut', label: 'Крой', scalarFallback: r.qtyCut || 0 },
          { key: 'dist', label: 'Раздача', scalarFallback: r.qtyDistribution || 0 },
          { key: 'sew', label: 'Пошив', scalarFallback: r.qtySewing || 0 },
          { key: 'pack', label: 'Упаковка', scalarFallback: r.qtyPackaging || 0 }
        ];

        stageDefs.forEach((st, stIdx) => {
          const perSizeVals = grp.sizes.map(sz => {
            const v = mat?.values?.[sz]?.[st.key] ?? 0;
            return v > 0 ? v : '';
          });
          const rowSum = grp.sizes.reduce((s, sz) => s + (mat?.values?.[sz]?.[st.key] ?? 0), 0);
          const effectiveTotal = rowSum > 0 ? rowSum : st.scalarFallback;

          matrixSheetAoa.push([
            stIdx === 0 ? r.month || DEFAULT_MONTHS[0] : '',
            stIdx === 0 ? r.brand || '' : '',
            stIdx === 0 ? r.orderNo : '',
            stIdx === 0 ? r.model : '',
            stIdx === 0 ? r.color : '',
            stIdx === 0 ? r.colorCode || '' : '',
            stIdx === 0 ? r.rost || '' : '',
            st.label,
            ...perSizeVals,
            effectiveTotal > 0 ? effectiveTotal : 0,
            stIdx === 0 ? (mat?.defect || r.qtyDefect || '') : '',
            stIdx === 0 ? (r.qtyShipped || '') : '',
            stIdx === 0 ? (r.notes || '') : ''
          ]);
        });
      });
    });

    const wsMatrix = XLSX.utils.aoa_to_sheet(matrixSheetAoa);
    wsMatrix['!cols'] = [
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 22 },
      { wch: 16 },
      { wch: 12 },
      { wch: 11 },
      { wch: 12 },
      ...Array.from({ length: maxMatrixSizeCols }, () => ({ wch: 8 })),
      { wch: 11 },
      { wch: 9 },
      { wch: 11 },
      { wch: 24 }
    ];

    const hasExportSizes = exportSizes.length > 0;
    const stageSpan = hasExportSizes ? activeReportStages.length : 1;

    // ЛИСТ 1: Таблица производства (Этап и число строго в отдельных ячейках)
    const prodHeaders = [
      '№',
      'Месяц',
      'Бренд',
      'Заказ №',
      'Модель',
      'Цвет',
      lang === 'uz' ? 'Artikul' : 'Артикул',
      'Рост',
      'Заказ (шт)',
      'Крой (шт)',
      'Крой %',
      'Раздача (шт)',
      'Пошив (шт)',
      'Упаковка (шт)',
      'Брак (шт)',
      'Брак %',
      'Общ-упак',
      'Разница',
      'Отгрузка (шт)',
      'Остаток на складе',
      'Остаток %',
      'Закрытие %',
      'Примечание',
      ...(hasExportSizes ? ['Этап', ...exportSizes] : [])
    ];

    const prodRows: any[][] = [];
    const prodMerges: XLSX.Range[] = [];
    sourceRows.forEach((r, idx) => {
      const m = getRowMetrics(r);
      const baseLeft = [
        idx + 1,
        r.month || DEFAULT_MONTHS[0],
        r.brand || '',
        r.orderNo,
        r.model,
        r.color,
        r.colorCode || '',
        r.rost || '',
        r.qtyOrder,
        r.qtyCut,
        `${m.cutPct.toFixed(1)}%`,
        r.qtyDistribution,
        r.qtySewing,
        r.qtyPackaging,
        r.qtyDefect,
        `${m.defectPct.toFixed(1)}%`,
        r.qtyTotalPack,
        r.difference,
        r.qtyShipped,
        r.qtyStock,
        `${m.stockPct.toFixed(1)}%`,
        `${m.closePct.toFixed(1)}%`,
        r.notes || ''
      ];
      if (!hasExportSizes) {
        prodRows.push(baseLeft);
        return;
      }
      const startRow = 1 + prodRows.length;
      activeReportStages.forEach((stg, stIdx) => {
        const leftCells = stIdx === 0 ? baseLeft : baseLeft.map(() => '');
        prodRows.push([
          ...leftCells,
          stg.label,
          ...exportSizes.map(sz => getGroupSizeStageNumeric([r], sz, stg.key) ?? '')
        ]);
      });
      if (stageSpan > 1) {
        for (let c = 0; c < baseLeft.length; c++) {
          prodMerges.push({ s: { r: startRow, c }, e: { r: startRow + stageSpan - 1, c } });
        }
      }
    });

    const prodFooterBase = [
      'ИТОГО:',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ordSum,
      cutSum,
      `${cutRateSum}%`,
      distSum,
      sewSum,
      packSum,
      defSum,
      `${defRateSum}%`,
      totalPackSum,
      diffSum,
      shipSum,
      stockSum,
      `${stockRateSum}%`,
      `${closeRateSum}%`,
      ''
    ];
    const prodFootRows: any[][] = [];
    if (!hasExportSizes) {
      prodFootRows.push(prodFooterBase);
    } else {
      const startFootRow = 1 + prodRows.length;
      activeReportStages.forEach((stg, stIdx) => {
        prodFootRows.push([
          ...(stIdx === 0 ? prodFooterBase : prodFooterBase.map(() => '')),
          stg.label,
          ...exportSizes.map(sz => getSourceTotalSizeStage(sz, stg.key))
        ]);
      });
      if (stageSpan > 1) {
        for (let c = 0; c < prodFooterBase.length; c++) {
          prodMerges.push({ s: { r: startFootRow, c }, e: { r: startFootRow + stageSpan - 1, c } });
        }
      }
    }

    const wsProd = XLSX.utils.aoa_to_sheet([prodHeaders, ...prodRows, ...prodFootRows]);
    if (prodMerges.length > 0) wsProd['!merges'] = prodMerges;
    wsProd['!cols'] = [
      { wch: 5 },
      { wch: 15 },
      { wch: 15 },
      { wch: 14 },
      { wch: 24 },
      { wch: 18 },
      { wch: 13 },
      { wch: 11 },
      { wch: 13 },
      { wch: 13 },
      { wch: 10 },
      { wch: 14 },
      { wch: 13 },
      { wch: 14 },
      { wch: 11 },
      { wch: 10 },
      { wch: 12 },
      { wch: 11 },
      { wch: 13 },
      { wch: 17 },
      { wch: 11 },
      { wch: 12 },
      { wch: 24 },
      ...(hasExportSizes ? [{ wch: 12 }, ...exportSizes.map(() => ({ wch: 9 }))] : [])
    ];

    // ЛИСТ 2: Сводная по заказам
    const orderNosForExport = Array.from(new Set(sourceRows.map(r => r.orderNo).filter(Boolean)));
    const summaryHeaders = [
      '№',
      'Месяц',
      'Бренд',
      'Заказ №',
      'Модель',
      'Заказ (шт)',
      'Крой %',
      'Раздача (шт)',
      'Упаковка (шт)',
      'Разд−Упак (шт)',
      'Разд−Упак (%)',
      'Брак %',
      'Закрытие %',
      'Отгружено (шт)',
      'Остаток (шт)',
      'Статус',
      ...(hasExportSizes ? ['Этап', ...exportSizes] : [])
    ];
    const summaryRows: any[][] = [];
    const summaryMerges: XLSX.Range[] = [];
    orderNosForExport.forEach((ordNo, idx) => {
      const grp = sourceRows.filter(r => r.orderNo === ordNo);
      const model = grp[0]?.model || '';
      const brand = grp.map(r => r.brand).filter(Boolean)[0] || '';
      const month = Array.from(new Set(grp.map(r => r.month))).join(', ');
      const oQ = grp.reduce((s, r) => s + r.qtyOrder, 0);
      const cQ = grp.reduce((s, r) => s + r.qtyCut, 0);
      const dQ = grp.reduce((s, r) => s + r.qtyDistribution, 0);
      const pQ = grp.reduce((s, r) => s + r.qtyPackaging, 0);
      const dfQ = grp.reduce((s, r) => s + r.qtyDefect, 0);
      const tpQ = grp.reduce((s, r) => s + r.qtyTotalPack, 0);
      const shQ = grp.reduce((s, r) => s + r.qtyShipped, 0);
      const stQ = grp.reduce((s, r) => s + r.qtyStock, 0);
      const cutPct = oQ > 0 ? ((cQ / oQ) * 100).toFixed(1) : '0.0';
      const diffPure = dQ - pQ;
      const diffPurePct = dQ > 0 ? ((diffPure / dQ) * 100).toFixed(1) : '0.0';
      const defPct = dQ > 0 ? ((dfQ / dQ) * 100).toFixed(1) : '0.0';
      const clsPct = dQ > 0 ? ((tpQ / dQ) * 100).toFixed(1) : '0.0';
      const isDone = shQ >= oQ && oQ > 0;
      const baseLeft = [
        idx + 1,
        month,
        brand,
        ordNo,
        model,
        oQ,
        `${cutPct}%`,
        dQ,
        pQ,
        diffPure,
        `${diffPurePct}%`,
        `${defPct}%`,
        `${clsPct}%`,
        shQ,
        stQ,
        isDone ? 'Отгружен' : 'В работе'
      ];
      if (!hasExportSizes) {
        summaryRows.push(baseLeft);
        return;
      }
      const startRow = 1 + summaryRows.length;
      activeReportStages.forEach((stg, stIdx) => {
        summaryRows.push([
          ...(stIdx === 0 ? baseLeft : baseLeft.map(() => '')),
          stg.label,
          ...exportSizes.map(sz => getGroupSizeStageNumeric(grp, sz, stg.key) ?? '')
        ]);
      });
      if (stageSpan > 1) {
        for (let c = 0; c < baseLeft.length; c++) {
          summaryMerges.push({ s: { r: startRow, c }, e: { r: startRow + stageSpan - 1, c } });
        }
      }
    });
    const summaryFooterBase = [
      'ИТОГО:',
      '',
      '',
      '',
      '',
      ordSum,
      `${cutRateSum}%`,
      distSum,
      packSum,
      distSum - packSum,
      `${distSum > 0 ? (((distSum - packSum) / distSum) * 100).toFixed(1) : '0.0'}%`,
      `${defRateSum}%`,
      `${closeRateSum}%`,
      shipSum,
      stockSum,
      ''
    ];
    const summaryFootRows: any[][] = [];
    if (!hasExportSizes) {
      summaryFootRows.push(summaryFooterBase);
    } else {
      const startFootRow = 1 + summaryRows.length;
      activeReportStages.forEach((stg, stIdx) => {
        summaryFootRows.push([
          ...(stIdx === 0 ? summaryFooterBase : summaryFooterBase.map(() => '')),
          stg.label,
          ...exportSizes.map(sz => getSourceTotalSizeStage(sz, stg.key))
        ]);
      });
      if (stageSpan > 1) {
        for (let c = 0; c < summaryFooterBase.length; c++) {
          summaryMerges.push({ s: { r: startFootRow, c }, e: { r: startFootRow + stageSpan - 1, c } });
        }
      }
    }
    const wsSummary = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows, ...summaryFootRows]);
    if (summaryMerges.length > 0) wsSummary['!merges'] = summaryMerges;
    wsSummary['!cols'] = [
      { wch: 5 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 24 },
      { wch: 13 },
      { wch: 10 },
      { wch: 14 },
      { wch: 14 },
      { wch: 15 },
      { wch: 15 },
      { wch: 10 },
      { wch: 12 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      ...(hasExportSizes ? [{ wch: 12 }, ...exportSizes.map(() => ({ wch: 9 }))] : [])
    ];

    // ЛИСТ 3: Строки по цветам и ростам
    const colorHeaders = [
      '№',
      'Бренд',
      'Заказ №',
      'Модель',
      'Цвет',
      lang === 'uz' ? 'Artikul' : 'Артикул',
      'Рост',
      'Заказ (шт)',
      'Крой %',
      'Раздача (шт)',
      'Упаковка (шт)',
      'Разд−Упак (шт)',
      'Разд−Упак (%)',
      'Брак %',
      'Отгружено (шт)',
      'Остаток (шт)',
      'Закрытие %',
      ...(hasExportSizes ? ['Этап', ...exportSizes] : [])
    ];
    const colorRows: any[][] = [];
    const colorMerges: XLSX.Range[] = [];
    sourceRows.forEach((r, idx) => {
      const m = getRowMetrics(r);
      const baseLeft = [
        idx + 1,
        r.brand || '',
        r.orderNo,
        r.model,
        r.color,
        r.colorCode || '',
        r.rost || '',
        r.qtyOrder,
        `${m.cutPct.toFixed(1)}%`,
        r.qtyDistribution,
        r.qtyPackaging,
        m.diffPure,
        `${m.diffPurePct.toFixed(1)}%`,
        `${m.defectPct.toFixed(1)}%`,
        r.qtyShipped,
        r.qtyStock,
        `${m.closePct.toFixed(1)}%`
      ];
      if (!hasExportSizes) {
        colorRows.push(baseLeft);
        return;
      }
      const startRow = 1 + colorRows.length;
      activeReportStages.forEach((stg, stIdx) => {
        colorRows.push([
          ...(stIdx === 0 ? baseLeft : baseLeft.map(() => '')),
          stg.label,
          ...exportSizes.map(sz => getGroupSizeStageNumeric([r], sz, stg.key) ?? '')
        ]);
      });
      if (stageSpan > 1) {
        for (let c = 0; c < baseLeft.length; c++) {
          colorMerges.push({ s: { r: startRow, c }, e: { r: startRow + stageSpan - 1, c } });
        }
      }
    });
    const colorFooterBase = [
      'ИТОГО:',
      '',
      '',
      '',
      '',
      '',
      '',
      ordSum,
      `${cutRateSum}%`,
      distSum,
      packSum,
      distSum - packSum,
      `${distSum > 0 ? (((distSum - packSum) / distSum) * 100).toFixed(1) : '0.0'}%`,
      `${defRateSum}%`,
      shipSum,
      stockSum,
      `${closeRateSum}%`
    ];
    const colorFootRows: any[][] = [];
    if (!hasExportSizes) {
      colorFootRows.push(colorFooterBase);
    } else {
      const startFootRow = 1 + colorRows.length;
      activeReportStages.forEach((stg, stIdx) => {
        colorFootRows.push([
          ...(stIdx === 0 ? colorFooterBase : colorFooterBase.map(() => '')),
          stg.label,
          ...exportSizes.map(sz => getSourceTotalSizeStage(sz, stg.key))
        ]);
      });
      if (stageSpan > 1) {
        for (let c = 0; c < colorFooterBase.length; c++) {
          colorMerges.push({ s: { r: startFootRow, c }, e: { r: startFootRow + stageSpan - 1, c } });
        }
      }
    }
    const wsColors = XLSX.utils.aoa_to_sheet([colorHeaders, ...colorRows, ...colorFootRows]);
    if (colorMerges.length > 0) wsColors['!merges'] = colorMerges;
    wsColors['!cols'] = [
      { wch: 5 },
      { wch: 15 },
      { wch: 14 },
      { wch: 22 },
      { wch: 18 },
      { wch: 13 },
      { wch: 11 },
      { wch: 13 },
      { wch: 10 },
      { wch: 14 },
      { wch: 14 },
      { wch: 15 },
      { wch: 15 },
      { wch: 10 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      ...(hasExportSizes ? [{ wch: 12 }, ...exportSizes.map(() => ({ wch: 9 }))] : [])
    ];

    const wb = XLSX.utils.book_new();
    if (isEntryWorkspace) {
      XLSX.utils.book_append_sheet(wb, wsMatrix, 'Матрица размеров');
      XLSX.utils.book_append_sheet(wb, wsProd, 'Производство');
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Сводная по заказам');
      XLSX.utils.book_append_sheet(wb, wsColors, 'Строки по цветам');
    } else if (activeTabMode === 'summary_photo3') {
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Сводная по заказам');
      XLSX.utils.book_append_sheet(wb, wsProd, 'Производство');
      XLSX.utils.book_append_sheet(wb, wsColors, 'Строки по цветам');
      XLSX.utils.book_append_sheet(wb, wsMatrix, 'Матрица размеров');
    } else if (activeTabMode === 'colors_photo4') {
      XLSX.utils.book_append_sheet(wb, wsColors, 'Строки по цветам');
      XLSX.utils.book_append_sheet(wb, wsProd, 'Производство');
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Сводная по заказам');
      XLSX.utils.book_append_sheet(wb, wsMatrix, 'Матрица размеров');
    } else {
      XLSX.utils.book_append_sheet(wb, wsProd, 'Производство');
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Сводная по заказам');
      XLSX.utils.book_append_sheet(wb, wsColors, 'Строки по цветам');
      XLSX.utils.book_append_sheet(wb, wsMatrix, 'Матрица размеров');
    }

    const filePrefix = isEntryWorkspace
      ? 'Заказы_с_матрицей_размеров'
      : activeTabMode === 'summary_photo3'
      ? 'Сводная_по_заказам'
      : activeTabMode === 'colors_photo4'
      ? 'Строки_по_цветам'
      : 'Заказы_Производство';

    XLSX.writeFile(wb, `${filePrefix}_${new Date().toISOString().split('T')[0]}.xlsx`);
    showNotice(`Файл XLSX (${sourceRows.length} стр. + матрица размеров) успешно скачан!`);
  };

  // =========================================================================
  // ЭКСПОРТ В PDF (без пустых столбцов + этапы и числа в отдельных ячейках)
  // =========================================================================
  const handleExportPdf = async () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);

      // Фильтруем размерные колонки, в которых сумма по всем этапам равна 0
      const nonZeroPdfSizes = showHorizontalReportSizes
        ? monitoringUnionSizes
            .filter(sz =>
              filteredRows.some(r => {
                const st = getRowSizeAllStages(r.id, sz);
                return st.order > 0 || st.cut > 0 || st.dist > 0 || st.sew > 0 || st.pack > 0;
              })
            )
            .slice(0, 14)
        : [];
      const stageLabel = REPORT_STAGE_LABELS[reportSizeStage];

      doc.setFont(fontName, 'bold');
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      const reportTitle =
        activeTabMode === 'summary_photo3'
          ? 'СВОДНЫЙ ОТЧЕТ ПО ЗАКАЗАМ — CHUST TEXTILE'
          : activeTabMode === 'colors_photo4'
          ? 'ОТЧЕТ ПО ЦВЕТАМ И РОСТАМ — CHUST TEXTILE'
          : 'ОТЧЕТ ПО ЗАКАЗАМ И ПРОИЗВОДСТВУ — CHUST TEXTILE';
      doc.text(reportTitle, 12, 14);

      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      const periodLabel = selectedMonth === 'all' ? 'Все месяцы' : selectedMonth;
      doc.text(
        `Отчетный месяц: ${periodLabel}   |   Дата: ${new Date().toLocaleDateString('ru-RU')}   |   Заказов: ${totals.distinctOrdersCount}   |   Крой%: ${totals.cutRatePercent}%   |   Закрытие: ${totals.overallPercent}%${totals.defectQty > 0 ? `   |   Брак: ${totals.defectRatePercent}%` : ''}${nonZeroPdfSizes.length > 0 ? `   |   Этапы: ${stageLabel}` : ''}`,
        12,
        20
      );

      const hasBrand = filteredRows.some(r => Boolean(r.brand?.trim()));
      const hasRost = filteredRows.some(r => Boolean(r.rost?.trim()));
      const hasDefect = filteredRows.some(r => (r.qtyDefect || 0) > 0);
      const hasShipped = filteredRows.some(r => (r.qtyShipped || 0) > 0);
      const hasNotes = filteredRows.some(r => Boolean(r.notes?.trim()));
      const hasPdfSizes = nonZeroPdfSizes.length > 0;
      const pdfStageSpan = activeReportStages.length;

      let head: any[][] = [];
      let body: any[][] = [];
      let foot: any[][] = [];

      if (activeTabMode === 'summary_photo3') {
        const orderNos: string[] = Array.from(new Set<string>(filteredRows.map(r => r.orderNo).filter(Boolean)));
        type SumCol = { h: string; v: (grp: FactoryLedgerRow[], ordNo: string, idx: number) => string; f: () => string };
        const sumCols: SumCol[] = [
          { h: '№', v: (_g, _o, idx) => String(idx + 1), f: () => '' },
          { h: 'Месяц', v: grp => Array.from(new Set(grp.map(r => r.month))).join(', '), f: () => 'ИТОГО' },
          ...(hasBrand ? [{ h: 'Бренд', v: (grp: FactoryLedgerRow[]) => grp.map(r => r.brand).filter(Boolean)[0] || '', f: () => '' }] : []),
          { h: 'Заказ', v: (_g, ordNo) => ordNo, f: () => '' },
          { h: 'Модель', v: grp => grp[0]?.model || '', f: () => '' },
          { h: 'Заказ (шт)', v: grp => grp.reduce((s, r) => s + r.qtyOrder, 0).toLocaleString(), f: () => totals.orderQty.toLocaleString() },
          {
            h: 'Крой %',
            v: grp => {
              const oQ = grp.reduce((s, r) => s + r.qtyOrder, 0);
              const cQ = grp.reduce((s, r) => s + r.qtyCut, 0);
              return `${oQ > 0 ? ((cQ / oQ) * 100).toFixed(1) : '0.0'}%`;
            },
            f: () => `${totals.cutRatePercent}%`
          },
          { h: 'Разд.', v: grp => grp.reduce((s, r) => s + r.qtyDistribution, 0).toLocaleString(), f: () => totals.distQty.toLocaleString() },
          { h: 'Упак.', v: grp => grp.reduce((s, r) => s + r.qtyPackaging, 0).toLocaleString(), f: () => totals.packQty.toLocaleString() },
          {
            h: 'Разд−Упак',
            v: grp => {
              const dQ = grp.reduce((s, r) => s + r.qtyDistribution, 0);
              const pQ = grp.reduce((s, r) => s + r.qtyPackaging, 0);
              const dp = dQ - pQ;
              const pct = dQ > 0 ? ((dp / dQ) * 100).toFixed(1) : '0.0';
              return `${dp} (${pct}%)`;
            },
            f: () => `${totals.diffPureQty.toLocaleString()} (${totals.diffPurePct}%)`
          },
          ...(hasDefect
            ? [{
                h: 'Брак%',
                v: (grp: FactoryLedgerRow[]) => {
                  const dQ = grp.reduce((s, r) => s + r.qtyDistribution, 0);
                  const dfQ = grp.reduce((s, r) => s + r.qtyDefect, 0);
                  return `${dQ > 0 ? ((dfQ / dQ) * 100).toFixed(1) : '0.0'}%`;
                },
                f: () => `${totals.defectRatePercent}%`
              }]
            : []),
          {
            h: 'Закр.%',
            v: grp => {
              const dQ = grp.reduce((s, r) => s + r.qtyDistribution, 0);
              const tpQ = grp.reduce((s, r) => s + r.qtyTotalPack, 0);
              return `${dQ > 0 ? ((tpQ / dQ) * 100).toFixed(1) : '0.0'}%`;
            },
            f: () => `${totals.overallPercent}%`
          },
          ...(hasShipped ? [{ h: 'Отгр.', v: (grp: FactoryLedgerRow[]) => grp.reduce((s, r) => s + r.qtyShipped, 0).toLocaleString(), f: () => totals.shipQty.toLocaleString() }] : []),
          { h: 'Остаток', v: grp => grp.reduce((s, r) => s + r.qtyStock, 0).toLocaleString(), f: () => totals.stockQty.toLocaleString() },
          {
            h: 'Статус',
            v: grp => {
              const oQ = grp.reduce((s, r) => s + r.qtyOrder, 0);
              const shQ = grp.reduce((s, r) => s + r.qtyShipped, 0);
              return shQ >= oQ && oQ > 0 ? 'Отгр.' : 'В работе';
            },
            f: () => ''
          }
        ];

        head = [[...sumCols.map(c => c.h), ...(hasPdfSizes ? ['Этап', ...nonZeroPdfSizes] : [])]];
        if (!hasPdfSizes) {
          body = orderNos.map((ordNo, idx) => {
            const grp = filteredRows.filter(r => r.orderNo === ordNo);
            return sumCols.map(c => c.v(grp, ordNo, idx));
          });
          foot = [sumCols.map(c => c.f())];
        } else {
          body = [];
          orderNos.forEach((ordNo, idx) => {
            const grp = filteredRows.filter(r => r.orderNo === ordNo);
            activeReportStages.forEach((stg, stIdx) => {
              const sizeCells = nonZeroPdfSizes.map(sz => {
                const v = getGroupSizeStageNumeric(grp, sz, stg.key);
                return v !== null ? String(v) : '';
              });
              if (stIdx === 0) {
                body.push([
                  ...sumCols.map(c => ({
                    content: c.v(grp, ordNo, idx),
                    rowSpan: pdfStageSpan,
                    styles: { valign: 'middle' }
                  })),
                  stg.label,
                  ...sizeCells
                ]);
              } else {
                body.push([stg.label, ...sizeCells]);
              }
            });
          });
          foot = activeReportStages.map((stg, stIdx) => {
            const totalSizeCells = nonZeroPdfSizes.map(sz => String(getTotalSizeStageNumeric(sz, stg.key)));
            if (stIdx === 0) {
              return [
                ...sumCols.map(c => ({
                  content: c.f(),
                  rowSpan: pdfStageSpan,
                  styles: { valign: 'middle' }
                })),
                stg.label,
                ...totalSizeCells
              ];
            }
            return [stg.label, ...totalSizeCells];
          });
        }
      } else {
        type ProdCol = { h: string; v: (r: FactoryLedgerRow, idx: number, m: ReturnType<typeof getRowMetrics>) => string; f: () => string };
        const prodCols: ProdCol[] = [
          { h: '№', v: (_r, idx) => String(idx + 1), f: () => '' },
          { h: 'Месяц', v: r => r.month || '', f: () => 'ИТОГО' },
          ...(hasBrand ? [{ h: 'Бренд', v: (r: FactoryLedgerRow) => r.brand || '', f: () => '' }] : []),
          { h: 'Заказ№', v: r => r.orderNo, f: () => '' },
          { h: 'Модель', v: r => r.model, f: () => '' },
          { h: 'Цвет', v: r => r.color, f: () => '' },
          ...(hasRost ? [{ h: 'Рост', v: (r: FactoryLedgerRow) => r.rost || '', f: () => '' }] : []),
          { h: 'Заказ', v: r => r.qtyOrder.toLocaleString(), f: () => totals.orderQty.toLocaleString() },
          { h: 'Крой', v: r => r.qtyCut.toLocaleString(), f: () => totals.cutQty.toLocaleString() },
          { h: 'Крой%', v: (_r, _i, m) => `${m.cutPct.toFixed(1)}%`, f: () => `${totals.cutRatePercent}%` },
          { h: 'Разд.', v: r => r.qtyDistribution.toLocaleString(), f: () => totals.distQty.toLocaleString() },
          { h: 'Пошив', v: r => r.qtySewing.toLocaleString(), f: () => totals.sewQty.toLocaleString() },
          { h: 'Упак.', v: r => r.qtyPackaging.toLocaleString(), f: () => totals.packQty.toLocaleString() },
          ...(hasDefect
            ? [
                { h: 'Брак', v: (r: FactoryLedgerRow) => (r.qtyDefect > 0 ? r.qtyDefect.toLocaleString() : '0'), f: () => totals.defectQty.toLocaleString() },
                { h: 'Брак%', v: (_r: FactoryLedgerRow, _i: number, m: ReturnType<typeof getRowMetrics>) => `${m.defectPct.toFixed(1)}%`, f: () => `${totals.defectRatePercent}%` }
              ]
            : []),
          { h: 'Общ-уп', v: r => r.qtyTotalPack.toLocaleString(), f: () => totals.totalPackQty.toLocaleString() },
          { h: 'Разн.', v: r => String(r.difference), f: () => totals.diffQty.toLocaleString() },
          ...(hasShipped ? [{ h: 'Отгр.', v: (r: FactoryLedgerRow) => (r.qtyShipped > 0 ? r.qtyShipped.toLocaleString() : '0'), f: () => totals.shipQty.toLocaleString() }] : []),
          { h: 'Остаток', v: r => r.qtyStock.toLocaleString(), f: () => totals.stockQty.toLocaleString() },
          { h: 'Закр.%', v: (_r, _i, m) => `${m.closePct.toFixed(1)}%`, f: () => `${totals.overallPercent}%` },
          ...(hasNotes ? [{ h: 'Прим.', v: (r: FactoryLedgerRow) => r.notes || '', f: () => '' }] : [])
        ];

        head = [[...prodCols.map(c => c.h), ...(hasPdfSizes ? ['Этап', ...nonZeroPdfSizes] : [])]];
        if (!hasPdfSizes) {
          body = filteredRows.map((r, idx) => {
            const m = getRowMetrics(r);
            return prodCols.map(c => c.v(r, idx, m));
          });
          foot = [prodCols.map(c => c.f())];
        } else {
          body = [];
          filteredRows.forEach((r, idx) => {
            const m = getRowMetrics(r);
            activeReportStages.forEach((stg, stIdx) => {
              const sizeCells = nonZeroPdfSizes.map(sz => {
                const v = getGroupSizeStageNumeric([r], sz, stg.key);
                return v !== null ? String(v) : '';
              });
              if (stIdx === 0) {
                body.push([
                  ...prodCols.map(c => ({
                    content: c.v(r, idx, m),
                    rowSpan: pdfStageSpan,
                    styles: { valign: 'middle' }
                  })),
                  stg.label,
                  ...sizeCells
                ]);
              } else {
                body.push([stg.label, ...sizeCells]);
              }
            });
          });
          foot = activeReportStages.map((stg, stIdx) => {
            const totalSizeCells = nonZeroPdfSizes.map(sz => String(getTotalSizeStageNumeric(sz, stg.key)));
            if (stIdx === 0) {
              return [
                ...prodCols.map(c => ({
                  content: c.f(),
                  rowSpan: pdfStageSpan,
                  styles: { valign: 'middle' }
                })),
                stg.label,
                ...totalSizeCells
              ];
            }
            return [stg.label, ...totalSizeCells];
          });
        }
      }

      autoTable(doc, {
        startY: 24,
        head,
        body,
        foot,
        theme: 'grid',
        styles: {
          font: fontName,
          fontSize: hasPdfSizes ? 5.6 : 6.4,
          cellPadding: 1.0,
          textColor: [15, 23, 42],
          lineColor: [203, 213, 225],
          lineWidth: 0.2
        },
        headStyles: {
          fillColor: [254, 240, 138],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          halign: 'center'
        },
        footStyles: {
          fillColor: [254, 240, 138],
          textColor: [15, 23, 42],
          fontStyle: 'bold'
        },
        margin: { left: 8, right: 8 }
      });

      doc.save(`Заказы_Отчет_${new Date().toISOString().split('T')[0]}.pdf`);
      showNotice('PDF-отчет успешно сформирован и скачан (этапы в отдельных ячейках, пустые столбцы скрыты).');
    } catch (err) {
      console.error('PDF export error:', err);
      showNotice('Ошибка при формировании PDF-отчета.');
    }
  };

  // =========================================================================
  // PDF ЭКСПОРТ ДЕТАЛИЗАЦИИ ЭТАПОВ ПО РАЗМЕРАМ (2-rasm: матрица + график + примечание)
  // =========================================================================
  const handleExportDetailPreviewPdf = async (
    rowsToPrint: FactoryLedgerRow[],
    orderNoLabel: string,
    isAllColors: boolean
  ) => {
    if (rowsToPrint.length === 0) return;
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);

      rowsToPrint.forEach((variantRow, vIdx) => {
        if (vIdx > 0) doc.addPage('a4', 'landscape');
        const vMat = sizeMatrices[variantRow.id] || buildDefaultSizeMatrixForRow(variantRow);
        const vSizes = getEffectiveDisplaySizes(vMat).filter(sz => {
          const c = vMat.values[sz];
          if (!c) return false;
          return (
            (Number(c.order) || 0) > 0 ||
            (Number(c.cut) || 0) > 0 ||
            (Number(c.dist) || 0) > 0 ||
            (Number(c.sew) || 0) > 0 ||
            (Number(c.pack) || 0) > 0
          );
        });
        const effectiveSizes = vSizes.length > 0 ? vSizes : getEffectiveDisplaySizes(vMat);

        const vTotals = effectiveSizes.reduce(
          (acc, sz) => {
            const c = vMat.values[sz];
            if (!c) return acc;
            acc.order += Number(c.order) || 0;
            acc.cut += Number(c.cut) || 0;
            acc.dist += Number(c.dist) || 0;
            acc.sew += Number(c.sew) || 0;
            acc.pack += Number(c.pack) || 0;
            return acc;
          },
          { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }
        );
        const vRem = vTotals.order - vTotals.pack;
        const vCutPct = vTotals.order > 0 ? (vTotals.cut / vTotals.order) * 100 : 0;
        const vClosePct = vTotals.order > 0 ? (vTotals.pack / vTotals.order) * 100 : 0;

        doc.setFont(fontName, 'bold');
        doc.setFontSize(13);
        doc.setTextColor(15, 23, 42);
        doc.text(`ДЕТАЛИЗАЦИЯ ЭТАПОВ ПО РАЗМЕРАМ — ${variantRow.orderNo}`, 12, 14);

        doc.setFont(fontName, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        const metaParts = [
          variantRow.brand ? `Бренд: ${variantRow.brand}` : '',
          `Модель: ${variantRow.model}`,
          `Цвет: ${variantRow.color}${variantRow.colorCode ? ` (${variantRow.colorCode})` : ''}`,
          variantRow.rost ? `Рост: ${variantRow.rost}` : '',
          variantRow.month ? `Месяц: ${variantRow.month}` : '',
          `Дата: ${new Date().toLocaleDateString('ru-RU')}`
        ].filter(Boolean);
        doc.text(metaParts.join('   |   '), 12, 20.5);

        const head = [['Этап', ...effectiveSizes, 'ВСЕГО']];
        const body = [
          ['Заказ', ...effectiveSizes.map(sz => (vMat.values[sz]?.order ? String(vMat.values[sz].order) : '')), String(vTotals.order)],
          ['Крой', ...effectiveSizes.map(sz => (vMat.values[sz]?.cut ? String(vMat.values[sz].cut) : '')), String(vTotals.cut)],
          [
            'Крой %',
            ...effectiveSizes.map(sz => {
              const c = vMat.values[sz];
              return c && c.order > 0 ? `${((c.cut / c.order) * 100).toFixed(1).replace('.', ',')}%` : '';
            }),
            `${vCutPct.toFixed(1).replace('.', ',')}%`
          ],
          ['Раздача', ...effectiveSizes.map(sz => (vMat.values[sz]?.dist ? String(vMat.values[sz].dist) : '')), String(vTotals.dist)],
          ['Пошив', ...effectiveSizes.map(sz => (vMat.values[sz]?.sew ? String(vMat.values[sz].sew) : '')), String(vTotals.sew)],
          ['Упаковка', ...effectiveSizes.map(sz => (vMat.values[sz]?.pack ? String(vMat.values[sz].pack) : '')), String(vTotals.pack)],
          [
            'Остаток',
            ...effectiveSizes.map(sz => {
              const c = vMat.values[sz];
              return c && (c.order > 0 || c.pack > 0) ? String(c.order - c.pack) : '';
            }),
            String(vRem)
          ],
          [
            'Закр. %',
            ...effectiveSizes.map(sz => {
              const c = vMat.values[sz];
              return c && c.order > 0 ? `${((c.pack / c.order) * 100).toFixed(1).replace('.', ',')}%` : '';
            }),
            `${vClosePct.toFixed(1).replace('.', ',')}%`
          ]
        ];

        autoTable(doc, {
          startY: 24,
          head,
          body,
          theme: 'grid',
          styles: {
            font: fontName,
            fontSize: 8.5,
            cellPadding: 1.8,
            halign: 'center',
            textColor: [15, 23, 42],
            lineColor: [203, 213, 225],
            lineWidth: 0.25
          },
          headStyles: {
            fillColor: [248, 203, 173],
            textColor: [15, 23, 42],
            fontStyle: 'bold'
          },
          columnStyles: {
            0: { halign: 'left', fontStyle: 'bold', cellWidth: 26 }
          },
          didParseCell: hookData => {
            if (hookData.section === 'body') {
              if (hookData.row.index === 2) {
                hookData.cell.styles.fillColor = [240, 249, 255];
                hookData.cell.styles.textColor = [12, 74, 110];
              } else if (hookData.row.index === 5) {
                hookData.cell.styles.fillColor = [254, 240, 138];
                hookData.cell.styles.fontStyle = 'bold';
              } else if (hookData.row.index === 7) {
                hookData.cell.styles.fillColor = [209, 250, 229];
                hookData.cell.styles.textColor = [136, 19, 55];
                hookData.cell.styles.fontStyle = 'bold';
              }
            }
          },
          margin: { left: 12, right: 12 }
        });

        const tableFinalY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 96) + 8;
        const chartBoxX = 12;
        const chartBoxW = 182;
        const boxH = Math.max(54, Math.min(82, 196 - tableFinalY));
        const noteBoxX = chartBoxX + chartBoxW + 6;
        const noteBoxW = 285 - noteBoxX;

        // Рамка графика выполнения упаковки по размерам
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.3);
        doc.roundedRect(chartBoxX, tableFinalY, chartBoxW, boxH, 2, 2);

        doc.setFont(fontName, 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(51, 65, 85);
        doc.text(`Упаковка и % выполнения по размерам (${variantRow.color})`, chartBoxX + 4, tableFinalY + 6);

        const chartLabels = [...effectiveSizes, 'ВСЕГО'];
        const barAreaTop = tableFinalY + 11;
        const barAreaBottom = tableFinalY + boxH - 9;
        const barAreaH = Math.max(24, barAreaBottom - barAreaTop);
        const slotW = (chartBoxW - 10) / Math.max(1, chartLabels.length);
        const barW = Math.min(14, Math.max(6, slotW - 3));

        chartLabels.forEach((lbl, lIdx) => {
          const isTotal = lbl === 'ВСЕГО';
          const packVal = isTotal ? vTotals.pack : vMat.values[lbl]?.pack || 0;
          const ordVal = isTotal ? vTotals.order : vMat.values[lbl]?.order || 0;
          const pctNum = ordVal > 0 ? Math.min(100, Math.max(0, (packVal / ordVal) * 100)) : 0;
          const pctText = ordVal > 0 ? `${((packVal / ordVal) * 100).toFixed(1).replace('.', ',')}%` : '0%';
          const bx = chartBoxX + 5 + lIdx * slotW + (slotW - barW) / 2;

          // Верхняя светло-зелёная часть (% остатка / шкала 100%)
          doc.setFillColor(210, 227, 200);
          doc.rect(bx, barAreaTop, barW, barAreaH, 'F');

          // Нижняя зелёная часть (факт упаковки)
          const fillH = Math.max(4.5, (barAreaH * pctNum) / 100);
          doc.setFillColor(141, 184, 117);
          doc.rect(bx, barAreaBottom - fillH, barW, fillH, 'F');

          // Процент выполнения
          doc.setFont(fontName, 'bold');
          doc.setFontSize(6.5);
          doc.setTextColor(15, 23, 42);
          doc.text(pctText, bx + barW / 2, barAreaBottom - fillH - 1.5, { align: 'center' });

          // Кол-во упаковки
          doc.text(String(packVal), bx + barW / 2, barAreaBottom - 1.2, { align: 'center' });

          // Подпись размера
          doc.setFontSize(7);
          doc.text(lbl, bx + barW / 2, barAreaBottom + 5, { align: 'center' });
        });

        // Правый блок: Примечание вместо фото
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(noteBoxX, tableFinalY, noteBoxW, boxH, 2, 2);
        doc.setFillColor(248, 250, 252);
        doc.rect(noteBoxX + 0.3, tableFinalY + 0.3, noteBoxW - 0.6, 8, 'F');

        doc.setFont(fontName, 'bold');
        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        doc.text('ПРИМЕЧАНИЕ', noteBoxX + 4, tableFinalY + 5.7);

        const noteBodyText = variantRow.notes?.trim() || 'Примечание не указано';
        doc.setFont(fontName, variantRow.notes?.trim() ? 'normal' : 'italic');
        doc.setFontSize(9);
        doc.setTextColor(variantRow.notes?.trim() ? 15 : 100, variantRow.notes?.trim() ? 23 : 116, variantRow.notes?.trim() ? 42 : 139);
        const noteLines = doc.splitTextToSize(noteBodyText, noteBoxW - 8);
        doc.text(noteLines, noteBoxX + 4, tableFinalY + 14);
      });

      const fileTag = isAllColors ? 'Все_цвета' : rowsToPrint[0].color || 'Детализация';
      doc.save(`Детализация_${orderNoLabel}_${fileTag}_${new Date().toISOString().split('T')[0]}.pdf`);
      showNotice('PDF детализации этапов с примечанием успешно скачан!');
    } catch (err) {
      console.error('Detail preview PDF export error:', err);
      showNotice('Ошибка при формировании PDF детализации.');
    }
  };

  // Данные для графиков (Фото 2)
  const productionStagesData = useMemo(
    () => [
      { name: 'Заказ', value: totals.orderQty, fill: '#3b82f6' },
      { name: 'Крой', value: totals.cutQty, fill: '#06b6d4' },
      { name: 'Раздача', value: totals.distQty, fill: '#14b8a6' },
      { name: 'Пошив', value: totals.sewQty, fill: '#10b981' },
      { name: 'Упаковка', value: totals.packQty, fill: '#84cc16' },
      { name: 'Отгружено', value: totals.shipQty, fill: '#f59e0b' }
    ],
    [totals]
  );

  const topDefectsData = useMemo(() => {
    return [...filteredRows]
      .filter(r => r.qtyDefect > 0)
      .sort((a, b) => b.qtyDefect - a.qtyDefect)
      .slice(0, 10)
      .map(r => ({
        name: r.orderNo,
        defect: r.qtyDefect,
        model: r.model
      }));
  }, [filteredRows]);

  const topModelsPieData = useMemo(() => {
    const map: { [model: string]: number } = {};
    filteredRows.forEach(r => {
      map[r.model] = (map[r.model] || 0) + (r.qtyPackaging || 0);
    });

    const colors = ['#38bdf8', '#10b981', '#f59e0b', '#ec4899', '#a78bfa', '#64748b'];
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, val], idx) => ({
        name: name.length > 22 ? name.substring(0, 20) + '...' : name,
        value: val,
        color: colors[idx % colors.length]
      }));
  }, [filteredRows]);

  // Активная ячейка для адресной строки Excel
  const activeCellInfo = useMemo(() => {
    if (!activeCell || !filteredRows[activeCell.row]) return null;
    const row = filteredRows[activeCell.row];
    const colDef = GRID_COLUMNS[activeCell.col];
    const colLetter = EXCEL_COL_LETTERS[activeCell.col] || 'Z';
    const address = `${colLetter}${activeCell.row + 1}`;
    const value = getCellRawValue(row, colDef.key);
    return { row, colDef, address, value };
  }, [activeCell, filteredRows, getCellRawValue]);

  // =========================================================================
  // ЛОГИКА РАЗМЕРНЫХ МАТРИЦ ПО ЗАКАЗАМ
  // =========================================================================
  const activeSizeRow = useMemo(() => {
    const sourceList = isEntryWorkspace ? excelEntryRows : filteredRows;
    if (sourceList.length === 0) return null;
    const found = sourceList.find(r => r.id === selectedSizeRowId);
    return found || sourceList[0];
  }, [isEntryWorkspace, excelEntryRows, filteredRows, selectedSizeRowId]);

  // Только для просмотра детализации в Мониторинге (Интерактивный дашборд)
  const isAllColorsPreview = previewOrderRowId === '__ALL_COLORS__';

  const monitorPreviewRow = useMemo(() => {
    if (filteredRows.length === 0) return null;
    if (isAllColorsPreview) return filteredRows[0];
    return filteredRows.find(r => r.id === previewOrderRowId) || filteredRows[0];
  }, [filteredRows, previewOrderRowId, isAllColorsPreview]);

  const monitorPreviewVariants = useMemo(() => {
    if (!monitorPreviewRow) return [];
    const targetKey = (monitorPreviewRow.orderNo || '').trim().toLowerCase();
    return filteredRows.filter(r => ((r.orderNo || '').trim().toLowerCase() === targetKey));
  }, [monitorPreviewRow, filteredRows]);

  const monitorPreviewMatrix = useMemo<OrderSizeMatrix | null>(() => {
    if (!monitorPreviewRow) return null;
    const existing = sizeMatrices[monitorPreviewRow.id];
    if (existing && Array.isArray(existing.sizes) && existing.sizes.length > 0) return existing;
    return buildDefaultSizeMatrixForRow(monitorPreviewRow);
  }, [monitorPreviewRow, sizeMatrices]);

  const monitorPreviewSizes = useMemo(() => {
    return getEffectiveDisplaySizes(monitorPreviewMatrix);
  }, [monitorPreviewMatrix]);

  const monitorPreviewOrderUnionSizes = useMemo(() => {
    const unionSet = new Set<string>();
    const allSizesInOrder = new Set<string>();
    monitorPreviewVariants.forEach(v => {
      const m = sizeMatrices[v.id];
      if (!m) return;
      m.sizes.forEach(s => allSizesInOrder.add(s));
      getPopulatedSizes(m).forEach(s => unionSet.add(s));
    });
    if (unionSet.size > 0) return Array.from(unionSet);
    return Array.from(allSizesInOrder);
  }, [monitorPreviewVariants, sizeMatrices]);

  const monitorPreviewTotals = useMemo(() => {
    if (!monitorPreviewMatrix) return { order: 0, pack: 0 };
    let order = 0;
    let pack = 0;
    monitorPreviewMatrix.sizes.forEach(sz => {
      const c = monitorPreviewMatrix.values[sz];
      if (!c) return;
      order += Number(c.order) || 0;
      pack += Number(c.pack) || 0;
    });
    return { order, pack };
  }, [monitorPreviewMatrix]);

  // Все цвета и ростовки, относящиеся к текущему выбранному Заказу №
  const activeOrderVariants = useMemo(() => {
    if (!activeSizeRow) return [];
    return derivedLedgerRows.filter(r => r.orderNo === activeSizeRow.orderNo);
  }, [activeSizeRow, derivedLedgerRows]);

  const activeSizeMatrix = useMemo<OrderSizeMatrix | null>(() => {
    if (!activeSizeRow) return null;
    const existing = sizeMatrices[activeSizeRow.id];
    if (existing && Array.isArray(existing.sizes) && existing.sizes.length > 0) {
      return existing;
    }
    return buildDefaultSizeMatrixForRow(activeSizeRow);
  }, [activeSizeRow, sizeMatrices]);

  // Отображаемые размеры в матрице ввода (учитывает режим «Только заполненные»)
  const visibleMatrixSizes = useMemo(() => {
    if (!activeSizeMatrix) return [];
    if (!hideEmptyMatrixSizes) return activeSizeMatrix.sizes;
    return getEffectiveDisplaySizes(activeSizeMatrix);
  }, [activeSizeMatrix, hideEmptyMatrixSizes]);

  // Заполненные размеры для сводной таблицы по заказу и для диаграммы / экспорта
  const reportMatrixSizes = useMemo(() => {
    return getEffectiveDisplaySizes(activeSizeMatrix);
  }, [activeSizeMatrix]);

  const activeOrderUnionPopulatedSizes = useMemo(() => {
    const unionSet = new Set<string>();
    const allSizesInOrder = new Set<string>();
    activeOrderVariants.forEach(v => {
      const m = sizeMatrices[v.id];
      if (!m) return;
      m.sizes.forEach(s => allSizesInOrder.add(s));
      getPopulatedSizes(m).forEach(s => unionSet.add(s));
    });
    if (unionSet.size > 0) return Array.from(unionSet);
    return Array.from(allSizesInOrder);
  }, [activeOrderVariants, sizeMatrices]);

  const activeSizeTotals = useMemo(() => {
    if (!activeSizeMatrix) {
      return { order: 0, cut: 0, cutPct: 0, dist: 0, sew: 0, pack: 0, remOrder: 0, remDist: 0, diffDistPackPct: 0, pct: 0 };
    }
    let order = 0;
    let cut = 0;
    let dist = 0;
    let sew = 0;
    let pack = 0;
    activeSizeMatrix.sizes.forEach(sz => {
      const c = activeSizeMatrix.values[sz];
      if (!c) return;
      order += Number(c.order) || 0;
      cut += Number(c.cut) || 0;
      dist += Number(c.dist) || 0;
      sew += Number(c.sew) || 0;
      pack += Number(c.pack) || 0;
    });
    const remOrder = order - pack;
    const remDist = dist - pack;
    const cutPct = order > 0 ? (cut / order) * 100 : 0;
    const diffDistPackPct = dist > 0 ? (remDist / dist) * 100 : 0;
    const pct = order > 0 ? (pack / order) * 100 : 0;
    return { order, cut, cutPct, dist, sew, pack, remOrder, remDist, diffDistPackPct, pct };
  }, [activeSizeMatrix]);

  const updateSizeCellValue = (sizeName: string, field: keyof SizeCellValues, rawVal: string) => {
    if (!activeSizeRow || !activeSizeMatrix) return;
    const num = Math.max(0, parseInt(rawVal.replace(/[^\d]/g, ''), 10) || 0);
    const nextMatrix: OrderSizeMatrix = {
      ...activeSizeMatrix,
      values: {
        ...activeSizeMatrix.values,
        [sizeName]: {
          ...(activeSizeMatrix.values[sizeName] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }),
          [field]: num
        }
      }
    };
    setSizeMatrices(prev => ({ ...prev, [activeSizeRow.id]: nextMatrix }));
  };

  // Excel-навигация (стрелки, Tab, Shift+Tab, Enter, Shift+Enter, F2, Esc) внутри матрицы «Размеры по заказу»
  const handleSizeMatrixKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, stageIdx: number, colIdx: number) => {
    if (!activeSizeMatrix) return;
    const maxRow = 4; // 0:order, 1:cut, 2:dist, 3:sew, 4:pack
    const maxCol = Math.max(0, visibleMatrixSizes.length - 1);
    let nextR = stageIdx;
    let nextC = colIdx;

    if (e.key === 'F2') {
      e.preventDefault();
      sizeMatrixManualCaretRef.current = true;
      const len = e.currentTarget.value.length;
      e.currentTarget.setSelectionRange(len, len);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      sizeMatrixManualCaretRef.current = false;
      e.currentTarget.blur();
      setSizeMatrixActiveCell(null);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        if (stageIdx > 0) nextR = stageIdx - 1;
        else if (colIdx > 0) {
          nextR = maxRow;
          nextC = colIdx - 1;
        }
      } else {
        if (stageIdx < maxRow) nextR = stageIdx + 1;
        else if (colIdx < maxCol) {
          nextR = 0;
          nextC = colIdx + 1;
        }
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (colIdx > 0) nextC = colIdx - 1;
        else if (stageIdx > 0) {
          nextR = stageIdx - 1;
          nextC = maxCol;
        }
      } else {
        if (colIdx < maxCol) nextC = colIdx + 1;
        else if (stageIdx < maxRow) {
          nextR = stageIdx + 1;
          nextC = 0;
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextR = Math.min(maxRow, stageIdx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nextR = Math.max(0, stageIdx - 1);
    } else if (e.key === 'ArrowRight') {
      const selAll = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === e.currentTarget.value.length;
      const atEnd = e.currentTarget.selectionStart === e.currentTarget.value.length;
      if (!sizeMatrixManualCaretRef.current || selAll || atEnd) {
        e.preventDefault();
        if (colIdx < maxCol) nextC = colIdx + 1;
        else if (stageIdx < maxRow) {
          nextR = stageIdx + 1;
          nextC = 0;
        }
      } else {
        return;
      }
    } else if (e.key === 'ArrowLeft') {
      const selAll = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === e.currentTarget.value.length;
      const atStart = e.currentTarget.selectionStart === 0;
      if (!sizeMatrixManualCaretRef.current || selAll || atStart) {
        e.preventDefault();
        if (colIdx > 0) nextC = colIdx - 1;
        else if (stageIdx > 0) {
          nextR = stageIdx - 1;
          nextC = maxCol;
        }
      } else {
        return;
      }
    } else {
      return;
    }

    sizeMatrixManualCaretRef.current = false;
    setSizeMatrixActiveCell({ row: nextR, col: nextC });
    const el = document.querySelector<HTMLInputElement>(`input[data-sz-r="${nextR}"][data-sz-c="${nextC}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  };

  // Применение распознанных данных из «Excel-лист (Ctrl+V)» в заказы и размерные матрицы
  const handleApplyParsedExcelItems = (items: ParsedExcelOrderItem[], mergeExisting: boolean) => {
    if (!items || items.length === 0) return;

    const nextRows = [...ledgerRows];
    const nextMatrices: Record<string, OrderSizeMatrix> = { ...sizeMatrices };
    const newBrands = new Set<string>(brandsList);
    const newMonths = new Set<string>(monthsList);

    let firstTargetId = '';
    let addedCount = 0;
    let updatedCount = 0;

    items.forEach((item, idx) => {
      if (item.brand) newBrands.add(item.brand);
      if (item.month) newMonths.add(item.month);

      const matchIdx = mergeExisting
        ? nextRows.findIndex(
            r =>
              r.orderNo.trim().toLowerCase() === item.orderNo.trim().toLowerCase() &&
              r.model.trim().toLowerCase() === item.model.trim().toLowerCase() &&
              r.color.trim().toLowerCase() === item.color.trim().toLowerCase() &&
              (r.rost || '').trim().toLowerCase() === (item.rost || '').trim().toLowerCase()
          )
        : -1;

      if (matchIdx !== -1) {
        const existingRow = nextRows[matchIdx];
        const existingMatrix = nextMatrices[existingRow.id];
        const built = buildLedgerEntryFromParsedItem(item, existingRow.id);

        const mergedSizes = existingMatrix
          ? Array.from(new Set([...existingMatrix.sizes, ...built.matrix.sizes]))
          : built.matrix.sizes;
        const mergedValues: Record<string, SizeCellValues> = { ...(existingMatrix?.values || {}) };

        built.matrix.sizes.forEach(sz => {
          const cur = mergedValues[sz] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
          const incoming = built.matrix.values[sz];
          if (!incoming) return;
          mergedValues[sz] = {
            order: incoming.order > 0 ? incoming.order : cur.order,
            cut: incoming.cut > 0 ? incoming.cut : cur.cut,
            dist: incoming.dist > 0 ? incoming.dist : cur.dist,
            sew: incoming.sew > 0 ? incoming.sew : cur.sew,
            pack: incoming.pack > 0 ? incoming.pack : cur.pack
          };
        });

        const mergedMatrix: OrderSizeMatrix = {
          rowId: existingRow.id,
          presetId: built.matrix.presetId === 'custom' && existingMatrix ? existingMatrix.presetId : built.matrix.presetId,
          sizes: mergedSizes,
          values: mergedValues,
          defect: item.defect > 0 ? item.defect : (existingMatrix?.defect || 0)
        };

        nextMatrices[existingRow.id] = mergedMatrix;
        nextRows[matchIdx] = recalcLedgerRowFromMatrix(
          {
            ...existingRow,
            brand: item.brand || existingRow.brand,
            colorCode: item.colorCode || existingRow.colorCode,
            month: item.month || existingRow.month,
            qtyShipped: item.qtyShipped > 0 ? item.qtyShipped : existingRow.qtyShipped,
            notes: item.notes || existingRow.notes
          },
          item.sizes.length > 0 ? mergedMatrix : null
        );
        if (!firstTargetId) firstTargetId = existingRow.id;
        updatedCount++;
      } else {
        const newId = `r-xl-${Date.now()}-${idx}`;
        const built = buildLedgerEntryFromParsedItem(item, newId);
        nextMatrices[newId] = built.matrix;
        nextRows.unshift(built.row);
        if (!firstTargetId) firstTargetId = newId;
        addedCount++;
      }
    });

    if (newBrands.size > brandsList.length) {
      setBrandsList(Array.from(newBrands));
    }
    if (newMonths.size > monthsList.length) {
      setMonthsList(Array.from(newMonths));
    }

    setSizeMatrices(nextMatrices);
    setLedgerRows(nextRows);
    const touchedIds = items
      .map((item, idx) => {
        const match = nextRows.find(
          r =>
            r.orderNo.trim().toLowerCase() === item.orderNo.trim().toLowerCase() &&
            r.model.trim().toLowerCase() === item.model.trim().toLowerCase() &&
            r.color.trim().toLowerCase() === item.color.trim().toLowerCase() &&
            (r.rost || '').trim().toLowerCase() === (item.rost || '').trim().toLowerCase()
        );
        return match?.id || `r-xl-${Date.now()}-${idx}`;
      })
      .filter(Boolean);
    registerEntrySessionIds(touchedIds);
    setShowSavedInExcel(false);
    if (firstTargetId) {
      setSelectedSizeRowId(firstTargetId);
      const addedRow = nextRows.find(r => r.id === firstTargetId);
      if (addedRow) setLastAddedOrderNo(addedRow.orderNo);
    }
    setActiveTabMode('size_matrix');

    const parts: string[] = [];
    if (addedCount > 0) parts.push(`добавлено: ${addedCount}`);
    if (updatedCount > 0) parts.push(`обновлено: ${updatedCount}`);
    showNotice(`Данные из Excel загружены (${parts.join(', ')})!`);
  };

  // Массовая вставка из Excel (Ctrl+V) прямо в ячейки матрицы «Размеры по заказу»
  const handleSizeMatrixPaste = (e: React.ClipboardEvent<HTMLInputElement>, startStageIdx: number, startColIdx: number) => {
    if (!activeSizeRow || !activeSizeMatrix) return;
    const html = e.clipboardData?.getData('text/html') || '';
    const text = e.clipboardData?.getData('text') || '';
    if (!text.includes('\t') && !text.includes('\n')) return; // Одиночное число вставляется стандартно

    // Если вставлена полноценная Excel-таблица с названиями размеров/этапов/заказов (напр. как на 2-м фото),
    // открываем Excel-лист с автоматическим распознаванием!
    const hasStructuredHeaders = /(xs|xl|заказ|модел|цвет|крой|разд|пошив|упак|всего|этикет|рост)/i.test(text);
    if (hasStructuredHeaders) {
      e.preventDefault();
      const parsedGrid = parseClipboardToGrid(html, text);
      if (parsedGrid.length > 0) {
        setPendingExcelPasteGrid(parsedGrid);
        setActiveTabMode('excel_paste');
        showNotice('Таблица с шапкой/размерами распознана в Excel-листе! Проверьте и нажмите «Загрузить в заказы».');
        return;
      }
    }

    e.preventDefault();
    const stageFields: (keyof SizeCellValues)[] = ['order', 'cut', 'dist', 'sew', 'pack'];
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length > 0);
    const nextValues = { ...activeSizeMatrix.values };

    lines.forEach((line, rOff) => {
      const stageField = stageFields[startStageIdx + rOff];
      if (!stageField) return;
      const cells = line.split('\t');
      cells.forEach((rawCell, cOff) => {
        const sz = visibleMatrixSizes[startColIdx + cOff];
        if (!sz) return;
        const num = Math.max(0, parseInt(rawCell.replace(/[^\d]/g, ''), 10) || 0);
        nextValues[sz] = {
          ...(nextValues[sz] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }),
          [stageField]: num
        };
      });
    });

    setSizeMatrices(prev => ({
      ...prev,
      [activeSizeRow.id]: {
        ...activeSizeMatrix,
        values: nextValues
      }
    }));
    showNotice(`Данные из Excel вставлены в матрицу размеров (${lines.length} стр.)!`);
  };

  // Размеры для горизонтальной сетки всех цветов/ростов активного заказа
  const variantsMatrixSizes = useMemo(() => {
    if (!activeSizeRow) return visibleMatrixSizes;
    const allOrdered: string[] = [];
    const populatedSet = new Set<string>();
    activeOrderVariants.forEach(v => {
      const m = sizeMatrices[v.id];
      if (!m) return;
      m.sizes.forEach(s => {
        if (!allOrdered.includes(s)) allOrdered.push(s);
      });
      getPopulatedSizes(m).forEach(s => populatedSet.add(s));
    });
    if (hideEmptyMatrixSizes && populatedSet.size > 0) {
      return allOrdered.filter(s => populatedSet.has(s));
    }
    return allOrdered.length > 0 ? allOrdered : visibleMatrixSizes;
  }, [activeSizeRow, activeOrderVariants, sizeMatrices, hideEmptyMatrixSizes, visibleMatrixSizes]);

  // Обновление количества по конкретной строке (цвет/рост) и размеру в горизонтальной сетке вариантов
  const updateVariantCellValue = (
    targetRow: FactoryLedgerRow,
    sizeName: string,
    field: keyof SizeCellValues,
    rawVal: string
  ) => {
    const num = Math.max(0, parseInt(rawVal.replace(/[^\d]/g, ''), 10) || 0);
    setSizeMatrices(prev => {
      const existing = prev[targetRow.id] || buildDefaultSizeMatrixForRow(targetRow);
      const nextSizes = existing.sizes.includes(sizeName) ? existing.sizes : [...existing.sizes, sizeName];
      const nextMatrix: OrderSizeMatrix = {
        ...existing,
        sizes: nextSizes,
        values: {
          ...existing.values,
          [sizeName]: {
            ...(existing.values[sizeName] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }),
            [field]: num
          }
        }
      };
      return { ...prev, [targetRow.id]: nextMatrix };
    });
  };

  // Excel-навигация и Ctrl+V по строкам вариантов (Цвета/росты × Размеры)
  const handleVariantsGridKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) => {
    const maxR = Math.max(0, activeOrderVariants.length - 1);
    const maxC = Math.max(0, variantsMatrixSizes.length - 1);
    let nextR = rowIdx;
    let nextC = colIdx;

    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      nextR = rowIdx < maxR ? rowIdx + 1 : 0;
    } else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault();
      nextR = rowIdx > 0 ? rowIdx - 1 : maxR;
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (colIdx > 0) nextC = colIdx - 1;
        else if (rowIdx > 0) {
          nextR = rowIdx - 1;
          nextC = maxC;
        }
      } else {
        if (colIdx < maxC) nextC = colIdx + 1;
        else if (rowIdx < maxR) {
          nextR = rowIdx + 1;
          nextC = 0;
        }
      }
    } else if (e.key === 'ArrowRight') {
      if (e.currentTarget.selectionStart === e.currentTarget.value.length) {
        e.preventDefault();
        nextC = Math.min(maxC, colIdx + 1);
      } else return;
    } else if (e.key === 'ArrowLeft') {
      if (e.currentTarget.selectionStart === 0) {
        e.preventDefault();
        nextC = Math.max(0, colIdx - 1);
      } else return;
    } else if (e.key === 'Escape') {
      e.currentTarget.blur();
      return;
    } else {
      return;
    }

    const el = document.querySelector<HTMLInputElement>(`input[data-vg-r="${nextR}"][data-vg-c="${nextC}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  };

  const handleVariantsGridPaste = (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, startColIdx: number) => {
    const html = e.clipboardData?.getData('text/html') || '';
    const text = e.clipboardData?.getData('text') || '';
    if (!text.includes('\t') && !text.includes('\n')) return;

    const hasStructuredHeaders = /(xs|xl|заказ|модел|цвет|крой|разд|пошив|упак|всего|этикет|рост)/i.test(text);
    if (hasStructuredHeaders) {
      e.preventDefault();
      const parsedGrid = parseClipboardToGrid(html, text);
      if (parsedGrid.length > 0) {
        setPendingExcelPasteGrid(parsedGrid);
        setActiveTabMode('excel_paste');
        showNotice('Таблица с шапкой/размерами распознана в Excel-листе! Проверьте и нажмите «Загрузить в заказы».');
        return;
      }
    }

    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.length > 0);
    setSizeMatrices(prev => {
      const next = { ...prev };
      lines.forEach((line, rOff) => {
        const targetRow = activeOrderVariants[startRowIdx + rOff];
        if (!targetRow) return;
        const existing = next[targetRow.id] || buildDefaultSizeMatrixForRow(targetRow);
        const nextValues = { ...existing.values };
        const nextSizes = [...existing.sizes];
        const cells = line.split('\t');
        cells.forEach((rawCell, cOff) => {
          const sz = variantsMatrixSizes[startColIdx + cOff];
          if (!sz) return;
          if (!nextSizes.includes(sz)) nextSizes.push(sz);
          const num = Math.max(0, parseInt(rawCell.replace(/[^\d]/g, ''), 10) || 0);
          nextValues[sz] = {
            ...(nextValues[sz] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }),
            [variantsGridStage]: num
          };
        });
        next[targetRow.id] = { ...existing, sizes: nextSizes, values: nextValues };
      });
      return next;
    });
    showNotice(`Данные вставлены в горизонтальную таблицу цветов (${lines.length} стр.)!`);
  };

  const updateSizeDefect = (rawVal: string) => {
    if (!activeSizeRow || !activeSizeMatrix) return;
    const num = Math.max(0, parseInt(rawVal.replace(/[^\d]/g, ''), 10) || 0);
    setSizeMatrices(prev => ({
      ...prev,
      [activeSizeRow.id]: { ...activeSizeMatrix, defect: num }
    }));
  };

  const changeSizePresetForRow = (presetId: Exclude<SizePresetId, 'custom'>) => {
    if (!activeSizeRow) return;
    const presetSizes = [...SIZE_PRESETS[presetId].sizes];
    const prevVals = activeSizeMatrix?.values || {};
    const newVals: Record<string, SizeCellValues> = {};
    presetSizes.forEach(sz => {
      newVals[sz] = prevVals[sz] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
    });
    const nextMatrix: OrderSizeMatrix = {
      rowId: activeSizeRow.id,
      presetId,
      sizes: presetSizes,
      values: newVals,
      defect: activeSizeMatrix?.defect || 0
    };
    setHideEmptyMatrixSizes(false);
    setSizeMatrices(prev => ({ ...prev, [activeSizeRow.id]: nextMatrix }));
    showNotice(`Размерная сетка переключена на: ${SIZE_PRESETS[presetId].label}`);
  };

  // Редактировать название конкретного размера в матрице
  const handleCommitRenameSize = (oldName: string) => {
    const newName = editingSizeColDraft.trim();
    setEditingSizeCol(null);
    if (!activeSizeRow || !activeSizeMatrix || !newName || newName === oldName) return;
    if (activeSizeMatrix.sizes.includes(newName)) {
      showNotice(`Размер «${newName}» уже существует!`);
      return;
    }
    const nextSizes = activeSizeMatrix.sizes.map(s => (s === oldName ? newName : s));
    const nextValues: Record<string, SizeCellValues> = {};
    activeSizeMatrix.sizes.forEach(s => {
      const targetKey = s === oldName ? newName : s;
      nextValues[targetKey] = activeSizeMatrix.values[s] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
    });
    setSizeMatrices(prev => ({
      ...prev,
      [activeSizeRow.id]: {
        ...activeSizeMatrix,
        presetId: 'custom',
        sizes: nextSizes,
        values: nextValues
      }
    }));
    showNotice(`Размер «${oldName}» переименован в «${newName}»`);
  };

  // Оставить в матрице ТОЛЬКО размеры с введенными данными (> 0)
  const handleTrimEmptySizeColumns = () => {
    if (!activeSizeRow || !activeSizeMatrix) return;
    const populated = getPopulatedSizes(activeSizeMatrix);
    if (populated.length === 0) {
      showNotice('Сначала введите числа хотя бы в один размер!');
      return;
    }
    const nextValues: Record<string, SizeCellValues> = {};
    populated.forEach(sz => {
      nextValues[sz] = activeSizeMatrix.values[sz];
    });
    setSizeMatrices(prev => ({
      ...prev,
      [activeSizeRow.id]: {
        ...activeSizeMatrix,
        presetId: 'custom',
        sizes: populated,
        values: nextValues
      }
    }));
    showNotice(`Пустые размеры (0) удалены! Оставлены только активные: ${populated.join(', ')}`);
  };


  const handleAddCustomSizeColumn = () => {
    const label = newCustomSizeInput.trim();
    if (!label || !activeSizeRow || !activeSizeMatrix) return;
    if (activeSizeMatrix.sizes.includes(label)) {
      showNotice(`Размер «${label}» уже есть в таблице`);
      return;
    }
    const nextMatrix: OrderSizeMatrix = {
      ...activeSizeMatrix,
      presetId: 'custom',
      sizes: [...activeSizeMatrix.sizes, label],
      values: {
        ...activeSizeMatrix.values,
        [label]: { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 }
      }
    };
    setSizeMatrices(prev => ({ ...prev, [activeSizeRow.id]: nextMatrix }));
    setNewCustomSizeInput('');
    showNotice(`Добавлен размер «${label}»`);
  };

  const handleApplyBulkSizes = () => {
    if (!activeSizeRow || !activeSizeMatrix) return;
    const parsed: string[] = bulkSizeInput
      .split(/[,;\s\t]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const unique: string[] = Array.from<string>(new Set(parsed));
    if (unique.length === 0) return;

    const existingValues = activeSizeMatrix.values;
    const newValues: Record<string, SizeCellValues> = {};
    unique.forEach(sz => {
      newValues[sz] = existingValues[sz] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
    });

    const hasAnyNumbers = unique.some(sz => (newValues[sz]?.order || 0) > 0 || (newValues[sz]?.pack || 0) > 0);
    let nextMatrix: OrderSizeMatrix = {
      ...activeSizeMatrix,
      presetId: 'custom',
      sizes: unique,
      values: newValues
    };

    if (!hasAnyNumbers && activeSizeRow.qtyOrder > 0) {
      const ordArr = distributeQtyAcrossSizes(activeSizeRow.qtyOrder, unique, unique.length);
      const cutArr = distributeQtyAcrossSizes(activeSizeRow.qtyCut, unique, unique.length);
      const distArr = distributeQtyAcrossSizes(activeSizeRow.qtyDistribution, unique, unique.length);
      const sewArr = distributeQtyAcrossSizes(activeSizeRow.qtySewing, unique, unique.length);
      const packArr = distributeQtyAcrossSizes(activeSizeRow.qtyPackaging, unique, unique.length);
      unique.forEach((sz, idx) => {
        nextMatrix.values[sz] = {
          order: ordArr[idx],
          cut: cutArr[idx],
          dist: distArr[idx],
          sew: sewArr[idx],
          pack: packArr[idx]
        };
      });
    }

    setSizeMatrices(prev => ({ ...prev, [activeSizeRow.id]: nextMatrix }));
    setBulkSizeInput('');
    setShowCustomSizeEditor(false);
    showNotice(`Применены размеры (${unique.length}): ${unique.join(', ')}`);
  };

  const handleRemoveSizeColumn = (sizeName: string) => {
    if (!activeSizeRow || !activeSizeMatrix || activeSizeMatrix.sizes.length <= 1) return;
    const nextSizes = activeSizeMatrix.sizes.filter(s => s !== sizeName);
    const nextValues = { ...activeSizeMatrix.values };
    delete nextValues[sizeName];
    setSizeMatrices(prev => ({
      ...prev,
      [activeSizeRow.id]: {
        ...activeSizeMatrix,
        presetId: 'custom',
        sizes: nextSizes,
        values: nextValues
      }
    }));
  };


  const handleUploadModelImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeSizeRow) return;
    const reader = new FileReader();
    reader.onload = evt => {
      const dataUrl = String(evt.target?.result || '');
      if (!dataUrl) return;
      setModelImages(prev => ({
        ...prev,
        [activeSizeRow.model]: dataUrl,
        [activeSizeRow.id]: dataUrl
      }));
      showNotice('Фотография / эскиз модели загружены!');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleExportSizeMatrixExcel = () => {
    if (!activeSizeRow || !activeSizeMatrix) return;
    const sizes = reportMatrixSizes;
    const head = [
      'Месяц',
      'Бренд',
      'Заказ №',
      'Модель',
      'Цвет',
      lang === 'uz' ? 'Artikul' : 'Артикул',
      'Рост',
      'Этап',
      ...sizes,
      'ВСЕГО',
      'Брак',
      'Отгрузка',
      'Примечание'
    ];

    const stageRows = [
      ['Заказ', ...sizes.map(sz => activeSizeMatrix.values[sz]?.order || ''), activeSizeTotals.order],
      ['Крой', ...sizes.map(sz => activeSizeMatrix.values[sz]?.cut || ''), activeSizeTotals.cut],
      [
        'Крой % (к Заказу)',
        ...sizes.map(sz => {
          const c = activeSizeMatrix.values[sz];
          if (!c || c.order === 0) return '';
          return `${((c.cut / c.order) * 100).toFixed(1).replace('.', ',')}%`;
        }),
        `${activeSizeTotals.cutPct.toFixed(1).replace('.', ',')}%`
      ],
      ['Раздача', ...sizes.map(sz => activeSizeMatrix.values[sz]?.dist || ''), activeSizeTotals.dist],
      ['Пошив', ...sizes.map(sz => activeSizeMatrix.values[sz]?.sew || ''), activeSizeTotals.sew],
      ['Упаковка', ...sizes.map(sz => activeSizeMatrix.values[sz]?.pack || ''), activeSizeTotals.pack],
      [
        'Остаток',
        ...sizes.map(sz => {
          const c = activeSizeMatrix.values[sz];
          if (!c || (c.order === 0 && c.pack === 0)) return '';
          return c.order - c.pack;
        }),
        activeSizeTotals.remOrder
      ],
      [
        '%',
        ...sizes.map(sz => {
          const c = activeSizeMatrix.values[sz];
          if (!c || c.order === 0) return '';
          return `${((c.pack / c.order) * 100).toFixed(1).replace('.', ',')}%`;
        }),
        `${activeSizeTotals.pct.toFixed(1).replace('.', ',')}%`
      ]
    ].map((arr, i) => [
      i === 0 ? (activeSizeRow.month || DEFAULT_MONTHS[0]) : '',
      i === 0 ? (activeSizeRow.brand || '') : '',
      i === 0 ? activeSizeRow.orderNo : '',
      i === 0 ? activeSizeRow.model : '',
      i === 0 ? activeSizeRow.color : '',
      i === 0 ? (activeSizeRow.colorCode || '') : '',
      i === 0 ? (activeSizeRow.rost || '') : '',
      ...arr,
      i === 0 ? (activeSizeMatrix.defect || '') : '',
      i === 0 ? (activeSizeRow.qtyShipped || '') : '',
      i === 0 ? (activeSizeRow.notes || '') : ''
    ]);

    const summaryHead = ['СВОДКА:'];
    const summaryTitles = [
      'Всего заказа',
      'Всего крой',
      'Крой %',
      'Всего Раздача',
      'Всего Пошив',
      'Всего Упаковка',
      'Брак',
      'Разница (Разд-Упак)',
      'Разница %'
    ];
    const summaryVals = [
      activeSizeTotals.order,
      activeSizeTotals.cut,
      `${activeSizeTotals.cutPct.toFixed(1).replace('.', ',')}%`,
      activeSizeTotals.dist,
      activeSizeTotals.sew,
      activeSizeTotals.pack,
      activeSizeMatrix.defect || 0,
      activeSizeTotals.remDist,
      `${activeSizeTotals.diffDistPackPct.toFixed(1).replace('.', ',')}%`
    ];

    const ws = XLSX.utils.aoa_to_sheet([head, ...stageRows, summaryHead, summaryTitles, summaryVals]);
    ws['!cols'] = [
      { wch: 15 },
      { wch: 15 },
      { wch: 14 },
      { wch: 22 },
      { wch: 16 },
      { wch: 12 },
      { wch: 11 },
      { wch: 18 },
      ...sizes.map(() => ({ wch: 9 })),
      { wch: 11 },
      { wch: 9 },
      { wch: 11 },
      { wch: 22 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Матрица размеров');
    XLSX.writeFile(wb, `Размеры_${activeSizeRow.orderNo}_${activeSizeRow.color}${activeSizeRow.rost ? '_' + activeSizeRow.rost : ''}.xlsx`);
    showNotice('Матрица размеров экспортирована в XLSX!');
  };

  const handleExportSizeMatrixPdf = async () => {
    if (!activeSizeRow || !activeSizeMatrix) return;
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);

      doc.setFont(fontName, 'bold');
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text(
        `РАЗМЕРЫ ПО ЗАКАЗУ: ${activeSizeRow.orderNo} — ${activeSizeRow.model} (${activeSizeRow.color}${activeSizeRow.rost ? ', рост ' + activeSizeRow.rost : ''})`,
        12,
        14
      );

      doc.setFont(fontName, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `Бренд: ${activeSizeRow.brand || '—'}   |   Месяц: ${activeSizeRow.month || '—'}   |   Крой %: ${activeSizeTotals.cutPct.toFixed(1)}%   |   Дата: ${new Date().toLocaleDateString('ru-RU')}`,
        12,
        20
      );

      const sizes = reportMatrixSizes;
      const colorLabel = [
        activeSizeRow.color,
        activeSizeRow.colorCode ? `(${activeSizeRow.colorCode})` : '',
        activeSizeRow.rost ? `Рост: ${activeSizeRow.rost}` : ''
      ].filter(Boolean).join('\n');

      const head = [['Заказ', 'Модель', 'Цвет / Рост', 'Этап', ...sizes, 'ВСЕГО']];
      const stageRows = [
        [
          { content: `${activeSizeRow.orderNo}\n${activeSizeRow.brand || ''}`, rowSpan: 8, styles: { valign: 'middle', halign: 'center', fontStyle: 'bold' } },
          { content: activeSizeRow.model, rowSpan: 8, styles: { valign: 'middle', halign: 'center', fontStyle: 'bold' } },
          { content: colorLabel, rowSpan: 8, styles: { valign: 'middle', halign: 'center', fontStyle: 'bold' } },
          'Заказ',
          ...sizes.map(sz => (activeSizeMatrix.values[sz]?.order ? String(activeSizeMatrix.values[sz].order) : '')),
          String(activeSizeTotals.order)
        ],
        ['Крой', ...sizes.map(sz => (activeSizeMatrix.values[sz]?.cut ? String(activeSizeMatrix.values[sz].cut) : '')), String(activeSizeTotals.cut)],
        [
          { content: 'Крой %', styles: { fillColor: [224, 242, 254], textColor: [3, 105, 161], fontStyle: 'bold' } },
          ...sizes.map(sz => {
            const c = activeSizeMatrix.values[sz];
            const pctStr = c && c.order > 0 ? `${((c.cut / c.order) * 100).toFixed(1).replace('.', ',')}%` : '';
            return {
              content: pctStr,
              styles: pctStr ? { fillColor: [224, 242, 254], textColor: [3, 105, 161], fontStyle: 'bold' } : {}
            };
          }),
          {
            content: `${activeSizeTotals.cutPct.toFixed(1).replace('.', ',')}%`,
            styles: { fillColor: [224, 242, 254], textColor: [3, 105, 161], fontStyle: 'bold' }
          }
        ],
        ['Раздача', ...sizes.map(sz => (activeSizeMatrix.values[sz]?.dist ? String(activeSizeMatrix.values[sz].dist) : '')), String(activeSizeTotals.dist)],
        ['Пошив', ...sizes.map(sz => (activeSizeMatrix.values[sz]?.sew ? String(activeSizeMatrix.values[sz].sew) : '')), String(activeSizeTotals.sew)],
        [
          { content: 'Упаковка', styles: { fillColor: [255, 255, 0], fontStyle: 'bold' } },
          ...sizes.map(sz => ({
            content: activeSizeMatrix.values[sz]?.pack ? String(activeSizeMatrix.values[sz].pack) : '',
            styles: { fillColor: [255, 255, 0], fontStyle: 'bold' }
          })),
          { content: String(activeSizeTotals.pack), styles: { fillColor: [255, 255, 0], fontStyle: 'bold' } }
        ],
        [
          'Остаток',
          ...sizes.map(sz => {
            const c = activeSizeMatrix.values[sz];
            return c && (c.order > 0 || c.pack > 0) ? String(c.order - c.pack) : '';
          }),
          String(activeSizeTotals.remOrder)
        ],
        [
          { content: 'Закр. %', styles: { textColor: [185, 28, 28], fontStyle: 'bold' } },
          ...sizes.map(sz => {
            const c = activeSizeMatrix.values[sz];
            const pctStr = c && c.order > 0 ? `${((c.pack / c.order) * 100).toFixed(1).replace('.', ',')}%` : '';
            return {
              content: pctStr,
              styles: pctStr ? { fillColor: [134, 239, 172], textColor: [153, 27, 27], fontStyle: 'bold' } : {}
            };
          }),
          {
            content: `${activeSizeTotals.pct.toFixed(1).replace('.', ',')}%`,
            styles: { fillColor: [134, 239, 172], textColor: [153, 27, 27], fontStyle: 'bold' }
          }
        ]
      ];

      autoTable(doc, {
        startY: 25,
        head,
        body: stageRows as any,
        theme: 'grid',
        styles: {
          font: fontName,
          fontSize: 8.2,
          halign: 'center',
          textColor: [15, 23, 42],
          lineColor: [51, 65, 85],
          lineWidth: 0.25
        },
        headStyles: {
          fillColor: [248, 203, 173],
          textColor: [15, 23, 42],
          fontStyle: 'bold'
        },
        margin: { left: 10, right: 10 }
      });

      const finalY = (doc as any).lastAutoTable?.finalY || 105;
      autoTable(doc, {
        startY: finalY + 8,
        head: [['Всего заказа', 'Всего крой', 'Крой %', 'Всего Раздача', 'Всего Пошив', 'Всего Упаковка', 'Брак', 'Разница (Разд-Упак)', 'Разница %']],
        body: [[
          String(activeSizeTotals.order),
          String(activeSizeTotals.cut),
          `${activeSizeTotals.cutPct.toFixed(1)}%`,
          String(activeSizeTotals.dist),
          String(activeSizeTotals.sew),
          String(activeSizeTotals.pack),
          activeSizeMatrix.defect > 0 ? String(activeSizeMatrix.defect) : '0',
          String(activeSizeTotals.remDist),
          `${activeSizeTotals.diffDistPackPct.toFixed(1)}%`
        ]],
        theme: 'grid',
        styles: {
          font: fontName,
          fontSize: 8.8,
          halign: 'center',
          fontStyle: 'bold',
          textColor: [15, 23, 42],
          lineColor: [51, 65, 85],
          lineWidth: 0.25
        },
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42]
        },
        margin: { left: 10, right: 10 }
      });

      doc.save(`Размеры_${activeSizeRow.orderNo}_${activeSizeRow.color}${activeSizeRow.rost ? '_' + activeSizeRow.rost : ''}.pdf`);
      showNotice('PDF раскладка по размерам скачана!');
    } catch (err) {
      console.error(err);
      showNotice('Ошибка при создании PDF раскладки!');
    }
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Плавающее и заметное уведомление о сохранении / действиях */}
      {notification && (
        <div className="fixed top-16 right-4 z-50 px-4 py-3 bg-emerald-600 border-2 border-emerald-300 rounded-2xl flex items-center gap-2.5 text-white text-sm shadow-2xl animate-fadeIn">
          <CheckCircle2 className="w-5 h-5 text-white shrink-0" />
          <span className="font-black tracking-wide">{notification}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="ml-1 p-0.5 rounded-lg hover:bg-emerald-500 text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* =========================================================================
          ГЛАВНЫЙ ПЕРЕКЛЮЧАТЕЛЬ РАБОЧИХ ЗОН: ВВОД ДАННЫХ | ПАПКИ ЗАКАЗОВ | МОНИТОРИНГ И АНАЛИЗ
         ========================================================================= */}
      <div className="bg-slate-900/85 backdrop-blur-md border border-white/10 rounded-2xl p-2.5 shadow-xl flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950/90 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setIsTableFullscreen(false);
              if (!selectedSizeRowId && derivedLedgerRows[0]) {
                setSelectedSizeRowId(derivedLedgerRows[0].id);
              }
              setActiveTabMode('size_matrix');
            }}
            className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-black flex items-center gap-2 cursor-pointer transition-all whitespace-nowrap shrink-0 ${
              isEntryWorkspace
                ? 'bg-orange-400 text-slate-950 shadow-lg shadow-orange-950/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-900'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>
              {lang === 'uz' ? "Ma'lumot kiritish (Excel-jadval)" : 'Ввод данных (Excel-таблица)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsTableFullscreen(false);
              setActiveTabMode('folders_update');
            }}
            className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-black flex items-center gap-2 cursor-pointer transition-all whitespace-nowrap shrink-0 ${
              isFoldersWorkspace
                ? 'bg-amber-400 text-slate-950 shadow-lg shadow-amber-950/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-900'
            }`}
          >
            <FolderOpen className="w-4 h-4" />
            <span>{lang === 'uz' ? 'Zakazlarni yangilash (Papkalar)' : 'Обновление заказов (Папки)'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsTableFullscreen(false);
              setActiveTabMode(lastMonitorTab);
            }}
            className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-black flex items-center gap-2 cursor-pointer transition-all whitespace-nowrap shrink-0 ${
              isMonitorWorkspace
                ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-950/40'
                : 'text-slate-300 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>{lang === 'uz' ? 'Monitoring va tahlil' : 'Мониторинг и анализ'}</span>
            <Lock className="w-3.5 h-3.5 opacity-80" />
          </button>
        </div>

        {/* Правая зона верхней полосы зависит строго от выбранной рабочей зоны */}
        {isEntryWorkspace ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setActiveTabMode(prev => (prev === 'excel_paste' ? 'size_matrix' : 'excel_paste'))
              }
              className={`px-3 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer border transition-all whitespace-nowrap shrink-0 ${
                activeTabMode === 'excel_paste'
                  ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow'
                  : 'bg-slate-950 text-emerald-300 border-emerald-500/40 hover:bg-slate-800'
              }`}
              title={
                lang === 'uz'
                  ? 'Excel jadvallarini Ctrl+V orqali joylash uchun erkin varaq'
                  : 'Открыть свободный Excel-лист для вставки таблиц через Ctrl+V'
              }
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Excel varaq (Ctrl+V)' : 'Excel-лист (Ctrl+V)'}</span>
            </button>

            {derivedLedgerRows.length > 0 && (
              <button
                type="button"
                onClick={handleSaveOrderChanges}
                className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer transition-all shadow whitespace-nowrap shrink-0 border ${
                  hasUnsavedChanges
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-300 ring-2 ring-emerald-400/40'
                    : 'bg-emerald-700/90 hover:bg-emerald-600 text-white border-emerald-500/60'
                }`}
                title="Ctrl+S"
              >
                <Save className="w-3.5 h-3.5" />
                <span>
                  {lang === 'uz'
                    ? hasUnsavedChanges
                      ? 'Saqlash'
                      : 'Saqlandi'
                    : hasUnsavedChanges
                    ? 'Сохранить'
                    : 'Сохранено'}
                </span>
                {hasUnsavedChanges && (
                  <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse" />
                )}
              </button>
            )}
          </div>
        ) : isFoldersWorkspace ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleFolderSaveAll}
              className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer transition-all shadow whitespace-nowrap shrink-0 border ${
                hasUnsavedChanges
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-300 ring-2 ring-emerald-400/40'
                  : 'bg-emerald-700/90 hover:bg-emerald-600 text-white border-emerald-500/60'
              }`}
              title="Ctrl+S"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {lang === 'uz'
                  ? hasUnsavedChanges
                    ? 'Saqlash'
                    : 'Saqlandi'
                  : hasUnsavedChanges
                  ? 'Сохранить'
                  : 'Сохранено'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black rounded-xl text-xs flex items-center gap-1.5 shadow cursor-pointer border border-emerald-400/40 whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'XLSX yuklab olish' : 'Скачать XLSX'}</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1.5 rounded-xl bg-slate-950 border border-amber-500/40 text-amber-200 text-xs font-bold flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <span>{lang === 'uz' ? "Faqat ko'rish rejimi" : 'Режим только чтения'}</span>
            </span>

            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black rounded-xl text-xs flex items-center gap-1.5 shadow cursor-pointer border border-emerald-400/40"
              title={lang === 'uz' ? 'Filtrlangan ma’lumotlarni XLSX formatida yuklash' : 'Экспорт отфильтрованных данных в формат XLSX'}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'XLSX yuklab olish' : 'Скачать XLSX'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportPdf}
              className="px-3 py-2 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-black rounded-xl text-xs flex items-center gap-1.5 shadow cursor-pointer border border-rose-400/40"
              title={lang === 'uz' ? 'Umumiy hisobotni PDF formatida yuklash' : 'Скачать общий отчет в формате PDF'}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'PDF yuklab olish' : 'Скачать PDF'}</span>
            </button>
          </div>
        )}
      </div>

      {/* =========================================================================
          ЗАКАЗЛАРНИ ЯНГИЛАШ (ПАПКИ ПО КАЖДОМУ ЗАКАЗУ И ВСЕМ ЦВЕТАМ ВНУТРИ)
         ========================================================================= */}
      {isFoldersWorkspace && (
        <OrdersFoldersView
          allRows={committedLedgerRows}
          sizeMatrices={sizeMatrices}
          monthsList={uniqueMonths}
          brandsList={uniqueBrands}
          hasUnsavedChanges={hasUnsavedChanges}
          onUpdateRowField={handleFolderUpdateField}
          onUpdateSizeCell={handleFolderUpdateSizeCell}
          onUpdateDefect={handleFolderUpdateDefect}
          onChangeSizePreset={handleFolderChangeSizePreset}
          onAddSizeColumn={handleFolderAddSizeColumn}
          onAddColorToFolder={handleFolderAddColorToFolder}
          onRequestDeleteFolder={ordNo => {
            setIsClearAllConfirmOpen(false);
            setRowToDelete(null);
            setFolderToDelete(ordNo);
            setDeletePassword('');
            setDeletePasswordError('');
          }}
          onRequestDeleteRow={row => {
            setIsClearAllConfirmOpen(false);
            setFolderToDelete(null);
            setRowToDelete(row);
            setDeletePassword('');
            setDeletePasswordError('');
          }}
          onSaveAll={handleFolderSaveAll}
          onNotice={showNotice}
          lang={lang}
        />
      )}

      {/* =========================================================================
          МОНИТОРИНГ И АНАЛИЗ (НОВАЯ ПАНЕЛЬ + РАЗМЕРНЫЙ УЧЁТ + РАЗНИЦА + PNG/PDF)
         ========================================================================= */}
      {isMonitorWorkspace && (
        <OrdersMonitoringDashboard
          allRows={committedLedgerRows}
          sizeMatrices={sizeMatrices}
          selectedMonth={selectedMonth}
          onChangeMonth={setSelectedMonth}
          selectedBrand={selectedBrand}
          onChangeBrand={setSelectedBrand}
          brandsList={uniqueBrands}
          selectedOrderNo={selectedOrderNo}
          onChangeOrderNo={setSelectedOrderNo}
          selectedModel={selectedModel}
          onChangeModel={setSelectedModel}
          selectedColor={selectedColor}
          onChangeColor={setSelectedColor}
          onNotice={showNotice}
          lang={lang}
        />
      )}

      {/* Формы добавления месяца / бренда (только в рабочем пространстве Ввод данных) */}
      {isEntryWorkspace && isAddMonthOpen && (
        <div className="p-3 bg-slate-900 border border-cyan-500/40 rounded-xl flex flex-wrap items-center gap-2.5 text-xs animate-fadeIn">
          <span className="text-cyan-300 font-bold">Добавить новый месяц:</span>
          <select
            value={newMonthName}
            onChange={e => setNewMonthName(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white font-semibold"
          >
            {RUSSIAN_MONTH_NAMES.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input
            type="number"
            value={newMonthYear}
            onChange={e => setNewMonthYear(e.target.value)}
            className="w-20 px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono font-bold"
            min="2024"
            max="2035"
          />
          <span className="text-slate-400">или вручную:</span>
          <input
            type="text"
            value={customMonthInput}
            onChange={e => setCustomMonthInput(e.target.value)}
            placeholder="Например: Февраль 2027"
            className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder:text-slate-500"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleCreateNewMonth();
                if (activeSizeRow) {
                  const lbl = customMonthInput.trim() || `${newMonthName} ${newMonthYear}`;
                  if (lbl) updateActiveRowMeta('month', lbl);
                }
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              const lbl = customMonthInput.trim() || `${newMonthName} ${newMonthYear}`;
              handleCreateNewMonth();
              if (activeSizeRow && lbl) updateActiveRowMeta('month', lbl);
            }}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg cursor-pointer"
          >
            Добавить
          </button>
          <button
            type="button"
            onClick={() => setIsAddMonthOpen(false)}
            className="p-1.5 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {isEntryWorkspace && isAddBrandOpen && (
        <div className="p-3 bg-slate-900 border border-indigo-500/40 rounded-xl flex flex-wrap items-center gap-2.5 text-xs animate-fadeIn">
          <span className="text-indigo-300 font-bold flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" />
            <span>Добавить новый бренд:</span>
          </span>
          <input
            type="text"
            value={newBrandInput}
            onChange={e => setNewBrandInput(e.target.value)}
            placeholder="Например: Gloria Jeans / LC Waikiki..."
            className="flex-1 min-w-[220px] px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder:text-slate-500"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const created = handleCreateNewBrand();
                if (created && activeSizeRow) updateActiveRowMeta('brand', created);
              }
            }}
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              const created = handleCreateNewBrand();
              if (created && activeSizeRow) updateActiveRowMeta('brand', created);
            }}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg cursor-pointer"
          >
            Добавить бренд
          </button>
          <button
            type="button"
            onClick={() => setIsAddBrandOpen(false)}
            className="p-1.5 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* =========================================================================
          TAB 1.5: ЕДИНАЯ EXCEL-ТАБЛИЦА ДЛЯ ВВОДА ЗАКАЗОВ И РАЗМЕРОВ
         ========================================================================= */}
      {activeTabMode === 'size_matrix' && (
        <OrdersExcelGrid
          rows={excelEntryRows}
          savedOrdersCount={savedArchiveCount}
          showSavedArchive={showSavedInExcel}
          onToggleShowSavedArchive={() => setShowSavedInExcel(prev => !prev)}
          onClearEntrySheet={() => {
            setLedgerRows(prev => prev.filter(r => !isRowEmptyDraft(r)));
            setEntrySessionRowIds([]);
            setShowSavedInExcel(false);
            showNotice(
              lang === 'uz'
                ? "Kiritish varag'i tozalandi (avval saqlangan zakazlar o'zgarmadi)."
                : 'Лист ввода очищен для новых заказов (ранее сохранённые заказы не затронуты).'
            );
          }}
          sizeMatrices={sizeMatrices}
          monthsList={uniqueMonths}
          brandsList={uniqueBrands}
          selectedRowId={activeSizeRow?.id || ''}
          onSelectRow={id => setSelectedSizeRowId(id)}
          onUpdateRowField={updateRowFieldById}
          onUpdateSizeCell={updateRowSizeCellById}
          onUpdateDefect={updateRowDefectById}
          onAddBlankExcelRow={handleAddInlineExcelRow}
          onBulkPasteCells={handleBulkPasteExcelCells}
          onStructuredExcelPaste={parsedGrid => {
            setPendingExcelPasteGrid(parsedGrid);
            setActiveTabMode('excel_paste');
            showNotice(
              lang === 'uz'
                ? 'Sarlavhali jadval aniqlandi! Tekshirib «Zakazlarga yuklash» tugmasini bosing.'
                : 'Таблица с шапкой распознана в Excel-листе! Проверьте и нажмите «Загрузить в заказы».'
            );
          }}
          onOpenPhotoForRow={rowId => {
            setSelectedSizeRowId(rowId);
            setIsModelImageModalOpen(true);
          }}
          onRequestDeleteRow={row => {
            setIsClearAllConfirmOpen(false);
            setFolderToDelete(null);
            setRowToDelete(row);
            setDeletePassword('');
            setDeletePasswordError('');
          }}
          onExportActivePdf={handleExportSizeMatrixPdf}
          onOpenExcelPasteTab={() => setActiveTabMode('excel_paste')}
          modelImages={modelImages}
          hasUnsavedChanges={hasUnsavedChanges}
          lastSavedAt={lastSavedAt}
          onNotice={showNotice}
          lang={lang}
        />
      )}

      {/* =========================================================================
          TAB: СВОБОДНАЯ EXCEL-СРЕДА ДЛЯ ВСТАВКИ ЧЕРЕЗ CTRL+V
         ========================================================================= */}
      {activeTabMode === 'excel_paste' && (
        <ExcelPasteSheet
          monthsList={uniqueMonths}
          brandsList={uniqueBrands}
          defaultMonth={selectedMonth === 'all' ? (uniqueMonths[0] || DEFAULT_MONTHS[0]) : selectedMonth}
          initialGrid={pendingExcelPasteGrid}
          onConsumeInitialGrid={() => setPendingExcelPasteGrid(null)}
          onApplyParsedItems={handleApplyParsedExcelItems}
          onNotice={showNotice}
          lang={lang}
        />
      )}

      {/* =========================================================================
          TAB 5: НАСТРОЙКИ, БРЕНДЫ, МЕСЯЦЫ И НОРМАТИВЫ
         ========================================================================= */}
      {activeTabMode === 'settings_photo5' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6 animate-fadeIn">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                <span>НАСТРОЙКИ, БРЕНДЫ, МЕСЯЦЫ И НОРМАТИВЫ ПРОИЗВОДСТВА</span>
              </h2>
              <p className="text-xs text-slate-300 mt-1">
                Управление брендами, отчетными месяцами, ростовками и расчетными формулами фабрики.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAddBrandOpen(true)}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Добавить бренд</span>
              </button>
              <button
                type="button"
                onClick={() => setIsAddMonthOpen(true)}
                className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Добавить месяц</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 1) Бренды */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Tag className="w-4 h-4 text-indigo-400" />
                <span>1) Бренды ({uniqueBrands.length})</span>
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBrandInput}
                  onChange={e => setNewBrandInput(e.target.value)}
                  placeholder="Новый бренд..."
                  className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreateNewBrand();
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleCreateNewBrand()}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold cursor-pointer"
                >
                  +
                </button>
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {uniqueBrands.map((bName, idx) => {
                  const bCount = derivedLedgerRows.filter(r => r.brand === bName).length;
                  return (
                    <div key={bName} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
                      <span className="font-bold text-indigo-200">
                        {idx + 1}. {bName}
                      </span>
                      <span className="font-mono text-slate-400">{bCount} поз.</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2) Список месяцев */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-cyan-400" />
                <span>2) Отчетные месяцы ({uniqueMonths.length})</span>
              </h3>

              <table className="w-full text-left text-xs text-slate-200">
                <thead className="border-b border-slate-800 text-[11px] text-slate-400 font-bold uppercase">
                  <tr>
                    <th className="pb-2">№</th>
                    <th className="pb-2">Месяц</th>
                    <th className="pb-2 text-right">Строк</th>
                    <th className="pb-2 text-right">Объем</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {uniqueMonths.map((mName, idx) => {
                    const mRows = derivedLedgerRows.filter(r => r.month === mName);
                    const mSum = mRows.reduce((s, r) => s + r.qtyOrder, 0);
                    return (
                      <tr key={mName} className="hover:bg-slate-900/70">
                        <td className="py-2 text-slate-400">{idx + 1}</td>
                        <td className="py-2 font-sans font-bold text-cyan-300">{mName}</td>
                        <td className="py-2 text-right text-white">{mRows.length}</td>
                        <td className="py-2 text-right text-emerald-400 font-bold">{mSum.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 3) Формулы и нормативы */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span>3) Формулы и нормативы</span>
              </h3>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-200">Крой % к заказу:</span>
                  <span className="font-mono font-bold text-sky-400">Крой / Заказ × 100%</span>
                </div>
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-200">Разница Разд − Упак:</span>
                  <span className="font-mono font-bold text-rose-300">Раздача − Упаковка (шт и %)</span>
                </div>
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-200">Закрытие заказа (%):</span>
                  <span className="font-mono font-bold text-emerald-400">Общ-упак / Раздача × 100%</span>
                </div>
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-200">Процент брака (Брак %):</span>
                  <span className="font-mono font-bold text-rose-400">Брак / Раздача × 100% (норма 3.5%)</span>
                </div>
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-200">Остаток склада (%):</span>
                  <span className="font-mono font-bold text-indigo-300">Остаток / Упаковка × 100%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          МОДАЛЬНОЕ ОКНО ПОДТВЕРЖДЕНИЯ УДАЛЕНИЯ (ПАРОЛЬ ЗАДАЁТСЯ В НАСТРОЙКАХ)
         ========================================================================= */}
      {(rowToDelete || folderToDelete || isClearAllConfirmOpen) && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-rose-500/40 rounded-3xl max-w-sm w-full p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto">
              <Lock className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="font-black text-white text-base">
                {isClearAllConfirmOpen
                  ? (lang === 'uz' ? "Barcha zakazlarni o'chirish" : 'Очистить все заказы')
                  : folderToDelete
                  ? (lang === 'uz' ? "Zakaz papkasini o'chirish" : 'Удаление заказа')
                  : (lang === 'uz' ? "Rang / qatorni o'chirish" : 'Удаление строки заказа')}
              </h3>
              {isClearAllConfirmOpen ? (
                <p className="text-xs text-slate-300">
                  {lang === 'uz'
                    ? `Barcha zakaz qatorlari va razmer jadvallari o'chiriladi (${derivedLedgerRows.length} ta).`
                    : `Будут удалены все строки заказов и матрицы размеров (${derivedLedgerRows.length} шт.).`}
                </p>
              ) : folderToDelete ? (
                <>
                  <p className="text-xs text-rose-300 font-mono font-bold">
                    {folderToDelete}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {lang === 'uz'
                      ? `Ushbu zakazdagi barcha ranglar o'chiriladi (${
                          ledgerRows.filter(r => (r.orderNo || '').trim() === folderToDelete.trim()).length
                        } ta qator).`
                      : `Будут удалены все цвета этого заказа (${
                          ledgerRows.filter(r => (r.orderNo || '').trim() === folderToDelete.trim()).length
                        } стр.).`}
                  </p>
                </>
              ) : (
                rowToDelete && (
                  <>
                    <p className="text-xs text-slate-300 font-mono">
                      {rowToDelete.orderNo} • {rowToDelete.color || (lang === 'uz' ? 'Rangsiz' : 'Без цвета')}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {lang === 'uz' ? 'Oy:' : 'Месяц:'} {rowToDelete.month || DEFAULT_MONTHS[0]}
                    </p>
                  </>
                )
              )}
            </div>

            <div>
              <label className="text-xs font-bold text-slate-200 block mb-1.5">
                {lang === 'uz'
                  ? "Tasdiqlash uchun parolni kiriting:"
                  : 'Введите пароль для подтверждения:'}
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={e => {
                  setDeletePassword(e.target.value);
                  setDeletePasswordError('');
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleConfirmDeleteRow();
                  if (e.key === 'Escape') {
                    setRowToDelete(null);
                    setFolderToDelete(null);
                    setIsClearAllConfirmOpen(false);
                  }
                }}
                autoFocus
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-center text-sm font-mono text-white focus:border-rose-500 focus:outline-none"
                placeholder="••••"
              />
              {deletePasswordError && (
                <span className="text-[11px] text-rose-400 block mt-1.5 text-center font-bold">
                  {deletePasswordError}
                </span>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRowToDelete(null);
                  setFolderToDelete(null);
                  setIsClearAllConfirmOpen(false);
                }}
                className="flex-1 py-2 border border-slate-700 text-slate-200 rounded-xl text-xs font-bold hover:bg-slate-800 cursor-pointer"
              >
                {lang === 'uz' ? 'Bekor qilish' : 'Отмена'}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteRow}
                className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white font-black rounded-xl text-xs cursor-pointer shadow-md"
              >
                {isClearAllConfirmOpen
                  ? (lang === 'uz' ? 'Hammasini tozalash' : 'Очистить всё')
                  : (lang === 'uz' ? "O'chirish" : 'Удалить')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          МОДАЛЬНОЕ ОКНО ФОТО / ЭСКИЗА МОДЕЛИ (ВО ВВОДЕ ДАННЫХ)
         ========================================================================= */}
      {isModelImageModalOpen && activeSizeRow && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border-2 border-slate-300 rounded-2xl max-w-lg w-full p-5 shadow-2xl text-slate-950 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wide">
                  {lang === 'uz' ? 'Model rasmi / eskizi' : 'Фото / Эскиз модели'}
                </h3>
                <p className="text-xs font-bold text-slate-600">
                  {activeSizeRow.orderNo} • {activeSizeRow.model} • {activeSizeRow.color}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModelImageModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center justify-center py-4 min-h-[240px] bg-slate-50 rounded-xl border border-slate-200">
              {modelImages[activeSizeRow.id] || modelImages[activeSizeRow.model] ? (
                <img
                  src={modelImages[activeSizeRow.id] || modelImages[activeSizeRow.model]}
                  alt={`${activeSizeRow.model} ${activeSizeRow.color}`}
                  className="max-h-72 w-auto object-contain rounded-lg border border-slate-200 shadow-sm"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-center space-y-3 px-4">
                  <ImageIcon className="w-12 h-12 text-slate-400" />
                  <p className="text-xs text-slate-600 font-semibold">
                    {lang === 'uz' ? (
                      <>
                        Model rasmi yoki eskizini biriktirish uchun <strong>«Rasm yuklash»</strong> tugmasini bosing:{' '}
                        <span className="font-mono font-bold text-slate-900">{activeSizeRow.model}</span>
                      </>
                    ) : (
                      <>
                        Нажмите <strong>«Загрузить фото»</strong>, чтобы прикрепить эскиз или фото модели{' '}
                        <span className="font-mono font-bold text-slate-900">{activeSizeRow.model}</span>
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <input
                ref={modelImageInputRef}
                type="file"
                accept="image/*"
                onChange={handleUploadModelImage}
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => modelImageInputRef.current?.click()}
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                  <span>{lang === 'uz' ? 'Rasm yuklash' : 'Загрузить фото'}</span>
                </button>
                {(modelImages[activeSizeRow.id] || modelImages[activeSizeRow.model]) && (
                  <button
                    type="button"
                    onClick={() => {
                      setModelImages(prev => {
                        const next = { ...prev };
                        delete next[activeSizeRow.id];
                        delete next[activeSizeRow.model];
                        return next;
                      });
                    }}
                    className="px-3 py-2 text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{lang === 'uz' ? "Rasmni o'chirish" : 'Удалить фото'}</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsModelImageModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-900 font-bold rounded-xl text-xs cursor-pointer"
              >
                {lang === 'uz' ? 'Yopish' : 'Закрыть'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
