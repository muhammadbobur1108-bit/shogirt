import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import { PrintPreviewPayload, escapeHtml, printHtmlViaIframe } from '../../lib/printBridge';
import {
  Lock,
  Printer,
  FileText,
  QrCode,
  Tag,
  Layers,
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Square,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { FactoryLedgerRow, OrderSizeMatrix } from '../../lib/ordersSizeStore';
import {
  BagGroupSummary,
  DefectCheckRow,
  PackingListRow,
  buildBagQrPayload,
  findSizeBreakdownForRow,
  formatRuDate,
  groupPackingRowsByBag,
  registerCyrillicPdfFont
} from '../../lib/nakladnoyStore';

// Модульный кэш сгенерированных QR DataURL — исключает повторную генерацию и зависание при переключении вкладок
const qrDataUrlMemoryCache = new Map<string, string>();
const PREVIEW_SHEETS_PER_PAGE = 6;

export type MarkingTemplateSubTab = 'qr_tara' | 'single_color' | 'multi_color_5';

export interface MarkingTemplatesTabHandle {
  openPrintPreview: () => void;
}

interface MarkingTemplatesTabProps {
  rows: PackingListRow[];
  ledgerRows: FactoryLedgerRow[];
  sizeMatrices: Record<string, OrderSizeMatrix>;
  defectChecks: DefectCheckRow[];
  initialBagUid?: string | null;
  onOpenPrintPreview?: (payload: PrintPreviewPayload) => void;
  onNotice: (msg: string) => void;
}

interface ColorSlot {
  color: string;
  size: string;
  qty: string;
}

function getTodayRuDate(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function pairBagsForA4(bags: BagGroupSummary[]): [BagGroupSummary, BagGroupSummary | null][] {
  const pairs: [BagGroupSummary, BagGroupSummary | null][] = [];
  for (let i = 0; i < bags.length; i += 2) {
    pairs.push([bags[i], bags[i + 1] || null]);
  }
  return pairs;
}

export const MarkingTemplatesTab = forwardRef<MarkingTemplatesTabHandle, MarkingTemplatesTabProps>(({
  rows,
  ledgerRows,
  sizeMatrices,
  defectChecks,
  initialBagUid,
  onOpenPrintPreview,
  onNotice
}, ref) => {
  const [subTab, setSubTab] = useState<MarkingTemplateSubTab>('qr_tara');
  const [layoutMode, setLayoutMode] = useState<'two_up' | 'single'>('two_up');
  const [pairMode, setPairMode] = useState<'sequential' | 'duplicate_single'>('duplicate_single');
  const [selectedBagUids, setSelectedBagUids] = useState<string[]>([]);
  const [rangeFrom, setRangeFrom] = useState<string>('1');
  const [rangeTo, setRangeTo] = useState<string>('50');
  const [labelDate, setLabelDate] = useState<string>(() => getTodayRuDate());
  const [previewPage, setPreviewPage] = useState<number>(0);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({});

  // Редактируемые поля для Шаблонов 2 и 3 (Рис. 5)
  const [tplTara, setTplTara] = useState<string>('');
  const [tplOrder, setTplOrder] = useState<string>('');
  const [tplName, setTplName] = useState<string>('');
  const [tplModelSide, setTplModelSide] = useState<string>('');
  const [tplArticle, setTplArticle] = useState<string>('');
  const [tplColor, setTplColor] = useState<string>('');
  const [tplSize, setTplSize] = useState<string>('');
  const [tplQtyStr, setTplQtyStr] = useState<string>('');
  const [tplTotalQty, setTplTotalQty] = useState<string>('');
  const [tplWeightGross, setTplWeightGross] = useState<string>('');
  const [tplWeightNetto, setTplWeightNetto] = useState<string>('');
  const [tplPackDate, setTplPackDate] = useState<string>(() => `${getTodayRuDate()} г.`);
  const [tplCountry, setTplCountry] = useState<string>('ООО "Chust Textile", Узбекистан');
  const [tplDestination, setTplDestination] = useState<string>('Российская Федерация');
  const [tplColorSlots, setTplColorSlots] = useState<ColorSlot[]>([
    { color: '', size: '', qty: '' },
    { color: '', size: '', qty: '' },
    { color: '', size: '', qty: '' },
    { color: '', size: '', qty: '' },
    { color: '', size: '', qty: '' }
  ]);

  const bagGroups = useMemo(() => groupPackingRowsByBag(rows), [rows]);

  // O(N) карта разрешений по каждой таре (вместо O(N^2) фильтрации)
  const bagPermissions = useMemo(() => {
    const groupedChecks = new Map<string, DefectCheckRow[]>();
    defectChecks.forEach(dc => {
      const list = groupedChecks.get(dc.row.bagUid);
      if (list) list.push(dc);
      else groupedChecks.set(dc.row.bagUid, [dc]);
    });

    const map: Record<string, { allowed: boolean; blockedReasons: string[] }> = {};
    bagGroups.forEach(b => {
      const checks = groupedChecks.get(b.bagUid);
      if (!checks || checks.length === 0) {
        map[b.bagUid] = { allowed: true, blockedReasons: [] };
        return;
      }
      const blocked = checks.filter(dc => dc.isBlocked);
      if (blocked.length === 0) {
        map[b.bagUid] = { allowed: true, blockedReasons: [] };
        return;
      }
      map[b.bagUid] = {
        allowed: false,
        blockedReasons: blocked.map(
          bl =>
            `${bl.row.orderNo} • ${bl.row.color}: Всего уп. (${bl.totalPack}) > Раздача (${bl.razdacha}) → Разница ${bl.difference}`
        )
      };
    });
    return map;
  }, [bagGroups, defectChecks]);

  // Автовыбор тары при переходе из Упаковочного листа или при наличии разрешённых тар
  useEffect(() => {
    if (initialBagUid && bagGroups.some(b => b.bagUid === initialBagUid)) {
      const perm = bagPermissions[initialBagUid];
      const next = perm?.allowed !== false ? [initialBagUid] : [];
      setSelectedBagUids(prev =>
        prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next
      );
      setSubTab('qr_tara');
      setPreviewPage(0);
      return;
    }

    setSelectedBagUids(prev => {
      const groupIds = new Set(bagGroups.map(b => b.bagUid));
      const validPrev = prev.filter(
        uid => groupIds.has(uid) && bagPermissions[uid]?.allowed !== false
      );
      if (validPrev.length > 0) {
        return validPrev.length === prev.length && validPrev.every((v, i) => v === prev[i])
          ? prev
          : validPrev;
      }
      const firstAllowed = bagGroups.find(b => bagPermissions[b.bagUid]?.allowed !== false);
      const next = firstAllowed ? [firstAllowed.bagUid] : [];
      return prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next;
    });
  }, [initialBagUid, bagGroups, bagPermissions]);

  const selectedBagUidSet = useMemo(() => new Set(selectedBagUids), [selectedBagUids]);

  // Выбранные к печати тары (в порядке Упаковочного листа, только разрешённые)
  const selectedBags = useMemo(() => {
    return bagGroups.filter(b => selectedBagUidSet.has(b.bagUid) && bagPermissions[b.bagUid]?.allowed !== false);
  }, [bagGroups, selectedBagUidSet, bagPermissions]);

  useEffect(() => {
    setPreviewPage(0);
  }, [selectedBagUids.length, layoutMode, pairMode, subTab]);

  const primaryBag: BagGroupSummary | undefined = useMemo(
    () => selectedBags[0] || bagGroups[0],
    [selectedBags, bagGroups]
  );

  // Загружаем данные первой выбранной тары в поля редактирования Шаблонов 2 и 3 (только когда активны эти вкладки)
  useEffect(() => {
    if (!primaryBag || subTab === 'qr_tara') return;
    const first = primaryBag.rows[0];
    const szInfo = findSizeBreakdownForRow(first, ledgerRows, sizeMatrices);

    setTplTara(primaryBag.taraNo);
    setTplOrder(primaryBag.orderNo);
    setTplName(primaryBag.productName);
    setTplModelSide(primaryBag.model);
    setTplArticle(first.article || '');
    setTplColor(first.color);
    setTplSize(first.sizeText || szInfo.sizeText);
    setTplQtyStr(first.sizeQtyText || String(first.qty));
    setTplTotalQty(String(primaryBag.totalQty));
    setTplWeightGross(primaryBag.weightKg !== '' ? String(primaryBag.weightKg) : '');
    setTplWeightNetto(
      first.weightNettoKg !== undefined && first.weightNettoKg !== '' ? String(first.weightNettoKg) : ''
    );
    if (first.packDate) setTplPackDate(first.packDate);
    if (first.countryOrigin) setTplCountry(first.countryOrigin);
    if (first.destination) setTplDestination(first.destination);

    setTplColorSlots(
      Array.from({ length: 5 }, (_, idx) => {
        const r = primaryBag.rows[idx];
        if (!r) return { color: '', size: '', qty: '' };
        const rSz = findSizeBreakdownForRow(r, ledgerRows, sizeMatrices);
        return {
          color: r.color,
          size: r.sizeText || rSz.sizeText,
          qty: String(r.qty)
        };
      })
    );
  }, [primaryBag, subTab, ledgerRows, sizeMatrices]);

  // Неблокирующая пакетная генерация QR-кодов: сначала из кэша и для видимых тар, остальные мелкими порциями
  useEffect(() => {
    let cancelled = false;
    if (bagGroups.length === 0) {
      setQrDataUrls({});
      return;
    }

    const initialCached: Record<string, string> = {};
    const missing: BagGroupSummary[] = [];
    const selectedSet = new Set(selectedBagUids);

    // Сначала собираем уже закэшированные и сортируем: выбранные тары в приоритете
    bagGroups.forEach(bag => {
      const payload = buildBagQrPayload(bag.qrCode, bag.taraNo, bag.orderNo);
      const cacheKey = `${bag.bagUid}::${payload}`;
      const cached = qrDataUrlMemoryCache.get(cacheKey);
      if (cached) {
        initialCached[bag.bagUid] = cached;
      } else {
        missing.push(bag);
      }
    });

    if (Object.keys(initialCached).length > 0) {
      setQrDataUrls(prev => ({ ...prev, ...initialCached }));
    }

    if (missing.length === 0) return;

    // Выбранные для предпросмотра тары генерируются первыми
    missing.sort((a, b) => Number(selectedSet.has(b.bagUid)) - Number(selectedSet.has(a.bagUid)));

    let idx = 0;
    const CHUNK_SIZE = 4;

    const processChunk = async () => {
      if (cancelled || idx >= missing.length) return;
      const slice = missing.slice(idx, idx + CHUNK_SIZE);
      idx += CHUNK_SIZE;

      const entries = await Promise.all(
        slice.map(async bag => {
          const payload = buildBagQrPayload(bag.qrCode, bag.taraNo, bag.orderNo);
          const cacheKey = `${bag.bagUid}::${payload}`;
          try {
            const url = await QRCode.toDataURL(payload, {
              width: 220,
              margin: 1,
              errorCorrectionLevel: 'M',
              color: { dark: '#000000', light: '#ffffff' }
            });
            qrDataUrlMemoryCache.set(cacheKey, url);
            return [bag.bagUid, url] as const;
          } catch {
            return [bag.bagUid, ''] as const;
          }
        })
      );

      if (cancelled) return;
      setQrDataUrls(prev => {
        let changed = false;
        const next = { ...prev };
        entries.forEach(([k, v]) => {
          if (v && next[k] !== v) {
            next[k] = v;
            changed = true;
          }
        });
        return changed ? next : prev;
      });

      if (idx < missing.length && !cancelled) {
        setTimeout(processChunk, 12);
      }
    };

    const timer = setTimeout(processChunk, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bagGroups, selectedBagUids]);

  const blockedBags = useMemo(
    () => bagGroups.filter(b => bagPermissions[b.bagUid]?.allowed === false),
    [bagGroups, bagPermissions]
  );

  const handleToggleBag = (bag: BagGroupSummary) => {
    const perm = bagPermissions[bag.bagUid];
    if (perm && !perm.allowed) {
      onNotice(`Тара № ${bag.taraNo} заблокирована проверкой брака (Печать маркировки запрещена).`);
      return;
    }
    setSelectedBagUids(prev =>
      prev.includes(bag.bagUid) ? prev.filter(id => id !== bag.bagUid) : [...prev, bag.bagUid]
    );
  };

  const handleSelectAllAllowed = () => {
    const allowedIds = bagGroups
      .filter(b => bagPermissions[b.bagUid]?.allowed !== false)
      .map(b => b.bagUid);
    setSelectedBagUids(allowedIds);
    if (blockedBags.length > 0) {
      onNotice(
        `Выбрано разрешённых тар: ${allowedIds.length}. Пропущено заблокированных (брак): ${blockedBags.length}.`
      );
    }
  };

  const handleSelectRange = () => {
    const fromN = parseInt(rangeFrom.trim(), 10);
    const toN = parseInt(rangeTo.trim(), 10);
    if (!Number.isFinite(fromN) || !Number.isFinite(toN) || fromN > toN) {
      onNotice('Укажите корректный числовой диапазон тар (например, с 1 по 50).');
      return;
    }

    const matchedIds: string[] = [];
    let skippedBlocked = 0;

    bagGroups.forEach(b => {
      const taraNum = parseInt(String(b.taraNo).trim(), 10);
      if (Number.isFinite(taraNum) && taraNum >= fromN && taraNum <= toN) {
        if (bagPermissions[b.bagUid]?.allowed === false) {
          skippedBlocked++;
        } else {
          matchedIds.push(b.bagUid);
        }
      }
    });

    setSelectedBagUids(matchedIds);
    onNotice(
      skippedBlocked > 0
        ? `В диапазоне ${fromN}–${toN} выбрано тар: ${matchedIds.length} (заблокировано проверкой брака: ${skippedBlocked}).`
        : `В диапазоне ${fromN}–${toN} выбрано тар к печати: ${matchedIds.length}.`
    );
  };

  const buildQrStickerHtml = (bag: BagGroupSummary): string => {
    const visibleColorRows = bag.rows.slice(0, 6);
    const padCount = Math.max(0, 6 - visibleColorRows.length);
    const qrSrc = qrDataUrls[bag.bagUid] || '';
    const dateVal = labelDate.trim() || formatRuDate(bag.rows[0]?.packDate || '') || getTodayRuDate();
    const weightVal = bag.weightKg !== '' && bag.weightKg !== undefined ? String(bag.weightKg) : '';

    const rowsHtml = [
      ...visibleColorRows.map(
        (r, i) => `<tr>
          <td class="ta-c bold">${i + 1}</td>
          <td class="bold">${escapeHtml(r.color)}</td>
          <td class="ta-c bold">${escapeHtml(r.qty)}</td>
        </tr>`
      ),
      ...Array.from({ length: padCount }, (_, padIdx) => `<tr>
        <td class="ta-c muted">${visibleColorRows.length + padIdx + 1}</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
      </tr>`)
    ].join('');

    return `<div class="qr-card">
      <div class="qr-top">
        <div class="qr-tara-box">
          <div class="qr-micro">НОМЕР ТАРЫ №</div>
          <div class="qr-tara-num">${escapeHtml(bag.taraNo)}</div>
        </div>
        <div class="qr-order-box">${escapeHtml(bag.orderNo)}</div>
      </div>
      <div class="qr-body">
        <div class="qr-mid">
          <div class="qr-code-col">
            ${qrSrc ? `<img src="${qrSrc}" alt="QR" class="qr-img" />` : '<div class="qr-placeholder">QR</div>'}
            <div class="qr-uid">${escapeHtml(bag.qrCode)}</div>
          </div>
          <div class="qr-info-col">
            <div>
              <div class="qr-micro muted-lbl">МОДЕЛЬ</div>
              <div class="qr-model">${escapeHtml(bag.model || '—')}</div>
              <div class="qr-micro muted-lbl" style="margin-top:4px;">НАИМЕНОВАНИЕ</div>
              <div class="qr-name">${escapeHtml(bag.productName || '—')}</div>
            </div>
            <div class="qr-total-bar">
              <span>ИТОГО</span>
              <span class="qr-total-num">${bag.totalQty}</span>
            </div>
          </div>
        </div>
        <div class="qr-date-weight">
          <div class="qr-dw-left">
            <div class="qr-micro">ДАТА</div>
            <div class="qr-dw-val">${escapeHtml(dateVal)}</div>
          </div>
          <div class="qr-dw-right">
            <div class="qr-micro">ВЕС (КГ)</div>
            <div class="qr-dw-weight-row">
              <span class="qr-weight-val">${escapeHtml(weightVal)}</span>
              <span class="qr-kg-unit">кг</span>
            </div>
          </div>
        </div>
        <table class="qr-tbl">
          <thead>
            <tr>
              <th style="width:34px">№</th>
              <th>Цвет</th>
              <th style="width:74px">Кол-во</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
  };

  const buildSingleColorStickerHtml = (
    vals: {
      tara: string;
      order: string;
      name: string;
      modelSide: string;
      article: string;
      color: string;
      size: string;
      qtyStr: string;
      weightGross: string;
      weightNetto: string;
      packDate: string;
      country: string;
      destination: string;
    },
    side: 'left' | 'right'
  ): string => {
    const leftSide = side === 'left' && vals.modelSide
      ? `<div class="side-wrap"><div class="side-txt side-left">${escapeHtml(vals.modelSide)}</div></div>`
      : '';
    const rightSide = side === 'right' && vals.modelSide
      ? `<div class="side-wrap"><div class="side-txt side-right">${escapeHtml(vals.modelSide)}</div></div>`
      : '';

    return `<div class="lbl-single-wrap">
      ${leftSide}
      <table class="lbl-tbl">
        <tbody>
          <tr><td class="w38">№ тары</td><td class="bold">${escapeHtml(vals.tara)}</td></tr>
          <tr><td>Номер заказа</td><td class="bold">${escapeHtml(vals.order)}</td></tr>
          <tr><td>Наименование</td><td class="semi">${escapeHtml(vals.name)}</td></tr>
          <tr><td>Артикул</td><td class="semi">${escapeHtml(vals.article)}</td></tr>
          <tr><td class="big-row">Цвет</td><td class="big-row bold">${escapeHtml(vals.color)}</td></tr>
          <tr><td class="big-row">Размер</td><td class="size-row bold">${escapeHtml(vals.size)}</td></tr>
          <tr><td>Кол-во</td><td class="semi mono">${escapeHtml(vals.qtyStr)}</td></tr>
          <tr><td>Вес брутто</td><td class="semi mono">${escapeHtml(vals.weightGross)}</td></tr>
          <tr><td>Вес нетто</td><td class="semi mono">${escapeHtml(vals.weightNetto)}</td></tr>
          <tr><td>Дата упаковки</td><td class="semi">${escapeHtml(vals.packDate)}</td></tr>
          <tr><td>Страна происхождения</td><td class="semi">${escapeHtml(vals.country)}</td></tr>
          <tr><td>Пункт назначения</td><td class="semi">${escapeHtml(vals.destination)}</td></tr>
          <tr><td class="bold">ТР ТС 017/2011</td><td class="bold">EAC</td></tr>
        </tbody>
      </table>
      ${rightSide}
    </div>`;
  };

  const buildMultiColor5StickerHtml = (vals: {
    tara: string;
    order: string;
    name: string;
    article: string;
    totalQty: string;
    slots: ColorSlot[];
    weightGross: string;
    weightNetto: string;
    packDate: string;
    country: string;
    destination: string;
  }): string => {
    const slotsHtml = vals.slots
      .map(
        (slot, idx) => `
          <tr>
            <td style="width:26%">Цвет</td>
            <td rowspan="3" class="slot-num">${idx + 1}</td>
            <td class="semi">${escapeHtml(slot.color)}</td>
          </tr>
          <tr>
            <td class="dot-y">Размер</td>
            <td class="dot-y semi">${escapeHtml(slot.size)}</td>
          </tr>
          <tr>
            <td>Кол-во</td>
            <td class="bold mono">${escapeHtml(slot.qty)}</td>
          </tr>`
      )
      .join('');

    return `<div class="lbl-multi-wrap">
      <table class="lbl-tbl">
        <tbody>
          <tr><td colspan="2" class="w38">№ тары</td><td class="bold">${escapeHtml(vals.tara)}</td></tr>
          <tr><td colspan="2">Номер заказа</td><td class="bold">${escapeHtml(vals.order)}</td></tr>
          <tr><td colspan="2">Наименование</td><td class="semi">${escapeHtml(vals.name)}</td></tr>
          <tr><td colspan="2">Артикул</td><td class="semi">${escapeHtml(vals.article)}</td></tr>
          <tr><td colspan="2">Общее кол-во</td><td class="bold mono">${escapeHtml(vals.totalQty)}</td></tr>
          ${slotsHtml}
          <tr><td colspan="2">Вес брутто</td><td class="semi mono">${escapeHtml(vals.weightGross)}</td></tr>
          <tr><td colspan="2">Вес нетто</td><td class="semi mono">${escapeHtml(vals.weightNetto)}</td></tr>
          <tr><td colspan="2">Дата упаковки</td><td class="semi">${escapeHtml(vals.packDate)}</td></tr>
          <tr><td colspan="2">Страна происхождения</td><td class="semi">${escapeHtml(vals.country)}</td></tr>
          <tr><td colspan="2">Пункт назначения</td><td class="semi">${escapeHtml(vals.destination)}</td></tr>
          <tr><td colspan="2" class="bold">ТР ТС 017/2011</td><td class="bold">EAC</td></tr>
        </tbody>
      </table>
    </div>`;
  };

  const buildPrintableMarkingHtml = (): string => {
    const targetBags = selectedBags;

    if (layoutMode === 'two_up' && pairMode === 'duplicate_single') {
      if (targetBags.length === 0) {
        if (subTab === 'qr_tara') return '';
        if (subTab === 'single_color') {
          const vals = {
            tara: tplTara,
            order: tplOrder,
            name: tplName,
            modelSide: tplModelSide,
            article: tplArticle,
            color: tplColor,
            size: tplSize,
            qtyStr: tplQtyStr,
            weightGross: tplWeightGross,
            weightNetto: tplWeightNetto,
            packDate: tplPackDate,
            country: tplCountry,
            destination: tplDestination
          };
          return `<div class="sheet"><div class="two-grid"><div>${buildSingleColorStickerHtml(vals, 'left')}</div><div class="right-col">${buildSingleColorStickerHtml(vals, 'right')}</div></div></div>`;
        }
        const mVals = {
          tara: tplTara,
          order: tplOrder,
          name: tplName,
          article: tplArticle,
          totalQty: tplTotalQty,
          slots: tplColorSlots,
          weightGross: tplWeightGross,
          weightNetto: tplWeightNetto,
          packDate: tplPackDate,
          country: tplCountry,
          destination: tplDestination
        };
        return `<div class="sheet"><div class="two-grid"><div>${buildMultiColor5StickerHtml(mVals)}</div><div class="right-col">${buildMultiColor5StickerHtml(mVals)}</div></div></div>`;
      }

      return targetBags
        .map((b, idx) => {
          let left = '';
          let right = '';
          if (subTab === 'qr_tara') {
            left = buildQrStickerHtml(b);
            right = buildQrStickerHtml(b);
          } else if (subTab === 'single_color') {
            const vals = bagToSingleVals(b, idx === 0);
            left = buildSingleColorStickerHtml(vals, 'left');
            right = buildSingleColorStickerHtml(vals, 'right');
          } else {
            const mVals = bagToMultiVals(b, idx === 0);
            left = buildMultiColor5StickerHtml(mVals);
            right = buildMultiColor5StickerHtml(mVals);
          }
          const br = idx < targetBags.length - 1 ? 'page-break' : '';
          return `<div class="sheet ${br}"><div class="two-grid"><div>${left}</div><div class="right-col">${right}</div></div></div>`;
        })
        .join('');
    }

    if (layoutMode === 'single') {
      if (targetBags.length === 0) {
        if (subTab === 'single_color') {
          return `<div class="sheet">${buildSingleColorStickerHtml(
            {
              tara: tplTara,
              order: tplOrder,
              name: tplName,
              modelSide: tplModelSide,
              article: tplArticle,
              color: tplColor,
              size: tplSize,
              qtyStr: tplQtyStr,
              weightGross: tplWeightGross,
              weightNetto: tplWeightNetto,
              packDate: tplPackDate,
              country: tplCountry,
              destination: tplDestination
            },
            'left'
          )}</div>`;
        }
        if (subTab === 'multi_color_5') {
          return `<div class="sheet">${buildMultiColor5StickerHtml({
            tara: tplTara,
            order: tplOrder,
            name: tplName,
            article: tplArticle,
            totalQty: tplTotalQty,
            slots: tplColorSlots,
            weightGross: tplWeightGross,
            weightNetto: tplWeightNetto,
            packDate: tplPackDate,
            country: tplCountry,
            destination: tplDestination
          })}</div>`;
        }
        return '';
      }

      return targetBags
        .map((b, idx) => {
          const inner =
            subTab === 'qr_tara'
              ? buildQrStickerHtml(b)
              : subTab === 'single_color'
              ? buildSingleColorStickerHtml(bagToSingleVals(b, idx === 0), 'left')
              : buildMultiColor5StickerHtml(bagToMultiVals(b, idx === 0));
          return `<div class="sheet ${idx < targetBags.length - 1 ? 'page-break' : ''}">${inner}</div>`;
        })
        .join('');
    }

    if (targetBags.length === 0) {
      if (subTab === 'single_color') {
        return `<div class="sheet"><div class="two-grid"><div>${buildSingleColorStickerHtml(
          {
            tara: tplTara,
            order: tplOrder,
            name: tplName,
            modelSide: tplModelSide,
            article: tplArticle,
            color: tplColor,
            size: tplSize,
            qtyStr: tplQtyStr,
            weightGross: tplWeightGross,
            weightNetto: tplWeightNetto,
            packDate: tplPackDate,
            country: tplCountry,
            destination: tplDestination
          },
          'left'
        )}</div><div></div></div></div>`;
      }
      if (subTab === 'multi_color_5') {
        return `<div class="sheet"><div class="two-grid"><div>${buildMultiColor5StickerHtml({
          tara: tplTara,
          order: tplOrder,
          name: tplName,
          article: tplArticle,
          totalQty: tplTotalQty,
          slots: tplColorSlots,
          weightGross: tplWeightGross,
          weightNetto: tplWeightNetto,
          packDate: tplPackDate,
          country: tplCountry,
          destination: tplDestination
        })}</div><div></div></div></div>`;
      }
      return '';
    }

    const sheetPairs = pairBagsForA4(targetBags);
    return sheetPairs
      .map(([leftBag, rightBag], sheetIdx) => {
        const leftHtml =
          subTab === 'qr_tara'
            ? buildQrStickerHtml(leftBag)
            : subTab === 'single_color'
            ? buildSingleColorStickerHtml(bagToSingleVals(leftBag, sheetIdx === 0), 'left')
            : buildMultiColor5StickerHtml(bagToMultiVals(leftBag, sheetIdx === 0));
        const rightHtml = rightBag
          ? subTab === 'qr_tara'
            ? buildQrStickerHtml(rightBag)
            : subTab === 'single_color'
            ? buildSingleColorStickerHtml(bagToSingleVals(rightBag, false), 'right')
            : buildMultiColor5StickerHtml(bagToMultiVals(rightBag, false))
          : '';
        const br = sheetIdx < sheetPairs.length - 1 ? 'page-break' : '';
        return `<div class="sheet ${br}"><div class="two-grid"><div>${leftHtml}</div><div class="${rightBag ? 'right-col' : ''}">${rightHtml}</div></div></div>`;
      })
      .join('');
  };

  const handleTriggerPrint = () => {
    if (subTab === 'qr_tara' && selectedBags.length === 0) {
      onNotice('Нет разрешённых тар для печати. Проверьте выбор тар или «Проверка брака».');
      return;
    }
    if (primaryBag && bagPermissions[primaryBag.bagUid]?.allowed === false && selectedBags.length === 0) {
      onNotice('Печать запрещена: по проверке брака Разница < 0.');
      return;
    }
    const htmlBody = buildPrintableMarkingHtml();
    if (!htmlBody) {
      onNotice('Нет данных для печати маркировки.');
      return;
    }

    const extraCss = `
      .sheet { width: 100%; break-inside: avoid; page-break-inside: avoid; }
      .page-break { page-break-after: always; break-after: page; }
      .two-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
      .right-col { border-left: 1px dashed #64748b; padding-left: 20px; }
      .ta-c { text-align: center; }
      .ta-l { text-align: left; }
      .bold { font-weight: 900; }
      .semi { font-weight: 700; }
      .mono { font-family: monospace; }
      .muted { color: #94a3b8; }

      .qr-card { width: 100%; max-width: 465px; margin: 0 auto; border: 2.5px solid #000; color: #000; background: #fff; font-family: Arial, sans-serif; break-inside: avoid; }
      .qr-top { display: grid; grid-template-columns: 3fr 9fr; border-bottom: 2px solid #000; }
      .qr-tara-box { border-right: 2px solid #000; padding: 4px 6px; text-align: center; display: flex; flex-direction: column; justify-content: center; }
      .qr-micro { font-size: 8.5px; font-weight: 700; text-transform: uppercase; line-height: 1.1; }
      .muted-lbl { color: #334155; font-weight: 600; }
      .qr-tara-num { font-size: 28px; font-weight: 900; line-height: 1; margin-top: 2px; }
      .qr-order-box { display: flex; align-items: center; justify-content: center; padding: 6px 10px; font-size: 26px; font-weight: 900; line-height: 1; text-align: center; }
      .qr-body { padding: 10px; }
      .qr-mid { display: grid; grid-template-columns: 4fr 8fr; gap: 10px; margin-bottom: 8px; }
      .qr-code-col { display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .qr-img { width: 112px; height: 112px; object-fit: contain; border: 1px solid #e2e8f0; }
      .qr-placeholder { width: 104px; height: 104px; border: 1px solid #000; display: flex; align-items: center; justify-content: center; font-size: 10px; }
      .qr-uid { font-size: 8.5px; font-family: monospace; font-weight: 700; margin-top: 2px; text-align: center; word-break: break-all; }
      .qr-info-col { display: flex; flex-direction: column; justify-content: space-between; gap: 6px; }
      .qr-model { font-size: 13px; font-weight: 900; line-height: 1.2; margin-top: 2px; }
      .qr-name { font-size: 12px; font-weight: 900; line-height: 1.2; margin-top: 2px; }
      .qr-total-bar { background: #000 !important; color: #fff !important; padding: 4px 10px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 900; }
      .qr-total-num { font-size: 20px; font-family: monospace; line-height: 1; }
      .qr-date-weight { display: grid; grid-template-columns: 5fr 7fr; border: 1.5px solid #000; margin-bottom: 8px; }
      .qr-dw-left { border-right: 1.5px solid #000; padding: 6px 8px; display: flex; flex-direction: column; justify-content: space-between; }
      .qr-dw-val { font-size: 14px; font-weight: 900; font-family: monospace; margin-top: 4px; }
      .qr-dw-right { padding: 6px 10px; min-height: 46px; display: flex; flex-direction: column; justify-content: space-between; }
      .qr-dw-weight-row { display: flex; align-items: flex-end; justify-content: space-between; margin-top: 4px; min-height: 22px; }
      .qr-weight-val { font-size: 18px; font-weight: 900; font-family: monospace; line-height: 1; }
      .qr-kg-unit { font-size: 12px; font-weight: 900; margin-left: auto; }
      .qr-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
      .qr-tbl th, .qr-tbl td { border: 1px solid #000; padding: 2.5px 6px; }

      .lbl-single-wrap { display: flex; align-items: stretch; justify-content: center; max-width: 440px; width: 100%; margin: 0 auto; break-inside: avoid; }
      .lbl-multi-wrap { max-width: 430px; width: 100%; margin: 0 auto; break-inside: avoid; }
      .side-wrap { width: 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
      .side-txt { font-size: 11px; font-weight: 900; white-space: nowrap; writing-mode: vertical-rl; }
      .side-left { transform: rotate(180deg); }
      .lbl-tbl { width: 100%; border-collapse: collapse; border: 2px solid #000; font-size: 11px; }
      .lbl-tbl td { border: 1px solid #000; padding: 2px 7px; }
      .w38 { width: 38%; }
      .big-row { padding: 9px 7px !important; font-size: 15px; }
      .size-row { padding: 7px 7px !important; font-size: 13px; }
      .slot-num { text-align: center; vertical-align: middle; font-size: 15px; font-weight: 700; width: 12%; }
      .dot-y { border-top-style: dotted !important; border-bottom-style: dotted !important; }
    `;

    const format = layoutMode === 'two_up' ? 'a4_landscape' : 'a4_portrait';
    const previewPayload: PrintPreviewPayload = {
      title: `Маркировка (${selectedBags.length} тар)`,
      subtitle: `${subTab === 'qr_tara' ? 'QR-маркировка' : subTab === 'single_color' ? '1 цвет + размеры' : 'До 5 цветов'} · ${layoutMode === 'two_up' ? 'Альбомная A4 (по 2 на лист)' : 'Книжная A4'}`,
      format,
      marginMm: 8,
      extraCss,
      htmlBody,
      onDownloadPdf: handleExportMarkingPdf
    };

    if (onOpenPrintPreview) {
      onOpenPrintPreview(previewPayload);
      return;
    }

    printHtmlViaIframe({
      ...previewPayload,
      onError: msg => onNotice(msg)
    });
  };

  useImperativeHandle(ref, () => ({
    openPrintPreview: handleTriggerPrint
  }));

  // Генерация и скачивание A4 PDF для печати (по 2 копии на лист в альбомном формате или 1 этикетка)
  const handleExportMarkingPdf = async () => {
    if (subTab === 'qr_tara' && selectedBags.length === 0) {
      onNotice('Нет разрешённых тар для PDF. Проверьте выбор тар или «Проверка брака».');
      return;
    }
    if (primaryBag && bagPermissions[primaryBag.bagUid]?.allowed === false && selectedBags.length === 0) {
      onNotice('Экспорт запрещён: по проверке брака Разница < 0.');
      return;
    }

    setIsExportingPdf(true);
    try {
      const targetBags = selectedBags;
      const qrResolved: Record<string, string> = { ...qrDataUrls };

      if (subTab === 'qr_tara') {
        await Promise.all(
          targetBags.map(async bag => {
            if (qrResolved[bag.bagUid]) return;
            const payload = buildBagQrPayload(bag.qrCode, bag.taraNo, bag.orderNo);
            const cacheKey = `${bag.bagUid}::${payload}`;
            const cached = qrDataUrlMemoryCache.get(cacheKey);
            if (cached) {
              qrResolved[bag.bagUid] = cached;
              return;
            }
            const url = await QRCode.toDataURL(payload, {
              width: 220,
              margin: 1,
              errorCorrectionLevel: 'M',
              color: { dark: '#000000', light: '#ffffff' }
            });
            qrDataUrlMemoryCache.set(cacheKey, url);
            qrResolved[bag.bagUid] = url;
          })
        );
      }

      const isLandscape = layoutMode === 'two_up';
      const doc = new jsPDF({
        orientation: isLandscape ? 'landscape' : 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      const fontName = await registerCyrillicPdfFont(doc);

      const drawQrStickerOnPdf = (bag: BagGroupSummary, x: number, y: number, w: number) => {
        const topH = 17;
        const midH = 40;
        const dwH = 14;
        const rowH = 6.2;
        const tblHeadH = 6.5;
        const totalH = topH + midH + dwH + tblHeadH + 6 * rowH + 5;

        doc.setDrawColor(0, 0, 0);
        doc.setTextColor(0, 0, 0);

        // Внешняя рамка карточки
        doc.setLineWidth(0.65);
        doc.rect(x, y, w, totalH);

        // Верхняя полоса: НОМЕР ТАРЫ № (25%) | Заказ (75%)
        const taraW = w * 0.25;
        doc.setLineWidth(0.5);
        doc.line(x, y + topH, x + w, y + topH);
        doc.line(x + taraW, y, x + taraW, y + topH);

        doc.setFont(fontName, 'bold');
        doc.setFontSize(7);
        doc.text('НОМЕР ТАРЫ №', x + taraW / 2, y + 4.8, { align: 'center' });
        doc.setFontSize(22);
        doc.text(String(bag.taraNo || ''), x + taraW / 2, y + 14, { align: 'center' });

        doc.setFontSize(21);
        doc.text(String(bag.orderNo || ''), x + taraW + (w - taraW) / 2, y + 12, {
          align: 'center',
          maxWidth: w - taraW - 6
        });

        // Средний блок: QR + инфо + чёрная плашка ИТОГО
        const pad = 3.5;
        const bodyY = y + topH + pad;
        const qrColW = (w - pad * 2) * 0.34;
        const infoX = x + pad + qrColW + 3.5;
        const infoW = w - pad * 2 - qrColW - 3.5;

        const qrSize = Math.min(31, qrColW - 2);
        const qrX = x + pad + (qrColW - qrSize) / 2;
        const qrSrc = qrResolved[bag.bagUid];
        if (qrSrc) {
          doc.addImage(qrSrc, 'PNG', qrX, bodyY, qrSize, qrSize);
        } else {
          doc.setLineWidth(0.3);
          doc.rect(qrX, bodyY, qrSize, qrSize);
        }
        doc.setFont(fontName, 'bold');
        doc.setFontSize(6.5);
        doc.text(String(bag.qrCode || ''), x + pad + qrColW / 2, bodyY + qrSize + 3.5, {
          align: 'center',
          maxWidth: qrColW
        });

        doc.setTextColor(60, 70, 85);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(7);
        doc.text('МОДЕЛЬ', infoX, bodyY + 3.2);
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9.5);
        const modelLines = doc.splitTextToSize(String(bag.model || '—'), infoW);
        doc.text(modelLines.slice(0, 2), infoX, bodyY + 7.5);

        const nameLblY = bodyY + 7.5 + Math.min(2, modelLines.length) * 4 + 2;
        doc.setTextColor(60, 70, 85);
        doc.setFontSize(7);
        doc.text('НАИМЕНОВАНИЕ', infoX, nameLblY);
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);
        const nameLines = doc.splitTextToSize(String(bag.productName || '—'), infoW);
        doc.text(nameLines.slice(0, 2), infoX, nameLblY + 4.2);

        // Чёрная плашка ИТОГО
        const barH = 8.5;
        const barY = y + topH + midH - barH - 2;
        doc.setFillColor(0, 0, 0);
        doc.rect(infoX, barY, infoW, barH, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont(fontName, 'bold');
        doc.setFontSize(9.5);
        doc.text('ИТОГО', infoX + 3, barY + 5.7);
        doc.setFontSize(14);
        doc.text(String(bag.totalQty), infoX + infoW - 3, barY + 6, { align: 'right' });

        // Блок ДАТА | ВЕС (КГ)
        doc.setTextColor(0, 0, 0);
        const dwY = y + topH + midH + 1;
        const dwLeftW = (w - pad * 2) * 0.42;
        doc.setLineWidth(0.45);
        doc.rect(x + pad, dwY, w - pad * 2, dwH);
        doc.line(x + pad + dwLeftW, dwY, x + pad + dwLeftW, dwY + dwH);

        const dateVal = labelDate.trim() || formatRuDate(bag.rows[0]?.packDate || '') || getTodayRuDate();
        const weightVal = bag.weightKg !== '' && bag.weightKg !== undefined ? String(bag.weightKg) : '';

        doc.setFontSize(6.8);
        doc.setTextColor(60, 70, 85);
        doc.text('ДАТА', x + pad + 2.5, dwY + 4);
        doc.text('ВЕС (КГ)', x + pad + dwLeftW + 3, dwY + 4);

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(11);
        doc.text(String(dateVal), x + pad + 2.5, dwY + 11);
        if (weightVal) {
          doc.setFontSize(13);
          doc.text(weightVal, x + pad + dwLeftW + 3, dwY + 11);
        }
        doc.setFontSize(9.5);
        doc.text('кг', x + w - pad - 3, dwY + 11, { align: 'right' });

        // Таблица цветов 1..6 (без дублирующей строки ИТОГО)
        const tblY = dwY + dwH + 3;
        const tblW = w - pad * 2;
        const col1W = 11;
        const col3W = 24;
        const col2W = tblW - col1W - col3W;
        const totalTblH = tblHeadH + 6 * rowH;

        doc.setLineWidth(0.32);
        doc.rect(x + pad, tblY, tblW, totalTblH);
        doc.line(x + pad + col1W, tblY, x + pad + col1W, tblY + totalTblH);
        doc.line(x + pad + col1W + col2W, tblY, x + pad + col1W + col2W, tblY + totalTblH);
        doc.line(x + pad, tblY + tblHeadH, x + pad + tblW, tblY + tblHeadH);

        doc.setFont(fontName, 'bold');
        doc.setFontSize(8.5);
        doc.text('№', x + pad + col1W / 2, tblY + 4.5, { align: 'center' });
        doc.text('Цвет', x + pad + col1W + col2W / 2, tblY + 4.5, { align: 'center' });
        doc.text('Кол-во', x + pad + col1W + col2W + col3W / 2, tblY + 4.5, { align: 'center' });

        const visibleColorRows = bag.rows.slice(0, 6);
        for (let rIdx = 0; rIdx < 6; rIdx++) {
          const ry = tblY + tblHeadH + rIdx * rowH;
          if (rIdx > 0) {
            doc.line(x + pad, ry, x + pad + tblW, ry);
          }
          const cRow = visibleColorRows[rIdx];
          doc.setFont(fontName, 'bold');
          doc.setFontSize(8.5);
          if (cRow) {
            doc.setTextColor(0, 0, 0);
            doc.text(String(rIdx + 1), x + pad + col1W / 2, ry + 4.3, { align: 'center' });
            doc.text(String(cRow.color || ''), x + pad + col1W + 2, ry + 4.3, {
              maxWidth: col2W - 4
            });
            doc.text(String(cRow.qty), x + pad + col1W + col2W + col3W / 2, ry + 4.3, {
              align: 'center'
            });
          } else {
            doc.setTextColor(150, 160, 175);
            doc.setFont(fontName, 'normal');
            doc.text(String(rIdx + 1), x + pad + col1W / 2, ry + 4.3, { align: 'center' });
          }
        }
        doc.setTextColor(0, 0, 0);
      };

      const drawSingleColorOnPdf = (
        vals: ReturnType<typeof bagToSingleVals>,
        x: number,
        y: number,
        w: number
      ) => {
        const tblRows: [string, string, number][] = [
          ['№ тары', vals.tara, 6.2],
          ['Номер заказа', vals.order, 6.2],
          ['Наименование', vals.name, 6.2],
          ['Артикул', vals.article, 6.2],
          ['Цвет', vals.color, 10.5],
          ['Размер', vals.size, 9],
          ['Кол-во', vals.qtyStr, 6.2],
          ['Вес брутто', vals.weightGross, 6.2],
          ['Вес нетто', vals.weightNetto, 6.2],
          ['Дата упаковки', vals.packDate, 6.2],
          ['Страна происхождения', vals.country, 6.2],
          ['Пункт назначения', vals.destination, 6.2],
          ['ТР ТС 017/2011', 'EAC', 6.2]
        ];
        const leftW = w * 0.38;
        let curY = y;
        doc.setDrawColor(0, 0, 0);
        doc.setTextColor(0, 0, 0);
        tblRows.forEach(([k, v, h], rIdx) => {
          doc.setLineWidth(0.3);
          doc.rect(x, curY, w, h);
          doc.line(x + leftW, curY, x + leftW, curY + h);
          doc.setFont(fontName, rIdx === 12 ? 'bold' : 'normal');
          doc.setFontSize(rIdx === 4 || rIdx === 5 ? 10.5 : 8.5);
          doc.text(k, x + 2, curY + h / 2 + 1.5, { maxWidth: leftW - 4 });
          doc.setFont(fontName, 'bold');
          doc.text(String(v || ''), x + leftW + 2, curY + h / 2 + 1.5, { maxWidth: w - leftW - 4 });
          curY += h;
        });
        doc.setLineWidth(0.6);
        doc.rect(x, y, w, curY - y);
      };

      const drawMultiColorOnPdf = (
        vals: ReturnType<typeof bagToMultiVals>,
        x: number,
        y: number,
        w: number
      ) => {
        const col1 = w * 0.26;
        const col2 = w * 0.12;
        const col3 = w - col1 - col2;
        const rowH = 5.4;
        let curY = y;
        doc.setDrawColor(0, 0, 0);
        doc.setTextColor(0, 0, 0);

        const topRows: [string, string][] = [
          ['№ тары', vals.tara],
          ['Номер заказа', vals.order],
          ['Наименование', vals.name],
          ['Артикул', vals.article],
          ['Общее кол-во', vals.totalQty]
        ];
        topRows.forEach(([k, v]) => {
          doc.setLineWidth(0.28);
          doc.rect(x, curY, w, rowH);
          doc.line(x + col1 + col2, curY, x + col1 + col2, curY + rowH);
          doc.setFont(fontName, 'normal');
          doc.setFontSize(8);
          doc.text(k, x + 2, curY + 3.8);
          doc.setFont(fontName, 'bold');
          doc.text(String(v || ''), x + col1 + col2 + 2, curY + 3.8, { maxWidth: col3 - 4 });
          curY += rowH;
        });

        vals.slots.forEach((sl, sIdx) => {
          const blockH = rowH * 3;
          doc.setLineWidth(0.28);
          doc.rect(x, curY, w, blockH);
          doc.line(x + col1, curY, x + col1, curY + blockH);
          doc.line(x + col1 + col2, curY, x + col1 + col2, curY + blockH);
          doc.line(x, curY + rowH, x + col1, curY + rowH);
          doc.line(x + col1 + col2, curY + rowH, x + w, curY + rowH);
          doc.line(x, curY + rowH * 2, x + col1, curY + rowH * 2);
          doc.line(x + col1 + col2, curY + rowH * 2, x + w, curY + rowH * 2);

          doc.setFont(fontName, 'bold');
          doc.setFontSize(10);
          doc.text(String(sIdx + 1), x + col1 + col2 / 2, curY + blockH / 2 + 1.5, { align: 'center' });

          doc.setFontSize(7.8);
          doc.setFont(fontName, 'normal');
          doc.text('Цвет', x + 2, curY + 3.8);
          doc.text('Размер', x + 2, curY + rowH + 3.8);
          doc.text('Кол-во', x + 2, curY + rowH * 2 + 3.8);

          doc.setFont(fontName, 'bold');
          doc.text(String(sl.color || ''), x + col1 + col2 + 2, curY + 3.8, { maxWidth: col3 - 4 });
          doc.text(String(sl.size || ''), x + col1 + col2 + 2, curY + rowH + 3.8, { maxWidth: col3 - 4 });
          doc.text(String(sl.qty || ''), x + col1 + col2 + 2, curY + rowH * 2 + 3.8, { maxWidth: col3 - 4 });
          curY += blockH;
        });

        const botRows: [string, string][] = [
          ['Вес брутто', vals.weightGross],
          ['Вес нетто', vals.weightNetto],
          ['Дата упаковки', vals.packDate],
          ['Страна происхождения', vals.country],
          ['Пункт назначения', vals.destination],
          ['ТР ТС 017/2011', 'EAC']
        ];
        botRows.forEach(([k, v], bIdx) => {
          doc.setLineWidth(0.28);
          doc.rect(x, curY, w, rowH);
          doc.line(x + col1 + col2, curY, x + col1 + col2, curY + rowH);
          doc.setFont(fontName, bIdx === botRows.length - 1 ? 'bold' : 'normal');
          doc.setFontSize(8);
          doc.text(k, x + 2, curY + 3.8);
          doc.setFont(fontName, 'bold');
          doc.text(String(v || ''), x + col1 + col2 + 2, curY + 3.8, { maxWidth: col3 - 4 });
          curY += rowH;
        });

        doc.setLineWidth(0.6);
        doc.rect(x, y, w, curY - y);
      };

      type SheetEntry = { left: BagGroupSummary | null; right: BagGroupSummary | null; isFirst: boolean };
      const sheets: SheetEntry[] = [];

      if (layoutMode === 'two_up' && pairMode === 'duplicate_single') {
        if (targetBags.length === 0) {
          sheets.push({ left: null, right: null, isFirst: true });
        } else {
          targetBags.forEach((b, idx) => sheets.push({ left: b, right: b, isFirst: idx === 0 }));
        }
      } else if (layoutMode === 'single') {
        if (targetBags.length === 0) {
          sheets.push({ left: null, right: null, isFirst: true });
        } else {
          targetBags.forEach((b, idx) => sheets.push({ left: b, right: null, isFirst: idx === 0 }));
        }
      } else {
        if (targetBags.length === 0) {
          sheets.push({ left: null, right: null, isFirst: true });
        } else {
          pairBagsForA4(targetBags).forEach(([l, r], idx) =>
            sheets.push({ left: l, right: r, isFirst: idx === 0 })
          );
        }
      }

      const fallbackSingle = {
        tara: tplTara,
        order: tplOrder,
        name: tplName,
        modelSide: tplModelSide,
        article: tplArticle,
        color: tplColor,
        size: tplSize,
        qtyStr: tplQtyStr,
        weightGross: tplWeightGross,
        weightNetto: tplWeightNetto,
        packDate: tplPackDate,
        country: tplCountry,
        destination: tplDestination
      };
      const fallbackMulti = {
        tara: tplTara,
        order: tplOrder,
        name: tplName,
        article: tplArticle,
        totalQty: tplTotalQty,
        slots: tplColorSlots,
        weightGross: tplWeightGross,
        weightNetto: tplWeightNetto,
        packDate: tplPackDate,
        country: tplCountry,
        destination: tplDestination
      };

      sheets.forEach((sh, shIdx) => {
        if (shIdx > 0) doc.addPage();
        if (isLandscape) {
          const cardW = 131;
          const leftX = 11;
          const rightX = 155;
          const topY = 12;

          if (subTab === 'qr_tara' && sh.left) {
            drawQrStickerOnPdf(sh.left, leftX, topY, cardW);
          } else if (subTab === 'single_color') {
            drawSingleColorOnPdf(sh.left ? bagToSingleVals(sh.left, sh.isFirst) : fallbackSingle, leftX, topY, cardW);
          } else if (subTab === 'multi_color_5') {
            drawMultiColorOnPdf(sh.left ? bagToMultiVals(sh.left, sh.isFirst) : fallbackMulti, leftX, topY, cardW);
          }

          if (sh.right || (layoutMode === 'two_up' && pairMode === 'duplicate_single' && targetBags.length === 0)) {
            doc.setDrawColor(148, 163, 184);
            doc.setLineWidth(0.3);
            for (let dy = 10; dy < 198; dy += 4) {
              doc.line(148.5, dy, 148.5, Math.min(dy + 2, 198));
            }
            if (subTab === 'qr_tara' && sh.right) {
              drawQrStickerOnPdf(sh.right, rightX, topY, cardW);
            } else if (subTab === 'single_color') {
              drawSingleColorOnPdf(sh.right ? bagToSingleVals(sh.right, false) : fallbackSingle, rightX, topY, cardW);
            } else if (subTab === 'multi_color_5') {
              drawMultiColorOnPdf(sh.right ? bagToMultiVals(sh.right, false) : fallbackMulti, rightX, topY, cardW);
            }
          }
        } else {
          const cardW = 134;
          const centerX = (210 - cardW) / 2;
          const topY = 15;
          if (subTab === 'qr_tara' && sh.left) {
            drawQrStickerOnPdf(sh.left, centerX, topY, cardW);
          } else if (subTab === 'single_color') {
            drawSingleColorOnPdf(sh.left ? bagToSingleVals(sh.left, sh.isFirst) : fallbackSingle, centerX, topY, cardW);
          } else if (subTab === 'multi_color_5') {
            drawMultiColorOnPdf(sh.left ? bagToMultiVals(sh.left, sh.isFirst) : fallbackMulti, centerX, topY, cardW);
          }
        }
      });

      const dateTag = new Date().toISOString().slice(0, 10);
      doc.save(`Маркировка_${targetBags.length || 1}_тар_${dateTag}.pdf`);
      onNotice(`PDF сформирован (${sheets.length} стр. A4).`);
    } catch (err) {
      console.error('Marking PDF export error:', err);
      onNotice('Ошибка формирования PDF маркировки.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Карточка QR-маркировки тары (Рис. 7 + Дата + крупное поле Вес (кг) + чисто русское «ИТОГО» без JAMI)
  const renderQrSticker = (bag: BagGroupSummary) => {
    const visibleColorRows = bag.rows.slice(0, 6);
    const padRows = Array.from({ length: Math.max(0, 6 - visibleColorRows.length) });
    const qrSrc = qrDataUrls[bag.bagUid] || '';
    const dateVal = labelDate.trim() || formatRuDate(bag.rows[0]?.packDate || '') || getTodayRuDate();
    const weightVal = bag.weightKg !== '' && bag.weightKg !== undefined ? String(bag.weightKg) : '';

    return (
      <div className="bg-white text-black border-[2.5px] border-black w-full max-w-[465px] mx-auto select-none break-inside-avoid">
        {/* Верхняя строка: НОМЕР ТАРЫ № | НОМЕР ЗАКАЗА */}
        <div className="grid grid-cols-12 border-b-[2px] border-black">
          <div className="col-span-3 border-r-[2px] border-black px-2 py-1 text-center flex flex-col justify-center">
            <div className="text-[8.5px] font-bold leading-tight uppercase">НОМЕР ТАРЫ №</div>
            <div className="text-3xl font-black leading-none mt-0.5 tabular-nums">{bag.taraNo}</div>
          </div>
          <div className="col-span-9 px-3 py-1.5 flex items-center justify-center">
            <div className="text-2xl sm:text-3xl font-black tracking-tight text-center leading-none">
              {bag.orderNo}
            </div>
          </div>
        </div>

        {/* Средняя часть */}
        <div className="p-2.5 space-y-2">
          <div className="grid grid-cols-12 gap-3 items-stretch">
            <div className="col-span-4 flex flex-col items-center justify-center">
              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt={`QR ${bag.qrCode}`}
                  className="w-full max-w-[116px] aspect-square object-contain border border-slate-200"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-[106px] h-[106px] border border-black flex items-center justify-center text-[10px]">
                  QR
                </div>
              )}
              <div className="text-[8.5px] font-mono font-bold mt-0.5 text-center break-all">{bag.qrCode}</div>
            </div>

            <div className="col-span-8 flex flex-col justify-between gap-1.5">
              <div className="space-y-1">
                <div>
                  <div className="text-[8.5px] font-semibold uppercase text-slate-700 leading-none">МОДЕЛЬ</div>
                  <div className="text-xs sm:text-sm font-black leading-tight mt-0.5">{bag.model || '—'}</div>
                </div>
                <div>
                  <div className="text-[8.5px] font-semibold uppercase text-slate-700 leading-none">НАИМЕНОВАНИЕ</div>
                  <div className="text-xs font-black leading-tight mt-0.5">{bag.productName || '—'}</div>
                </div>
              </div>

              <div className="bg-black text-white px-2.5 py-1 flex items-center justify-between">
                <span className="text-xs font-black uppercase">ИТОГО</span>
                <span className="text-xl font-black font-mono tabular-nums leading-none">{bag.totalQty}</span>
              </div>
            </div>
          </div>

          {/* Строка Дата + Увеличенное поле для записи веса (кг) */}
          <div className="grid grid-cols-12 border-[1.5px] border-black">
            <div className="col-span-5 border-r-[1.5px] border-black px-2 py-1.5 flex flex-col justify-between">
              <div className="text-[8.5px] font-bold uppercase text-slate-700 leading-none">ДАТА</div>
              <div className="text-sm font-black font-mono tabular-nums mt-1">{dateVal}</div>
            </div>
            <div className="col-span-7 px-2.5 py-1.5 flex flex-col justify-between min-h-[46px]">
              <div className="text-[8.5px] font-bold uppercase text-slate-700 leading-none">
                ВЕС (КГ)
              </div>
              <div className="flex items-end justify-between mt-1 min-h-[24px]">
                <span className="text-lg font-black font-mono tabular-nums leading-none">
                  {weightVal}
                </span>
                <span className="text-xs font-black text-slate-800 ml-auto">кг</span>
              </div>
            </div>
          </div>

          {/* Таблица цветов 1..6 + чисто русское ИТОГО */}
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="font-bold">
                <th className="border border-black py-0.5 px-1.5 w-10 text-center">№</th>
                <th className="border border-black py-0.5 px-2 text-center">Цвет</th>
                <th className="border border-black py-0.5 px-2 w-24 text-center">Кол-во</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {visibleColorRows.map((r, i) => (
                <tr key={r.id}>
                  <td className="border border-black py-0.5 px-1.5 text-center font-black">{i + 1}</td>
                  <td className="border border-black py-0.5 px-2 font-bold">{r.color}</td>
                  <td className="border border-black py-0.5 px-2 text-center font-black">{r.qty}</td>
                </tr>
              ))}
              {padRows.map((_, padIdx) => (
                <tr key={`pad-${padIdx}`}>
                  <td className="border border-black py-0.5 px-1.5 text-center text-slate-400">
                    {visibleColorRows.length + padIdx + 1}
                  </td>
                  <td className="border border-black py-0.5 px-2">&nbsp;</td>
                  <td className="border border-black py-0.5 px-2">&nbsp;</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Шаблон 2: 1 цвет + размеры (Рис. 5 верх)
  const renderSingleColorStickerForValues = (
    vals: {
      tara: string;
      order: string;
      name: string;
      modelSide: string;
      article: string;
      color: string;
      size: string;
      qtyStr: string;
      weightGross: string;
      weightNetto: string;
      packDate: string;
      country: string;
      destination: string;
    },
    side: 'left' | 'right'
  ) => (
    <div className="bg-white text-black flex items-stretch justify-center mx-auto max-w-[440px] w-full break-inside-avoid">
      {side === 'left' && vals.modelSide && (
        <div className="flex items-center justify-center w-6 shrink-0">
          <div
            className="text-[11px] font-black tracking-tight whitespace-nowrap"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            {vals.modelSide}
          </div>
        </div>
      )}

      <table className="flex-1 border-collapse border-[2px] border-black text-[11px]">
        <tbody>
          <tr>
            <td className="border border-black px-2 py-0.5 w-[38%]">№ тары</td>
            <td className="border border-black px-2 py-0.5 font-black">{vals.tara}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-0.5">Номер заказа</td>
            <td className="border border-black px-2 py-0.5 font-black">{vals.order}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-0.5">Наименование</td>
            <td className="border border-black px-2 py-0.5 font-bold">{vals.name}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-0.5">Артикул</td>
            <td className="border border-black px-2 py-0.5 font-bold">{vals.article}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-2.5 text-base font-normal">Цвет</td>
            <td className="border border-black px-2 py-2.5 text-base font-black">{vals.color}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-2 text-base font-normal">Размер</td>
            <td className="border border-black px-2 py-2 text-sm font-black">{vals.size}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-0.5">Кол-во</td>
            <td className="border border-black px-2 py-0.5 font-bold font-mono">{vals.qtyStr}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-0.5">Вес брутто</td>
            <td className="border border-black px-2 py-0.5 font-bold font-mono">{vals.weightGross}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-0.5">Вес нетто</td>
            <td className="border border-black px-2 py-0.5 font-bold font-mono">{vals.weightNetto}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-0.5">Дата упаковки</td>
            <td className="border border-black px-2 py-0.5 font-bold">{vals.packDate}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-0.5">Страна происхождения</td>
            <td className="border border-black px-2 py-0.5 font-bold">{vals.country}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-0.5">Пункт назначения</td>
            <td className="border border-black px-2 py-0.5 font-bold">{vals.destination}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-0.5 font-black">ТР ТС 017/2011</td>
            <td className="border border-black px-2 py-0.5 font-black">EAC</td>
          </tr>
        </tbody>
      </table>

      {side === 'right' && vals.modelSide && (
        <div className="flex items-center justify-center w-6 shrink-0">
          <div
            className="text-[11px] font-black tracking-tight whitespace-nowrap"
            style={{ writingMode: 'vertical-rl' }}
          >
            {vals.modelSide}
          </div>
        </div>
      )}
    </div>
  );

  // Шаблон 3: до 5 цветов в одной таре (Рис. 5 низ)
  const renderMultiColor5StickerForValues = (vals: {
    tara: string;
    order: string;
    name: string;
    article: string;
    totalQty: string;
    slots: ColorSlot[];
    weightGross: string;
    weightNetto: string;
    packDate: string;
    country: string;
    destination: string;
  }) => (
    <div className="bg-white text-black mx-auto max-w-[430px] w-full break-inside-avoid">
      <table className="w-full border-collapse border-[2px] border-black text-[11px]">
        <tbody>
          <tr>
            <td colSpan={2} className="border border-black px-2 py-0.5 w-[38%]">№ тары</td>
            <td className="border border-black px-2 py-0.5 font-black">{vals.tara}</td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black px-2 py-0.5">Номер заказа</td>
            <td className="border border-black px-2 py-0.5 font-black">{vals.order}</td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black px-2 py-0.5">Наименование</td>
            <td className="border border-black px-2 py-0.5 font-bold">{vals.name}</td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black px-2 py-0.5">Артикул</td>
            <td className="border border-black px-2 py-0.5 font-bold">{vals.article}</td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black px-2 py-0.5">Общее кол-во</td>
            <td className="border border-black px-2 py-0.5 font-black font-mono">{vals.totalQty}</td>
          </tr>

          {vals.slots.map((slot, idx) => (
            <React.Fragment key={`slot-${idx}`}>
              <tr>
                <td className="border-x border-t border-black px-2 py-0.5 w-[26%]">Цвет</td>
                <td rowSpan={3} className="border border-black px-2 text-center text-base font-bold w-[12%] align-middle">
                  {idx + 1}
                </td>
                <td className="border-x border-t border-black px-2 py-0.5 font-bold">{slot.color}</td>
              </tr>
              <tr>
                <td className="border-x border-dotted border-black px-2 py-0.5">Размер</td>
                <td className="border-x border-dotted border-black px-2 py-0.5 font-semibold">{slot.size}</td>
              </tr>
              <tr>
                <td className="border-x border-b border-black px-2 py-0.5">Кол-во</td>
                <td className="border-x border-b border-black px-2 py-0.5 font-black font-mono">{slot.qty}</td>
              </tr>
            </React.Fragment>
          ))}

          <tr>
            <td colSpan={2} className="border border-black px-2 py-0.5">Вес брутто</td>
            <td className="border border-black px-2 py-0.5 font-bold font-mono">{vals.weightGross}</td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black px-2 py-0.5">Вес нетто</td>
            <td className="border border-black px-2 py-0.5 font-bold font-mono">{vals.weightNetto}</td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black px-2 py-0.5">Дата упаковки</td>
            <td className="border border-black px-2 py-0.5 font-bold">{vals.packDate}</td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black px-2 py-0.5">Страна происхождения</td>
            <td className="border border-black px-2 py-0.5 font-bold">{vals.country}</td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black px-2 py-0.5">Пункт назначения</td>
            <td className="border border-black px-2 py-0.5 font-bold">{vals.destination}</td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black px-2 py-0.5 font-black">ТР ТС 017/2011</td>
            <td className="border border-black px-2 py-0.5 font-black">EAC</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  // Преобразует тару в значения для Шаблона 2 или 3 (при пакетной печати нескольких тар)
  const bagToSingleVals = (bag: BagGroupSummary, isPrimary: boolean) => {
    if (isPrimary && selectedBags.length <= 1) {
      return {
        tara: tplTara,
        order: tplOrder,
        name: tplName,
        modelSide: tplModelSide,
        article: tplArticle,
        color: tplColor,
        size: tplSize,
        qtyStr: tplQtyStr,
        weightGross: tplWeightGross,
        weightNetto: tplWeightNetto,
        packDate: tplPackDate,
        country: tplCountry,
        destination: tplDestination
      };
    }
    const first = bag.rows[0];
    const szInfo = findSizeBreakdownForRow(first, ledgerRows, sizeMatrices);
    return {
      tara: bag.taraNo,
      order: bag.orderNo,
      name: bag.productName,
      modelSide: bag.model,
      article: first.article || tplArticle,
      color: first.color,
      size: first.sizeText || szInfo.sizeText,
      qtyStr: first.sizeQtyText || String(first.qty),
      weightGross: bag.weightKg !== '' ? String(bag.weightKg) : '',
      weightNetto: first.weightNettoKg !== undefined && first.weightNettoKg !== '' ? String(first.weightNettoKg) : '',
      packDate: first.packDate || tplPackDate,
      country: first.countryOrigin || tplCountry,
      destination: first.destination || tplDestination
    };
  };

  const bagToMultiVals = (bag: BagGroupSummary, isPrimary: boolean) => {
    if (isPrimary && selectedBags.length <= 1) {
      return {
        tara: tplTara,
        order: tplOrder,
        name: tplName,
        article: tplArticle,
        totalQty: tplTotalQty,
        slots: tplColorSlots,
        weightGross: tplWeightGross,
        weightNetto: tplWeightNetto,
        packDate: tplPackDate,
        country: tplCountry,
        destination: tplDestination
      };
    }
    const first = bag.rows[0];
    const slots: ColorSlot[] = Array.from({ length: 5 }, (_, idx) => {
      const r = bag.rows[idx];
      if (!r) return { color: '', size: '', qty: '' };
      const rSz = findSizeBreakdownForRow(r, ledgerRows, sizeMatrices);
      return { color: r.color, size: r.sizeText || rSz.sizeText, qty: String(r.qty) };
    });
    return {
      tara: bag.taraNo,
      order: bag.orderNo,
      name: bag.productName,
      article: first.article || tplArticle,
      totalQty: String(bag.totalQty),
      slots,
      weightGross: bag.weightKg !== '' ? String(bag.weightKg) : '',
      weightNetto: first.weightNettoKg !== undefined && first.weightNettoKg !== '' ? String(first.weightNettoKg) : '',
      packDate: first.packDate || tplPackDate,
      country: first.countryOrigin || tplCountry,
      destination: first.destination || tplDestination
    };
  };

  // Формирование листов печати / предпросмотра (A4: пары [1-2, 3-4, ..., 49-50], без пустой 50-й!)
  const renderPrintableSheets = (forPrint: boolean) => {
    const targetBags = selectedBags;

    // По 2 одинаковые копии каждой тары на одном A4 (1-1, 2-2, ...)
    if (layoutMode === 'two_up' && pairMode === 'duplicate_single') {
      if (targetBags.length === 0) {
        if (subTab === 'qr_tara') return null;
        if (subTab === 'single_color') {
          const vals = {
            tara: tplTara,
            order: tplOrder,
            name: tplName,
            modelSide: tplModelSide,
            article: tplArticle,
            color: tplColor,
            size: tplSize,
            qtyStr: tplQtyStr,
            weightGross: tplWeightGross,
            weightNetto: tplWeightNetto,
            packDate: tplPackDate,
            country: tplCountry,
            destination: tplDestination
          };
          return (
            <div className="grid grid-cols-2 gap-6 items-start">
              <div>{renderSingleColorStickerForValues(vals, 'left')}</div>
              <div className="border-l border-dashed border-slate-400 pl-6">
                {renderSingleColorStickerForValues(vals, 'right')}
              </div>
            </div>
          );
        }
        const mVals = {
          tara: tplTara,
          order: tplOrder,
          name: tplName,
          article: tplArticle,
          totalQty: tplTotalQty,
          slots: tplColorSlots,
          weightGross: tplWeightGross,
          weightNetto: tplWeightNetto,
          packDate: tplPackDate,
          country: tplCountry,
          destination: tplDestination
        };
        return (
          <div className="grid grid-cols-2 gap-6 items-start">
            <div>{renderMultiColor5StickerForValues(mVals)}</div>
            <div className="border-l border-dashed border-slate-400 pl-6">
              {renderMultiColor5StickerForValues(mVals)}
            </div>
          </div>
        );
      }

      const totalPreviewPages = Math.max(1, Math.ceil(targetBags.length / PREVIEW_SHEETS_PER_PAGE));
      const safePage = Math.min(previewPage, totalPreviewPages - 1);
      const visibleBags = forPrint
        ? targetBags
        : targetBags.slice(safePage * PREVIEW_SHEETS_PER_PAGE, (safePage + 1) * PREVIEW_SHEETS_PER_PAGE);
      const startIndexOffset = forPrint ? 0 : safePage * PREVIEW_SHEETS_PER_PAGE;

      return (
        <div className={forPrint ? '' : 'space-y-8'}>
          {!forPrint && totalPreviewPages > 1 && (
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 text-xs text-slate-700">
              <span className="font-semibold">
                Предпросмотр листов: {startIndexOffset + 1}–{startIndexOffset + visibleBags.length} из {targetBags.length} (в печать/PDF выйдут все {targetBags.length} л.)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPreviewPage(p => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Пред.</span>
                </button>
                <span className="font-mono font-bold px-2">
                  {safePage + 1} / {totalPreviewPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewPage(p => Math.min(totalPreviewPages - 1, p + 1))}
                  disabled={safePage >= totalPreviewPages - 1}
                  className="px-2.5 py-1 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>След.</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
          {visibleBags.map((b, localIdx) => {
            const idx = startIndexOffset + localIdx;
            const singleVals = subTab === 'single_color' ? bagToSingleVals(b, idx === 0) : null;
            const multiVals = subTab === 'multi_color_5' ? bagToMultiVals(b, idx === 0) : null;
            return (
              <div
                key={`dup-${b.bagUid}`}
                className={`${
                  localIdx < visibleBags.length - 1
                    ? 'break-after-page pb-6 border-b-2 border-dashed border-slate-300 print:border-none print:pb-0'
                    : ''
                }`}
              >
                <div className="grid grid-cols-2 gap-6 items-start">
                  <div>
                    {subTab === 'qr_tara'
                      ? renderQrSticker(b)
                      : subTab === 'single_color' && singleVals
                      ? renderSingleColorStickerForValues(singleVals, 'left')
                      : multiVals
                      ? renderMultiColor5StickerForValues(multiVals)
                      : null}
                  </div>
                  <div className="border-l border-dashed border-slate-400 pl-6">
                    {subTab === 'qr_tara'
                      ? renderQrSticker(b)
                      : subTab === 'single_color' && singleVals
                      ? renderSingleColorStickerForValues(singleVals, 'right')
                      : multiVals
                      ? renderMultiColor5StickerForValues(multiVals)
                      : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // Режим по 1 этикетке на лист (или термоэтикетка)
    if (layoutMode === 'single') {
      if (targetBags.length === 0) {
        if (subTab === 'single_color') {
          return renderSingleColorStickerForValues(
            {
              tara: tplTara,
              order: tplOrder,
              name: tplName,
              modelSide: tplModelSide,
              article: tplArticle,
              color: tplColor,
              size: tplSize,
              qtyStr: tplQtyStr,
              weightGross: tplWeightGross,
              weightNetto: tplWeightNetto,
              packDate: tplPackDate,
              country: tplCountry,
              destination: tplDestination
            },
            'left'
          );
        }
        if (subTab === 'multi_color_5') {
          return renderMultiColor5StickerForValues({
            tara: tplTara,
            order: tplOrder,
            name: tplName,
            article: tplArticle,
            totalQty: tplTotalQty,
            slots: tplColorSlots,
            weightGross: tplWeightGross,
            weightNetto: tplWeightNetto,
            packDate: tplPackDate,
            country: tplCountry,
            destination: tplDestination
          });
        }
        return null;
      }

      return (
        <div className={forPrint ? '' : 'space-y-6'}>
          {targetBags.map((b, idx) => (
            <div
              key={b.bagUid}
              className={idx < targetBags.length - 1 ? 'break-after-page pb-6 border-b border-dashed border-slate-300 print:border-none print:pb-0' : ''}
            >
              {subTab === 'qr_tara'
                ? renderQrSticker(b)
                : subTab === 'single_color'
                ? renderSingleColorStickerForValues(bagToSingleVals(b, idx === 0), 'left')
                : renderMultiColor5StickerForValues(bagToMultiVals(b, idx === 0))}
            </div>
          ))}
        </div>
      );
    }

    // ПОСЛЕДОВАТЕЛЬНЫЙ РЕЖИМ НА A4: по 2 разные тары на лист -> [1-2], [3-4], ..., [49-50] (или только [49] если 50 нет)
    if (targetBags.length === 0) {
      if (subTab === 'single_color') {
        return (
          <div className="grid grid-cols-2 gap-6 items-start">
            <div>
              {renderSingleColorStickerForValues(
                {
                  tara: tplTara,
                  order: tplOrder,
                  name: tplName,
                  modelSide: tplModelSide,
                  article: tplArticle,
                  color: tplColor,
                  size: tplSize,
                  qtyStr: tplQtyStr,
                  weightGross: tplWeightGross,
                  weightNetto: tplWeightNetto,
                  packDate: tplPackDate,
                  country: tplCountry,
                  destination: tplDestination
                },
                'left'
              )}
            </div>
            <div />
          </div>
        );
      }
      if (subTab === 'multi_color_5') {
        return (
          <div className="grid grid-cols-2 gap-6 items-start">
            <div>
              {renderMultiColor5StickerForValues({
                tara: tplTara,
                order: tplOrder,
                name: tplName,
                article: tplArticle,
                totalQty: tplTotalQty,
                slots: tplColorSlots,
                weightGross: tplWeightGross,
                weightNetto: tplWeightNetto,
                packDate: tplPackDate,
                country: tplCountry,
                destination: tplDestination
              })}
            </div>
            <div />
          </div>
        );
      }
      return null;
    }

    const sheetPairs = pairBagsForA4(targetBags);

    return (
      <div className={forPrint ? '' : 'space-y-8'}>
        {sheetPairs.map(([leftBag, rightBag], sheetIdx) => (
          <div
            key={`sheet-${leftBag.bagUid}-${rightBag ? rightBag.bagUid : 'alone'}`}
            className={`${
              sheetIdx < sheetPairs.length - 1
                ? 'break-after-page pb-6 border-b-2 border-dashed border-slate-300 print:border-none print:pb-0'
                : ''
            }`}
          >
            <div className="grid grid-cols-2 gap-6 items-start">
              <div>
                {subTab === 'qr_tara'
                  ? renderQrSticker(leftBag)
                  : subTab === 'single_color'
                  ? renderSingleColorStickerForValues(bagToSingleVals(leftBag, sheetIdx === 0), 'left')
                  : renderMultiColor5StickerForValues(bagToMultiVals(leftBag, sheetIdx === 0))}
              </div>
              <div className={rightBag ? 'border-l border-dashed border-slate-400 pl-6' : ''}>
                {rightBag ? (
                  subTab === 'qr_tara'
                    ? renderQrSticker(rightBag)
                    : subTab === 'single_color'
                    ? renderSingleColorStickerForValues(bagToSingleVals(rightBag, false), 'right')
                    : renderMultiColor5StickerForValues(bagToMultiVals(rightBag, false))
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const a4SheetCount =
    layoutMode === 'two_up'
      ? pairMode === 'duplicate_single'
        ? selectedBags.length
        : selectedBags.length > 0
        ? Math.ceil(selectedBags.length / 2)
        : 0
      : selectedBags.length;

  return (
    <div className="space-y-4">
      {/* Переключатель 3 отдельных шаблонов и кнопка печати */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setSubTab('qr_tara')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'qr_tara' ? 'bg-sky-500 text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Шаблон 1: QR-маркировка тары (Рис. 7)</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('single_color')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'single_color' ? 'bg-sky-500 text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Шаблон 2: 1 цвет + размеры (Рис. 5 верх)</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('multi_color_5')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === 'multi_color_5' ? 'bg-sky-500 text-slate-950' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Шаблон 3: до 5 цветов (Рис. 5 низ)</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setLayoutMode('two_up')}
              className={`px-2.5 py-1 rounded font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                layoutMode === 'two_up' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              По 2 на лист A4
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('single')}
              className={`px-2.5 py-1 rounded font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                layoutMode === 'single' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              1 этикетка
            </button>
          </div>

          {layoutMode === 'two_up' && (
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setPairMode('duplicate_single')}
                className={`px-2.5 py-1 rounded font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                  pairMode === 'duplicate_single' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                2 копии на лист
              </button>
              <button
                type="button"
                onClick={() => setPairMode('sequential')}
                className={`px-2.5 py-1 rounded font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                  pairMode === 'sequential' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                По порядку (1-2, 3-4)
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleExportMarkingPdf}
            disabled={isExportingPdf || (subTab === 'qr_tara' && selectedBags.length === 0)}
            className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <FileText className="w-4 h-4" />
            <span>{isExportingPdf ? 'Создаём PDF...' : 'Скачать PDF'}</span>
          </button>

          <button
            type="button"
            onClick={handleTriggerPrint}
            disabled={subTab === 'qr_tara' && selectedBags.length === 0}
            className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Printer className="w-4 h-4" />
            <span>
              Печать ({selectedBags.length} тар · {a4SheetCount || 1} л.)
            </span>
          </button>
        </div>
      </div>

      {/* Панель выбора тар и диапазона печати (по 2 копии на лист A4) + дата на этикетке */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-slate-200">Выбор тар для печати на A4 (по 2 копии на лист):</span>
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1">
              <span className="text-slate-400">с №</span>
              <input
                type="number"
                value={rangeFrom}
                onChange={e => setRangeFrom(e.target.value)}
                className="w-14 bg-transparent text-white font-mono font-bold text-center focus:outline-none"
              />
              <span className="text-slate-400">по №</span>
              <input
                type="number"
                value={rangeTo}
                onChange={e => setRangeTo(e.target.value)}
                className="w-14 bg-transparent text-white font-mono font-bold text-center focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSelectRange}
                className="px-2.5 py-1 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold cursor-pointer"
              >
                Выбрать диапазон
              </button>
            </div>

            <button
              type="button"
              onClick={handleSelectAllAllowed}
              disabled={bagGroups.length === 0}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 font-semibold cursor-pointer"
            >
              Выбрать все разрешённые
            </button>
            <button
              type="button"
              onClick={() => setSelectedBagUids([])}
              disabled={selectedBagUids.length === 0}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 border border-slate-700 font-semibold cursor-pointer"
            >
              Снять выбор
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <label className="text-slate-400 font-semibold">Дата на QR-маркировке:</label>
            <input
              type="text"
              value={labelDate}
              onChange={e => setLabelDate(e.target.value)}
              placeholder="17.11.2026"
              className="w-28 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono font-bold text-center focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* Сетка тар с отметкой разрешения / блокировки */}
        {bagGroups.length === 0 ? (
          <div className="text-xs text-slate-400 py-2">
            В «Упаковочном листе» пока нет тар. Добавьте тары, чтобы выбрать их для печати.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
            {bagGroups.map(bag => {
              const perm = bagPermissions[bag.bagUid];
              const isAllowed = perm ? perm.allowed : true;
              const isChecked = isAllowed && selectedBagUidSet.has(bag.bagUid);
              const colorsText = bag.rows.map(r => `${r.color}: ${r.qty}`).join(', ');

              return (
                <button
                  key={bag.bagUid}
                  type="button"
                  onClick={() => handleToggleBag(bag)}
                  className={`p-2 rounded-lg border text-left flex items-start gap-2 transition-colors ${
                    !isAllowed
                      ? 'bg-red-950/60 border-red-500/60 text-red-200 cursor-not-allowed'
                      : isChecked
                      ? 'bg-sky-950/70 border-sky-400 text-white cursor-pointer'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600 cursor-pointer'
                  }`}
                >
                  <div className="pt-0.5 shrink-0">
                    {!isAllowed ? (
                      <Lock className="w-4 h-4 text-red-400" />
                    ) : isChecked ? (
                      <CheckSquare className="w-4 h-4 text-sky-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 text-[11px]">
                    <div className="font-black flex items-center justify-between gap-1">
                      <span>№ {bag.taraNo} • {bag.orderNo}</span>
                      <span className="font-mono">{bag.totalQty} шт</span>
                    </div>
                    <div className="truncate text-slate-400">{colorsText}</div>
                    {!isAllowed && (
                      <div className="text-[10px] font-bold text-red-400 mt-0.5">
                        Печать маркировки запрещена
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Сводный статус проверки брака */}
        {blockedBags.length > 0 && (
          <div className="bg-red-950/60 border border-red-500/70 rounded-lg px-3 py-2 text-xs text-red-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-red-300">
                Заблокировано проверкой брака ({blockedBags.length} тар):
              </strong>{' '}
              такие тары автоматически исключены из печати маркировки (Разница &lt; 0 — «Печать маркировки запрещена»).
            </div>
          </div>
        )}
        {bagGroups.length > 0 && blockedBags.length === 0 && (
          <div className="text-xs text-emerald-300 font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            <span>Все тары прошли проверку брака — печать разрешена.</span>
          </div>
        )}
      </div>

      {/* Поля редактирования для Шаблонов 2 и 3 (Рис. 5) */}
      {subTab !== 'qr_tara' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="text-xs font-bold text-slate-200">
            Данные маркировки (автоматически заполняются из выбранной тары или вводятся вручную):
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-xs">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">№ тары</label>
              <input value={tplTara} onChange={e => setTplTara(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Номер заказа</label>
              <input value={tplOrder} onChange={e => setTplOrder(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-400 mb-1">Наименование</label>
              <input value={tplName} onChange={e => setTplName(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Артикул</label>
              <input value={tplArticle} onChange={e => setTplArticle(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Боковой код модели</label>
              <input value={tplModelSide} onChange={e => setTplModelSide(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
            </div>

            {subTab === 'single_color' ? (
              <>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Цвет</label>
                  <input value={tplColor} onChange={e => setTplColor(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-slate-400 mb-1">Размер</label>
                  <input value={tplSize} onChange={e => setTplSize(e.target.value)} placeholder="2XS + XS + S + M + L + XL" className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Кол-во (разбивка)</label>
                  <input value={tplQtyStr} onChange={e => setTplQtyStr(e.target.value)} placeholder="2 + 4 + 4 + 6 + 4 + 3 = 23" className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
                </div>
              </>
            ) : (
              <div className="col-span-2 sm:col-span-4 lg:col-span-6 space-y-2 pt-1">
                <div className="w-44">
                  <label className="block text-[11px] text-slate-400 mb-1">Общее кол-во</label>
                  <input value={tplTotalQty} onChange={e => setTplTotalQty(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white font-mono font-bold" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  {tplColorSlots.map((sl, idx) => (
                    <div key={idx} className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                      <div className="text-[10px] font-bold text-slate-400">Позиция {idx + 1}</div>
                      <input
                        value={sl.color}
                        onChange={e =>
                          setTplColorSlots(prev => prev.map((x, i) => (i === idx ? { ...x, color: e.target.value } : x)))
                        }
                        placeholder="Цвет"
                        className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-[11px]"
                      />
                      <input
                        value={sl.size}
                        onChange={e =>
                          setTplColorSlots(prev => prev.map((x, i) => (i === idx ? { ...x, size: e.target.value } : x)))
                        }
                        placeholder="Размер"
                        className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-[11px]"
                      />
                      <input
                        value={sl.qty}
                        onChange={e =>
                          setTplColorSlots(prev => prev.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))
                        }
                        placeholder="Кол-во"
                        className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white text-[11px] font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Вес брутто</label>
              <input value={tplWeightGross} onChange={e => setTplWeightGross(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Вес нетто</label>
              <input value={tplWeightNetto} onChange={e => setTplWeightNetto(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Дата упаковки</label>
              <input value={tplPackDate} onChange={e => setTplPackDate(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Страна происхождения</label>
              <input value={tplCountry} onChange={e => setTplCountry(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Пункт назначения</label>
              <input value={tplDestination} onChange={e => setTplDestination(e.target.value)} className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-white" />
            </div>
          </div>
        </div>
      )}

      {/* Область предпросмотра листов A4 */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 overflow-x-auto">
        {subTab === 'qr_tara' && selectedBags.length === 0 ? (
          <div className="text-center py-10 text-slate-300 text-xs">
            Выберите одну или несколько разрешённых тар выше (например, диапазон с № 1 по № 50) для предпросмотра и печати.
          </div>
        ) : (
          <div className="min-w-[340px] max-w-[980px] mx-auto bg-white p-4 sm:p-6 rounded-lg shadow-xl">
            {renderPrintableSheets(false)}
          </div>
        )}
      </div>
    </div>
  );
});

MarkingTemplatesTab.displayName = 'MarkingTemplatesTab';

export default MarkingTemplatesTab;
