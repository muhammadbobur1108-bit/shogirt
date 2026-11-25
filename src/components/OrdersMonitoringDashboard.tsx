import React, { useMemo, useRef, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toPng } from 'html-to-image';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  ReferenceLine,
  LabelList
} from 'recharts';
import {
  Calendar,
  Ruler,
  LayoutDashboard,
  Layers,
  X,
  CheckCircle2,
  FileText,
  GitCompare,
  ArrowRight,
  MessageSquare,
  ImageDown
} from 'lucide-react';
import {
  FactoryLedgerRow,
  OrderSizeMatrix,
  SizeCellValues,
  getEffectiveDisplaySizes
} from '../lib/ordersSizeStore';
import { registerCyrillicFonts } from '../lib/pdfCyrillicFonts';
import { Language } from '../locales';

interface OrdersMonitoringDashboardProps {
  allRows: FactoryLedgerRow[];
  sizeMatrices: Record<string, OrderSizeMatrix>;
  selectedMonth: string;
  onChangeMonth: (val: string) => void;
  selectedBrand: string;
  onChangeBrand: (val: string) => void;
  brandsList?: string[];
  selectedOrderNo: string;
  onChangeOrderNo: (val: string) => void;
  selectedModel: string;
  onChangeModel: (val: string) => void;
  selectedColor: string;
  onChangeColor: (val: string) => void;
  onNotice?: (msg: string) => void;
  lang: Language;
}

type MonitorScopeMode = 'umumiy' | 'razmerlar' | 'farqlar';
type TimePeriodMode = 'monthly' | 'yearly';

const MONTH_SHORT_UZ = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
const MONTH_SHORT_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

const PIE_COLORS = ['#60a5fa', '#2dd4bf', '#facc15', '#a78bfa', '#38bdf8', '#64748b'];

const STAGE_DEFS: Array<{ key: keyof SizeCellValues; uz: string; ru: string; tone: string }> = [
  { key: 'order', uz: 'Buyurtma', ru: 'Заказ', tone: 'text-blue-300' },
  { key: 'cut', uz: 'Kroy', ru: 'Крой', tone: 'text-sky-300' },
  { key: 'dist', uz: 'Taqsimot', ru: 'Раздача', tone: 'text-teal-300' },
  { key: 'sew', uz: 'Tikuv', ru: 'Пошив', tone: 'text-emerald-300' },
  { key: 'pack', uz: 'Qadoq', ru: 'Упаковка', tone: 'text-amber-300 font-bold' }
];

function extractMonthAndYear(rawMonth?: string): { monthIdx: number; year: number } {
  const s = (rawMonth || '').toLowerCase().trim();
  const yearMatch = s.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : 2026;

  const patterns: Array<[RegExp, number]> = [
    [/январ|yanvar/, 1],
    [/феврал|fevral/, 2],
    [/март|mart/, 3],
    [/апрел|aprel/, 4],
    [/май|мая|\bmay\b/, 5],
    [/июн|iyun/, 6],
    [/июл|iyul/, 7],
    [/август|avgust/, 8],
    [/сентябр|sentabr|sentyabr/, 9],
    [/октябр|oktabr|oktyabr/, 10],
    [/ноябр|noyabr/, 11],
    [/декабр|dekabr/, 12]
  ];

  for (const [re, idx] of patterns) {
    if (re.test(s)) return { monthIdx: idx, year };
  }
  return { monthIdx: 0, year };
}

