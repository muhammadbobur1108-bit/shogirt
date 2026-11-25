import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FactoryLedgerRow, OrderSizeMatrix } from './ordersSizeStore';
import { PrintPreviewPayload, escapeHtml } from './printBridge';

export interface PackingListRow {
  id: string;
  bagUid: string;              // Уникальный ID тары (общий для цветов внутри одной тары)
  qrCode: string;              // Неповторяющийся уникальный QR-код тары (напр. CT-10001-K9M)
  taraNo: string;              // № (Номер тары, напр. "1", "2", "160 / V2")
  orderNo: string;             // Заказ (напр. "MOS-545.4")
  model: string;               // Модель (напр. "SM-OW-1111/160-ВК (брак)")
  productName: string;         // Наименование (напр. "Фуфайка (футболка) мужская")
  color: string;               // Цвет (напр. "Белый")
  qty: number;                 // Кол-во (шт)
  weightKg: number | '';       // Вес брутто (кг)
  selectedForShipment: boolean;// Выбрано к отгрузке (Отгружено)
  shipmentNo: string;          // Номер отгрузки (напр. "12")
  shippedScanIndex?: number;   // Порядковый индекс отгрузки при QR-сканировании (1, 2, 3...)
  scannedAt?: string;          // Время сканирования QR-кода (ЧЧ:ММ:СС)
  defect1SortOverride?: number | '';    // Ручная корректировка 1-Сорт (если нет в Заказах)
  defectRazdachaOverride?: number | ''; // Ручная корректировка Раздача (если нет в Заказах)
  article?: string;            // Артикул для шаблона №5
  sizeText?: string;           // Размеры для шаблона №5 (напр. "2XS + XS + S + M + L + XL")
  sizeQtyText?: string;        // Распределение кол-ва по размерам (напр. "2 + 4 + 4 + 6 + 4 + 3 = 23")
  weightNettoKg?: number | ''; // Вес нетто (кг) для шаблона №5
  packDate?: string;           // Дата упаковки для шаблона №5
  countryOrigin?: string;      // Страна происхождения
  destination?: string;        // Пункт назначения
  createdAt: string;
}

export interface BagGroupSummary {
  bagUid: string;
  qrCode: string;
  taraNo: string;
  orderNo: string;
  model: string;
  productName: string;
  rows: PackingListRow[];
  totalQty: number;
  weightKg: number | '';
  selectedForShipment: boolean;
  shipmentNo: string;
}

export interface OrderColorSummaryRow {
  key: string;
  displayNo: string;
  taraList: string[];
  orderNo: string;
  model: string;
  productName: string;
  color: string;
  totalQty: number;
  rowsCount: number;
}

export interface DefectCheckRow {
  row: PackingListRow;
  fromOrdersBase: boolean;
  firstSort: number;           // 1-Сорт
  totalPack: number;           // Всего упаковка = Кол-во + 1-Сорт
  razdacha: number;            // Раздача
  difference: number;          // Разница = Раздача - Всего упаковка
  cumulativeQtyForColor: number;
  cumulativeTotalPack: number;
  cumulativeDifference: number;
  isBlocked: boolean;          // Разница < 0 => запрет печати маркировки
  controlLabel: string;        // "Печать маркировки запрещена" | "Разрешено"
}

export interface WaybillRowItem {
  id: string;
  seqNo: number;               // № п/п
  bagNo: string;               // № мешка
  orderNo: string;             // Заказ
  model: string;               // Модель
  productName: string;         // Наименование
  color: string;               // Цвет
  qty: number;                 // Кол-во
  taraCount: number;           // Тара (1 для тары/позиции, как в образце)
  grossWeightKg: number | '';  // Вес брутто
}

export interface WaybillSignatories {
  directorName: string;        // Директор
  recipientName: string;       // Принял
  warehouseManagerName: string;// Зав. складом
  senderName: string;          // Сдал
}

export interface WaybillDocument {
  id: string;
  waybillNo: string;           // Накладная №
  waybillDate: string;         // от ДД.ММ.ГГГГ
  rows: WaybillRowItem[];
  totalQty: number;
  totalTara: number;
  totalGrossWeightKg: number;
  signatories: WaybillSignatories;
  createdBy?: string;          // Кто создал документ
  createdAt: string;
}

export const NAKLADNOY_STORAGE_KEYS = {
  PACKING_ROWS: 'tex_erp_nakladnoy_packing_v2',
  WAYBILLS: 'tex_erp_nakladnoy_waybills_v2',
  ACTIVE_WAYBILL: 'tex_erp_nakladnoy_active_waybill_v2',
  SIGNATORIES: 'tex_erp_nakladnoy_signatories_v2',
  QR_COUNTER: 'tex_erp_nakladnoy_qr_seq_v2',
  ISSUED_QR_SET: 'tex_erp_nakladnoy_issued_qrs_v2',
  LAST_WAYBILL_NO: 'tex_erp_nakladnoy_last_wb_no_v2'
};

export const DEFAULT_SIGNATORIES: WaybillSignatories = {
  directorName: 'Мирматов Н',
  recipientName: 'Норбоев Ж',
  warehouseManagerName: 'Миралиев Н',
  senderName: 'Умаров Б'
};

