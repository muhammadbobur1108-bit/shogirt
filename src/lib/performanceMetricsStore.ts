import { FactoryLedgerRow } from './ordersSizeStore';
import { PackingListRow, WaybillDocument } from './nakladnoyStore';

export interface DailyLedgerSnapshot {
  dateIso: string; // YYYY-MM-DD
  totalOrder: number;
  totalCut: number;
  totalDistribution: number;
  totalSewing: number;
  totalPackaging: number;
  totalDefect: number;
  totalShipped: number;
  updatedAt: string;
}

export interface ManualDailyShiftLog {
  dateIso: string; // YYYY-MM-DD
  cut: number;
  sewing: number;
  packaging: number;
  shipped: number;
  defectQty: number;
  note?: string;
  updatedAt: string;
}

export interface DailyPerformancePoint {
  dateIso: string;
  dateLabel: string; // DD.MM
  cut: number;
  sewing: number;
  packaging: number;
  shipped: number;
  defectQty: number;
  defectRate: number; // %
  throughputTotal: number;
  hasActivity: boolean;
}

export interface PerformanceSummary {
  points: DailyPerformancePoint[];
  hasAnyData: boolean;
  activeDaysCount: number;
  totalCutPeriod: number;
  totalSewingPeriod: number;
  totalPackagingPeriod: number;
  totalShippedPeriod: number;
  totalDefectPeriod: number;
  avgDailyThroughput: number;
  peakDailyThroughput: number;
  peakDateLabel: string;
  overallDefectRate: number;
  waybillsInPeriod: number;
  currentLedgerTotals: {
    orderQty: number;
    cutQty: number;
    distQty: number;
    sewQty: number;
    packQty: number;
    defectQty: number;
    shippedQty: number;
  };
}

const SNAPSHOTS_KEY = 'tex_erp_daily_snapshots_v1';
const MANUAL_LOGS_KEY = 'tex_erp_manual_daily_logs_v1';
export const PERFORMANCE_LOGS_UPDATED_EVENT = 'tex-erp-performance-logs-updated';