function fmtSpaceInt(val: number): string {
  const n = Math.round(val || 0);
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function fmtDashInt(val: number): string {
  const n = Math.round(val || 0);
  if (n === 0) return '-';
  return fmtSpaceInt(n);
}

function fmtCommaPct(val: number, decimals = 1): string {
  return `${val.toFixed(decimals).replace('.', ',')}%`;
}

function getClosePctBg(pct: number): string {
  if (pct >= 98) return 'bg-emerald-700/80 text-emerald-50';
  if (pct >= 75) return 'bg-amber-700/65 text-amber-50';
  if (pct >= 45) return 'bg-orange-800/70 text-orange-100';
  return 'bg-rose-900/85 text-rose-100';
}

function getDefectPctBg(pct: number): string {
  if (pct <= 0) return 'text-slate-300';
  if (pct >= 3.5) return 'bg-rose-800/90 text-rose-50 font-black';
  return 'bg-emerald-800/80 text-emerald-100 font-bold';
}

function getDiffBadgeClass(val: number): string {
  if (val < 0) return 'text-rose-400 font-black';
  if (val > 0) return 'text-amber-300 font-bold';
  return 'text-emerald-400 font-bold';
}

function NavyTooltip({ active, payload, label, suffix = 'шт' }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-[#060f26] border border-cyan-500/50 rounded-xl px-3 py-2 shadow-2xl text-xs">
      {label && <p className="font-bold text-cyan-300 mb-1 border-b border-slate-700 pb-1">{label}</p>}
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-3 text-slate-100 font-semibold">
          <span className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-xs inline-block"
              style={{ backgroundColor: entry.color || entry.payload?.fill || '#38bdf8' }}
            />
            <span className="text-slate-200">{entry.name || entry.payload?.name}:</span>
          </span>
          <span className="font-mono font-black text-white">
            {typeof entry.value === 'number' && suffix === '%'
              ? fmtCommaPct(entry.value)
              : `${fmtSpaceInt(Number(entry.value) || 0)}${suffix ? ` ${suffix}` : ''}`}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function OrdersMonitoringDashboard({
  allRows,
  sizeMatrices,
  selectedMonth,
  onChangeMonth,
  selectedBrand,
  onChangeBrand,
  brandsList = [],
  selectedOrderNo,
  onChangeOrderNo,
  selectedModel,
  onChangeModel,
  selectedColor,
  onChangeColor,
  onNotice,
  lang
}: OrdersMonitoringDashboardProps) {
  const isUz = lang === 'uz';
  const unitLabel = isUz ? 'dona' : 'шт';
  const [monitorMode, setMonitorMode] = useState<MonitorScopeMode>('umumiy');
  const [periodMode, setPeriodMode] = useState<TimePeriodMode>('monthly');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedSizeFilter, setSelectedSizeFilter] = useState<string>('all');
  const [sizeStage, setSizeStage] = useState<keyof SizeCellValues>('order');
  const [capturingPngKey, setCapturingPngKey] = useState<string | null>(null);

  const fullDashboardRef = useRef<HTMLDivElement>(null);
  const kpiDiffRef = useRef<HTMLDivElement>(null);
  const yearlyRef = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<HTMLDivElement>(null);
  const ordersTableRef = useRef<HTMLDivElement>(null);
  const rowsTableRef = useRef<HTMLDivElement>(null);
  const sizeSummaryRef = useRef<HTMLDivElement>(null);
  const allStagesSizesRef = useRef<HTMLDivElement>(null);
  const farqlarRef = useRef<HTMLDivElement>(null);

  // Interactive visible stages for the All-Stages Size Table (2-rasm)
  const [visibleAllStages, setVisibleAllStages] = useState<Array<keyof SizeCellValues>>([
    'order',
    'cut',
    'dist',
    'sew',
    'pack'
  ]);
  const [showBrakInSizeTable, setShowBrakInSizeTable] = useState<boolean>(true);
  const [hideZeroRowsInSizeTable, setHideZeroRowsInSizeTable] = useState<boolean>(true);

  const toggleAllStageVisibility = (stKey: keyof SizeCellValues) => {
    setVisibleAllStages(prev => {
      if (prev.includes(stKey)) {
        if (prev.length === 1) return prev; // Keep at least one stage visible
        return prev.filter(k => k !== stKey);
      }
      return STAGE_DEFS.map(s => s.key).filter(k => prev.includes(k) || k === stKey);
    });
  };

  // Available years, months, orders, models, colors
  const availableYears = useMemo(() => {
    const yrs = new Set<string>();
    allRows.forEach(r => {
      const { year } = extractMonthAndYear(r.month);
      yrs.add(String(year));
    });
    if (yrs.size === 0) yrs.add(String(new Date().getFullYear()));
    return Array.from(yrs).sort((a, b) => Number(a) - Number(b));
  }, [allRows]);

  const availableMonths = useMemo(() => {
    const map = new Map<string, number>();
    allRows.forEach(r => {
      const m = (r.month || '').trim();
      if (!m) return;
      const { monthIdx, year } = extractMonthAndYear(m);
      if (selectedYear !== 'all' && String(year) !== selectedYear) return;
      map.set(m, year * 100 + monthIdx);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[1] - b[1])
      .map(e => e[0]);
  }, [allRows, selectedYear]);

  const availableBrands = useMemo(() => {
    const set = new Set<string>(brandsList.filter(b => b.trim()));
    allRows.forEach(r => {
      if (selectedYear !== 'all') {
        const { year } = extractMonthAndYear(r.month);
        if (String(year) !== selectedYear) return;
      }
      if (periodMode === 'monthly' && selectedMonth !== 'all' && r.month !== selectedMonth) return;
      const b = (r.brand || '').trim();
      if (b) set.add(b);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows, brandsList, selectedYear, periodMode, selectedMonth]);

  const availableOrders = useMemo(() => {
    const set = new Set<string>();
    allRows.forEach(r => {
      if (selectedYear !== 'all') {
        const { year } = extractMonthAndYear(r.month);
        if (String(year) !== selectedYear) return;
      }
      if (periodMode === 'monthly' && selectedMonth !== 'all' && r.month !== selectedMonth) return;
      if (selectedBrand !== 'all' && (r.brand || '').trim() !== selectedBrand) return;
      if (r.orderNo.trim()) set.add(r.orderNo.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows, selectedYear, periodMode, selectedMonth, selectedBrand]);

  const availableModels = useMemo(() => {
    const set = new Set<string>();
    allRows.forEach(r => {
      if (selectedYear !== 'all') {
        const { year } = extractMonthAndYear(r.month);
        if (String(year) !== selectedYear) return;
      }
      if (periodMode === 'monthly' && selectedMonth !== 'all' && r.month !== selectedMonth) return;
      if (selectedBrand !== 'all' && (r.brand || '').trim() !== selectedBrand) return;
      if (selectedOrderNo !== 'all' && r.orderNo !== selectedOrderNo) return;
      if (r.model.trim()) set.add(r.model.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows, selectedYear, periodMode, selectedMonth, selectedBrand, selectedOrderNo]);

  const availableColors = useMemo(() => {
    const set = new Set<string>();
    allRows.forEach(r => {
      if (selectedYear !== 'all') {
        const { year } = extractMonthAndYear(r.month);
        if (String(year) !== selectedYear) return;
      }
      if (periodMode === 'monthly' && selectedMonth !== 'all' && r.month !== selectedMonth) return;
      if (selectedBrand !== 'all' && (r.brand || '').trim() !== selectedBrand) return;
      if (selectedOrderNo !== 'all' && r.orderNo !== selectedOrderNo) return;
      if (selectedModel !== 'all' && r.model !== selectedModel) return;
      const c = (r.color || '').trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows, selectedYear, periodMode, selectedMonth, selectedBrand, selectedOrderNo, selectedModel]);

  // Primary filtered dataset for KPIs & tables (includes Brand & Color filters!)
  const scopedRows = useMemo(() => {
    return allRows.filter(r => {
      const { year } = extractMonthAndYear(r.month);
      if (selectedYear !== 'all' && String(year) !== selectedYear) return false;
      if (periodMode === 'monthly' && selectedMonth !== 'all' && r.month !== selectedMonth) return false;
      if (selectedBrand !== 'all' && (r.brand || '').trim() !== selectedBrand) return false;
      if (selectedOrderNo !== 'all' && r.orderNo !== selectedOrderNo) return false;
      if (selectedModel !== 'all' && r.model !== selectedModel) return false;
      if (selectedColor !== 'all' && (r.color || '').trim() !== selectedColor) return false;
      return true;
    });
  }, [allRows, selectedYear, periodMode, selectedMonth, selectedBrand, selectedOrderNo, selectedModel, selectedColor]);

  // Previous month comparison dataset
  const prevMonthRows = useMemo(() => {
    if (periodMode !== 'monthly' || selectedMonth === 'all') return [];
    const { monthIdx, year } = extractMonthAndYear(selectedMonth);
    if (monthIdx === 0) return [];
    const targetIdx = monthIdx === 1 ? 12 : monthIdx - 1;
    const targetYear = monthIdx === 1 ? year - 1 : year;
    return allRows.filter(r => {
      const parsed = extractMonthAndYear(r.month);
      if (parsed.year !== targetYear || parsed.monthIdx !== targetIdx) return false;
      if (selectedBrand !== 'all' && (r.brand || '').trim() !== selectedBrand) return false;
      if (selectedOrderNo !== 'all' && r.orderNo !== selectedOrderNo) return false;
      if (selectedModel !== 'all' && r.model !== selectedModel) return false;
      if (selectedColor !== 'all' && (r.color || '').trim() !== selectedColor) return false;
      return true;
    });
  }, [allRows, periodMode, selectedMonth, selectedBrand, selectedOrderNo, selectedModel, selectedColor]);

  const activeChartYear = useMemo(() => {
    if (selectedYear !== 'all') return Number(selectedYear);
    if (periodMode === 'monthly' && selectedMonth !== 'all') {
      return extractMonthAndYear(selectedMonth).year;
    }
    return Number(availableYears[availableYears.length - 1] || new Date().getFullYear());
  }, [selectedYear, periodMode, selectedMonth, availableYears]);

  // Year summary breakdown
  const yearlySummaryRows = useMemo(() => {
    const byYear = new Map<
      number,
      {
        year: number;
        orderSet: Set<string>;
        rowsCount: number;
        qtyOrder: number;
        qtyCut: number;
        qtyDist: number;
        qtySew: number;
        qtyPack: number;
        qtyDefect: number;
        qtyShipped: number;
        qtyStock: number;
      }
    >();

    allRows.forEach(r => {
      if (selectedBrand !== 'all' && (r.brand || '').trim() !== selectedBrand) return;
      if (selectedOrderNo !== 'all' && r.orderNo !== selectedOrderNo) return;
      if (selectedModel !== 'all' && r.model !== selectedModel) return;
      if (selectedColor !== 'all' && (r.color || '').trim() !== selectedColor) return;
      const { year } = extractMonthAndYear(r.month);
      if (!byYear.has(year)) {
        byYear.set(year, {
          year,
          orderSet: new Set(),
          rowsCount: 0,
          qtyOrder: 0,
          qtyCut: 0,
          qtyDist: 0,
          qtySew: 0,
          qtyPack: 0,
          qtyDefect: 0,
          qtyShipped: 0,
          qtyStock: 0
        });
      }
      const b = byYear.get(year)!;
      b.orderSet.add((r.orderNo || r.id).trim().toLowerCase());
      b.rowsCount += 1;
      b.qtyOrder += r.qtyOrder || 0;
      b.qtyCut += r.qtyCut || 0;
      b.qtyDist += r.qtyDistribution || 0;
      b.qtySew += r.qtySewing || 0;
      b.qtyPack += r.qtyPackaging || 0;
      b.qtyDefect += r.qtyDefect || 0;
      b.qtyShipped += r.qtyShipped || 0;
      b.qtyStock += r.qtyStock || 0;
    });

    return Array.from(byYear.values()).sort((a, b) => b.year - a.year);
  }, [allRows, selectedBrand, selectedOrderNo, selectedModel, selectedColor]);

  // Core KPIs + Stage Differences
  const kpiStats = useMemo(() => {
    const orderSet = new Set<string>();
    const modelSet = new Set<string>();
    let qtyOrder = 0;
    let qtyCut = 0;
    let qtyDist = 0;
    let qtySew = 0;
    let qtyPack = 0;
    let qtyDefect = 0;
    let qtyShipped = 0;
    let qtyStock = 0;

    const orderStockMap = new Map<string, number>();

    scopedRows.forEach(r => {
      const ordKey = (r.orderNo || r.id).trim().toLowerCase();
      orderSet.add(ordKey);
      if (r.model.trim()) modelSet.add(r.model.trim().toLowerCase());
      qtyOrder += r.qtyOrder || 0;
      qtyCut += r.qtyCut || 0;
      qtyDist += r.qtyDistribution || 0;
      qtySew += r.qtySewing || 0;
      qtyPack += r.qtyPackaging || 0;
      qtyDefect += r.qtyDefect || 0;
      qtyShipped += r.qtyShipped || 0;
      qtyStock += r.qtyStock || 0;
      orderStockMap.set(ordKey, (orderStockMap.get(ordKey) || 0) + (r.qtyStock || 0));
    });

    const ordersWithStockCount = Array.from(orderStockMap.values()).filter(v => v > 0).length;
    const packToOrderPct = qtyOrder > 0 ? (qtyPack / qtyOrder) * 100 : 0;
    const defectPct = qtyDist > 0 ? (qtyDefect / qtyDist) * 100 : 0;
    const shippedToPackPct = qtyPack > 0 ? (qtyShipped / qtyPack) * 100 : 0;

    // Stage differences
    const diffCutDist = qtyCut - qtyDist;
    const diffDistSew = qtyDist - qtySew;
    const diffSewPack1 = qtySew - qtyPack;
    const totalPackWithBrak = qtyPack + qtyDefect;
    const diffSewTotalPack = qtySew - totalPackWithBrak;
    const diffDistTotalPack = qtyDist - totalPackWithBrak;

    let prevOrder = 0;
    let prevDist = 0;
    let prevPack = 0;
    let prevDefect = 0;
    let prevShipped = 0;
    prevMonthRows.forEach(r => {
      prevOrder += r.qtyOrder || 0;
      prevDist += r.qtyDistribution || 0;
      prevPack += r.qtyPackaging || 0;
      prevDefect += r.qtyDefect || 0;
      prevShipped += r.qtyShipped || 0;
    });
    const orderDeltaPct = prevOrder > 0 ? ((qtyOrder - prevOrder) / prevOrder) * 100 : null;
    const packDeltaPct = prevPack > 0 ? ((qtyPack - prevPack) / prevPack) * 100 : null;
    const shipDeltaPct = prevShipped > 0 ? ((qtyShipped - prevShipped) / prevShipped) * 100 : null;
    const prevDefectPct = prevDist > 0 ? (prevDefect / prevDist) * 100 : null;
    const defectDeltaPP = prevDefectPct !== null ? defectPct - prevDefectPct : null;

    return {
      ordersCount: orderSet.size,
      rowsCount: scopedRows.length,
      modelsCount: modelSet.size,
      qtyOrder,
      qtyCut,
      qtyDist,
      qtySew,
      qtyPack,
      qtyDefect,
      totalPackWithBrak,
      qtyShipped,
      qtyStock,
      ordersWithStockCount,
      packToOrderPct,
      defectPct,
      shippedToPackPct,
      orderDeltaPct,
      packDeltaPct,
      shipDeltaPct,
      defectDeltaPP,
      diffCutDist,
      diffDistSew,
      diffSewPack1,
      diffSewTotalPack,
      diffDistTotalPack
    };
  }, [scopedRows, prevMonthRows]);

  const stagesChartData = useMemo(
    () => [
      { name: isUz ? 'Buyurtma' : 'Заказ', value: kpiStats.qtyOrder, fill: '#60a5fa' },
      { name: isUz ? 'Kroy' : 'Крой', value: kpiStats.qtyCut, fill: '#38bdf8' },
      { name: isUz ? 'Taqsimot' : 'Раздача', value: kpiStats.qtyDist, fill: '#2dd4bf' },
      { name: isUz ? 'Tikuv' : 'Пошив', value: kpiStats.qtySew, fill: '#34d399' },
      { name: isUz ? 'Qadoq' : 'Упаковка', value: kpiStats.qtyPack, fill: '#10b981' },
      { name: isUz ? "Jo'natildi" : 'Отгр.', value: kpiStats.qtyShipped, fill: '#f59e0b' }
    ],
    [kpiStats, isUz]
  );

  const monthlyYearData = useMemo(() => {
    const names = isUz ? MONTH_SHORT_UZ : MONTH_SHORT_RU;
    const buckets = Array.from({ length: 12 }, (_, idx) => ({
      monthLabel: names[idx],
      order: 0,
      pack: 0,
      shipped: 0,
      dist: 0,
      defect: 0,
      defectPct: 0
    }));

    allRows.forEach(r => {
      const { monthIdx, year } = extractMonthAndYear(r.month);
      if (year !== activeChartYear || monthIdx < 1 || monthIdx > 12) return;
      if (selectedBrand !== 'all' && (r.brand || '').trim() !== selectedBrand) return;
      if (selectedOrderNo !== 'all' && r.orderNo !== selectedOrderNo) return;
      if (selectedModel !== 'all' && r.model !== selectedModel) return;
      if (selectedColor !== 'all' && (r.color || '').trim() !== selectedColor) return;
      const b = buckets[monthIdx - 1];
      b.order += r.qtyOrder || 0;
      b.pack += r.qtyPackaging || 0;
      b.shipped += r.qtyShipped || 0;
      b.dist += r.qtyDistribution || 0;
      b.defect += r.qtyDefect || 0;
    });

    return buckets.map(b => ({
      ...b,
      defectPct: b.dist > 0 ? Number(((b.defect / b.dist) * 100).toFixed(1)) : 0
    }));
  }, [allRows, activeChartYear, selectedBrand, selectedOrderNo, selectedModel, selectedColor, isUz]);

  // Grouped Orders Summary Table
  const groupedOrdersTable = useMemo(() => {
    const map = new Map<
      string,
      {
        orderNo: string;
        model: string;
        qtyOrder: number;
        qtyCut: number;
        qtyDist: number;
        qtySew: number;
        qtyPack: number;
        qtyDefect: number;
        qtyShipped: number;
        qtyStock: number;
        rowsCount: number;
        notesList: string[];
        rows: FactoryLedgerRow[];
      }
    >();

    scopedRows.forEach(r => {
      const ord = (r.orderNo || '').trim() || '—';
      if (!map.has(ord)) {
        map.set(ord, {
          orderNo: ord,
          model: r.model || '—',
          qtyOrder: 0,
          qtyCut: 0,
          qtyDist: 0,
          qtySew: 0,
          qtyPack: 0,
          qtyDefect: 0,
          qtyShipped: 0,
          qtyStock: 0,
          rowsCount: 0,
          notesList: [],
          rows: []
        });
      }
      const g = map.get(ord)!;
      if (g.model === '—' && r.model) g.model = r.model;
      g.qtyOrder += r.qtyOrder || 0;
      g.qtyCut += r.qtyCut || 0;
      g.qtyDist += r.qtyDistribution || 0;
      g.qtySew += r.qtySewing || 0;
      g.qtyPack += r.qtyPackaging || 0;
      g.qtyDefect += r.qtyDefect || 0;
      g.qtyShipped += r.qtyShipped || 0;
      g.qtyStock += r.qtyStock || 0;
      g.rowsCount += 1;
      g.rows.push(r);
      if (r.notes?.trim() && !g.notesList.includes(r.notes.trim())) {
        g.notesList.push(r.notes.trim());
      }
    });

    return Array.from(map.values()).map(g => {
      const defectPct = g.qtyDist > 0 ? (g.qtyDefect / g.qtyDist) * 100 : 0;
      const packOrderPct = g.qtyOrder > 0 ? (g.qtyPack / g.qtyOrder) * 100 : 0;
      const shipPackPct = g.qtyPack > 0 ? (g.qtyShipped / g.qtyPack) * 100 : 0;
      const totalPackWithBrak = g.qtyPack + g.qtyDefect;
      const diffCutDist = g.qtyCut - g.qtyDist;
      const diffDistSew = g.qtyDist - g.qtySew;
      const diffSewPack1 = g.qtySew - g.qtyPack;
      const diffSewTotalPack = g.qtySew - totalPackWithBrak;

      let statusLabel = '';
      let statusTone = '';
      if (g.qtyPack <= 0) {
        statusLabel = isUz ? 'Qadoqlanmagan' : 'Не упаковано';
        statusTone = 'text-rose-400';
      } else if (g.qtyShipped >= g.qtyPack) {
        statusLabel = isUz ? "Jo'natilgan" : 'Отгружено';
        statusTone = 'text-emerald-400';
      } else if (g.qtyShipped > 0) {
        statusLabel = isUz ? "Qisman jo'natilgan" : 'Частично отгр.';
        statusTone = 'text-amber-300';
      } else {
        statusLabel = isUz ? 'Omborda' : 'На складе';
        statusTone = 'text-sky-300';
      }
      return {
        ...g,
        defectPct,
        packOrderPct,
        shipPackPct,
        totalPackWithBrak,
        diffCutDist,
        diffDistSew,
        diffSewPack1,
        diffSewTotalPack,
        statusLabel,
        statusTone
      };
    });
  }, [scopedRows, isUz]);

  const topDefectsData = useMemo(() => {
    return groupedOrdersTable
      .filter(o => o.qtyDefect > 0)
      .sort((a, b) => b.qtyDefect - a.qtyDefect)
      .slice(0, 10)
      .map(o => ({ name: o.orderNo, defect: o.qtyDefect }));
  }, [groupedOrdersTable]);

  const topModelsPieData = useMemo(() => {
    const map = new Map<string, number>();
    let total = 0;
    scopedRows.forEach(r => {
      const mdl = (r.model || '').trim() || '—';
      const p = r.qtyPackaging || 0;
      if (p > 0) {
        map.set(mdl, (map.get(mdl) || 0) + p);
        total += p;
      }
    });
    const sorted = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    const top5 = sorted.slice(0, 5);
    const restSum = sorted.slice(5).reduce((s, e) => s + e[1], 0);
    const list = top5.map(([name, value], idx) => ({
      name,
      value,
      pct: total > 0 ? Math.round((value / total) * 100) : 0,
      color: PIE_COLORS[idx % PIE_COLORS.length]
    }));
    if (restSum > 0) {
      list.push({
        name: isUz ? 'Boshqa' : 'Прочие',
        value: restSum,
        pct: total > 0 ? Math.round((restSum / total) * 100) : 0,
        color: PIE_COLORS[5]
      });
    }
    return list;
  }, [scopedRows, isUz]);

  const alertsSummary = useMemo(() => {
    const highDefectOrders = groupedOrdersTable
      .filter(o => o.defectPct >= 3.5 && o.qtyDefect > 0)
      .sort((a, b) => b.defectPct - a.defectPct);

    const stockOrders = groupedOrdersTable
      .filter(o => o.qtyStock > 0)
      .sort((a, b) => b.qtyStock - a.qtyStock);

    const anomalyRows = scopedRows.filter(
      r => (r.qtyPackaging || 0) + (r.qtyDefect || 0) > (r.qtyDistribution || 0) && (r.qtyDistribution || 0) > 0
    );

    const notPackedOrders = groupedOrdersTable.filter(o => o.qtyDist > 0 && o.qtyPack === 0);
    const lowCutOrders = groupedOrdersTable.filter(o => o.qtyOrder > 0 && o.qtyCut < o.qtyOrder);

    return { highDefectOrders, stockOrders, anomalyRows, notPackedOrders, lowCutOrders };
  }, [groupedOrdersTable, scopedRows]);

  // =========================================================================
  // SIZE-ONLY MONITORING ANALYTICS ("Faqat razmerlar bo'yicha")
  // =========================================================================
  const allAvailableSizes = useMemo(() => {
    const set = new Set<string>();
    scopedRows.forEach(r => {
      const m = sizeMatrices[r.id];
      if (!m) return;
      getEffectiveDisplaySizes(m).forEach(sz => set.add(sz));
    });
    return Array.from(set);
  }, [scopedRows, sizeMatrices]);

  const sizeAnalytics = useMemo(() => {
    const map = new Map<
      string,
      {
        size: string;
        ordersSet: Set<string>;
        rowsCount: number;
        order: number;
        cut: number;
        dist: number;
        sew: number;
        pack: number;
      }
    >();

    scopedRows.forEach(r => {
      const m = sizeMatrices[r.id];
      if (!m) return;
      const szList = getEffectiveDisplaySizes(m);
      szList.forEach(sz => {
        if (selectedSizeFilter !== 'all' && sz !== selectedSizeFilter) return;
        const c = m.values?.[sz];
        if (!c) return;
        const ord = Number(c.order) || 0;
        const cut = Number(c.cut) || 0;
        const dist = Number(c.dist) || 0;
        const sew = Number(c.sew) || 0;
        const pack = Number(c.pack) || 0;
        if (ord === 0 && cut === 0 && dist === 0 && sew === 0 && pack === 0) return;

        if (!map.has(sz)) {
          map.set(sz, {
            size: sz,
            ordersSet: new Set(),
            rowsCount: 0,
            order: 0,
            cut: 0,
            dist: 0,
            sew: 0,
            pack: 0
          });
        }
        const b = map.get(sz)!;
        b.ordersSet.add((r.orderNo || r.id).trim().toLowerCase());
        b.rowsCount += 1;
        b.order += ord;
        b.cut += cut;
        b.dist += dist;
        b.sew += sew;
        b.pack += pack;
      });
    });

    const rows = Array.from(map.values()).map(item => {
      const rem = item.order - item.pack;
      const cutPct = item.order > 0 ? (item.cut / item.order) * 100 : 0;
      const closePct = item.order > 0 ? (item.pack / item.order) * 100 : 0;
      return {
        ...item,
        ordersCount: item.ordersSet.size,
        rem,
        cutPct,
        closePct
      };
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.order += r.order;
        acc.cut += r.cut;
        acc.dist += r.dist;
        acc.sew += r.sew;
        acc.pack += r.pack;
        acc.rem += r.rem;
        return acc;
      },
      { order: 0, cut: 0, dist: 0, sew: 0, pack: 0, rem: 0 }
    );

    const totalCutPct = totals.order > 0 ? (totals.cut / totals.order) * 100 : 0;
    const totalClosePct = totals.order > 0 ? (totals.pack / totals.order) * 100 : 0;

    return { rows, totals, totalCutPct, totalClosePct };
  }, [scopedRows, sizeMatrices, selectedSizeFilter]);

  const sizeColumnsForMatrixTable = useMemo(() => {
    if (selectedSizeFilter !== 'all') return [selectedSizeFilter];
    return sizeAnalytics.rows.map(r => r.size);
  }, [selectedSizeFilter, sizeAnalytics.rows]);

  // Rows prepared for Interactive All-Stages Size Table (2-rasm)
  const interactiveSizeRows = useMemo(() => {
    return scopedRows.filter(row => {
      if (!hideZeroRowsInSizeTable) return true;
      const m = sizeMatrices[row.id];
      const hasSizesData = sizeColumnsForMatrixTable.some(sz => {
        const c = m?.values?.[sz];
        if (!c) return false;
        return (
          (Number(c.order) || 0) > 0 ||
          (Number(c.cut) || 0) > 0 ||
          (Number(c.dist) || 0) > 0 ||
          (Number(c.sew) || 0) > 0 ||
          (Number(c.pack) || 0) > 0
        );
      });
      return hasSizesData || (row.qtyDefect || 0) > 0;
    });
  }, [scopedRows, hideZeroRowsInSizeTable, sizeMatrices, sizeColumnsForMatrixTable]);

  const activePeriodLabel =
    periodMode === 'yearly'
      ? selectedYear === 'all'
        ? isUz
          ? 'Barcha yillar (Yillik)'
          : 'Все годы (Годовой)'
        : `${selectedYear} ${isUz ? 'yil (Yillik)' : 'год (Годовой)'}`
      : selectedMonth === 'all'
      ? isUz
        ? 'Barcha oylar'
        : 'Все месяцы'
      : selectedMonth;

  const hasAnyFilter =
    selectedYear !== 'all' ||
    selectedMonth !== 'all' ||
    selectedBrand !== 'all' ||
    selectedOrderNo !== 'all' ||
    selectedModel !== 'all' ||
    selectedColor !== 'all' ||
    selectedSizeFilter !== 'all';

  // =========================================================================
  // CRISP HIGH-DPI PNG EXPORTS (html-to-image, pixelRatio: 3)
  // =========================================================================
  const capturePngSection = async (
    ref: React.RefObject<HTMLDivElement | null>,
    fileName: string,
    key: string,
    uzMsg: string,
    ruMsg: string
  ) => {
    const el = ref.current;
    if (!el) return;
    setCapturingPngKey(key);
    try {
      await new Promise(resolve => setTimeout(resolve, 60));
      const dataUrl = await toPng(el, {
        pixelRatio: 3,
        backgroundColor: '#040a1b',
        cacheBust: true,
        filter: node => !(node instanceof HTMLElement && node.dataset?.noCapture === 'true')
      });
      const link = document.createElement('a');
      link.download = `${fileName}_${new Date().toISOString().split('T')[0]}.png`;
      link.href = dataUrl;
      link.click();
      onNotice?.(isUz ? uzMsg : ruMsg);
    } catch (err) {
      console.error('PNG capture error:', err);
      onNotice?.(isUz ? 'PNG yaratishda xatolik.' : 'Ошибка при создании PNG.');
    } finally {
      setCapturingPngKey(null);
    }
  };

  // =========================================================================
  // INDIVIDUAL / SEPARATE PDF EXPORTS FOR EACH DASHBOARD SECTION
  // =========================================================================
  const notifyPdf = (msgUz: string, msgRu: string) => {
    onNotice?.(isUz ? msgUz : msgRu);
  };

  const getPdfFilterSubtitle = () =>
    `${isUz ? 'Davr' : 'Период'}: ${activePeriodLabel}  |  ${isUz ? 'Brend' : 'Бренд'}: ${
      selectedBrand === 'all' ? (isUz ? 'Barchasi' : 'Все') : selectedBrand
    }  |  ${isUz ? 'Zakaz' : 'Заказ'}: ${
      selectedOrderNo === 'all' ? (isUz ? 'Barchasi' : 'Все') : selectedOrderNo
    }  |  ${isUz ? 'Model' : 'Модель'}: ${
      selectedModel === 'all' ? (isUz ? 'Barchasi' : 'Все') : selectedModel
    }  |  ${isUz ? 'Rang' : 'Цвет'}: ${
      selectedColor === 'all' ? (isUz ? 'Barchasi' : 'Все') : selectedColor
    }  |  ${isUz ? 'Sana' : 'Дата'}: ${new Date().toLocaleDateString('ru-RU')}`;

  // 1. Full Dashboard Overview PDF
  const handlePdfFullDashboard = async () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);

      doc.setFont(fontName, 'bold');
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text(
        isUz ? 'ISHLAB CHIQARISH DASHBOARD — TO‘LIQ HISOBOT' : 'ИНТЕРАКТИВНЫЙ ДАШБОРД — ОБЩИЙ ОТЧЁТ',
        12,
        14
      );
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      doc.text(getPdfFilterSubtitle(), 12, 20);

      // KPI + Stage Diffs Summary
      autoTable(doc, {
        startY: 24,
        head: [
          [
            isUz ? 'Zakazlar' : 'Заказов',
            isUz ? 'Buyurtma' : 'Заказ',
            isUz ? 'Kroy' : 'Крой',
            isUz ? 'Taqsimot' : 'Раздача',
            isUz ? 'Tikuv' : 'Пошив',
            isUz ? 'Qadoq (1-s)' : 'Упак (1-с)',
            isUz ? 'Brak (%)' : 'Брак (%)',
            isUz ? "Jo'natildi" : 'Отгр.',
            isUz ? 'Qoldiq' : 'Остаток',
            isUz ? 'Kroy−Razd' : 'Крой−Разд',
            isUz ? 'Razd−Tik' : 'Разд−Пош',
            isUz ? 'Tik−Up(1s)' : 'Пош−Уп(1с)',
            isUz ? 'Tik−(1s+Br)' : 'Пош−(1с+Бр)'
          ]
        ],
        body: [
          [
            String(kpiStats.ordersCount),
            fmtSpaceInt(kpiStats.qtyOrder),
            fmtSpaceInt(kpiStats.qtyCut),
            fmtSpaceInt(kpiStats.qtyDist),
            fmtSpaceInt(kpiStats.qtySew),
            fmtSpaceInt(kpiStats.qtyPack),
            `${fmtSpaceInt(kpiStats.qtyDefect)} (${fmtCommaPct(kpiStats.defectPct)})`,
            fmtSpaceInt(kpiStats.qtyShipped),
            fmtSpaceInt(kpiStats.qtyStock),
            fmtSpaceInt(kpiStats.diffCutDist),
            fmtSpaceInt(kpiStats.diffDistSew),
            fmtSpaceInt(kpiStats.diffSewPack1),
            fmtSpaceInt(kpiStats.diffSewTotalPack)
          ]
        ],
        theme: 'grid',
        styles: { font: fontName, fontSize: 7.5, halign: 'center' },
        headStyles: { fillColor: [11, 24, 56], textColor: [255, 255, 255], fontStyle: 'bold' },
        margin: { left: 8, right: 8 }
      });

      const afterKpiY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 6 : 48;

      autoTable(doc, {
        startY: afterKpiY,
        head: [
          [
            '№',
            isUz ? 'Zakaz' : 'Заказ',
            isUz ? 'Model' : 'Модель',
            isUz ? 'Buyurtma' : 'Заказ',
            isUz ? 'Taqsimot' : 'Раздача',
            isUz ? 'Qadoq' : 'Упак.',
            isUz ? 'Brak %' : 'Брак %',
            isUz ? "Jo'natildi" : 'Отгр.',
            isUz ? 'Qoldiq' : 'Остаток',
            isUz ? 'Holat' : 'Статус'
          ]
        ],
        body: groupedOrdersTable.map((o, i) => [
          String(i + 1),
          o.orderNo,
          o.model,
          fmtSpaceInt(o.qtyOrder),
          fmtSpaceInt(o.qtyDist),
          fmtSpaceInt(o.qtyPack),
          fmtCommaPct(o.defectPct),
          fmtSpaceInt(o.qtyShipped),
          fmtSpaceInt(o.qtyStock),
          o.statusLabel
        ]),
        theme: 'grid',
        styles: { font: fontName, fontSize: 7 },
        headStyles: { fillColor: [13, 31, 71], textColor: [255, 255, 255], fontStyle: 'bold' },
        margin: { left: 8, right: 8 }
      });

      doc.save(`Dashboard_Umumiy_${new Date().toISOString().split('T')[0]}.pdf`);
      notifyPdf('Dashboard PDF yuklab olindi!', 'PDF дашборда скачан!');
    } catch (e) {
      console.error(e);
    }
  };

  // 2. Yearly Summary PDF
  const handlePdfYearlySummary = async () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);
      doc.setFont(fontName, 'bold');
      doc.setFontSize(13);
      doc.text(isUz ? 'YILLIK UMUMIY ZAKAZ HOLATI' : 'ГОДОВОЙ СВОД ЗАКАЗОВ', 12, 14);
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.text(getPdfFilterSubtitle(), 12, 20);

      autoTable(doc, {
        startY: 25,
        head: [
          [
            isUz ? 'Yil' : 'Год',
            isUz ? 'Zakazlar' : 'Заказы',
            isUz ? 'Buyurtma' : 'Заказ',
            isUz ? 'Kroy' : 'Крой',
            isUz ? 'Taqsimot' : 'Раздача',
            isUz ? 'Qadoq' : 'Упаковка',
            isUz ? 'Brak (%)' : 'Брак (%)',
            isUz ? "Jo'natildi" : 'Отгр.',
            isUz ? 'Qoldiq' : 'Остаток',
            isUz ? 'Qadoq / Buyurtma' : 'Упак. / Заказ'
          ]
        ],
        body: yearlySummaryRows.map(yr => {
          const defPct = yr.qtyDist > 0 ? (yr.qtyDefect / yr.qtyDist) * 100 : 0;
          const closePct = yr.qtyOrder > 0 ? (yr.qtyPack / yr.qtyOrder) * 100 : 0;
          return [
            `${yr.year}`,
            String(yr.orderSet.size),
            fmtSpaceInt(yr.qtyOrder),
            fmtSpaceInt(yr.qtyCut),
            fmtSpaceInt(yr.qtyDist),
            fmtSpaceInt(yr.qtyPack),
            `${fmtSpaceInt(yr.qtyDefect)} (${fmtCommaPct(defPct)})`,
            fmtSpaceInt(yr.qtyShipped),
            fmtSpaceInt(yr.qtyStock),
            fmtCommaPct(closePct)
          ];
        }),
        theme: 'grid',
        styles: { font: fontName, fontSize: 8 },
        headStyles: { fillColor: [11, 24, 56], textColor: [255, 255, 255] },
        margin: { left: 10, right: 10 }
      });
      doc.save(`Yillik_Hisobot_${new Date().toISOString().split('T')[0]}.pdf`);
      notifyPdf('Yillik hisobot PDF yuklab olindi!', 'Годовой отчёт PDF скачан!');
    } catch (e) {
      console.error(e);
    }
  };

  // 3. Analytics & Monthly Dynamics PDF
  const handlePdfAnalyticsCharts = async () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);
      doc.setFont(fontName, 'bold');
      doc.setFontSize(13);
      doc.text(
        isUz
          ? `OYLIK DINAMIKA VA MODEL TAHLILI (${activeChartYear} YIL)`
          : `ПОМЕСЯЧНАЯ ДИНАМИКА И АНАЛИЗ МОДЕЛЕЙ (${activeChartYear} Г.)`,
        12,
        14
      );
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.text(getPdfFilterSubtitle(), 12, 20);

      autoTable(doc, {
        startY: 25,
        head: [
          [
            isUz ? 'Oy' : 'Месяц',
            isUz ? 'Buyurtma' : 'Заказ',
            isUz ? 'Taqsimot' : 'Раздача',
            isUz ? 'Qadoq' : 'Упаковка',
            isUz ? 'Brak' : 'Брак',
            isUz ? 'Brak %' : 'Брак %',
            isUz ? "Jo'natildi" : 'Отгружено'
          ]
        ],
        body: monthlyYearData.map(m => [
          m.monthLabel,
          fmtSpaceInt(m.order),
          fmtSpaceInt(m.dist),
          fmtSpaceInt(m.pack),
          fmtSpaceInt(m.defect),
          fmtCommaPct(m.defectPct),
          fmtSpaceInt(m.shipped)
        ]),
        theme: 'grid',
        styles: { font: fontName, fontSize: 8 },
        headStyles: { fillColor: [13, 31, 71], textColor: [255, 255, 255] },
        margin: { left: 10, right: 10 }
      });

      const nextY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : 110;
      autoTable(doc, {
        startY: nextY,
        head: [[isUz ? 'Top-5 Model' : 'Топ-5 Моделей', isUz ? 'Qadoqlangan (dona)' : 'Упаковано (шт)', '%']],
        body: topModelsPieData.map(m => [m.name, fmtSpaceInt(m.value), `${m.pct}%`]),
        theme: 'grid',
        styles: { font: fontName, fontSize: 8 },
        headStyles: { fillColor: [16, 185, 129], textColor: [15, 23, 42] },
        margin: { left: 10, right: 10 }
      });

      doc.save(`Grafiklar_Dinamika_${activeChartYear}.pdf`);
      notifyPdf('Dinamika va modellar PDF yuklab olindi!', 'PDF динамики и моделей скачан!');
    } catch (e) {
      console.error(e);
    }
  };

  // 4. Orders Summary Table PDF
  const handlePdfOrdersTable = async () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);
      doc.setFont(fontName, 'bold');
      doc.setFontSize(13);
      doc.text(isUz ? "ZAKAZLAR BO'YICHA JADVAL" : 'ТАБЛИЦА ПО ЗАКАЗАМ', 12, 14);
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.text(getPdfFilterSubtitle(), 12, 20);

      autoTable(doc, {
        startY: 25,
        head: [
          [
            '№',
            isUz ? 'Zakaz' : 'Заказ',
            isUz ? 'Model' : 'Модель',
            isUz ? 'Buyurtma' : 'Заказ',
            isUz ? 'Taqsimot' : 'Раздача',
            isUz ? 'Qadoq' : 'Упак.',
            isUz ? 'Brak' : 'Брак',
            isUz ? 'Brak %' : 'Брак %',
            isUz ? 'Qadoq/Buyurtma' : 'Упак/Заказ',
            isUz ? "Jo'natildi" : 'Отгр.',
            isUz ? 'Qoldiq' : 'Остаток',
            isUz ? "Jo'nat.%" : 'Отгр.%',
            isUz ? 'Holat' : 'Статус'
          ]
        ],
        body: [
          [
            '',
            isUz ? 'JAMI' : 'ИТОГО',
            '',
            fmtSpaceInt(kpiStats.qtyOrder),
            fmtSpaceInt(kpiStats.qtyDist),
            fmtSpaceInt(kpiStats.qtyPack),
            fmtSpaceInt(kpiStats.qtyDefect),
            fmtCommaPct(kpiStats.defectPct),
            fmtCommaPct(kpiStats.packToOrderPct),
            fmtSpaceInt(kpiStats.qtyShipped),
            fmtSpaceInt(kpiStats.qtyStock),
            fmtCommaPct(kpiStats.shippedToPackPct),
            String(kpiStats.ordersCount)
          ],
          ...groupedOrdersTable.map((o, i) => [
            String(i + 1),
            o.orderNo,
            o.model,
            fmtSpaceInt(o.qtyOrder),
            fmtSpaceInt(o.qtyDist),
            fmtSpaceInt(o.qtyPack),
            fmtSpaceInt(o.qtyDefect),
            fmtCommaPct(o.defectPct),
            fmtCommaPct(o.packOrderPct),
            fmtSpaceInt(o.qtyShipped),
            fmtSpaceInt(o.qtyStock),
            fmtCommaPct(o.shipPackPct),
            o.statusLabel
          ])
        ],
        theme: 'grid',
        styles: { font: fontName, fontSize: 6.8, cellPadding: 1.2 },
        headStyles: { fillColor: [11, 24, 56], textColor: [255, 255, 255], fontStyle: 'bold' },
        margin: { left: 8, right: 8 }
      });

      doc.save(`Zakazlar_Jadvali_${new Date().toISOString().split('T')[0]}.pdf`);
      notifyPdf('Zakazlar jadvali PDF yuklab olindi!', 'Таблица заказов PDF скачана!');
    } catch (e) {
      console.error(e);
    }
  };

  // 5. Order Color Rows PDF
  const handlePdfOrderColorRows = async () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);
      doc.setFont(fontName, 'bold');
      doc.setFontSize(13);
      doc.text(
        isUz ? "TANLANGAN ZAKAZ QATORLARI (rang / o'lcham bo'yicha)" : 'СТРОКИ ЗАКАЗОВ (по цвету / росту)',
        12,
        14
      );
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.text(getPdfFilterSubtitle(), 12, 20);

      autoTable(doc, {
        startY: 25,
        head: [
          [
            '№',
            isUz ? 'Zakaz' : 'Заказ',
            isUz ? "Rang / o'lcham" : 'Цвет / рост',
            isUz ? 'Buyurtma' : 'Заказ',
            isUz ? 'Taqsimot' : 'Раздача',
            isUz ? 'Qadoq' : 'Упак.',
            isUz ? 'Brak' : 'Брак',
            isUz ? 'Brak %' : 'Брак %',
            isUz ? "Jo'natildi" : 'Отгр.',
            isUz ? 'Qoldiq' : 'Остаток',
            isUz ? 'Oy' : 'Месяц',
            isUz ? 'Izoh' : 'Примечание'
          ]
        ],
        body: scopedRows.map((r, i) => {
          const defPct = r.qtyDistribution > 0 ? (r.qtyDefect / r.qtyDistribution) * 100 : 0;
          return [
            String(i + 1),
            r.orderNo || '—',
            [r.color || (isUz ? 'Rangsiz' : 'Без цвета'), r.rost].filter(Boolean).join(' • '),
            fmtSpaceInt(r.qtyOrder),
            fmtSpaceInt(r.qtyDistribution),
            fmtSpaceInt(r.qtyPackaging),
            fmtSpaceInt(r.qtyDefect),
            fmtCommaPct(defPct),
            fmtSpaceInt(r.qtyShipped),
            fmtSpaceInt(r.qtyStock),
            r.month || '',
            r.notes || ''
          ];
        }),
        theme: 'grid',
        styles: { font: fontName, fontSize: 6.8, cellPadding: 1.2 },
        headStyles: { fillColor: [11, 24, 56], textColor: [255, 255, 255] },
        margin: { left: 8, right: 8 }
      });

      doc.save(`Zakaz_Qatorlari_${new Date().toISOString().split('T')[0]}.pdf`);
      notifyPdf('Zakaz qatorlari PDF yuklab olindi!', 'PDF строк заказа скачан!');
    } catch (e) {
      console.error(e);
    }
  };

  // 6. Aggregated Size Table PDF
  const handlePdfSizeSummary = async () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);
      doc.setFont(fontName, 'bold');
      doc.setFontSize(13);
      doc.text(isUz ? "RAZMERLAR BO'YICHA UMUMIY HISOB JADVALI" : 'СВОДНАЯ ТАБЛИЦА ПО РАЗМЕРАМ', 12, 14);
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.text(getPdfFilterSubtitle(), 12, 20);

      autoTable(doc, {
        startY: 25,
        head: [
          [
            '№',
            isUz ? 'Razmer' : 'Размер',
            isUz ? 'Zakazlar' : 'Заказы',
            isUz ? 'Buyurtma' : 'Заказ',
            isUz ? 'Kroy' : 'Крой',
            isUz ? 'Kroy %' : 'Крой %',
            isUz ? 'Taqsimot' : 'Раздача',
            isUz ? 'Tikuv' : 'Пошив',
            isUz ? 'Qadoq' : 'Упак.',
            isUz ? 'Qoldiq' : 'Остаток',
            isUz ? 'Qadoq/Buyurtma' : 'Упак/Заказ'
          ]
        ],
        body: [
          [
            '',
            isUz ? 'JAMI' : 'ИТОГО',
            String(kpiStats.ordersCount),
            fmtSpaceInt(sizeAnalytics.totals.order),
            fmtSpaceInt(sizeAnalytics.totals.cut),
            fmtCommaPct(sizeAnalytics.totalCutPct),
            fmtSpaceInt(sizeAnalytics.totals.dist),
            fmtSpaceInt(sizeAnalytics.totals.sew),
            fmtSpaceInt(sizeAnalytics.totals.pack),
            fmtSpaceInt(sizeAnalytics.totals.rem),
            fmtCommaPct(sizeAnalytics.totalClosePct)
          ],
          ...sizeAnalytics.rows.map((sz, i) => [
            String(i + 1),
            sz.size,
            String(sz.ordersCount),
            fmtSpaceInt(sz.order),
            fmtSpaceInt(sz.cut),
            fmtCommaPct(sz.cutPct),
            fmtSpaceInt(sz.dist),
            fmtSpaceInt(sz.sew),
            fmtSpaceInt(sz.pack),
            fmtSpaceInt(sz.rem),
            fmtCommaPct(sz.closePct)
          ])
        ],
        theme: 'grid',
        styles: { font: fontName, fontSize: 7.5 },
        headStyles: { fillColor: [11, 24, 56], textColor: [255, 255, 255] },
        margin: { left: 8, right: 8 }
      });

      doc.save(`Razmerlar_Umumiy_${new Date().toISOString().split('T')[0]}.pdf`);
      notifyPdf('Razmerlar umumiy jadvali PDF yuklab olindi!', 'Сводка по размерам PDF скачана!');
    } catch (e) {
      console.error(e);
    }
  };

  // 7. Interactive All-Stages Size Table PDF (2-rasm)
  const handlePdfAllStagesSizes = async () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);
      doc.setFont(fontName, 'bold');
      doc.setFontSize(13);
      doc.text(
        isUz
          ? "RAZMERLAR BO'YICHA BARCHA ETAP JADVALI (Zakaz, Kroy, Taqsimot, Tikuv, Qadoq, Brak)"
          : 'ТАБЛИЦА РАЗМЕРОВ ПО ВСЕМ ЭТАПАМ (Заказ, Крой, Раздача, Пошив, Упак., Брак)',
        12,
        14
      );
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.text(getPdfFilterSubtitle(), 12, 20);

      const activeStgDefs = STAGE_DEFS.filter(s => visibleAllStages.includes(s.key));
      const head = [
        [
          '№',
          isUz ? 'Zakaz' : 'Заказ',
          isUz ? 'Rang' : 'Цвет',
          isUz ? 'Etap' : 'Этап',
          ...sizeColumnsForMatrixTable,
          isUz ? 'JAMI' : 'ВСЕГО',
          ...(showBrakInSizeTable ? [isUz ? 'Brak' : 'Брак'] : [])
        ]
      ];
      const body: any[][] = [];
      interactiveSizeRows.forEach((r, idx) => {
        const m = sizeMatrices[r.id];
        activeStgDefs.forEach((st, stIdx) => {
          let sum = 0;
          const cells = sizeColumnsForMatrixTable.map(sz => {
            const v = Number(m?.values?.[sz]?.[st.key]) || 0;
            sum += v;
            return v > 0 ? String(v) : '-';
          });
          if (stIdx === 0) {
            body.push([
              { content: String(idx + 1), rowSpan: activeStgDefs.length, styles: { valign: 'middle' } },
              { content: r.orderNo || '—', rowSpan: activeStgDefs.length, styles: { valign: 'middle' } },
              {
                content: [r.color || (isUz ? 'Rangsiz' : 'Без цвета'), r.rost].filter(Boolean).join(' • '),
                rowSpan: activeStgDefs.length,
                styles: { valign: 'middle' }
              },
              isUz ? st.uz : st.ru,
              ...cells,
              fmtSpaceInt(sum),
              ...(showBrakInSizeTable
                ? [
                    {
                      content: fmtDashInt(r.qtyDefect),
                      rowSpan: activeStgDefs.length,
                      styles: { valign: 'middle' }
                    }
                  ]
                : [])
            ]);
          } else {
            body.push([isUz ? st.uz : st.ru, ...cells, fmtSpaceInt(sum)]);
          }
        });
      });

      autoTable(doc, {
        startY: 25,
        head,
        body,
        theme: 'grid',
        styles: { font: fontName, fontSize: 6.2, cellPadding: 1.0 },
        headStyles: { fillColor: [11, 24, 56], textColor: [255, 255, 255], fontStyle: 'bold' },
        margin: { left: 8, right: 8 }
      });

      doc.save(`Razmerlar_Barcha_Etaplar_${new Date().toISOString().split('T')[0]}.pdf`);
      notifyPdf('Barcha etaplar razmer jadvali PDF yuklab olindi!', 'PDF размеров по всем этапам скачан!');
    } catch (e) {
      console.error(e);
    }
  };

  // 8. Stage Differences & Primechaniya PDF (For All Filtered OR Single Order OR Single Order+Color)
  const handlePdfDifferencesAndNotes = async (
    rowsToPrint: FactoryLedgerRow[],
    title: string,
    fileName: string
  ) => {
    if (rowsToPrint.length === 0) {
      notifyPdf("PDF uchun ma'lumot yo'q.", 'Нет данных для PDF.');
      return;
    }
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);

      doc.setFont(fontName, 'bold');
      doc.setFontSize(13);
      doc.text(title, 12, 14);
      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.text(getPdfFilterSubtitle(), 12, 20);

      let sCut = 0;
      let sDist = 0;
      let sSew = 0;
      let sPack = 0;
      let sBrak = 0;
      rowsToPrint.forEach(r => {
        sCut += r.qtyCut || 0;
        sDist += r.qtyDistribution || 0;
        sSew += r.qtySewing || 0;
        sPack += r.qtyPackaging || 0;
        sBrak += r.qtyDefect || 0;
      });
      const sTotPack = sPack + sBrak;

      autoTable(doc, {
        startY: 25,
        head: [
          [
            '№',
            isUz ? 'Zakaz' : 'Заказ',
            isUz ? 'Model' : 'Модель',
            isUz ? 'Rang / Rost' : 'Цвет / Рост',
            isUz ? 'Kroy' : 'Крой',
            isUz ? 'Taqsimot' : 'Раздача',
            isUz ? 'Kroy−Razd' : 'Крой−Разд',
            isUz ? 'Tikuv' : 'Пошив',
            isUz ? 'Razd−Posh' : 'Разд−Пош',
            isUz ? 'Qadoq (1-s)' : 'Уп (1-с)',
            isUz ? 'Posh−Up(1s)' : 'Пош−Уп(1с)',
            isUz ? 'Brak' : 'Брак',
            isUz ? '1s+Brak' : '1с+Брак',
            isUz ? 'Posh−(1s+Br)' : 'Пош−(1с+Бр)',
            isUz ? 'Primechaniya (Izoh)' : 'Примечание'
          ]
        ],
        body: [
          [
            '',
            isUz ? 'JAMI' : 'ИТОГО',
            '',
            '',
            fmtSpaceInt(sCut),
            fmtSpaceInt(sDist),
            fmtSpaceInt(sCut - sDist),
            fmtSpaceInt(sSew),
            fmtSpaceInt(sDist - sSew),
            fmtSpaceInt(sPack),
            fmtSpaceInt(sSew - sPack),
            fmtSpaceInt(sBrak),
            fmtSpaceInt(sTotPack),
            fmtSpaceInt(sSew - sTotPack),
            ''
          ],
          ...rowsToPrint.map((r, idx) => {
            const cut = r.qtyCut || 0;
            const dist = r.qtyDistribution || 0;
            const sew = r.qtySewing || 0;
            const pack = r.qtyPackaging || 0;
            const brak = r.qtyDefect || 0;
            const totPack = pack + brak;
            return [
              String(idx + 1),
              r.orderNo || '—',
              r.model || '—',
              [r.color || (isUz ? 'Rangsiz' : 'Без цвета'), r.rost].filter(Boolean).join(' • '),
              fmtSpaceInt(cut),
              fmtSpaceInt(dist),
              fmtSpaceInt(cut - dist),
              fmtSpaceInt(sew),
              fmtSpaceInt(dist - sew),
              fmtSpaceInt(pack),
              fmtSpaceInt(sew - pack),
              fmtSpaceInt(brak),
              fmtSpaceInt(totPack),
              fmtSpaceInt(sew - totPack),
              r.notes || ''
            ];
          })
        ],
        theme: 'grid',
        styles: { font: fontName, fontSize: 6.1, cellPadding: 1.0 },
        headStyles: { fillColor: [11, 24, 56], textColor: [255, 255, 255], fontStyle: 'bold' },
        margin: { left: 6, right: 6 }
      });

      doc.save(fileName);
      notifyPdf('Farqlar va Primechaniya PDF yuklab olindi!', 'PDF разниц и примечаний скачан!');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div ref={fullDashboardRef} className="space-y-4 text-white animate-fadeIn">
      {/* TOP BAR + MODE SWITCHER + FILTERS (including BRAND & RANG filters!) */}
      <div className="bg-[#060f28]/95 backdrop-blur-md border border-[#1e3a6e] rounded-2xl p-4 shadow-2xl space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-black tracking-wide text-white uppercase">
              {isUz
                ? 'ISHLAB CHIQARISH — INTERAKTIV DASHBOARD'
                : 'ПРОИЗВОДСТВО — ИНТЕРАКТИВНЫЙ ДАШБОРД'}
            </h1>
            <p className="text-xs text-cyan-300 mt-0.5 font-semibold">
              Chust Textile •{' '}
              {isUz
                ? "Buyurtmalar bo'yicha ishlab chiqarish va jo'natish nazorati"
                : 'Контроль производства и отгрузки по заказам'}{' '}
              • {activePeriodLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 3 Monitoring Sub-modes */}
            <div className="bg-[#040a1b] border border-[#1e3a6e] rounded-xl p-1 flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setMonitorMode('umumiy')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                  monitorMode === 'umumiy'
                    ? 'bg-sky-500 text-white shadow'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                }`}
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>{isUz ? 'Umumiy hisob (Oylik / Yillik)' : 'Общий учёт (Мес. / Год)'}</span>
              </button>
              <button
                type="button"
                onClick={() => setMonitorMode('razmerlar')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                  monitorMode === 'razmerlar'
                    ? 'bg-amber-400 text-slate-950 shadow'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                }`}
              >
                <Ruler className="w-3.5 h-3.5" />
                <span>{isUz ? "Faqat razmerlar bo'yicha" : 'Только по размерам'}</span>
              </button>
              <button
                type="button"
                onClick={() => setMonitorMode('farqlar')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                  monitorMode === 'farqlar'
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                }`}
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>{isUz ? 'Farqlar va Primechaniya' : 'Разницы и Примечания'}</span>
              </button>
            </div>

            {/* Period Toggle */}
            <div className="bg-[#040a1b] border border-[#1e3a6e] rounded-xl p-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPeriodMode('monthly')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                  periodMode === 'monthly'
                    ? 'bg-emerald-500 text-slate-950 font-black'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {isUz ? 'Oylik' : 'По месяцам'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPeriodMode('yearly');
                  onChangeMonth('all');
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                  periodMode === 'yearly'
                    ? 'bg-indigo-500 text-white font-black'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {isUz ? 'Yillik umumiy' : 'За весь год'}
              </button>
            </div>

            {/* Main Dashboard PDF & Crisp PNG Buttons */}
            <button
              type="button"
              data-no-capture="true"
              onClick={handlePdfFullDashboard}
              className="px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white font-black rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow border border-rose-400/40 whitespace-nowrap shrink-0"
              title={isUz ? 'Umumiy Dashboard PDF yuklab olish' : 'Скачать общий PDF дашборда'}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{isUz ? 'Dashboard PDF' : 'PDF Дашборда'}</span>
            </button>

            <button
              type="button"
              data-no-capture="true"
              onClick={() =>
                capturePngSection(
                  fullDashboardRef,
                  'Dashboard_Toliq',
                  'full',
                  'Dashboard PNG rasmi yuklab olindi!',
                  'PNG дашборда скачан!'
                )
              }
              disabled={capturingPngKey === 'full'}
              className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-black rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow border border-cyan-400/40 whitespace-nowrap shrink-0 disabled:opacity-60"
              title={isUz ? 'Tiniq PNG rasm yuklab olish' : 'Скачать чёткий PNG снимок дашборда'}
            >
              <ImageDown className="w-3.5 h-3.5" />
              <span>{isUz ? 'Dashboard PNG' : 'PNG Дашборда'}</span>
            </button>

            <div className="text-right pl-1 hidden md:block">
              <div className="text-[10px] text-slate-400">{isUz ? 'Hisobot sanasi' : 'Дата отчёта'}</div>
              <div className="text-xs font-mono font-black text-white">
                {new Date().toLocaleDateString('ru-RU')}
              </div>
            </div>
          </div>
        </div>

        {/* FILTER STRIP: YIL | OY | BREND | ZAKAZ № | MODEL | RANG | (RAZMER) */}
        <div
          className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${
            monitorMode === 'razmerlar' ? 'xl:grid-cols-7' : 'xl:grid-cols-6'
          } gap-2.5 items-end`}
        >
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-cyan-300 block mb-1">
              {isUz ? 'YIL ▼' : 'ГОД ▼'}
            </label>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[#eef4ff] text-slate-950 font-bold text-xs border border-cyan-300/60 focus:outline-none cursor-pointer shadow-sm"
            >
              <option value="all">{isUz ? 'Barcha yillar' : 'Все годы'}</option>
              {availableYears.map(y => (
                <option key={y} value={y}>
                  {y} {isUz ? 'yil' : 'год'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-cyan-300 block mb-1">
              {isUz ? 'OY ▼' : 'МЕСЯЦ ▼'}
            </label>
            <select
              value={periodMode === 'yearly' ? 'all' : selectedMonth}
              onChange={e => {
                const v = e.target.value;
                if (v === 'all') {
                  onChangeMonth('all');
                } else {
                  setPeriodMode('monthly');
                  onChangeMonth(v);
                }
              }}
              className="w-full px-3 py-2 rounded-md bg-[#eef4ff] text-slate-950 font-bold text-xs border border-cyan-300/60 focus:outline-none cursor-pointer shadow-sm"
            >
              <option value="all">{isUz ? 'Barchasi (Yillik)' : 'Все месяцы (Год)'}</option>
              {availableMonths.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-indigo-300 block mb-1">
              {isUz ? 'BREND ▼' : 'БРЕНД ▼'}
            </label>
            <select
              value={selectedBrand}
              onChange={e => onChangeBrand(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[#eef2ff] text-slate-950 font-bold text-xs border border-indigo-400/70 focus:outline-none cursor-pointer shadow-sm"
            >
              <option value="all">{isUz ? 'Barcha brendlar' : 'Все бренды'}</option>
              {availableBrands.map(b => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-cyan-300 block mb-1">
              {isUz ? 'ZAKAZ № ▼' : 'ЗАКАЗ № ▼'}
            </label>
            <select
              value={selectedOrderNo}
              onChange={e => onChangeOrderNo(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[#eef4ff] text-slate-950 font-bold text-xs border border-cyan-300/60 focus:outline-none cursor-pointer shadow-sm"
            >
              <option value="all">{isUz ? 'Barchasi' : 'Все заказы'}</option>
              {availableOrders.map(o => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-cyan-300 block mb-1">
              {isUz ? 'MODEL ▼' : 'МОДЕЛЬ ▼'}
            </label>
            <select
              value={selectedModel}
              onChange={e => onChangeModel(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[#eef4ff] text-slate-950 font-bold text-xs border border-cyan-300/60 focus:outline-none cursor-pointer shadow-sm"
            >
              <option value="all">{isUz ? 'Barchasi' : 'Все модели'}</option>
              {availableModels.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* RANG (COLOR) FILTER (1-rasm) */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-emerald-300 block mb-1">
              {isUz ? 'RANG ▼' : 'ЦВЕТ ▼'}
            </label>
            <select
              value={selectedColor}
              onChange={e => onChangeColor(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[#ecfdf5] text-slate-950 font-bold text-xs border border-emerald-400/70 focus:outline-none cursor-pointer shadow-sm"
            >
              <option value="all">{isUz ? 'Barcha ranglar' : 'Все цвета'}</option>
              {availableColors.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {monitorMode === 'razmerlar' && (
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-amber-300 block mb-1">
                {isUz ? 'RAZMER ▼' : 'РАЗМЕР ▼'}
              </label>
              <select
                value={selectedSizeFilter}
                onChange={e => setSelectedSizeFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-[#fef9c3] text-slate-950 font-bold text-xs border border-amber-400/70 focus:outline-none cursor-pointer shadow-sm"
              >
                <option value="all">{isUz ? 'Barcha razmerlar' : 'Все размеры'}</option>
                {allAvailableSizes.map(sz => (
                  <option key={sz} value={sz}>
                    {sz}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Active filter breadcrumb strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-400">{isUz ? 'Filtr →' : 'Фильтр →'}</span>
            <span>
              {isUz ? 'Yil:' : 'Год:'}{' '}
              <strong className="text-white">{selectedYear === 'all' ? (isUz ? 'Barchasi' : 'Все') : selectedYear}</strong>
            </span>
            <span>·</span>
            <span>
              {isUz ? 'Oy:' : 'Месяц:'}{' '}
              <strong className="text-white">
                {periodMode === 'yearly' || selectedMonth === 'all'
                  ? isUz
                    ? 'Yillik (barchasi)'
                    : 'За год (все)'
                  : selectedMonth}
              </strong>
            </span>
            <span>·</span>
            <span>
              {isUz ? 'Brend:' : 'Бренд:'}{' '}
              <strong className="text-indigo-300">{selectedBrand === 'all' ? (isUz ? 'Barchasi' : 'Все') : selectedBrand}</strong>
            </span>
            <span>·</span>
            <span>
              {isUz ? 'Zakaz:' : 'Заказ:'}{' '}
              <strong className="text-white">{selectedOrderNo === 'all' ? (isUz ? 'Barchasi' : 'Все') : selectedOrderNo}</strong>
            </span>
            <span>·</span>
            <span>
              {isUz ? 'Model:' : 'Модель:'}{' '}
              <strong className="text-white">{selectedModel === 'all' ? (isUz ? 'Barchasi' : 'Все') : selectedModel}</strong>
            </span>
            <span>·</span>
            <span>
              {isUz ? 'Rang:' : 'Цвет:'}{' '}
              <strong className="text-emerald-300">{selectedColor === 'all' ? (isUz ? 'Barchasi' : 'Все') : selectedColor}</strong>
            </span>
            <span className="text-slate-500 px-1">|</span>
            <span className="text-cyan-300 font-bold">
              {kpiStats.ordersCount} {isUz ? 'ta zakaz' : 'заказов'}, {kpiStats.rowsCount} {isUz ? 'ta qator' : 'строк'}
            </span>
          </div>

          {hasAnyFilter && (
            <button
              type="button"
              data-no-capture="true"
              onClick={() => {
                setSelectedYear('all');
                onChangeMonth('all');
                onChangeBrand('all');
                onChangeOrderNo('all');
                onChangeModel('all');
                onChangeColor('all');
                setSelectedSizeFilter('all');
              }}
              className="text-[11px] text-amber-300 hover:text-amber-200 font-bold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>{isUz ? 'Filtrni tozalash' : 'Сбросить фильтр'}</span>
            </button>
          )}
        </div>
      </div>

      {/* =====================================================================
          MODE 1: UMUMIY MONITORING (Exact Screenshot + Stage Differences + Individual PDFs & PNGs)
         ===================================================================== */}
      {monitorMode === 'umumiy' && (
        <div className="space-y-4">
          <div ref={kpiDiffRef} className="space-y-4">
          {/* 6 KPI CARDS ROW */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-cyan-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'ZAKAZLAR SONI' : 'КОЛ-ВО ЗАКАЗОВ'}
              </div>
              <div className="text-2xl sm:text-3xl font-black text-white mt-1.5 font-mono tabular-nums">
                {fmtSpaceInt(kpiStats.ordersCount)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2 space-y-0.5">
                <div>
                  {isUz ? "Qatorlar (rang/o'lcham):" : 'Строк (цвет/размер):'}{' '}
                  <strong className="text-white">{kpiStats.rowsCount}</strong>
                </div>
                <div>
                  {isUz ? 'Modellar:' : 'Моделей:'} <strong className="text-white">{kpiStats.modelsCount}</strong>
                </div>
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-blue-500 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'BUYURTMA MIQDORI' : 'ОБЪЁМ ЗАКАЗА'}
              </div>
              <div className="text-2xl sm:text-3xl font-black text-white mt-1.5 font-mono tabular-nums">
                {fmtSpaceInt(kpiStats.qtyOrder)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2 space-y-0.5">
                <div>
                  {isUz ? 'Taqsimot:' : 'Раздача:'} {fmtSpaceInt(kpiStats.qtyDist)} {isUz ? 'dona' : 'шт'}
                </div>
                {kpiStats.orderDeltaPct !== null ? (
                  <div className={`font-bold ${kpiStats.orderDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {kpiStats.orderDeltaPct >= 0 ? '▲' : '▼'} {fmtCommaPct(Math.abs(kpiStats.orderDeltaPct))}{' '}
                    {isUz ? "o'tgan oyga nisbatan" : 'к пред. месяцу'}
                  </div>
                ) : (
                  <div className="text-sky-300 font-semibold">
                    {isUz ? `Kroy: ${fmtSpaceInt(kpiStats.qtyCut)} dona` : `Крой: ${fmtSpaceInt(kpiStats.qtyCut)} шт`}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-emerald-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'QADOQLANDI' : 'УПАКОВАНО'}
              </div>
              <div className="text-2xl sm:text-3xl font-black text-white mt-1.5 font-mono tabular-nums">
                {fmtSpaceInt(kpiStats.qtyPack)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2 space-y-0.5">
                <div>
                  {isUz ? 'Buyurtmaga nisbatan:' : 'От заказа:'} {fmtCommaPct(kpiStats.packToOrderPct)}
                </div>
                {kpiStats.packDeltaPct !== null ? (
                  <div className={`font-bold ${kpiStats.packDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {kpiStats.packDeltaPct >= 0 ? '▲' : '▼'} {fmtCommaPct(Math.abs(kpiStats.packDeltaPct))}{' '}
                    {isUz ? "o'tgan oyga nisbatan" : 'к пред. месяцу'}
                  </div>
                ) : (
                  <div className="text-emerald-300 font-semibold">
                    {isUz ? `Tikuv: ${fmtSpaceInt(kpiStats.qtySew)} dona` : `Пошив: ${fmtSpaceInt(kpiStats.qtySew)} шт`}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-rose-500 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'BRAK DARAJASI' : 'УРОВЕНЬ БРАКА'}
              </div>
              <div
                className={`text-2xl sm:text-3xl font-black mt-1.5 font-mono tabular-nums ${
                  kpiStats.defectPct >= 3.5 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {fmtCommaPct(kpiStats.defectPct)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2 space-y-0.5">
                <div>
                  {isUz ? 'Brak:' : 'Брак:'} {fmtSpaceInt(kpiStats.qtyDefect)} {isUz ? 'dona · norma 3,5%' : 'шт · норма 3,5%'}
                </div>
                {kpiStats.defectDeltaPP !== null && (
                  <div className={`font-bold ${kpiStats.defectDeltaPP <= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {kpiStats.defectDeltaPP <= 0 ? '▼' : '▲'} {kpiStats.defectDeltaPP.toFixed(2).replace('.', ',')} p.p.{' '}
                    {isUz ? "o'tgan oyga nisbatan" : 'к пред. месяцу'}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-amber-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? "JO'NATILDI" : 'ОТГРУЖЕНО'}
              </div>
              <div className="text-2xl sm:text-3xl font-black text-white mt-1.5 font-mono tabular-nums">
                {fmtSpaceInt(kpiStats.qtyShipped)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2 space-y-0.5">
                <div>
                  {isUz ? 'Qadoqqa nisbatan:' : 'От упаковки:'} {fmtCommaPct(kpiStats.shippedToPackPct)}
                </div>
                {kpiStats.shipDeltaPct !== null && (
                  <div className={`font-bold ${kpiStats.shipDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {kpiStats.shipDeltaPct >= 0 ? '▲' : '▼'} {fmtCommaPct(Math.abs(kpiStats.shipDeltaPct))}{' '}
                    {isUz ? "o'tgan oyga nisbatan" : 'к пред. месяцу'}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-purple-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? "OMBOR QOLDIG'I" : 'ОСТАТОК НА СКЛАДЕ'}
              </div>
              <div className="text-2xl sm:text-3xl font-black text-white mt-1.5 font-mono tabular-nums">
                {fmtSpaceInt(kpiStats.qtyStock)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2 space-y-0.5">
                <div>{isUz ? "Qadoqlangan − jo'natilgan" : 'Упаковано − отгружено'}</div>
                <div>
                  {isUz ? "Qoldig'i bor zakazlar:" : 'Заказов с остатком:'}{' '}
                  <strong className="text-white">
                    {kpiStats.ordersWithStockCount} {isUz ? 'ta' : 'шт'}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {/* BOSQICHLAR FARQI DASHBOARD STRIP ("dashboardda ham") */}
          <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl p-3.5 shadow-lg space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#1e3a6e]/70">
              <div className="flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-black uppercase tracking-wider text-white">
                  {isUz
                    ? 'BOSQICHLAR O‘RTASIDAGI FARQLAR (KROY − RAZDACHA − POSHIV − UPAKOVKA + BRAK)'
                    : 'РАЗНИЦЫ ПО ЭТАПАМ (КРОЙ − РАЗДАЧА − ПОШИВ − УПАКОВКА + БРАК)'}
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2" data-no-capture="true">
                <button
                  type="button"
                  onClick={() =>
                    capturePngSection(
                      kpiDiffRef,
                      'KPI_va_Farqlar',
                      'kpiDiff',
                      'KPI va farqlar PNG rasmi yuklab olindi!',
                      'PNG показателей и разниц скачан!'
                    )
                  }
                  disabled={capturingPngKey === 'kpiDiff'}
                  className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ImageDown className="w-3 h-3" />
                  <span>{isUz ? 'KPI + Farqlar PNG' : 'PNG KPI + Разницы'}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handlePdfDifferencesAndNotes(
                      scopedRows,
                      isUz ? 'BOSQICHLAR FARQI VA PRIMECHANIYA HISOBOTI' : 'ОТЧЁТ ПО РАЗНИЦАМ И ПРИМЕЧАНИЯМ',
                      `Farqlar_Primechaniya_${new Date().toISOString().split('T')[0]}.pdf`
                    )
                  }
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3 h-3" />
                  <span>{isUz ? 'Farqlar PDF' : 'PDF Разниц'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMonitorMode('farqlar')}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>{isUz ? 'Batafsil va Primechaniya' : 'Подробнее и Примечания'}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 font-mono tabular-nums">
              <div className="bg-[#060f28] border border-[#1e3a6e] rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-sans font-bold text-slate-300">
                    {isUz ? 'Kroy − Razdacha farqi' : 'Крой − Раздача'}
                  </div>
                  <div className={`text-base font-black ${getDiffBadgeClass(kpiStats.diffCutDist)}`}>
                    {fmtSpaceInt(kpiStats.diffCutDist)}
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 font-sans">
                  {fmtSpaceInt(kpiStats.qtyCut)} − {fmtSpaceInt(kpiStats.qtyDist)}
                </span>
              </div>

              <div className="bg-[#060f28] border border-[#1e3a6e] rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-sans font-bold text-slate-300">
                    {isUz ? 'Razdacha − Poshiv farqi' : 'Раздача − Пошив'}
                  </div>
                  <div className={`text-base font-black ${getDiffBadgeClass(kpiStats.diffDistSew)}`}>
                    {fmtSpaceInt(kpiStats.diffDistSew)}
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 font-sans">
                  {fmtSpaceInt(kpiStats.qtyDist)} − {fmtSpaceInt(kpiStats.qtySew)}
                </span>
              </div>

              <div className="bg-[#060f28] border border-[#1e3a6e] rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-sans font-bold text-slate-300">
                    {isUz ? 'Poshiv − Upakovka (1-sort)' : 'Пошив − Упак. (1-сорт)'}
                  </div>
                  <div className={`text-base font-black ${getDiffBadgeClass(kpiStats.diffSewPack1)}`}>
                    {fmtSpaceInt(kpiStats.diffSewPack1)}
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 font-sans">
                  {fmtSpaceInt(kpiStats.qtySew)} − {fmtSpaceInt(kpiStats.qtyPack)}
                </span>
              </div>

              <div className="bg-[#060f28] border border-[#1e3a6e] rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-sans font-bold text-slate-300">
                    {isUz ? 'Poshiv − (1-sort + Brak)' : 'Пошив − (1-сорт + Брак)'}
                  </div>
                  <div className={`text-base font-black ${getDiffBadgeClass(kpiStats.diffSewTotalPack)}`}>
                    {fmtSpaceInt(kpiStats.diffSewTotalPack)}
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 font-sans">
                  {fmtSpaceInt(kpiStats.qtySew)} − {fmtSpaceInt(kpiStats.totalPackWithBrak)}
                </span>
              </div>
            </div>
          </div>
          </div>

          {/* YILLIK UMUMIY ZAKAZ HOLATI (with individual PDF & PNG buttons) */}
          {yearlySummaryRows.length > 0 && (
            <div ref={yearlyRef} className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl p-3.5 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2.5 border-b border-[#1e3a6e]/70">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">
                    {isUz ? 'YILLIK UMUMIY ZAKAZ HOLATI' : 'ГОДОВОЙ СВОД ЗАКАЗОВ'}
                  </h3>
                </div>
                <div className="flex items-center gap-2" data-no-capture="true">
                  <span className="text-[11px] text-slate-400 hidden sm:inline">
                    {isUz
                      ? "Yil ustiga bosing — yillik to'liq ko'rinishga o'tasiz"
                      : 'Нажмите на год, чтобы переключиться на годовой отчёт'}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      capturePngSection(
                        yearlyRef,
                        'Yillik_Hisobot',
                        'yearly',
                        'Yillik hisobot PNG yuklab olindi!',
                        'PNG годового свода скачан!'
                      )
                    }
                    disabled={capturingPngKey === 'yearly'}
                    className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <ImageDown className="w-3 h-3" />
                    <span>{isUz ? 'Yillik PNG' : 'PNG Годовой'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePdfYearlySummary}
                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <FileText className="w-3 h-3" />
                    <span>{isUz ? 'Yillik PDF' : 'PDF Годовой'}</span>
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-slate-300 border-b border-[#1e3a6e] text-[11px]">
                      <th className="py-1.5 px-2.5 text-left font-bold">{isUz ? 'Yil' : 'Год'}</th>
                      <th className="py-1.5 px-2.5 text-right font-bold">{isUz ? 'Zakazlar' : 'Заказы'}</th>
                      <th className="py-1.5 px-2.5 text-right font-bold">{isUz ? 'Buyurtma' : 'Заказ'}</th>
                      <th className="py-1.5 px-2.5 text-right font-bold">{isUz ? 'Kroy' : 'Крой'}</th>
                      <th className="py-1.5 px-2.5 text-right font-bold">{isUz ? 'Taqsimot' : 'Раздача'}</th>
                      <th className="py-1.5 px-2.5 text-right font-bold">{isUz ? 'Qadoq' : 'Упаковка'}</th>
                      <th className="py-1.5 px-2.5 text-right font-bold">{isUz ? 'Brak (%)' : 'Брак (%)'}</th>
                      <th className="py-1.5 px-2.5 text-right font-bold">{isUz ? "Jo'natildi" : 'Отгр.'}</th>
                      <th className="py-1.5 px-2.5 text-right font-bold">{isUz ? 'Qoldiq' : 'Остаток'}</th>
                      <th className="py-1.5 px-2.5 text-right font-bold">{isUz ? 'Qadoq / Buyurtma' : 'Упак. / Заказ'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlySummaryRows.map(yr => {
                      const defPct = yr.qtyDist > 0 ? (yr.qtyDefect / yr.qtyDist) * 100 : 0;
                      const closePct = yr.qtyOrder > 0 ? (yr.qtyPack / yr.qtyOrder) * 100 : 0;
                      const isActiveYear = selectedYear === String(yr.year) && periodMode === 'yearly';
                      return (
                        <tr
                          key={yr.year}
                          onClick={() => {
                            setSelectedYear(String(yr.year));
                            setPeriodMode('yearly');
                            onChangeMonth('all');
                          }}
                          className={`border-b border-[#1e3a6e]/40 cursor-pointer transition-colors font-mono tabular-nums ${
                            isActiveYear ? 'bg-indigo-900/50' : 'hover:bg-[#132554]/80'
                          }`}
                        >
                          <td className="py-1.5 px-2.5 font-sans font-black text-cyan-300 flex items-center gap-1.5">
                            <span>{yr.year} {isUz ? 'yil' : 'г.'}</span>
                            {isActiveYear && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                          </td>
                          <td className="py-1.5 px-2.5 text-right text-white font-bold">{yr.orderSet.size}</td>
                          <td className="py-1.5 px-2.5 text-right text-white font-bold">{fmtSpaceInt(yr.qtyOrder)}</td>
                          <td className="py-1.5 px-2.5 text-right text-sky-300">{fmtDashInt(yr.qtyCut)}</td>
                          <td className="py-1.5 px-2.5 text-right text-slate-200">{fmtDashInt(yr.qtyDist)}</td>
                          <td className="py-1.5 px-2.5 text-right text-emerald-300 font-bold">{fmtDashInt(yr.qtyPack)}</td>
                          <td className={`py-1.5 px-2.5 text-right ${defPct >= 3.5 ? 'text-rose-400 font-bold' : 'text-slate-300'}`}>
                            {fmtDashInt(yr.qtyDefect)} ({fmtCommaPct(defPct)})
                          </td>
                          <td className="py-1.5 px-2.5 text-right text-amber-300">{fmtDashInt(yr.qtyShipped)}</td>
                          <td className="py-1.5 px-2.5 text-right text-amber-200 font-bold">{fmtDashInt(yr.qtyStock)}</td>
                          <td className={`py-1.5 px-2.5 text-right font-bold ${closePct >= 80 ? 'text-emerald-400' : 'text-sky-300'}`}>
                            {fmtCommaPct(closePct)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6 CHARTS GRID Header with Individual PDF & PNG Buttons */}
          <div ref={chartsRef} className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-200">
              {isUz ? 'GRAFIKLAR VA TAHLIL BLOKI' : 'ГРАФИКИ И АНАЛИТИКА'}
            </h3>
            <div className="flex items-center gap-2" data-no-capture="true">
              <button
                type="button"
                onClick={() =>
                  capturePngSection(
                    chartsRef,
                    `Grafiklar_${activeChartYear}`,
                    'charts',
                    'Grafiklar PNG yuklab olindi!',
                    'PNG графиков скачан!'
                  )
                }
                disabled={capturingPngKey === 'charts'}
                className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                <ImageDown className="w-3 h-3" />
                <span>{isUz ? 'Grafiklar PNG' : 'PNG Графиков'}</span>
              </button>
              <button
                type="button"
                onClick={handlePdfAnalyticsCharts}
                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                <FileText className="w-3 h-3" />
                <span>{isUz ? 'Grafiklar PDF' : 'PDF Графиков'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* CHART 1: Ishlab chiqarish bosqichlari */}
            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl p-4 shadow-lg flex flex-col">
              <h3 className="text-xs font-bold text-slate-100 mb-3">
                {isUz ? 'Ishlab chiqarish bosqichlari' : 'Этапы производства'}
              </h3>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stagesChartData} layout="vertical" margin={{ top: 5, right: 55, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e3a6e" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis
                      dataKey="name"
                      type="category"
                      tick={{ fill: '#cbd5e1', fontSize: 11, fontWeight: 600 }}
                      axisLine={false}
                      tickLine={false}
                      width={74}
                    />
                    <Tooltip cursor={{ fill: 'rgba(56,189,248,0.08)' }} content={<NavyTooltip suffix={unitLabel} />} />
                    <Bar dataKey="value" name={isUz ? 'Miqdor' : 'Кол-во'} radius={[0, 3, 3, 0]} barSize={20}>
                      {stagesChartData.map((entry, idx) => (
                        <Cell key={`stg-${idx}`} fill={entry.fill} />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="right"
                        formatter={(v: any) => fmtSpaceInt(Number(v) || 0)}
                        style={{ fill: '#f8fafc', fontSize: 11, fontWeight: 700 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* CHART 2: Oylar bo'yicha dinamika */}
            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl p-4 shadow-lg flex flex-col">
              <h3 className="text-xs font-bold text-slate-100 mb-2">
                {isUz
                  ? `Oylar bo'yicha dinamika (dona) — ${activeChartYear} yil`
                  : `Динамика по месяцам (шт) — ${activeChartYear} г.`}
              </h3>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyYearData} margin={{ top: 10, right: 10, left: 0, bottom: 18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e3a6e" vertical={false} />
                    <XAxis
                      dataKey="monthLabel"
                      tick={{ fill: '#cbd5e1', fontSize: 10 }}
                      axisLine={{ stroke: '#334155' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#94a3b8', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => fmtSpaceInt(v)}
                      width={52}
                    />
                    <Tooltip cursor={{ fill: 'rgba(56,189,248,0.08)' }} content={<NavyTooltip suffix={unitLabel} />} />
                    <Legend
                      verticalAlign="bottom"
                      height={22}
                      wrapperStyle={{ fontSize: '10px', color: '#e2e8f0', paddingTop: '6px' }}
                    />
                    <Bar dataKey="order" name={isUz ? 'Buyurtma' : 'Заказ'} fill="#3b82f6" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="pack" name={isUz ? 'Qadoq' : 'Упак.'} fill="#10b981" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="shipped" name={isUz ? "Jo'natildi" : 'Отгр.'} fill="#f59e0b" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* CHART 3: Top-10 zakaz — brak miqdori */}
            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl p-4 shadow-lg flex flex-col">
              <h3 className="text-xs font-bold text-slate-100 mb-3">
                {isUz ? 'Top-10 zakaz — brak miqdori (dona)' : 'Топ-10 заказов по браку (шт)'}
              </h3>
              <div className="h-60 w-full">
                {topDefectsData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    {isUz ? 'Tanlangan davrda brak qayd etilmagan' : 'За выбранный период брак не зафиксирован'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topDefectsData} layout="vertical" margin={{ top: 2, right: 44, left: 4, bottom: 2 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e3a6e" horizontal={false} />
                      <XAxis type="number" hide />
                      <YAxis
                        dataKey="name"
                        type="category"
                        tick={{ fill: '#cbd5e1', fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={88}
                      />
                      <Tooltip cursor={{ fill: 'rgba(244,63,94,0.1)' }} content={<NavyTooltip suffix={unitLabel} />} />
                      <Bar dataKey="defect" name={isUz ? 'Brak' : 'Брак'} fill="#f87171" radius={[0, 3, 3, 0]} barSize={14}>
                        <LabelList
                          dataKey="defect"
                          position="right"
                          formatter={(v: any) => fmtSpaceInt(Number(v) || 0)}
                          style={{ fill: '#f8fafc', fontSize: 10, fontWeight: 700 }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* CHART 4: Brak darajasi — oylar bo'yicha */}
            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl p-4 shadow-lg flex flex-col">
              <h3 className="text-xs font-bold text-slate-100 mb-2">
                {isUz ? "Brak darajasi — oylar bo'yicha (norma bilan)" : 'Уровень брака по месяцам (с нормой)'}
              </h3>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyYearData} margin={{ top: 18, right: 10, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e3a6e" vertical={false} />
                    <XAxis
                      dataKey="monthLabel"
                      tick={{ fill: '#cbd5e1', fontSize: 10 }}
                      axisLine={{ stroke: '#334155' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#94a3b8', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `${v}%`}
                      width={34}
                    />
                    <Tooltip cursor={{ fill: 'rgba(244,63,94,0.08)' }} content={<NavyTooltip suffix="%" />} />
                    <ReferenceLine
                      y={3.5}
                      stroke="#facc15"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      label={{ value: isUz ? 'Norma 3,5%' : 'Норма 3,5%', position: 'right', fill: '#facc15', fontSize: 10 }}
                    />
                    <Bar dataKey="defectPct" name={isUz ? 'Brak %' : 'Брак %'} fill="#f87171" radius={[3, 3, 0, 0]} barSize={22}>
                      <LabelList
                        dataKey="defectPct"
                        position="top"
                        formatter={(v: any) => (Number(v) > 0 ? fmtCommaPct(Number(v)) : '')}
                        style={{ fill: '#f8fafc', fontSize: 10, fontWeight: 700 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* CHART 5: Modellar bo'yicha qadoqlangan */}
            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl p-4 shadow-lg flex flex-col">
              <h3 className="text-xs font-bold text-slate-100 mb-2">
                {isUz ? "Modellar bo'yicha qadoqlangan (Top-5)" : 'Упаковано по моделям (Топ-5)'}
              </h3>
              <div className="h-60 w-full flex items-center">
                {topModelsPieData.length === 0 ? (
                  <div className="w-full text-center text-xs text-slate-400">
                    {isUz ? "Qadoqlash ma'lumotlari yo'q" : 'Нет данных по упаковке'}
                  </div>
                ) : (
                  <div className="w-full h-full grid grid-cols-12 items-center gap-2">
                    <div className="col-span-7 h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={topModelsPieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={42}
                            outerRadius={78}
                            dataKey="value"
                            paddingAngle={1}
                            labelLine={false}
                            label={(props: any) => {
                              const { cx, cy, midAngle, innerRadius, outerRadius, pct } = props;
                              if (!pct || pct < 5) return null;
                              const RADIAN = Math.PI / 180;
                              const r = innerRadius + (outerRadius - innerRadius) * 0.54;
                              const x = cx + r * Math.cos(-midAngle * RADIAN);
                              const y = cy + r * Math.sin(-midAngle * RADIAN);
                              return (
                                <text
                                  x={x}
                                  y={y}
                                  fill="#060f28"
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fontSize={10}
                                  fontWeight={900}
                                >
                                  {`${pct}%`}
                                </text>
                              );
                            }}
                          >
                            {topModelsPieData.map((entry, idx) => (
                              <Cell key={`mp-${idx}`} fill={entry.color} stroke="#0b1838" strokeWidth={2} />
                            ))}
                          </Pie>
                          <Tooltip content={<NavyTooltip suffix={unitLabel} />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="col-span-5 space-y-2 pr-1">
                      {topModelsPieData.map((m, idx) => (
                        <div key={`leg-${idx}`} className="flex items-center gap-1.5 text-[10px]">
                          <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: m.color }} />
                          <span className="text-slate-200 truncate font-medium" title={m.name}>
                            {m.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* CHART 6: Ogohlantirishlar va nazorat */}
            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl p-4 shadow-lg flex flex-col">
              <h3 className="text-xs font-bold text-slate-100 mb-3">
                {isUz ? 'Ogohlantirishlar va nazorat' : 'Предупреждения и контроль'}
              </h3>
              <div className="space-y-3 text-xs flex-1 justify-between flex flex-col">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                    <span>{isUz ? 'Brak normadan yuqori' : 'Брак выше нормы'}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 pl-4.5">
                    {alertsSummary.highDefectOrders.length > 0
                      ? isUz
                        ? `${alertsSummary.highDefectOrders.length} ta zakazda brak 3,5% dan yuqori. Eng yuqori: ${alertsSummary.highDefectOrders[0].orderNo} — ${fmtCommaPct(alertsSummary.highDefectOrders[0].defectPct)}.`
                        : `В ${alertsSummary.highDefectOrders.length} заказах брак >= 3,5%. Максимум: ${alertsSummary.highDefectOrders[0].orderNo} — ${fmtCommaPct(alertsSummary.highDefectOrders[0].defectPct)}.`
                      : isUz
                      ? "Barcha zakazlarda brak darajasi norma ichida (3,5% gacha)."
                      : 'Во всех заказах брак в пределах нормы (до 3,5%).'}
                  </p>
                </div>

                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                    <span>{isUz ? "Omborda jo'natilmagan mahsulot" : 'Неотгруженный остаток на складе'}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 pl-4.5">
                    {alertsSummary.stockOrders.length > 0
                      ? isUz
                        ? `${alertsSummary.stockOrders.length} ta zakazda jami ${fmtSpaceInt(kpiStats.qtyStock)} dona qadoqlangan mahsulot hali jo'natilmagan. Eng ko'p: ${alertsSummary.stockOrders[0].orderNo} (${fmtSpaceInt(alertsSummary.stockOrders[0].qtyStock)} dona).`
                        : `В ${alertsSummary.stockOrders.length} заказах на складе ${fmtSpaceInt(kpiStats.qtyStock)} шт. Максимум: ${alertsSummary.stockOrders[0].orderNo} (${fmtSpaceInt(alertsSummary.stockOrders[0].qtyStock)} шт).`
                      : isUz
                      ? "Barcha qadoqlangan mahsulotlar jo'natilgan."
                      : 'Вся упакованная продукция отгружена.'}
                  </p>
                </div>

                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shrink-0" />
                    <span>{isUz ? "Ma'lumotni tekshirish" : 'Проверка расхождений'}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 pl-4.5">
                    {alertsSummary.anomalyRows.length > 0
                      ? isUz
                        ? `${alertsSummary.anomalyRows.length} ta qatorda qadoq+brak taqsimotdan oshib ketgan.`
                        : `В ${alertsSummary.anomalyRows.length} строках упак.+брак превышают раздачу.`
                      : isUz
                      ? "Qadoq+brak taqsimotdan oshib ketgan qatorlar yo'q."
                      : 'Строк с превышением упаковки над раздачей нет.'}
                  </p>
                </div>

                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <span className="w-2.5 h-2.5 rounded-full bg-orange-400 shrink-0" />
                    <span>{isUz ? 'Qadoqlash boshlanmagan' : 'Упаковка не начата'}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 pl-4.5">
                    {alertsSummary.notPackedOrders.length > 0
                      ? isUz
                        ? `${alertsSummary.notPackedOrders.length} ta zakaz taqsimotda, lekin hali qadoqlanmagan. Birinchisi: ${alertsSummary.notPackedOrders[0].orderNo}.`
                        : `${alertsSummary.notPackedOrders.length} заказов в раздаче, но ещё без упаковки (${alertsSummary.notPackedOrders[0].orderNo}).`
                      : isUz
                      ? "Taqsimotdagi barcha zakazlarda qadoqlash boshlangan."
                      : 'По всем заказам в раздаче начата упаковка.'}
                  </p>
                </div>

                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-400 shrink-0" />
                    <span>{isUz ? 'Kroy buyurtmadan kam' : 'Крой меньше заказа'}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 pl-4.5">
                    {alertsSummary.lowCutOrders.length > 0
                      ? isUz
                        ? `${alertsSummary.lowCutOrders.length} ta zakazda kroy buyurtma miqdoridan kam. Birinchisi: ${alertsSummary.lowCutOrders[0].orderNo}.`
                        : `В ${alertsSummary.lowCutOrders.length} заказах крой меньше заказа (${alertsSummary.lowCutOrders[0].orderNo}).`
                      : isUz
                      ? "Barcha zakazlarda kroy buyurtma miqdorini to'liq qoplagan."
                      : 'По всем заказам крой полностью выполнен.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
          </div>

          {/* TABLE 1: ZAKAZLAR BO'YICHA JADVAL (with Individual PDF & PNG buttons!) */}
          <div ref={ordersTableRef} className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl overflow-hidden shadow-xl">
            <div className="px-4 py-2.5 bg-[#081330] border-b border-[#1e3a6e] flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-white">
                {isUz ? "ZAKAZLAR BO'YICHA JADVAL" : 'ТАБЛИЦА ПО ЗАКАЗАМ'}
              </h2>
              <div className="flex items-center gap-2.5" data-no-capture="true">
                <span className="text-[11px] italic text-slate-300">
                  {isUz
                    ? `Ko'rsatilmoqda: ${groupedOrdersTable.length} / ${groupedOrdersTable.length} zakaz`
                    : `Показано: ${groupedOrdersTable.length} / ${groupedOrdersTable.length} заказов`}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    capturePngSection(
                      ordersTableRef,
                      'Zakazlar_Jadvali',
                      'ordersTbl',
                      'Zakazlar jadvali PNG yuklab olindi!',
                      'PNG таблицы заказов скачан!'
                    )
                  }
                  disabled={capturingPngKey === 'ordersTbl'}
                  className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ImageDown className="w-3 h-3" />
                  <span>{isUz ? 'Zakazlar PNG' : 'PNG Заказов'}</span>
                </button>
                <button
                  type="button"
                  onClick={handlePdfOrdersTable}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3 h-3" />
                  <span>{isUz ? 'Zakazlar PDF' : 'PDF Заказов'}</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[54vh] overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#0d1f47] text-cyan-200 border-b border-[#1e3a6e]">
                  <tr className="text-[11px] font-bold">
                    <th className="py-2 px-2.5 text-left w-10">№</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Zakaz' : 'Заказ'}</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Model' : 'Модель'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Buyurtma' : 'Заказ'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Taqsimot' : 'Раздача'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Qadoq' : 'Упак.'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Brak' : 'Брак'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Brak %' : 'Брак %'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Qadoq / Buyurtma' : 'Упак. / Заказ'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? "Jo'natildi" : 'Отгр.'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Qoldiq' : 'Остаток'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? "Jo'nat. %" : 'Отгр. %'}</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Holat' : 'Статус'}</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  <tr className="bg-[#122658] text-white font-black border-b border-[#254580]">
                    <td className="py-2 px-2.5"></td>
                    <td className="py-2 px-2.5 font-sans">{isUz ? 'JAMI' : 'ИТОГО'}</td>
                    <td className="py-2 px-2.5"></td>
                    <td className="py-2 px-2.5 text-right">{fmtSpaceInt(kpiStats.qtyOrder)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtSpaceInt(kpiStats.qtyDist)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtSpaceInt(kpiStats.qtyPack)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtSpaceInt(kpiStats.qtyDefect)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtCommaPct(kpiStats.defectPct)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtCommaPct(kpiStats.packToOrderPct)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtSpaceInt(kpiStats.qtyShipped)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtSpaceInt(kpiStats.qtyStock)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtCommaPct(kpiStats.shippedToPackPct)}</td>
                    <td className="py-2 px-2.5 font-sans">
                      {isUz ? 'Zakazlar:' : 'Заказов:'} {kpiStats.ordersCount}
                    </td>
                  </tr>

                  {groupedOrdersTable.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-10 text-center text-slate-400 font-sans">
                        {isUz ? "Tanlangan filtr bo'yicha zakazlar topilmadi" : 'По выбранному фильтру заказы не найдены'}
                      </td>
                    </tr>
                  ) : (
                    groupedOrdersTable.map((ord, idx) => {
                      const isSelected = selectedOrderNo === ord.orderNo;
                      return (
                        <tr
                          key={`grp-${ord.orderNo}-${idx}`}
                          onClick={() => onChangeOrderNo(isSelected ? 'all' : ord.orderNo)}
                          className={`border-b border-[#1a2f5d]/70 cursor-pointer transition-colors ${
                            isSelected ? 'bg-cyan-900/40' : 'hover:bg-[#102048]'
                          }`}
                        >
                          <td className="py-1.5 px-2.5 text-slate-400">{idx + 1}</td>
                          <td className="py-1.5 px-2.5 font-sans font-black text-white whitespace-nowrap">{ord.orderNo}</td>
                          <td className="py-1.5 px-2.5 font-sans text-slate-200 whitespace-nowrap">{ord.model}</td>
                          <td className="py-1.5 px-2.5 text-right text-slate-100">{fmtDashInt(ord.qtyOrder)}</td>
                          <td className="py-1.5 px-2.5 text-right text-slate-100">{fmtDashInt(ord.qtyDist)}</td>
                          <td className="py-1.5 px-2.5 text-right text-white font-bold">{fmtDashInt(ord.qtyPack)}</td>
                          <td className="py-1.5 px-2.5 text-right text-slate-200">{fmtDashInt(ord.qtyDefect)}</td>
                          <td className={`py-1.5 px-2.5 text-right ${getDefectPctBg(ord.defectPct)}`}>
                            {fmtCommaPct(ord.defectPct)}
                          </td>
                          <td className={`py-1.5 px-2.5 text-right font-bold ${getClosePctBg(ord.packOrderPct)}`}>
                            {fmtCommaPct(ord.packOrderPct)}
                          </td>
                          <td className="py-1.5 px-2.5 text-right text-slate-100">{fmtDashInt(ord.qtyShipped)}</td>
                          <td className="py-1.5 px-2.5 text-right font-bold text-amber-300">{fmtDashInt(ord.qtyStock)}</td>
                          <td className="py-1.5 px-2.5 text-right text-slate-200">{fmtCommaPct(ord.shipPackPct)}</td>
                          <td className={`py-1.5 px-2.5 font-sans font-bold whitespace-nowrap ${ord.statusTone}`}>
                            {ord.statusLabel}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* TABLE 2: TANLANGAN ZAKAZ QATORLARI (with Individual PDF & PNG buttons!) */}
          <div ref={rowsTableRef} className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl overflow-hidden shadow-xl">
            <div className="px-4 py-2.5 bg-[#081330] border-b border-[#1e3a6e] flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-white">
                {isUz
                  ? "TANLANGAN ZAKAZ QATORLARI (rang / o'lcham bo'yicha)"
                  : 'СТРОКИ ВЫБРАННОГО ЗАКАЗА (по цвету / росту)'}
              </h2>
              <div className="flex items-center gap-2.5" data-no-capture="true">
                <span className="text-[11px] italic text-slate-300">
                  {isUz
                    ? `Ko'rsatilmoqda: ${scopedRows.length} / ${allRows.length} qator`
                    : `Показано: ${scopedRows.length} / ${allRows.length} строк`}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    capturePngSection(
                      rowsTableRef,
                      'Zakaz_Qatorlari',
                      'rowsTbl',
                      'Qatorlar jadvali PNG yuklab olindi!',
                      'PNG таблицы строк скачан!'
                    )
                  }
                  disabled={capturingPngKey === 'rowsTbl'}
                  className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ImageDown className="w-3 h-3" />
                  <span>{isUz ? 'Qatorlar PNG' : 'PNG Строк'}</span>
                </button>
                <button
                  type="button"
                  onClick={handlePdfOrderColorRows}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3 h-3" />
                  <span>{isUz ? 'Qatorlar PDF' : 'PDF Строк'}</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[54vh] overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#0d1f47] text-cyan-200 border-b border-[#1e3a6e]">
                  <tr className="text-[11px] font-bold">
                    <th className="py-2 px-2.5 text-left w-10">№</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Zakaz' : 'Заказ'}</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? "Rang / o'lcham" : 'Цвет / рост'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Buyurtma' : 'Заказ'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Taqsimot' : 'Раздача'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Qadoq' : 'Упак.'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Brak' : 'Брак'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Brak %' : 'Брак %'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? "Jo'natildi" : 'Отгр.'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Qoldiq' : 'Остаток'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Qadoq / Buyurtma' : 'Упак. / Заказ'}</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Oy' : 'Месяц'}</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Izoh' : 'Прим.'}</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {scopedRows.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-10 text-center text-slate-400 font-sans">
                        {isUz ? 'Qatorlar topilmadi' : 'Строки не найдены'}
                      </td>
                    </tr>
                  ) : (
                    scopedRows.map((row, idx) => {
                      const rowDefectPct =
                        row.qtyDistribution > 0 ? (row.qtyDefect / row.qtyDistribution) * 100 : 0;
                      const rowPackOrderPct = row.qtyOrder > 0 ? (row.qtyPackaging / row.qtyOrder) * 100 : 0;
                      const colorRostLabel = [row.color || (isUz ? 'Rangsiz' : 'Без цвета'), row.rost].filter(Boolean).join(' • ');

                      return (
                        <tr
                          key={`row-${row.id}`}
                          className="border-b border-[#1a2f5d]/70 hover:bg-[#102048] transition-colors"
                        >
                          <td className="py-1.5 px-2.5 text-slate-400">{idx + 1}</td>
                          <td className="py-1.5 px-2.5 font-sans font-black text-white whitespace-nowrap">
                            {row.orderNo || '—'}
                          </td>
                          <td className="py-1.5 px-2.5 font-sans text-slate-100 whitespace-nowrap">
                            {colorRostLabel}
                          </td>
                          <td className="py-1.5 px-2.5 text-right text-slate-100">{fmtDashInt(row.qtyOrder)}</td>
                          <td className="py-1.5 px-2.5 text-right text-slate-100">{fmtDashInt(row.qtyDistribution)}</td>
                          <td className="py-1.5 px-2.5 text-right text-white font-bold">{fmtDashInt(row.qtyPackaging)}</td>
                          <td className="py-1.5 px-2.5 text-right text-slate-200">{fmtDashInt(row.qtyDefect)}</td>
                          <td className={`py-1.5 px-2.5 text-right ${getDefectPctBg(rowDefectPct)}`}>
                            {fmtCommaPct(rowDefectPct)}
                          </td>
                          <td className="py-1.5 px-2.5 text-right text-slate-100">{fmtDashInt(row.qtyShipped)}</td>
                          <td className="py-1.5 px-2.5 text-right font-bold text-amber-300">{fmtDashInt(row.qtyStock)}</td>
                          <td className={`py-1.5 px-2.5 text-right font-bold ${getClosePctBg(rowPackOrderPct)}`}>
                            {fmtCommaPct(rowPackOrderPct)}
                          </td>
                          <td className="py-1.5 px-2.5 font-sans text-slate-200 whitespace-nowrap">{row.month}</td>
                          <td className="py-1.5 px-2.5 font-sans text-slate-300 truncate max-w-[160px]" title={row.notes}>
                            {row.notes || ''}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODE 2: FAQAT RAZMERLAR BO'YICHA (+ Interactive All-Stages Table!)
         ===================================================================== */}
      {monitorMode === 'razmerlar' && (
        <div className="space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-amber-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'FAOL RAZMERLAR' : 'АКТИВНЫЕ РАЗМЕРЫ'}
              </div>
              <div className="text-2xl sm:text-3xl font-black text-amber-300 mt-1.5 font-mono tabular-nums">
                {sizeAnalytics.rows.length}
              </div>
              <div className="text-[11px] text-slate-300 mt-2">
                {isUz ? 'Zakaz qatorlari:' : 'Строк заказов:'} <strong className="text-white">{scopedRows.length}</strong>
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-blue-500 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'RAZMER BUYURTMA' : 'ЗАКАЗ ПО РАЗМЕРАМ'}
              </div>
              <div className="text-2xl sm:text-3xl font-black text-white mt-1.5 font-mono tabular-nums">
                {fmtSpaceInt(sizeAnalytics.totals.order)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2">
                {isUz ? "O'lchamlar jami" : 'Сумма размерных ячеек'}
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-sky-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'RAZMER KROY' : 'КРОЙ ПО РАЗМЕРАМ'}
              </div>
              <div className="text-2xl sm:text-3xl font-black text-sky-300 mt-1.5 font-mono tabular-nums">
                {fmtSpaceInt(sizeAnalytics.totals.cut)}
              </div>
              <div className="text-[11px] text-sky-200 mt-2 font-bold">
                {isUz ? 'Buyurtmaga nisbatan:' : 'От заказа:'} {fmtCommaPct(sizeAnalytics.totalCutPct)}
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-teal-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'RAZMER TAQSIMOT' : 'РАЗДАЧА ПО РАЗМЕРАМ'}
              </div>
              <div className="text-2xl sm:text-3xl font-black text-teal-300 mt-1.5 font-mono tabular-nums">
                {fmtSpaceInt(sizeAnalytics.totals.dist)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2">
                {isUz ? 'Tikuv:' : 'Пошив:'} <strong className="text-white">{fmtSpaceInt(sizeAnalytics.totals.sew)}</strong>
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-emerald-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'RAZMER QADOQ' : 'УПАКОВКА ПО РАЗМЕРАМ'}
              </div>
              <div className="text-2xl sm:text-3xl font-black text-emerald-400 mt-1.5 font-mono tabular-nums">
                {fmtSpaceInt(sizeAnalytics.totals.pack)}
              </div>
              <div className="text-[11px] text-emerald-300 mt-2 font-bold">
                {isUz ? 'Yopilish:' : 'Закрытие:'} {fmtCommaPct(sizeAnalytics.totalClosePct)}
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-rose-500 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'RAZMER BRAK' : 'БРАК (ПО РАЗМЕРАМ)'}
              </div>
              <div className="text-2xl sm:text-3xl font-black text-rose-400 mt-1.5 font-mono tabular-nums">
                {fmtSpaceInt(kpiStats.qtyDefect)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2">
                {isUz ? 'Qoldiq (Buyurtma−Qadoq):' : 'Остаток:'}{' '}
                <strong className="text-amber-300">{fmtSpaceInt(sizeAnalytics.totals.rem)}</strong>
              </div>
            </div>
          </div>

          {/* Chart: Size-by-size comparison */}
          <div ref={sizeSummaryRef} className="space-y-4">
          <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl p-4 shadow-xl">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                <Ruler className="w-4 h-4 text-amber-400" />
                <span>
                  {isUz
                    ? "RAZMERLAR BO'YICHA BOSQICHLAR TAQQOSLASH GRAFIGI (Buyurtma / Kroy / Qadoq)"
                    : 'ДИАГРАММА ПО РАЗМЕРАМ (Заказ / Крой / Упаковка)'}
                </span>
              </h3>
              <button
                type="button"
                data-no-capture="true"
                onClick={() =>
                  capturePngSection(
                    sizeSummaryRef,
                    'Razmerlar_Hisobot',
                    'sizeSum',
                    'Razmerlar tahlili PNG yuklab olindi!',
                    'PNG аналитики по размерам скачан!'
                  )
                }
                disabled={capturingPngKey === 'sizeSum'}
                className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                <ImageDown className="w-3 h-3" />
                <span>{isUz ? 'Razmerlar PNG' : 'PNG Размеров'}</span>
              </button>
            </div>
            <div className="h-60 w-full">
              {sizeAnalytics.rows.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">
                  {isUz ? "Razmerlar bo'yicha ma'lumotlar yo'q" : 'Нет данных по размерам'}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sizeAnalytics.rows} margin={{ top: 10, right: 12, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e3a6e" vertical={false} />
                    <XAxis dataKey="size" tick={{ fill: '#f8fafc', fontSize: 11, fontWeight: 700 }} />
                    <YAxis
                      tick={{ fill: '#94a3b8', fontSize: 10 }}
                      tickFormatter={(v: number) => fmtSpaceInt(v)}
                      width={52}
                    />
                    <Tooltip cursor={{ fill: 'rgba(56,189,248,0.08)' }} content={<NavyTooltip suffix={unitLabel} />} />
                    <Legend verticalAlign="bottom" height={22} wrapperStyle={{ fontSize: '11px', color: '#e2e8f0' }} />
                    <Bar dataKey="order" name={isUz ? 'Buyurtma' : 'Заказ'} fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="cut" name={isUz ? 'Kroy' : 'Крой'} fill="#38bdf8" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="pack" name={isUz ? 'Qadoq' : 'Упаковка'} fill="#10b981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* NEW INTERACTIVE ALL-STAGES SIZE TABLE (2-rasm: Zakaz, Kroy, Razdacha, Poshiv, Upakovka, Brak ALL visible!) */}
          <div ref={allStagesSizesRef} className="bg-[#0b1838]/95 border border-cyan-500/40 rounded-xl overflow-hidden shadow-2xl">
            <div className="px-4 py-3 bg-[#081330] border-b border-[#1e3a6e] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  <span>
                    {isUz
                      ? 'HAR BIR ETAP UMUMIY KO‘RINADIGAN INTERAKTIV RAZMERLAR JADVALI'
                      : 'ИНТЕРАКТИВНАЯ ТАБЛИЦА РАЗМЕРОВ ПО ВСЕМ ЭТАПАМ (Заказ, Крой, Раздача, Пошив, Упак., Брак)'}
                  </span>
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {isUz
                    ? "Etap tugmalarini bosib ko'rinadigan bosqichlarni tanlang, razmer ustunini bosib filtrlang"
                    : 'Кликайте по этапам для настройки видимости и по заголовку размера для фильтрации'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {STAGE_DEFS.map(st => {
                  const isOn = visibleAllStages.includes(st.key);
                  return (
                    <button
                      key={`all-st-tog-${st.key}`}
                      type="button"
                      onClick={() => toggleAllStageVisibility(st.key)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all whitespace-nowrap shrink-0 ${
                        isOn
                          ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-black'
                          : 'bg-[#102048] text-slate-300 border-[#1e3a6e] hover:text-white'
                      }`}
                    >
                      {isUz ? st.uz : st.ru}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowBrakInSizeTable(prev => !prev)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all whitespace-nowrap shrink-0 ${
                    showBrakInSizeTable
                      ? 'bg-rose-500 text-white border-rose-400 font-black'
                      : 'bg-[#102048] text-slate-300 border-[#1e3a6e]'
                  }`}
                >
                  {isUz ? 'Brak' : 'Брак'}
                </button>
                <button
                  type="button"
                  onClick={() => setHideZeroRowsInSizeTable(prev => !prev)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all whitespace-nowrap shrink-0 ${
                    hideZeroRowsInSizeTable
                      ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/50'
                      : 'bg-[#102048] text-slate-300 border-[#1e3a6e]'
                  }`}
                >
                  {hideZeroRowsInSizeTable
                    ? isUz
                      ? 'Bo‘shlar yashirin'
                      : 'Пустые скрыты'
                    : isUz
                    ? 'Barcha qatorlar'
                    : 'Все строки'}
                </button>
                <button
                  type="button"
                  data-no-capture="true"
                  onClick={() =>
                    capturePngSection(
                      allStagesSizesRef,
                      'Razmerlar_Barcha_Etaplar',
                      'allStagesPng',
                      'Barcha etaplar razmer jadvali PNG yuklab olindi!',
                      'PNG таблицы размеров по всем этапам скачан!'
                    )
                  }
                  disabled={capturingPngKey === 'allStagesPng'}
                  className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ImageDown className="w-3 h-3" />
                  <span>{isUz ? 'Etaplar PNG' : 'PNG Этапов'}</span>
                </button>
                <button
                  type="button"
                  data-no-capture="true"
                  onClick={handlePdfAllStagesSizes}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3 h-3" />
                  <span>{isUz ? 'Etaplar PDF' : 'PDF Этапов'}</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[58vh] overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#0d1f47] text-cyan-200 border-b border-[#1e3a6e]">
                  <tr className="text-[11px] font-bold">
                    <th className="py-2 px-2.5 text-left w-10">№</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Zakaz' : 'Заказ'}</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Model' : 'Модель'}</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? "Rang / o'lcham" : 'Цвет / рост'}</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Etap' : 'Этап'}</th>
                    {sizeColumnsForMatrixTable.map(sz => (
                      <th
                        key={`all-sz-h-${sz}`}
                        onClick={() => setSelectedSizeFilter(prev => (prev === sz ? 'all' : sz))}
                        className={`py-2 px-2 text-right font-mono min-w-[54px] cursor-pointer hover:bg-[#16306b] transition-colors ${
                          selectedSizeFilter === sz ? 'bg-amber-500/30 text-amber-200' : 'text-amber-300'
                        }`}
                        title={isUz ? 'Razmer bo‘yicha filtrlash' : 'Фильтровать по размеру'}
                      >
                        {sz}
                      </th>
                    ))}
                    <th className="py-2 px-2.5 text-right bg-[#122658] text-white">
                      {isUz ? 'JAMI' : 'ВСЕГО'}
                    </th>
                    {showBrakInSizeTable && (
                      <th className="py-2 px-2.5 text-right bg-rose-950/60 text-rose-300">
                        {isUz ? 'Brak' : 'Брак'}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {interactiveSizeRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6 + sizeColumnsForMatrixTable.length + (showBrakInSizeTable ? 1 : 0)}
                        className="py-10 text-center text-slate-400 font-sans"
                      >
                        {isUz ? "Ma'lumot topilmadi" : 'Данные не найдены'}
                      </td>
                    </tr>
                  ) : (
                    interactiveSizeRows.map((row, rIdx) => {
                      const m = sizeMatrices[row.id];
                      const activeStageDefs = STAGE_DEFS.filter(s => visibleAllStages.includes(s.key));
                      return (
                        <React.Fragment key={`ast-${row.id}`}>
                          {activeStageDefs.map((st, stIdx) => {
                            let rowStageSum = 0;
                            sizeColumnsForMatrixTable.forEach(sz => {
                              rowStageSum += Number(m?.values?.[sz]?.[st.key]) || 0;
                            });
                            const isLastStage = stIdx === activeStageDefs.length - 1;
                            return (
                              <tr
                                key={`ast-${row.id}-${st.key}`}
                                className={`hover:bg-[#102048] transition-colors ${
                                  isLastStage ? 'border-b-2 border-[#254580]' : 'border-b border-[#1a2f5d]/60'
                                }`}
                              >
                                {stIdx === 0 && (
                                  <>
                                    <td
                                      rowSpan={activeStageDefs.length}
                                      className="py-1.5 px-2.5 text-slate-400 align-middle"
                                    >
                                      {rIdx + 1}
                                    </td>
                                    <td
                                      rowSpan={activeStageDefs.length}
                                      onClick={() =>
                                        onChangeOrderNo(selectedOrderNo === row.orderNo ? 'all' : row.orderNo)
                                      }
                                      className="py-1.5 px-2.5 font-sans font-black text-white whitespace-nowrap align-middle cursor-pointer hover:text-cyan-300"
                                    >
                                      {row.orderNo || '—'}
                                    </td>
                                    <td
                                      rowSpan={activeStageDefs.length}
                                      className="py-1.5 px-2.5 font-sans text-slate-200 whitespace-nowrap align-middle"
                                    >
                                      {row.model || '—'}
                                    </td>
                                    <td
                                      rowSpan={activeStageDefs.length}
                                      className="py-1.5 px-2.5 font-sans text-slate-100 whitespace-nowrap align-middle"
                                    >
                                      {[row.color || (isUz ? 'Rangsiz' : 'Без цвета'), row.rost]
                                        .filter(Boolean)
                                        .join(' • ')}
                                    </td>
                                  </>
                                )}
                                <td className={`py-1 px-2.5 font-sans whitespace-nowrap ${st.tone}`}>
                                  {isUz ? st.uz : st.ru}
                                </td>
                                {sizeColumnsForMatrixTable.map(sz => {
                                  const val = Number(m?.values?.[sz]?.[st.key]) || 0;
                                  return (
                                    <td key={`asc-${row.id}-${st.key}-${sz}`} className="py-1 px-2 text-right text-slate-200">
                                      {fmtDashInt(val)}
                                    </td>
                                  );
                                })}
                                <td className="py-1 px-2.5 text-right font-black text-amber-300 bg-[#0d1f47]/60">
                                  {fmtDashInt(rowStageSum)}
                                </td>
                                {stIdx === 0 && showBrakInSizeTable && (
                                  <td
                                    rowSpan={activeStageDefs.length}
                                    className="py-1.5 px-2.5 text-right font-black text-rose-400 bg-rose-950/20 align-middle"
                                  >
                                    {fmtDashInt(row.qtyDefect)}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
                {interactiveSizeRows.length > 0 && (
                  <tfoot className="bg-[#122658] border-t-2 border-cyan-500/40 font-mono tabular-nums font-black text-white">
                    {STAGE_DEFS.filter(s => visibleAllStages.includes(s.key)).map((st, idx, arr) => {
                      let grandSum = 0;
                      const sizeSums = sizeColumnsForMatrixTable.map(sz => {
                        const s = interactiveSizeRows.reduce(
                          (acc, r) => acc + (Number(sizeMatrices[r.id]?.values?.[sz]?.[st.key]) || 0),
                          0
                        );
                        grandSum += s;
                        return s;
                      });
                      const totalBrak = interactiveSizeRows.reduce((acc, r) => acc + (r.qtyDefect || 0), 0);
                      return (
                        <tr key={`ft-ast-${st.key}`} className="border-b border-[#1e3a6e]">
                          {idx === 0 && (
                            <td rowSpan={arr.length} colSpan={4} className="py-2 px-3 text-right font-sans">
                              {isUz ? 'JAMI (BARCHA ETAP):' : 'ИТОГО (ВСЕ ЭТАПЫ):'}
                            </td>
                          )}
                          <td className={`py-1.5 px-2.5 font-sans whitespace-nowrap ${st.tone}`}>
                            {isUz ? st.uz : st.ru}
                          </td>
                          {sizeSums.map((s, sIdx) => (
                            <td key={`fts-${st.key}-${sIdx}`} className="py-1.5 px-2 text-right text-cyan-200">
                              {fmtSpaceInt(s)}
                            </td>
                          ))}
                          <td className="py-1.5 px-2.5 text-right text-amber-300">{fmtSpaceInt(grandSum)}</td>
                          {idx === 0 && showBrakInSizeTable && (
                            <td rowSpan={arr.length} className="py-2 px-2.5 text-right text-rose-300 align-middle">
                              {fmtSpaceInt(totalBrak)}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Table 1: Aggregated strictly by Size (with individual PDF) */}
          <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl overflow-hidden shadow-xl">
            <div className="px-4 py-2.5 bg-[#081330] border-b border-[#1e3a6e] flex items-center justify-between gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-white">
                {isUz ? "RAZMERLAR BO'YICHA UMUMIY HISOB JADVALI" : 'СВОДНАЯ ТАБЛИЦА СТРОГО ПО РАЗМЕРАМ'}
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-amber-300 font-bold">
                  {sizeAnalytics.rows.length} {isUz ? 'ta razmer' : 'размеров'}
                </span>
                <button
                  type="button"
                  onClick={handlePdfSizeSummary}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3 h-3" />
                  <span>{isUz ? 'Razmerlar PDF' : 'PDF Размеров'}</span>
                </button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#0d1f47] text-cyan-200 border-b border-[#1e3a6e]">
                  <tr className="text-[11px] font-bold">
                    <th className="py-2 px-2.5 text-left w-10">№</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Razmer' : 'Размер'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Zakazlar' : 'Заказы'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Buyurtma' : 'Заказ'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Kroy' : 'Крой'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Kroy %' : 'Крой %'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Taqsimot' : 'Раздача'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Tikuv' : 'Пошив'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Qadoq' : 'Упак.'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Qoldiq (Zakaz−Qadoq)' : 'Остаток'}</th>
                    <th className="py-2 px-2.5 text-right">{isUz ? 'Qadoq / Buyurtma' : 'Упак. / Заказ'}</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  <tr className="bg-[#122658] text-white font-black border-b border-[#254580]">
                    <td className="py-2 px-2.5"></td>
                    <td className="py-2 px-2.5 font-sans">{isUz ? 'JAMI (RAZMERLAR)' : 'ИТОГО (РАЗМЕРЫ)'}</td>
                    <td className="py-2 px-2.5 text-right">{kpiStats.ordersCount}</td>
                    <td className="py-2 px-2.5 text-right">{fmtSpaceInt(sizeAnalytics.totals.order)}</td>
                    <td className="py-2 px-2.5 text-right text-sky-300">{fmtSpaceInt(sizeAnalytics.totals.cut)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtCommaPct(sizeAnalytics.totalCutPct)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtSpaceInt(sizeAnalytics.totals.dist)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtSpaceInt(sizeAnalytics.totals.sew)}</td>
                    <td className="py-2 px-2.5 text-right text-emerald-300">{fmtSpaceInt(sizeAnalytics.totals.pack)}</td>
                    <td className="py-2 px-2.5 text-right text-amber-300">{fmtSpaceInt(sizeAnalytics.totals.rem)}</td>
                    <td className="py-2 px-2.5 text-right">{fmtCommaPct(sizeAnalytics.totalClosePct)}</td>
                  </tr>
                  {sizeAnalytics.rows.map((szRow, idx) => (
                    <tr
                      key={`sz-agg-${szRow.size}`}
                      onClick={() =>
                        setSelectedSizeFilter(prev => (prev === szRow.size ? 'all' : szRow.size))
                      }
                      className={`border-b border-[#1a2f5d]/70 cursor-pointer transition-colors ${
                        selectedSizeFilter === szRow.size ? 'bg-amber-900/35' : 'hover:bg-[#102048]'
                      }`}
                    >
                      <td className="py-1.5 px-2.5 text-slate-400">{idx + 1}</td>
                      <td className="py-1.5 px-2.5 font-black text-amber-300">{szRow.size}</td>
                      <td className="py-1.5 px-2.5 text-right text-slate-300">{szRow.ordersCount}</td>
                      <td className="py-1.5 px-2.5 text-right text-white font-bold">{fmtDashInt(szRow.order)}</td>
                      <td className="py-1.5 px-2.5 text-right text-sky-300">{fmtDashInt(szRow.cut)}</td>
                      <td className="py-1.5 px-2.5 text-right text-slate-200">{fmtCommaPct(szRow.cutPct)}</td>
                      <td className="py-1.5 px-2.5 text-right text-slate-100">{fmtDashInt(szRow.dist)}</td>
                      <td className="py-1.5 px-2.5 text-right text-slate-100">{fmtDashInt(szRow.sew)}</td>
                      <td className="py-1.5 px-2.5 text-right text-emerald-300 font-bold">{fmtDashInt(szRow.pack)}</td>
                      <td className="py-1.5 px-2.5 text-right text-amber-300 font-bold">{fmtDashInt(szRow.rem)}</td>
                      <td className={`py-1.5 px-2.5 text-right font-bold ${getClosePctBg(szRow.closePct)}`}>
                        {fmtCommaPct(szRow.closePct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 2: Single-stage Horizontal Size Matrix */}
          <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl overflow-hidden shadow-xl">
            <div className="px-4 py-2.5 bg-[#081330] border-b border-[#1e3a6e] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h2 className="text-xs font-black uppercase tracking-wider text-white">
                  {isUz
                    ? 'ZAKAZ VA RANG BO‘YICHA RAZMERLAR MATRITSASI'
                    : 'МАТРИЦА РАЗМЕРОВ ПО ЗАКАЗАМ И ЦВЕТАМ'}
                </h2>
              </div>

              <div className="flex items-center gap-1 flex-wrap">
                {STAGE_DEFS.map(st => (
                  <button
                    key={`st-pill-${st.key}`}
                    type="button"
                    onClick={() => setSizeStage(st.key)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                      sizeStage === st.key
                        ? 'bg-amber-400 text-slate-950 font-black'
                        : 'bg-[#102048] text-slate-300 hover:text-white'
                    }`}
                  >
                    {isUz ? st.uz : st.ru}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto max-h-[52vh] overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#0d1f47] text-cyan-200 border-b border-[#1e3a6e]">
                  <tr className="text-[11px] font-bold">
                    <th className="py-2 px-2.5 text-left">№</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Zakaz' : 'Заказ'}</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? 'Model' : 'Модель'}</th>
                    <th className="py-2 px-2.5 text-left">{isUz ? "Rang / o'lcham" : 'Цвет / рост'}</th>
                    {sizeColumnsForMatrixTable.map(sz => (
                      <th key={`mh-${sz}`} className="py-2 px-2 text-right font-mono text-amber-300 min-w-[54px]">
                        {sz}
                      </th>
                    ))}
                    <th className="py-2 px-2.5 text-right bg-[#122658] text-white">
                      {isUz ? 'JAMI' : 'ВСЕГО'}
                    </th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {interactiveSizeRows.map((row, idx) => {
                    const m = sizeMatrices[row.id];
                    let rowSum = 0;
                    return (
                      <tr key={`mr-${row.id}`} className="border-b border-[#1a2f5d]/70 hover:bg-[#102048]">
                        <td className="py-1.5 px-2.5 text-slate-400">{idx + 1}</td>
                        <td className="py-1.5 px-2.5 font-sans font-black text-white whitespace-nowrap">
                          {row.orderNo || '—'}
                        </td>
                        <td className="py-1.5 px-2.5 font-sans text-slate-200 whitespace-nowrap">
                          {row.model || '—'}
                        </td>
                        <td className="py-1.5 px-2.5 font-sans text-slate-100 whitespace-nowrap">
                          {[row.color || (isUz ? 'Rangsiz' : 'Без цвета'), row.rost].filter(Boolean).join(' • ')}
                        </td>
                        {sizeColumnsForMatrixTable.map(sz => {
                          const v = Number(m?.values?.[sz]?.[sizeStage]) || 0;
                          rowSum += v;
                          return (
                            <td key={`mc-${row.id}-${sz}`} className="py-1.5 px-2 text-right text-slate-200">
                              {fmtDashInt(v)}
                            </td>
                          );
                        })}
                        <td className="py-1.5 px-2.5 text-right font-black text-amber-300 bg-[#0d1f47]/60">
                          {fmtDashInt(rowSum)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODE 3: FARQLAR VA PRIMECHANIYA (Kroy−Razd, Razd−Poshiv, Poshiv−Upak 1-sort & (1-sort+Brak))
         ===================================================================== */}
      {monitorMode === 'farqlar' && (
        <div ref={farqlarRef} className="space-y-4">
          {/* 5 Difference KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-sky-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'KROY − RAZDACHA FARQI' : 'РАЗНИЦА КРОЙ − РАЗДАЧА'}
              </div>
              <div className={`text-2xl font-black mt-1.5 font-mono tabular-nums ${getDiffBadgeClass(kpiStats.diffCutDist)}`}>
                {fmtSpaceInt(kpiStats.diffCutDist)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2">
                {fmtSpaceInt(kpiStats.qtyCut)} − {fmtSpaceInt(kpiStats.qtyDist)}
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-teal-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'RAZDACHA − POSHIV FARQI' : 'РАЗНИЦА РАЗДАЧА − ПОШИВ'}
              </div>
              <div className={`text-2xl font-black mt-1.5 font-mono tabular-nums ${getDiffBadgeClass(kpiStats.diffDistSew)}`}>
                {fmtSpaceInt(kpiStats.diffDistSew)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2">
                {fmtSpaceInt(kpiStats.qtyDist)} − {fmtSpaceInt(kpiStats.qtySew)}
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-emerald-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'POSHIV − UPAKOVKA (1-SORT)' : 'ПОШИВ − УПАКОВКА (1-СОРТ)'}
              </div>
              <div className={`text-2xl font-black mt-1.5 font-mono tabular-nums ${getDiffBadgeClass(kpiStats.diffSewPack1)}`}>
                {fmtSpaceInt(kpiStats.diffSewPack1)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2">
                {fmtSpaceInt(kpiStats.qtySew)} − {fmtSpaceInt(kpiStats.qtyPack)}
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-amber-400 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'POSHIV − (1-SORT + BRAK)' : 'ПОШИВ − (1-СОРТ + БРАК)'}
              </div>
              <div className={`text-2xl font-black mt-1.5 font-mono tabular-nums ${getDiffBadgeClass(kpiStats.diffSewTotalPack)}`}>
                {fmtSpaceInt(kpiStats.diffSewTotalPack)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2">
                {fmtSpaceInt(kpiStats.qtySew)} − {fmtSpaceInt(kpiStats.totalPackWithBrak)}
              </div>
            </div>

            <div className="bg-[#0b1838]/95 border border-[#1e3a6e] border-t-2 border-t-rose-500 rounded-lg p-3.5 shadow-lg">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                {isUz ? 'JAMI BRAK (UMUMIY)' : 'ВСЕГО БРАК'}
              </div>
              <div className="text-2xl font-black text-rose-400 mt-1.5 font-mono tabular-nums">
                {fmtSpaceInt(kpiStats.qtyDefect)}
              </div>
              <div className="text-[11px] text-slate-300 mt-2">
                {isUz ? '1-sort + Brak:' : '1-сорт + Брак:'} <strong className="text-white">{fmtSpaceInt(kpiStats.totalPackWithBrak)}</strong>
              </div>
            </div>
          </div>

          {/* Table 1: Grouped by Order Differences + Per-Order PDF */}
          <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl overflow-hidden shadow-xl">
            <div className="px-4 py-2.5 bg-[#081330] border-b border-[#1e3a6e] flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-white">
                {isUz ? "ZAKAZLAR KESIMIDA BOSQICH FARQLARI VA PRIMECHANIYA" : 'РАЗНИЦЫ ПО ЭТАПАМ В РАЗРЕЗЕ ЗАКАЗОВ И ПРИМЕЧАНИЯ'}
              </h2>
              <div className="flex items-center gap-2" data-no-capture="true">
                <button
                  type="button"
                  onClick={() =>
                    capturePngSection(
                      farqlarRef,
                      'Farqlar_Primechaniya',
                      'farqlarPng',
                      'Farqlar va Primechaniya PNG yuklab olindi!',
                      'PNG разниц и примечаний скачан!'
                    )
                  }
                  disabled={capturingPngKey === 'farqlarPng'}
                  className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <ImageDown className="w-3 h-3" />
                  <span>{isUz ? 'Farqlar PNG' : 'PNG Разниц'}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handlePdfDifferencesAndNotes(
                      scopedRows,
                      isUz ? 'BOSQICHLAR FARQI VA PRIMECHANIYA — BARCHA ZAKAZLAR' : 'РАЗНИЦЫ ПО ЭТАПАМ И ПРИМЕЧАНИЯ — ВСЕ ЗАКАЗЫ',
                      `Farqlar_Barcha_${new Date().toISOString().split('T')[0]}.pdf`
                    )
                  }
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3 h-3" />
                  <span>{isUz ? 'Barchasi Farqlar + Primechaniya PDF' : 'PDF Все разницы и примечания'}</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[45vh] overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#0d1f47] text-cyan-200 border-b border-[#1e3a6e]">
                  <tr className="text-[11px] font-bold">
                    <th className="py-2 px-2 text-left">№</th>
                    <th className="py-2 px-2 text-left">{isUz ? 'Zakaz' : 'Заказ'}</th>
                    <th className="py-2 px-2 text-left">{isUz ? 'Model' : 'Модель'}</th>
                    <th className="py-2 px-2 text-right">{isUz ? 'Kroy' : 'Крой'}</th>
                    <th className="py-2 px-2 text-right">{isUz ? 'Razdacha' : 'Раздача'}</th>
                    <th className="py-2 px-2 text-right bg-sky-950/50">{isUz ? 'Kroy−Razd' : 'Крой−Разд'}</th>
                    <th className="py-2 px-2 text-right">{isUz ? 'Poshiv' : 'Пошив'}</th>
                    <th className="py-2 px-2 text-right bg-teal-950/50">{isUz ? 'Razd−Posh' : 'Разд−Пош'}</th>
                    <th className="py-2 px-2 text-right">{isUz ? 'Upak (1-s)' : 'Уп (1-с)'}</th>
                    <th className="py-2 px-2 text-right bg-emerald-950/50">{isUz ? 'Posh−Up(1s)' : 'Пош−Уп(1с)'}</th>
                    <th className="py-2 px-2 text-right text-rose-300">{isUz ? 'Brak' : 'Брак'}</th>
                    <th className="py-2 px-2 text-right">{isUz ? '1s+Brak' : '1с+Брак'}</th>
                    <th className="py-2 px-2 text-right bg-amber-950/50">{isUz ? 'Posh−(1s+Br)' : 'Пош−(1с+Бр)'}</th>
                    <th className="py-2 px-2 text-left">{isUz ? 'Primechaniya' : 'Примечание'}</th>
                    <th className="py-2 px-2 text-center">PDF</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {groupedOrdersTable.map((ord, idx) => (
                    <tr
                      key={`df-ord-${ord.orderNo}-${idx}`}
                      className="border-b border-[#1a2f5d]/70 hover:bg-[#102048] transition-colors"
                    >
                      <td className="py-1.5 px-2 text-slate-400">{idx + 1}</td>
                      <td className="py-1.5 px-2 font-sans font-black text-white whitespace-nowrap">{ord.orderNo}</td>
                      <td className="py-1.5 px-2 font-sans text-slate-200 whitespace-nowrap">{ord.model}</td>
                      <td className="py-1.5 px-2 text-right">{fmtDashInt(ord.qtyCut)}</td>
                      <td className="py-1.5 px-2 text-right">{fmtDashInt(ord.qtyDist)}</td>
                      <td className={`py-1.5 px-2 text-right bg-sky-950/25 ${getDiffBadgeClass(ord.diffCutDist)}`}>
                        {fmtSpaceInt(ord.diffCutDist)}
                      </td>
                      <td className="py-1.5 px-2 text-right">{fmtDashInt(ord.qtySew)}</td>
                      <td className={`py-1.5 px-2 text-right bg-teal-950/25 ${getDiffBadgeClass(ord.diffDistSew)}`}>
                        {fmtSpaceInt(ord.diffDistSew)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-emerald-300 font-bold">{fmtDashInt(ord.qtyPack)}</td>
                      <td className={`py-1.5 px-2 text-right bg-emerald-950/25 ${getDiffBadgeClass(ord.diffSewPack1)}`}>
                        {fmtSpaceInt(ord.diffSewPack1)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-rose-400 font-bold">{fmtDashInt(ord.qtyDefect)}</td>
                      <td className="py-1.5 px-2 text-right text-white font-bold">{fmtDashInt(ord.totalPackWithBrak)}</td>
                      <td className={`py-1.5 px-2 text-right bg-amber-950/25 ${getDiffBadgeClass(ord.diffSewTotalPack)}`}>
                        {fmtSpaceInt(ord.diffSewTotalPack)}
                      </td>
                      <td className="py-1.5 px-2 font-sans text-slate-200 max-w-[180px] truncate" title={ord.notesList.join(' | ')}>
                        {ord.notesList.join('; ') || '—'}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            handlePdfDifferencesAndNotes(
                              ord.rows,
                              `${isUz ? 'ZAKAZ FARQLARI VA PRIMECHANIYA' : 'РАЗНИЦЫ И ПРИМЕЧАНИЯ ПО ЗАКАЗУ'}: ${ord.orderNo}`,
                              `Farqlar_${ord.orderNo}_${new Date().toISOString().split('T')[0]}.pdf`
                            )
                          }
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white font-sans font-bold rounded text-[10px] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <FileText className="w-3 h-3" />
                          <span>PDF</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 2: Per-Order + Per-Color Detailed Differences + Primechaniya + Individual PDF per Color! */}
          <div className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-xl overflow-hidden shadow-xl">
            <div className="px-4 py-2.5 bg-[#081330] border-b border-[#1e3a6e] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-cyan-400" />
                <h2 className="text-xs font-black uppercase tracking-wider text-white">
                  {isUz
                    ? "HAR BIR ZAKAZ VA RANG BO‘YICHA FARQLAR HAMDA PRIMECHANIYA PDF"
                    : 'РАЗНИЦЫ И ПРИМЕЧАНИЯ ПО КАЖДОМУ ЗАКАЗУ И ЦВЕТУ (PDF)'}
                </h2>
              </div>
              <span className="text-[11px] text-slate-300">
                {scopedRows.length} {isUz ? 'ta qator' : 'строк'}
              </span>
            </div>

            <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#0d1f47] text-cyan-200 border-b border-[#1e3a6e]">
                  <tr className="text-[11px] font-bold">
                    <th className="py-2 px-2 text-left">№</th>
                    <th className="py-2 px-2 text-left">{isUz ? 'Zakaz' : 'Заказ'}</th>
                    <th className="py-2 px-2 text-left">{isUz ? 'Rang / Rost' : 'Цвет / Рост'}</th>
                    <th className="py-2 px-2 text-right">{isUz ? 'Kroy' : 'Крой'}</th>
                    <th className="py-2 px-2 text-right">{isUz ? 'Razdacha' : 'Раздача'}</th>
                    <th className="py-2 px-2 text-right bg-sky-950/50">{isUz ? 'Kroy−Razd' : 'Крой−Разд'}</th>
                    <th className="py-2 px-2 text-right">{isUz ? 'Poshiv' : 'Пошив'}</th>
                    <th className="py-2 px-2 text-right bg-teal-950/50">{isUz ? 'Razd−Posh' : 'Разд−Пош'}</th>
                    <th className="py-2 px-2 text-right">{isUz ? 'Upak (1-s)' : 'Уп (1-с)'}</th>
                    <th className="py-2 px-2 text-right bg-emerald-950/50">{isUz ? 'Posh−Up(1s)' : 'Пош−Уп(1с)'}</th>
                    <th className="py-2 px-2 text-right text-rose-300">{isUz ? 'Brak' : 'Брак'}</th>
                    <th className="py-2 px-2 text-right">{isUz ? '1s+Brak' : '1с+Брак'}</th>
                    <th className="py-2 px-2 text-right bg-amber-950/50">{isUz ? 'Posh−(1s+Br)' : 'Пош−(1с+Бр)'}</th>
                    <th className="py-2 px-2 text-left">{isUz ? 'Primechaniya' : 'Примечание'}</th>
                    <th className="py-2 px-2 text-center">{isUz ? 'Rang PDF' : 'PDF Цвета'}</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {scopedRows.map((r, idx) => {
                    const cut = r.qtyCut || 0;
                    const dist = r.qtyDistribution || 0;
                    const sew = r.qtySewing || 0;
                    const pack = r.qtyPackaging || 0;
                    const brak = r.qtyDefect || 0;
                    const totPack = pack + brak;
                    const dCutDist = cut - dist;
                    const dDistSew = dist - sew;
                    const dSewPack1 = sew - pack;
                    const dSewTot = sew - totPack;
                    const colorLabel = [r.color || (isUz ? 'Rangsiz' : 'Без цвета'), r.rost].filter(Boolean).join(' • ');

                    return (
                      <tr
                        key={`df-row-${r.id}`}
                        className="border-b border-[#1a2f5d]/70 hover:bg-[#102048] transition-colors"
                      >
                        <td className="py-1.5 px-2 text-slate-400">{idx + 1}</td>
                        <td className="py-1.5 px-2 font-sans font-black text-white whitespace-nowrap">
                          {r.orderNo || '—'}
                        </td>
                        <td className="py-1.5 px-2 font-sans text-cyan-200 whitespace-nowrap font-bold">
                          {colorLabel}
                        </td>
                        <td className="py-1.5 px-2 text-right">{fmtDashInt(cut)}</td>
                        <td className="py-1.5 px-2 text-right">{fmtDashInt(dist)}</td>
                        <td className={`py-1.5 px-2 text-right bg-sky-950/25 ${getDiffBadgeClass(dCutDist)}`}>
                          {fmtSpaceInt(dCutDist)}
                        </td>
                        <td className="py-1.5 px-2 text-right">{fmtDashInt(sew)}</td>
                        <td className={`py-1.5 px-2 text-right bg-teal-950/25 ${getDiffBadgeClass(dDistSew)}`}>
                          {fmtSpaceInt(dDistSew)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-emerald-300 font-bold">{fmtDashInt(pack)}</td>
                        <td className={`py-1.5 px-2 text-right bg-emerald-950/25 ${getDiffBadgeClass(dSewPack1)}`}>
                          {fmtSpaceInt(dSewPack1)}
                        </td>
                        <td className="py-1.5 px-2 text-right text-rose-400 font-bold">{fmtDashInt(brak)}</td>
                        <td className="py-1.5 px-2 text-right text-white font-bold">{fmtDashInt(totPack)}</td>
                        <td className={`py-1.5 px-2 text-right bg-amber-950/25 ${getDiffBadgeClass(dSewTot)}`}>
                          {fmtSpaceInt(dSewTot)}
                        </td>
                        <td className="py-1.5 px-2 font-sans text-slate-200 max-w-[200px] truncate" title={r.notes}>
                          {r.notes || '—'}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              handlePdfDifferencesAndNotes(
                                [r],
                                `${r.orderNo} — ${colorLabel} (${isUz ? 'Farqlar va Primechaniya' : 'Разницы и Примечание'})`,
                                `Farqlar_${r.orderNo}_${r.color || 'color'}_${new Date().toISOString().split('T')[0]}.pdf`
                              )
                            }
                            className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white font-sans font-bold rounded text-[10px] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <FileText className="w-3 h-3" />
                            <span>PDF</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