/**
 * Генерирует строго неповторяющийся уникальный QR-код для каждой тары (мешка / коробки).
 * Даже после удаления записей счётчик монотонно растёт, исключая дубликаты.
 */
export function generateUniqueQrCode(): string {
  let nextSeq = 10001;
  let issued: string[] = [];

  try {
    const rawSeq = localStorage.getItem(NAKLADNOY_STORAGE_KEYS.QR_COUNTER);
    if (rawSeq) {
      const parsed = parseInt(rawSeq, 10);
      if (Number.isFinite(parsed) && parsed >= 1) {
        nextSeq = parsed + 1;
      }
    }
    const rawIssued = localStorage.getItem(NAKLADNOY_STORAGE_KEYS.ISSUED_QR_SET);
    if (rawIssued) {
      const parsedSet = JSON.parse(rawIssued);
      if (Array.isArray(parsedSet)) issued = parsedSet;
    }
  } catch {
    // ignore storage read error
  }

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let candidate = '';
  let guard = 0;

  do {
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    candidate = `CT-${nextSeq + guard}-${suffix}`;
    guard++;
  } while (issued.includes(candidate) && guard < 100);

  const finalSeq = nextSeq + guard - 1;
  try {
    localStorage.setItem(NAKLADNOY_STORAGE_KEYS.QR_COUNTER, String(finalSeq));
    const nextIssued = [...issued.slice(-4999), candidate];
    localStorage.setItem(NAKLADNOY_STORAGE_KEYS.ISSUED_QR_SET, JSON.stringify(nextIssued));
  } catch {
    // ignore storage write error
  }

  return candidate;
}

/**
 * Формирует компактную строку для QR-кода (ASCII для быстрого и безошибочного сканирования камерой/сканером).
 */
export function buildBagQrPayload(qrCode: string, taraNo: string, orderNo: string): string {
  const safeQr = (qrCode || '').trim();
  const safeTara = (taraNo || '').replace(/\|/g, '/').trim();
  const safeOrder = (orderNo || '').replace(/\|/g, '/').trim();
  return `CHUST|${safeQr}|${safeTara}|${safeOrder}`;
}

const RU_TO_EN_SCAN_MAP: Record<string, string> = {
  Й: 'Q', Ц: 'W', У: 'E', К: 'R', Е: 'T', Н: 'Y', Г: 'U', Ш: 'I', Щ: 'O', З: 'P',
  Ф: 'A', Ы: 'S', В: 'D', А: 'F', П: 'G', Р: 'H', О: 'J', Л: 'K', Д: 'L',
  Я: 'Z', Ч: 'X', С: 'C', М: 'V', И: 'B', Т: 'N', Ь: 'M',
  й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o', з: 'p',
  ф: 'a', ы: 's', в: 'd', а: 'f', п: 'g', р: 'h', о: 'j', л: 'k', д: 'l',
  я: 'z', ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm',
  Х: '{', Ъ: '}', х: '[', ъ: ']', Ж: ':', Э: '"', ж: ';', э: "'", Б: '<', Ю: '>', б: ',', ю: '.'
};