export function toLocalDateIso(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseFlexibleDateToIso(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // YYYY-MM-DD or ISO timestamp
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // DD.MM.YYYY
  const ruMatch = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (ruMatch) {
    return `${ruMatch[3]}-${ruMatch[2]}-${ruMatch[1]}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return toLocalDateIso(parsed);
  }
  return null;
}

export function loadDailySnapshots(): DailyLedgerSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordTodayLedgerSnapshot(ledgerRows: FactoryLedgerRow[]): DailyLedgerSnapshot[] {
  const todayIso = toLocalDateIso();
  const existing = loadDailySnapshots();

  if (ledgerRows.length === 0) {
    return existing;
  }

  const totals = ledgerRows.reduce(
    (acc, r) => {
      acc.totalOrder += Number(r.qtyOrder) || 0;
      acc.totalCut += Number(r.qtyCut) || 0;
      acc.totalDistribution += Number(r.qtyDistribution) || 0;
      acc.totalSewing += Number(r.qtySewing) || 0;
      acc.totalPackaging += Number(r.qtyPackaging) || 0;
      acc.totalDefect += Number(r.qtyDefect) || 0;
      acc.totalShipped += Number(r.qtyShipped) || 0;
      return acc;
    },
    {
      totalOrder: 0,
      totalCut: 0,
      totalDistribution: 0,
      totalSewing: 0,
      totalPackaging: 0,
      totalDefect: 0,
      totalShipped: 0
    }
  );

  const hasNonZero =
    totals.totalOrder > 0 ||
    totals.totalCut > 0 ||
    totals.totalSewing > 0 ||
    totals.totalPackaging > 0 ||
    totals.totalDefect > 0 ||
    totals.totalShipped > 0;

  if (!hasNonZero) return existing;

  const snap: DailyLedgerSnapshot = {
    dateIso: todayIso,
    ...totals,
    updatedAt: new Date().toISOString()
  };

  const idx = existing.findIndex(s => s.dateIso === todayIso);
  const next =
    idx >= 0
      ? existing.map((s, i) => (i === idx ? snap : s))
      : [...existing, snap].sort((a, b) => a.dateIso.localeCompare(b.dateIso)).slice(-90);

  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(next));
  } catch {
    // ignore storage write errors
  }

  return next;
}

export function loadManualDailyLogs(): ManualDailyShiftLog[] {
  try {
    const raw = localStorage.getItem(MANUAL_LOGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveManualDailyLog(entry: Omit<ManualDailyShiftLog, 'updatedAt'>): ManualDailyShiftLog[] {
  const existing = loadManualDailyLogs();
  const nextItem: ManualDailyShiftLog = {
    dateIso: entry.dateIso,
    cut: Math.max(0, Math.round(Number(entry.cut) || 0)),
    sewing: Math.max(0, Math.round(Number(entry.sewing) || 0)),
    packaging: Math.max(0, Math.round(Number(entry.packaging) || 0)),
    shipped: Math.max(0, Math.round(Number(entry.shipped) || 0)),
    defectQty: Math.max(0, Math.round(Number(entry.defectQty) || 0)),
    note: entry.note?.trim() || undefined,
    updatedAt: new Date().toISOString()
  };

  const idx = existing.findIndex(item => item.dateIso === nextItem.dateIso);
  const next =
    idx >= 0
      ? existing.map((item, i) => (i === idx ? nextItem : item))
      : [...existing, nextItem].sort((a, b) => a.dateIso.localeCompare(b.dateIso));

  try {
    localStorage.setItem(MANUAL_LOGS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(PERFORMANCE_LOGS_UPDATED_EVENT));
  } catch {
    // ignore storage errors
  }

  return next;
}

export function buildPerformanceSummary(params: {
  days: number;
  ledgerRows: FactoryLedgerRow[];
  packingRows: PackingListRow[];
  waybills: WaybillDocument[];
  snapshots: DailyLedgerSnapshot[];
  manualLogs: ManualDailyShiftLog[];
}): PerformanceSummary {
  const { days, ledgerRows, packingRows, waybills, snapshots, manualLogs } = params;
  const safeDays = Math.max(7, Math.min(30, days));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build ordered date buckets for last N days
  const dateBuckets: { dateIso: string; dateLabel: string }[] = [];
  for (let offset = safeDays - 1; offset >= 0; offset--) {
    const d = new Date(today);
    d.setDate(today.getDate() - offset);
    const iso = toLocalDateIso(d);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    dateBuckets.push({ dateIso: iso, dateLabel: `${dd}.${mm}` });
  }
  const bucketSet = new Set(dateBuckets.map(b => b.dateIso));

  // Index manual logs by dateIso
  const manualMap = new Map<string, ManualDailyShiftLog>();
  manualLogs.forEach(log => {
    manualMap.set(log.dateIso, log);
  });

  // Compute snapshot daily deltas
  const sortedSnaps = [...snapshots].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  const snapDeltaMap = new Map<
    string,
    { cut: number; sewing: number; packaging: number; shipped: number; defectQty: number }
  >();

  sortedSnaps.forEach((snap, idx) => {
    if (idx === 0) {
      snapDeltaMap.set(snap.dateIso, {
        cut: snap.totalCut,
        sewing: snap.totalSewing,
        packaging: snap.totalPackaging,
        shipped: snap.totalShipped,
        defectQty: snap.totalDefect
      });
    } else {
      const prev = sortedSnaps[idx - 1];
      snapDeltaMap.set(snap.dateIso, {
        cut: Math.max(0, snap.totalCut - prev.totalCut),
        sewing: Math.max(0, snap.totalSewing - prev.totalSewing),
        packaging: Math.max(0, snap.totalPackaging - prev.totalPackaging),
        shipped: Math.max(0, snap.totalShipped - prev.totalShipped),
        defectQty: Math.max(0, snap.totalDefect - prev.totalDefect)
      });
    }
  });

  // Aggregate PackingListRow quantities by date (packDate or createdAt)
  const packingByDate = new Map<string, { totalQty: number; defectTaggedQty: number }>();
  packingRows.forEach(row => {
    const iso = parseFlexibleDateToIso(row.packDate) || parseFlexibleDateToIso(row.createdAt);
    if (!iso || !bucketSet.has(iso)) return;
    const prev = packingByDate.get(iso) || { totalQty: 0, defectTaggedQty: 0 };
    const qty = Number(row.qty) || 0;
    const isDefectModel = /брак|defect/i.test(row.model || '') || /брак|defect/i.test(row.productName || '');
    prev.totalQty += qty;
    if (isDefectModel) prev.defectTaggedQty += qty;
    packingByDate.set(iso, prev);
  });

  // Aggregate WaybillDocument shipments by waybillDate or createdAt
  const waybillsByDate = new Map<string, { qty: number; count: number }>();
  let waybillsInPeriod = 0;
  waybills.forEach(wb => {
    const iso = parseFlexibleDateToIso(wb.waybillDate) || parseFlexibleDateToIso(wb.createdAt);
    if (!iso || !bucketSet.has(iso)) return;
    waybillsInPeriod += 1;
    const prev = waybillsByDate.get(iso) || { qty: 0, count: 0 };
    prev.qty += Number(wb.totalQty) || 0;
    prev.count += 1;
    waybillsByDate.set(iso, prev);
  });

  // Combine sources into daily points
  const points: DailyPerformancePoint[] = dateBuckets.map(({ dateIso, dateLabel }) => {
    const manual = manualMap.get(dateIso);
    const snap = snapDeltaMap.get(dateIso);
    const packBucket = packingByDate.get(dateIso);
    const wbBucket = waybillsByDate.get(dateIso);

    const cut = (manual?.cut || 0) + (snap?.cut || 0);
    const sewing = (manual?.sewing || 0) + (snap?.sewing || 0);
    const packaging = Math.max(
      (manual?.packaging || 0) + (snap?.packaging || 0),
      (manual?.packaging || 0) + (packBucket ? packBucket.totalQty - packBucket.defectTaggedQty : 0)
    );
    const shipped = Math.max(
      (manual?.shipped || 0) + (snap?.shipped || 0),
      (manual?.shipped || 0) + (wbBucket?.qty || 0)
    );
    const defectQty = Math.max(
      (manual?.defectQty || 0) + (snap?.defectQty || 0),
      (manual?.defectQty || 0) + (packBucket?.defectTaggedQty || 0)
    );

    const denominator = packaging + defectQty;
    const defectRate =
      denominator > 0 ? Number(((defectQty / denominator) * 100).toFixed(2)) : 0;

    const throughputTotal = packaging > 0 ? packaging : sewing > 0 ? sewing : cut;
    const hasActivity =
      cut > 0 || sewing > 0 || packaging > 0 || shipped > 0 || defectQty > 0;

    return {
      dateIso,
      dateLabel,
      cut,
      sewing,
      packaging,
      shipped,
      defectQty,
      defectRate,
      throughputTotal,
      hasActivity
    };
  });

  const currentLedgerTotals = ledgerRows.reduce(
    (acc, r) => {
      acc.orderQty += Number(r.qtyOrder) || 0;
      acc.cutQty += Number(r.qtyCut) || 0;
      acc.distQty += Number(r.qtyDistribution) || 0;
      acc.sewQty += Number(r.qtySewing) || 0;
      acc.packQty += Number(r.qtyPackaging) || 0;
      acc.defectQty += Number(r.qtyDefect) || 0;
      acc.shippedQty += Number(r.qtyShipped) || 0;
      return acc;
    },
    {
      orderQty: 0,
      cutQty: 0,
      distQty: 0,
      sewQty: 0,
      packQty: 0,
      defectQty: 0,
      shippedQty: 0
    }
  );

  const activePoints = points.filter(p => p.hasActivity);
  const totalCutPeriod = points.reduce((s, p) => s + p.cut, 0);
  const totalSewingPeriod = points.reduce((s, p) => s + p.sewing, 0);
  const totalPackagingPeriod = points.reduce((s, p) => s + p.packaging, 0);
  const totalShippedPeriod = points.reduce((s, p) => s + p.shipped, 0);
  const totalDefectPeriod = points.reduce((s, p) => s + p.defectQty, 0);

  const avgDailyThroughput =
    activePoints.length > 0
      ? Math.round(activePoints.reduce((s, p) => s + p.throughputTotal, 0) / activePoints.length)
      : 0;

  let peakDailyThroughput = 0;
  let peakDateLabel = '—';
  points.forEach(p => {
    if (p.throughputTotal > peakDailyThroughput) {
      peakDailyThroughput = p.throughputTotal;
      peakDateLabel = p.dateLabel;
    }
  });

  const denom = totalPackagingPeriod + totalDefectPeriod;
  const overallDefectRate =
    denom > 0 ? Number(((totalDefectPeriod / denom) * 100).toFixed(2)) : 0;

  const hasAnyData =
    activePoints.length > 0 ||
    ledgerRows.length > 0 ||
    packingRows.length > 0 ||
    waybills.length > 0;

  return {
    points,
    hasAnyData,
    activeDaysCount: activePoints.length,
    totalCutPeriod,
    totalSewingPeriod,
    totalPackagingPeriod,
    totalShippedPeriod,
    totalDefectPeriod,
    avgDailyThroughput,
    peakDailyThroughput,
    peakDateLabel,
    overallDefectRate,
    waybillsInPeriod,
    currentLedgerTotals
  };
}