function convertRuScanLayoutIfAsciiToken(raw: string): string {
  const trimmed = raw.trim();
  // Признаки того, что USB-сканер ввёл латинский QR-код CHUST|CT-... при включённой русской раскладке
  const looksLikeRuCHUST = /^СРГЫЕ[/|\\]/i.test(trimmed) || /^СЕ-\d+/i.test(trimmed);
  if (!looksLikeRuCHUST) return trimmed;

  let out = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '/' && i <= 6) {
      out += '|';
    } else if (RU_TO_EN_SCAN_MAP[ch]) {
      out += RU_TO_EN_SCAN_MAP[ch];
    } else if (ch === '/' && trimmed.includes('СРГЫЕ')) {
      out += '|';
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Распознаёт любой отсканированный формат QR-кода (формат CHUST|..., JSON или прямой код CT-...).
 * Поддерживает автоматическую коррекцию русской раскладки для проводных/Bluetooth 2D-сканеров.
 */
export function extractQrTokenFromScan(rawScan: string): { qrToken: string; taraNo?: string; orderNo?: string } {
  const rawTrimmed = (rawScan || '').trim();
  if (!rawTrimmed) return { qrToken: '' };

  const trimmed = convertRuScanLayoutIfAsciiToken(rawTrimmed);

  if (trimmed.toUpperCase().startsWith('CHUST|')) {
    const parts = trimmed.split('|');
    return {
      qrToken: (parts[1] || '').trim(),
      taraNo: (parts[2] || '').trim() || undefined,
      orderNo: (parts[3] || '').trim() || undefined
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return {
        qrToken: String(parsed.qrCode || parsed.qr || parsed.id || '').trim(),
        taraNo: parsed.tara ? String(parsed.tara).trim() : undefined,
        orderNo: parsed.order ? String(parsed.order).trim() : undefined
      };
    }
  } catch {
    // not JSON
  }

  return { qrToken: trimmed };
}

export function loadPackingRows(): PackingListRow[] {
  try {
    const raw = localStorage.getItem(NAKLADNOY_STORAGE_KEYS.PACKING_ROWS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

export function savePackingRows(rows: PackingListRow[]): void {
  try {
    localStorage.setItem(NAKLADNOY_STORAGE_KEYS.PACKING_ROWS, JSON.stringify(rows));
  } catch {
    // ignore
  }
}

export function loadSavedWaybills(): WaybillDocument[] {
  try {
    const raw = localStorage.getItem(NAKLADNOY_STORAGE_KEYS.WAYBILLS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveWaybills(list: WaybillDocument[]): void {
  try {
    localStorage.setItem(NAKLADNOY_STORAGE_KEYS.WAYBILLS, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function loadSignatories(): WaybillSignatories {
  try {
    const raw = localStorage.getItem(NAKLADNOY_STORAGE_KEYS.SIGNATORIES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          directorName: parsed.directorName || DEFAULT_SIGNATORIES.directorName,
          recipientName: parsed.recipientName || DEFAULT_SIGNATORIES.recipientName,
          warehouseManagerName: parsed.warehouseManagerName || DEFAULT_SIGNATORIES.warehouseManagerName,
          senderName: parsed.senderName || DEFAULT_SIGNATORIES.senderName
        };
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SIGNATORIES };
}

export function saveSignatories(sig: WaybillSignatories): void {
  try {
    localStorage.setItem(NAKLADNOY_STORAGE_KEYS.SIGNATORIES, JSON.stringify(sig));
  } catch {
    // ignore
  }
}

export function getNextWaybillNo(): string {
  try {
    const raw = localStorage.getItem(NAKLADNOY_STORAGE_KEYS.LAST_WAYBILL_NO);
    const num = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(num) && num >= 1) {
      return String(num + 1);
    }
  } catch {
    // ignore
  }
  return '1';
}

export function rememberWaybillNo(noStr: string): void {
  const digits = parseInt(String(noStr).replace(/\D+/g, ''), 10);
  if (Number.isFinite(digits) && digits > 0) {
    try {
      const cur = parseInt(localStorage.getItem(NAKLADNOY_STORAGE_KEYS.LAST_WAYBILL_NO) || '0', 10) || 0;
      if (digits > cur) {
        localStorage.setItem(NAKLADNOY_STORAGE_KEYS.LAST_WAYBILL_NO, String(digits));
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Группирует строки Упаковочного листа по тарам (bagUid), сохраняя порядок появления.
 * Если в одной таре (напр. №1 MOS-545.4) несколько цветов (Белый 40, Черный 60) — они объединяются в один мешок.
 */
export function groupPackingRowsByBag(rows: PackingListRow[]): BagGroupSummary[] {
  const map = new Map<string, BagGroupSummary>();

  rows.forEach(row => {
    const existing = map.get(row.bagUid);
    if (!existing) {
      map.set(row.bagUid, {
        bagUid: row.bagUid,
        qrCode: row.qrCode,
        taraNo: row.taraNo,
        orderNo: row.orderNo,
        model: row.model,
        productName: row.productName,
        rows: [row],
        totalQty: Number(row.qty) || 0,
        weightKg: row.weightKg,
        selectedForShipment: row.selectedForShipment,
        shipmentNo: row.shipmentNo
      });
    } else {
      existing.rows.push(row);
      existing.totalQty += Number(row.qty) || 0;
      if (existing.weightKg === '' && row.weightKg !== '') {
        existing.weightKg = row.weightKg;
      }
      if (row.selectedForShipment) {
        existing.selectedForShipment = true;
      }
      if (!existing.shipmentNo && row.shipmentNo) {
        existing.shipmentNo = row.shipmentNo;
      }
    }
  });

  return Array.from(map.values());
}

/**
 * Рис. 2 — «Всего заказ цвет»: группировка таблицы №1 по (Заказ, Модель, Наименование, Цвет)
 */
export function buildOrderColorSummary(rows: PackingListRow[]): OrderColorSummaryRow[] {
  const map = new Map<string, OrderColorSummaryRow>();

  rows.forEach(r => {
    const order = (r.orderNo || '').trim();
    const model = (r.model || '').trim();
    const name = (r.productName || '').trim();
    const color = (r.color || '').trim();
    const key = `${order.toUpperCase()}||${model.toUpperCase()}||${name.toUpperCase()}||${color.toUpperCase()}`;

    const existing = map.get(key);
    const taraTrim = (r.taraNo || '').trim();
    if (!existing) {
      map.set(key, {
        key,
        displayNo: taraTrim || String(map.size + 1),
        taraList: taraTrim ? [taraTrim] : [],
        orderNo: r.orderNo,
        model: r.model,
        productName: r.productName,
        color: r.color,
        totalQty: Number(r.qty) || 0,
        rowsCount: 1
      });
    } else {
      existing.totalQty += Number(r.qty) || 0;
      existing.rowsCount += 1;
      if (taraTrim && !existing.taraList.includes(taraTrim)) {
        existing.taraList.push(taraTrim);
      }
    }
  });

  return Array.from(map.values());
}

function normalizeOrderStr(val: string): string {
  return (val || '').trim().toUpperCase();
}

function normalizeColorStr(val: string): string {
  return (val || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function normalizeModelStr(val: string): string {
  return (val || '')
    .replace(/\(\s*брак\s*\)/gi, '')
    .replace(/\(\s*brak\s*\)/gi, '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

/**
 * Ищет в базе Заказов (Размеры по заказу) 1-Сорт (Упаковка) и Раздачу по Заказу, Модели и Цвету.
 */
export function findOrderLedgerTotals(
  row: Pick<PackingListRow, 'orderNo' | 'model' | 'color'>,
  ledgerRows: FactoryLedgerRow[]
): { found: boolean; qtyPackaging: number; qtyDistribution: number; sizeText: string } {
  const targetOrder = normalizeOrderStr(row.orderNo);
  const targetColor = normalizeColorStr(row.color);
  const targetModel = normalizeModelStr(row.model);

  if (!targetOrder || !targetColor || ledgerRows.length === 0) {
    return { found: false, qtyPackaging: 0, qtyDistribution: 0, sizeText: '' };
  }

  // Сначала точное совпадение Заказ + Модель (без "(брак)") + Цвет
  let matched = ledgerRows.filter(
    lr =>
      normalizeOrderStr(lr.orderNo) === targetOrder &&
      normalizeColorStr(lr.color) === targetColor &&
      (!targetModel || normalizeModelStr(lr.model) === targetModel)
  );

  // Если не найдено по модели, ищем по Заказ + Цвет
  if (matched.length === 0) {
    matched = ledgerRows.filter(
      lr => normalizeOrderStr(lr.orderNo) === targetOrder && normalizeColorStr(lr.color) === targetColor
    );
  }

  if (matched.length === 0) {
    return { found: false, qtyPackaging: 0, qtyDistribution: 0, sizeText: '' };
  }

  const qtyPackaging = matched.reduce((s, r) => s + (Number(r.qtyPackaging) || 0), 0);
  const qtyDistribution = matched.reduce((s, r) => s + (Number(r.qtyDistribution) || 0), 0);

  return {
    found: true,
    qtyPackaging,
    qtyDistribution,
    sizeText: ''
  };
}

/**
 * Подбирает строку размеров из OrderSizeMatrix для шаблона №5 (1 цвет)
 */
export function findSizeBreakdownForRow(
  row: Pick<PackingListRow, 'orderNo' | 'model' | 'color'>,
  ledgerRows: FactoryLedgerRow[],
  sizeMatrices: Record<string, OrderSizeMatrix>
): { sizeText: string; sizeQtyText: string } {
  const targetOrder = normalizeOrderStr(row.orderNo);
  const targetColor = normalizeColorStr(row.color);
  if (!targetOrder) return { sizeText: '', sizeQtyText: '' };

  const matched = ledgerRows.find(
    lr => normalizeOrderStr(lr.orderNo) === targetOrder && (!targetColor || normalizeColorStr(lr.color) === targetColor)
  );
  if (!matched) return { sizeText: '', sizeQtyText: '' };

  const mat = sizeMatrices[matched.id];
  if (!mat || !Array.isArray(mat.sizes) || mat.sizes.length === 0) {
    return { sizeText: '', sizeQtyText: '' };
  }

  const activeSizes = mat.sizes.filter(sz => (mat.values?.[sz]?.order || 0) > 0 || (mat.values?.[sz]?.pack || 0) > 0);
  const targetSizes = activeSizes.length > 0 ? activeSizes : mat.sizes.slice(0, 7);
  return {
    sizeText: targetSizes.join(' + '),
    sizeQtyText: ''
  };
}

/**
 * Рис. 8 — «Проверка брака»:
 * Всего упаковка = Кол-во (брак) + 1-Сорт
 * Разница = Раздача - Всего упаковка
 * Если Разница < 0 => "Печать маркировки запрещена"
 */
export function evaluateDefectChecks(
  packingRows: PackingListRow[],
  ledgerRows: FactoryLedgerRow[]
): DefectCheckRow[] {
  // Накопленное кол-во по (Заказ + Цвет) среди всех тар
  const colorTotals = new Map<string, number>();
  packingRows.forEach(r => {
    const key = `${normalizeOrderStr(r.orderNo)}||${normalizeColorStr(r.color)}`;
    colorTotals.set(key, (colorTotals.get(key) || 0) + (Number(r.qty) || 0));
  });

  return packingRows.map(row => {
    const ledgerMatch = findOrderLedgerTotals(row, ledgerRows);

    const hasFirstSortOverride =
      row.defect1SortOverride !== undefined && row.defect1SortOverride !== '';
    const hasRazdachaOverride =
      row.defectRazdachaOverride !== undefined && row.defectRazdachaOverride !== '';

    const firstSort = hasFirstSortOverride
      ? Number(row.defect1SortOverride) || 0
      : ledgerMatch.found
      ? ledgerMatch.qtyPackaging
      : 0;

    const razdacha = hasRazdachaOverride
      ? Number(row.defectRazdachaOverride) || 0
      : ledgerMatch.found
      ? ledgerMatch.qtyDistribution
      : 0;

    const qty = Number(row.qty) || 0;
    const totalPack = qty + firstSort;
    const difference = razdacha - totalPack;

    const colorKey = `${normalizeOrderStr(row.orderNo)}||${normalizeColorStr(row.color)}`;
    const cumulativeQtyForColor = colorTotals.get(colorKey) || qty;
    const cumulativeTotalPack = cumulativeQtyForColor + firstSort;
    const cumulativeDifference = razdacha - cumulativeTotalPack;

    // Блокируем если текущая строка ушла в минус ИЛИ (при данных из Размеры по заказу) суммарно по этому цвету ушло в минус
    const isRowNegative = difference < 0;
    const isCumulativeNegative =
      !hasFirstSortOverride && !hasRazdachaOverride && ledgerMatch.found && cumulativeDifference < 0;
    const isBlocked = isRowNegative || isCumulativeNegative;

    return {
      row,
      fromOrdersBase: ledgerMatch.found && !hasFirstSortOverride && !hasRazdachaOverride,
      firstSort,
      totalPack,
      razdacha,
      difference,
      cumulativeQtyForColor,
      cumulativeTotalPack,
      cumulativeDifference,
      isBlocked,
      controlLabel: isBlocked ? 'Печать маркировки запрещена' : 'Разрешено'
    };
  });
}

/**
 * Проверяет, разрешена ли печать маркировки для конкретной тары (bagUid).
 * Если хотя бы один цвет в таре ушёл в минус (Разница < 0), печать тары блокируется!
 */
export function checkBagPrintPermission(
  bagUid: string,
  defectChecks: DefectCheckRow[]
): { allowed: boolean; blockedReasons: string[] } {
  const bagChecks = defectChecks.filter(dc => dc.row.bagUid === bagUid);
  if (bagChecks.length === 0) return { allowed: true, blockedReasons: [] };

  const blocked = bagChecks.filter(dc => dc.isBlocked);
  if (blocked.length === 0) return { allowed: true, blockedReasons: [] };

  const reasons = blocked.map(
    b =>
      `${b.row.orderNo} • ${b.row.color}: Всего уп. (${b.totalPack}) > Раздача (${b.razdacha}) → Разница ${b.difference}`
  );
  return { allowed: false, blockedReasons: reasons };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export async function registerCyrillicPdfFont(doc: jsPDF): Promise<string> {
  try {
    const [resReg, resBold] = await Promise.all([
      fetch('/fonts/LiberationSans-Regular.ttf'),
      fetch('/fonts/LiberationSans-Bold.ttf')
    ]);
    if (resReg.ok) {
      const regB64 = arrayBufferToBase64(await resReg.arrayBuffer());
      doc.addFileToVFS('LiberationSans-Regular.ttf', regB64);
      doc.addFont('LiberationSans-Regular.ttf', 'LiberationSans', 'normal');
    }
    if (resBold.ok) {
      const boldB64 = arrayBufferToBase64(await resBold.arrayBuffer());
      doc.addFileToVFS('LiberationSans-Bold.ttf', boldB64);
      doc.addFont('LiberationSans-Bold.ttf', 'LiberationSans', 'bold');
    }
    if (resReg.ok || resBold.ok) {
      doc.setFont('LiberationSans', 'normal');
      return 'LiberationSans';
    }
  } catch {
    // fallback
  }
  doc.setFont('helvetica', 'normal');
  return 'helvetica';
}

export function formatRuDate(isoOrRu: string): string {
  if (!isoOrRu) return '';
  if (/^\d{2}\.\d{2}\.\d{4}/.test(isoOrRu)) return isoOrRu;
  const parts = isoOrRu.split('-');
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return isoOrRu;
}

/**
 * Единый обработчик формирования и сохранения Накладной из выбранных строк упаковочного листа.
 * Используется в NakladnoyView и быстрых действиях на главной странице.
 */
export function createAndSaveWaybillFromRows(
  selectedRows: PackingListRow[],
  shipmentNoHint: string,
  currentUserName?: string,
  signatoriesOverride?: WaybillSignatories
): WaybillDocument {
  const orderedRows = [...selectedRows].sort((a, b) => {
    const aIdx = typeof a.shippedScanIndex === 'number' && a.shippedScanIndex > 0 ? a.shippedScanIndex : 999999;
    const bIdx = typeof b.shippedScanIndex === 'number' && b.shippedScanIndex > 0 ? b.shippedScanIndex : 999999;
    return aIdx - bIdx;
  });

  const seenBagIds = new Set<string>();
  const waybillRows: WaybillRowItem[] = orderedRows.map((row, idx) => {
    const isFirstOfBag = !seenBagIds.has(row.bagUid);
    seenBagIds.add(row.bagUid);

    return {
      id: `wbr-${Date.now()}-${idx}`,
      seqNo: idx + 1,
      bagNo: row.taraNo,
      orderNo: row.orderNo,
      model: row.model,
      productName: row.productName,
      color: row.color,
      qty: Number(row.qty) || 0,
      taraCount: isFirstOfBag ? 1 : 0,
      grossWeightKg: row.weightKg
    };
  });

  const explicitShipNo =
    selectedRows.find(r => r.shipmentNo.trim())?.shipmentNo.trim() ||
    shipmentNoHint.trim() ||
    getNextWaybillNo();

  const resolvedSignatories = signatoriesOverride || loadSignatories() || { ...DEFAULT_SIGNATORIES };
  const todayIso = new Date().toISOString().split('T')[0];

  const newWaybill: WaybillDocument = {
    id: `wb-${Date.now()}`,
    waybillNo: explicitShipNo,
    waybillDate: todayIso,
    rows: waybillRows,
    totalQty: waybillRows.reduce((s, r) => s + r.qty, 0),
    totalTara: waybillRows.reduce((s, r) => s + r.taraCount, 0),
    totalGrossWeightKg: waybillRows.reduce((s, r) => s + (Number(r.grossWeightKg) || 0), 0),
    signatories: resolvedSignatories,
    createdBy: (currentUserName || '').trim() || resolvedSignatories.senderName || '—',
    createdAt: new Date().toISOString()
  };

  rememberWaybillNo(explicitShipNo);
  try {
    localStorage.setItem(NAKLADNOY_STORAGE_KEYS.ACTIVE_WAYBILL, JSON.stringify(newWaybill));
  } catch {
    // ignore storage errors
  }

  const existingWaybills = loadSavedWaybills();
  const updatedArchive = [newWaybill, ...existingWaybills];
  saveWaybills(updatedArchive);

  return newWaybill;
}

export interface MultiOrderWaybillGroup {
  orderKey: string;
  orderNo: string;
  waybillNo: string;
  rows: WaybillRowItem[];
  totalQty: number;
  totalTara: number;
  totalGrossWeightKg: number;
  showWeight: boolean;
}

export function groupPackingRowsByOrder(
  selectedRows: PackingListRow[],
  baseWaybillNo?: string
): MultiOrderWaybillGroup[] {
  const orderedMap = new Map<string, PackingListRow[]>();
  selectedRows.forEach(row => {
    const cleanOrder = (row.orderNo || '').trim();
    const key = cleanOrder ? cleanOrder.toUpperCase() : '__NO_ORDER__';
    const bucket = orderedMap.get(key) || [];
    bucket.push(row);
    orderedMap.set(key, bucket);
  });

  const baseNo = (baseWaybillNo || '').trim() || getNextWaybillNo();
  const groupEntries = Array.from(orderedMap.entries());

  return groupEntries.map(([key, orderRows], groupIdx) => {
    const seenBagIds = new Set<string>();
    const waybillRows: WaybillRowItem[] = orderRows.map((row, idx) => {
      const isFirstOfBag = !seenBagIds.has(row.bagUid);
      seenBagIds.add(row.bagUid);
      return {
        id: `mwb-${groupIdx}-${idx}-${row.id}`,
        seqNo: idx + 1,
        bagNo: row.taraNo,
        orderNo: row.orderNo || 'Без заказа',
        model: row.model,
        productName: row.productName,
        color: row.color,
        qty: Number(row.qty) || 0,
        taraCount: isFirstOfBag ? 1 : 0,
        grossWeightKg: row.weightKg
      };
    });

    const totalQty = waybillRows.reduce((s, r) => s + r.qty, 0);
    const totalTara = waybillRows.reduce((s, r) => s + r.taraCount, 0);
    const totalGrossWeightKg = waybillRows.reduce((s, r) => s + (Number(r.grossWeightKg) || 0), 0);
    const showWeight = waybillRows.some(r => r.grossWeightKg !== '' && Number(r.grossWeightKg) > 0);
    const displayOrderNo = key === '__NO_ORDER__' ? 'Без заказа' : orderRows[0].orderNo.trim();
    const waybillNo = groupEntries.length > 1 ? `${baseNo}-${groupIdx + 1}` : baseNo;

    return {
      orderKey: key,
      orderNo: displayOrderNo,
      waybillNo,
      rows: waybillRows,
      totalQty,
      totalTara,
      totalGrossWeightKg,
      showWeight
    };
  });
}

export async function exportMultiOrderWaybillPdf(options: {
  selectedRows: PackingListRow[];
  baseWaybillNo?: string;
  waybillDateIso?: string;
  signatories?: WaybillSignatories;
}): Promise<{ pageCount: number; orderCount: number; fileName: string }> {
  const { selectedRows, baseWaybillNo, waybillDateIso, signatories } = options;
  const groups = groupPackingRowsByOrder(selectedRows, baseWaybillNo);
  if (groups.length === 0) {
    throw new Error('Не выбрано ни одной строки для формирования накладной PDF.');
  }

  const resolvedSig = signatories || loadSignatories() || { ...DEFAULT_SIGNATORIES };
  const dateIso = waybillDateIso || new Date().toISOString().split('T')[0];
  const formattedDate = formatRuDate(dateIso);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const fontName = await registerCyrillicPdfFont(doc);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  groups.forEach((grp, idx) => {
    if (idx > 0) {
      doc.addPage();
    }

    doc.setFont(fontName, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    doc.text(`Заказ: ${grp.orderNo}`, 10, 14);

    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text(`Накладная № ${grp.waybillNo}`, pageWidth / 2, 14, { align: 'center' });

    doc.setFontSize(11);
    doc.text(`от ${formattedDate}`, pageWidth - 10, 14, { align: 'right' });

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.45);
    doc.line(10, 17.5, pageWidth - 10, 17.5);

    const headCols = ['№ п/п', '№ мешка', 'Заказ', 'Модель', 'Наименование', 'Цвет', 'Кол-во', 'Тара'];
    if (grp.showWeight) headCols.push('Вес брутто');

    const bodyRows = grp.rows.map(r => [
      String(r.seqNo),
      r.bagNo,
      r.orderNo,
      r.model,
      r.productName,
      r.color,
      String(r.qty),
      String(r.taraCount),
      ...(grp.showWeight ? [r.grossWeightKg === '' ? '' : String(r.grossWeightKg)] : [])
    ]);

    const totalRow = [
      '',
      '',
      '',
      '',
      '',
      'ИТОГО:',
      String(grp.totalQty),
      String(grp.totalTara),
      ...(grp.showWeight ? [grp.totalGrossWeightKg.toFixed(1)] : [])
    ];

    autoTable(doc, {
      startY: 21,
      head: [headCols],
      body: [...bodyRows, totalRow],
      theme: 'grid',
      showHead: 'everyPage',
      margin: { left: 10, right: 10, bottom: 18 },
      styles: {
        font: fontName,
        fontSize: 8.5,
        textColor: [15, 23, 42],
        lineColor: [51, 65, 85],
        lineWidth: 0.25,
        cellPadding: 1.8
      },
      headStyles: {
        fillColor: [31, 94, 156],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center'
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 11 },
        1: { halign: 'center', cellWidth: 15 },
        6: { halign: 'right', cellWidth: 16, fontStyle: 'bold' },
        7: { halign: 'center', cellWidth: 12 },
        ...(grp.showWeight ? { 8: { halign: 'right', cellWidth: 20 } } : {})
      },
      didParseCell: hookData => {
        if (hookData.section === 'body' && hookData.row.index === bodyRows.length) {
          hookData.cell.styles.fillColor = [241, 245, 249];
          hookData.cell.styles.fontStyle = 'bold';
        }
      }
    });

    let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 80) + 12;
    const sigBlockHeight = 50;
    if (y + sigBlockHeight > pageHeight - 16) {
      doc.addPage();
      y = 20;
    }

    const sigRows: [string, string][] = [
      ['Директор:', resolvedSig.directorName],
      ['Принял:', resolvedSig.recipientName],
      ['Зав. складом:', resolvedSig.warehouseManagerName],
      ['Сдал:', resolvedSig.senderName]
    ];

    doc.setFont(fontName, 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.3);

    sigRows.forEach(([role, name]) => {
      doc.setFont(fontName, 'bold');
      doc.text(role, 18, y);
      doc.line(50, y, 114, y);
      doc.setFont(fontName, 'normal');
      doc.text(`${name} (Ф.И.О.)`, 120, y);
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      doc.text('Подпись', 76, y + 3.6);
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      y += 11.5;
    });
  });

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setFont(fontName, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Накладная (${groups.length} ${groups.length === 1 ? 'заказ' : 'заказов'}) · от ${formattedDate}`,
      10,
      pageHeight - 7
    );
    doc.text(`Страница ${p} из ${totalPages}`, pageWidth - 10, pageHeight - 7, { align: 'right' });
  }

  const fileName =
    groups.length === 1
      ? `Накладная_${groups[0].orderNo}_${formattedDate}.pdf`
      : `Накладные_${groups.length}_заказов_${formattedDate}.pdf`;

  doc.save(fileName);
  return { pageCount: totalPages, orderCount: groups.length, fileName };
}

export function buildMultiOrderWaybillPrintPayload(options: {
  selectedRows: PackingListRow[];
  baseWaybillNo?: string;
  waybillDateIso?: string;
  signatories?: WaybillSignatories;
  onDownloadPdf?: () => Promise<void> | void;
}): PrintPreviewPayload {
  const { selectedRows, baseWaybillNo, waybillDateIso, signatories, onDownloadPdf } = options;
  const groups = groupPackingRowsByOrder(selectedRows, baseWaybillNo);
  const resolvedSig = signatories || loadSignatories() || { ...DEFAULT_SIGNATORIES };
  const dateIso = waybillDateIso || new Date().toISOString().split('T')[0];
  const formattedDate = formatRuDate(dateIso);

  const sigItems: [string, string][] = [
    ['Директор:', resolvedSig.directorName],
    ['Принял:', resolvedSig.recipientName],
    ['Зав. складом:', resolvedSig.warehouseManagerName],
    ['Сдал:', resolvedSig.senderName]
  ];

  const totalQtyAll = groups.reduce((s, g) => s + g.totalQty, 0);
  const totalTaraAll = groups.reduce((s, g) => s + g.totalTara, 0);

  const pagesHtml = groups
    .map((grp, idx) => {
      const rowsHtml = grp.rows
        .map(
          r => `<tr>
            <td class="ta-c mono bold">${escapeHtml(r.seqNo)}</td>
            <td class="ta-c mono bold">${escapeHtml(r.bagNo)}</td>
            <td class="bold">${escapeHtml(r.orderNo)}</td>
            <td>${escapeHtml(r.model)}</td>
            <td>${escapeHtml(r.productName)}</td>
            <td>${escapeHtml(r.color)}</td>
            <td class="ta-r mono bold">${escapeHtml(r.qty)}</td>
            <td class="ta-c mono">${escapeHtml(r.taraCount)}</td>
            ${grp.showWeight ? `<td class="ta-r mono bold">${r.grossWeightKg === '' ? '' : escapeHtml(r.grossWeightKg)}</td>` : ''}
          </tr>`
        )
        .join('');

      return `
        <section class="wb-page ${idx < groups.length - 1 ? 'wb-page-break' : ''}">
          <div class="wb-head">
            <div class="wb-order">Заказ: <span class="mono">${escapeHtml(grp.orderNo)}</span></div>
            <div class="wb-title">Накладная № <span class="mono">${escapeHtml(grp.waybillNo)}</span></div>
            <div class="wb-date">от <span class="mono">${escapeHtml(formattedDate)}</span></div>
          </div>
          <table class="wb-tbl">
            <thead>
              <tr>
                <th class="ta-c" style="width:44px">№ п/п</th>
                <th class="ta-c" style="width:58px">№ мешка</th>
                <th>Заказ</th>
                <th>Модель</th>
                <th>Наименование</th>
                <th>Цвет</th>
                <th class="ta-r" style="width:62px">Кол-во</th>
                <th class="ta-c" style="width:48px">Тара</th>
                ${grp.showWeight ? '<th class="ta-r" style="width:78px">Вес брутто</th>' : ''}
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot>
              <tr>
                <td colspan="6" class="ta-r">ИТОГО:</td>
                <td class="ta-r mono">${grp.totalQty}</td>
                <td class="ta-c mono">${grp.totalTara}</td>
                ${grp.showWeight ? `<td class="ta-r mono">${grp.totalGrossWeightKg.toFixed(1)}</td>` : ''}
              </tr>
            </tfoot>
          </table>
          <div class="sigs">
            ${sigItems
              .map(
                ([role, name]) => `
              <div class="sig-row">
                <div class="sig-role">${escapeHtml(role)}</div>
                <div class="sig-line-box">
                  <div class="sig-line"></div>
                  <div class="sig-sub">Подпись</div>
                </div>
                <div class="sig-fio">
                  <div class="sig-name">${escapeHtml(name)}</div>
                  <div class="sig-sub">(Ф.И.О.)</div>
                </div>
              </div>`
              )
              .join('')}
          </div>
          <div class="wb-foot">
            <span>Заказ: ${escapeHtml(grp.orderNo)} · от ${escapeHtml(formattedDate)}</span>
            <span>Страница ${idx + 1} из ${groups.length}</span>
          </div>
        </section>`;
    })
    .join('');

  return {
    title:
      groups.length === 1
        ? `Накладная · Заказ ${groups[0].orderNo}`
        : `Пакетная накладная (${groups.length} заказов)`,
    subtitle: `от ${formattedDate} · Страниц: ${groups.length} · Тара: ${totalTaraAll} · Кол-во: ${totalQtyAll} шт`,
    format: 'a4_portrait',
    marginMm: 10,
    extraCss: `
      .wb-page { width: 100%; color: #0f172a; font-family: Arial, sans-serif; padding-bottom: 12px; }
      .wb-page-break { page-break-after: always; break-after: page; margin-bottom: 24px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 24px; }
      @media print {
        .wb-page-break { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
      }
      .wb-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
      .wb-order { font-size: 12px; font-weight: 800; color: #334155; }
      .wb-title { flex: 1; text-align: center; font-size: 17px; font-weight: 900; }
      .wb-date { font-size: 14px; font-weight: 900; }
      .mono { font-family: monospace; }
      .bold { font-weight: 700; }
      .ta-c { text-align: center; }
      .ta-r { text-align: right; }
      .wb-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
      .wb-tbl th, .wb-tbl td { border: 1px solid #334155; padding: 5px 6px; }
      .wb-tbl thead th { background: #1F5E9C; color: #ffffff; font-weight: 700; }
      .wb-tbl tfoot td { background: #f1f5f9; font-weight: 900; }
      .sigs { max-width: 560px; margin: 22px auto 0; font-size: 12px; break-inside: avoid; page-break-inside: avoid; }
      .sig-row { display: grid; grid-template-columns: 3fr 5fr 4fr; gap: 12px; align-items: start; margin-bottom: 14px; }
      .sig-role { font-weight: 600; padding-top: 3px; }
      .sig-line-box { text-align: center; }
      .sig-line { border-bottom: 1px solid #0f172a; height: 18px; }
      .sig-name { font-weight: 600; padding-top: 2px; }
      .sig-sub { font-size: 10px; color: #475569; margin-top: 2px; }
      .wb-foot { display: flex; justify-content: space-between; margin-top: 14px; font-size: 10px; color: #64748b; font-family: monospace; }
    `,
    htmlBody: pagesHtml,
    onDownloadPdf
  };
}


