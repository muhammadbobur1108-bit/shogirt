import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardList,
  Layers,
  Truck,
  FileSpreadsheet,
  ShieldAlert,
  QrCode,
  Archive,
  Eye,
  Printer,
  FileText,
  ZoomIn,
  ZoomOut,
  X
} from 'lucide-react';
import {
  FactoryLedgerRow,
  OrderSizeMatrix,
  TEX_ORDERS_UPDATED_EVENT,
  loadOrdersAndMatrices
} from '../lib/ordersSizeStore';
import {
  NAKLADNOY_STORAGE_KEYS,
  PackingListRow,
  WaybillDocument,
  WaybillSignatories,
  buildOrderColorSummary,
  createAndSaveWaybillFromRows,
  evaluateDefectChecks,
  formatRuDate,
  getNextWaybillNo,
  groupPackingRowsByBag,
  loadPackingRows,
  loadSavedWaybills,
  loadSignatories,
  rememberWaybillNo,
  savePackingRows,
  saveSignatories,
  saveWaybills
} from '../lib/nakladnoyStore';
import {
  PrintPageFormat,
  PrintPreviewPayload,
  buildPrintHtmlDocument,
  escapeHtml,
  printHtmlViaIframe
} from '../lib/printBridge';
import PackingListTab from './nakladnoy/PackingListTab';
import OrderColorSummaryTab from './nakladnoy/OrderColorSummaryTab';
import ShipmentQrTab from './nakladnoy/ShipmentQrTab';
import WaybillTab from './nakladnoy/WaybillTab';
import DefectCheckTab from './nakladnoy/DefectCheckTab';
import MarkingTemplatesTab, { MarkingTemplatesTabHandle } from './nakladnoy/MarkingTemplatesTab';
import WaybillsRegistryTab from './nakladnoy/WaybillsRegistryTab';

export type NakladnoySectionId =
  | 'packing_list'
  | 'order_color_summary'
  | 'shipment'
  | 'waybill'
  | 'waybill_registry'
  | 'defect_check'
  | 'marking_templates';

interface NakladnoyViewProps {
  ledgerRows?: FactoryLedgerRow[];
  sizeMatrices?: Record<string, OrderSizeMatrix>;
  currentUserName?: string;
  initialSection?: NakladnoySectionId;
  sectionNonce?: number;
}

export default function NakladnoyView({
  ledgerRows: propLedgerRows,
  sizeMatrices: propSizeMatrices,
  currentUserName,
  initialSection,
  sectionNonce
}: NakladnoyViewProps) {
  const [activeSection, setActiveSection] = useState<NakladnoySectionId>(initialSection || 'packing_list');
  const [packingRows, setPackingRows] = useState<PackingListRow[]>(() => loadPackingRows());
  const [savedWaybills, setSavedWaybills] = useState<WaybillDocument[]>(() => loadSavedWaybills());
  const [signatories, setSignatories] = useState<WaybillSignatories>(() => loadSignatories());
  const [activeWaybill, setActiveWaybill] = useState<WaybillDocument | null>(() => {
    try {
      const raw = localStorage.getItem(NAKLADNOY_STORAGE_KEYS.ACTIVE_WAYBILL);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.rows)) return parsed;
      }
    } catch {
      // ignore
    }
    return null;
  });

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
      setSavedWaybills(loadSavedWaybills());
      try {
        const raw = localStorage.getItem(NAKLADNOY_STORAGE_KEYS.ACTIVE_WAYBILL);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.rows)) setActiveWaybill(parsed);
        }
      } catch {
        // ignore
      }
    }
  }, [initialSection, sectionNonce]);
  const [selectedBagUidForTemplate, setSelectedBagUidForTemplate] = useState<string | null>(null);
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const [printPreview, setPrintPreview] = useState<PrintPreviewPayload | null>(null);
  const [previewFormat, setPreviewFormat] = useState<PrintPageFormat>('a4_portrait');
  const [previewZoom, setPreviewZoom] = useState<number>(100);
  const [previewIframeHeight, setPreviewIframeHeight] = useState<number>(1123);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);
  const markingTemplatesRef = useRef<MarkingTemplatesTabHandle | null>(null);

  // Живая синхронизация с базой Заказов («Размеры по заказу»)
  const [storeSnapshot, setStoreSnapshot] = useState<{
    rows: FactoryLedgerRow[];
    matrices: Record<string, OrderSizeMatrix>;
  }>(() => loadOrdersAndMatrices());

  useEffect(() => {
    const sync = () => setStoreSnapshot(loadOrdersAndMatrices());
    window.addEventListener(TEX_ORDERS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(TEX_ORDERS_UPDATED_EVENT, sync);
  }, []);

  const liveLedgerRows = propLedgerRows && propLedgerRows.length > 0 ? propLedgerRows : storeSnapshot.rows;
  const liveSizeMatrices =
    propSizeMatrices && Object.keys(propSizeMatrices).length > 0 ? propSizeMatrices : storeSnapshot.matrices;

  const showNotice = (msg: string) => {
    setNoticeText(msg);
    setTimeout(() => {
      setNoticeText(prev => (prev === msg ? null : prev));
    }, 3600);
  };

  useEffect(() => {
    if (!printPreview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPrintPreview(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [printPreview]);

  const openPrintPreview = (payload: PrintPreviewPayload) => {
    const initialFormat = payload.format || 'a4_portrait';
    setPreviewFormat(initialFormat);
    setPreviewZoom(100);
    setPreviewIframeHeight(initialFormat === 'a4_landscape' ? 794 : 1123);
    setPrintPreview(payload);
  };

  const handleConfirmNativePrint = () => {
    if (!printPreview) return;
    printHtmlViaIframe({
      title: printPreview.title,
      format: previewFormat,
      marginMm: printPreview.marginMm,
      extraCss: printPreview.extraCss,
      htmlBody: printPreview.htmlBody,
      onError: msg => showNotice(msg)
    });
  };

  const handlePreviewDownloadPdf = async () => {
    if (!printPreview?.onDownloadPdf) return;
    setIsDownloadingPdf(true);
    try {
      await printPreview.onDownloadPdf();
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const previewDocumentHtml = useMemo(() => {
    if (!printPreview) return '';
    return buildPrintHtmlDocument({
      title: printPreview.title,
      format: previewFormat,
      marginMm: printPreview.marginMm,
      extraCss: printPreview.extraCss,
      htmlBody: printPreview.htmlBody,
      screenPreview: true
    });
  }, [printPreview, previewFormat]);

  const handleOpenSectionPrintPreview = () => {
    if (activeSection === 'marking_templates') {
      markingTemplatesRef.current?.openPrintPreview();
      return;
    }

    if (activeSection === 'waybill') {
      if (!activeWaybill) {
        showNotice('Активная накладная ещё не сформирована. Сначала сформируйте накладную в разделе «Отгрузка и QR-сканер».');
        return;
      }
      const sig = activeWaybill.signatories || signatories;
      const formattedDate = formatRuDate(activeWaybill.waybillDate);
      const showWeight = activeWaybill.rows.some(
        r => r.grossWeightKg !== '' && Number(r.grossWeightKg) > 0
      );
      const rowsHtml = activeWaybill.rows
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
            ${showWeight ? `<td class="ta-r mono bold">${r.grossWeightKg === '' ? '' : escapeHtml(r.grossWeightKg)}</td>` : ''}
          </tr>`
        )
        .join('');
      const sigItems: [string, string][] = [
        ['Директор:', sig.directorName],
        ['Принял:', sig.recipientName],
        ['Зав. складом:', sig.warehouseManagerName],
        ['Сдал:', sig.senderName]
      ];
      openPrintPreview({
        title: `Накладная № ${activeWaybill.waybillNo}`,
        subtitle: `от ${formattedDate} · Позиций: ${activeWaybill.rows.length} · Тара: ${activeWaybill.totalTara} · Кол-во: ${activeWaybill.totalQty} шт`,
        format: 'a4_portrait',
        marginMm: 10,
        extraCss: `
          .wb-wrap { width: 100%; color: #0f172a; font-family: Arial, sans-serif; }
          .wb-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
          .wb-title { flex: 1; text-align: center; font-size: 18px; font-weight: 900; }
          .wb-date { font-size: 15px; font-weight: 900; }
          .mono { font-family: monospace; }
          .bold { font-weight: 700; }
          .ta-c { text-align: center; }
          .ta-r { text-align: right; }
          .wb-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
          .wb-tbl th, .wb-tbl td { border: 1px solid #334155; padding: 5px 6px; }
          .wb-tbl thead th { background: #1F5E9C; color: #ffffff; font-weight: 700; }
          .wb-tbl tfoot td { background: #f1f5f9; font-weight: 900; }
          .sigs { max-width: 560px; margin: 26px auto 0; font-size: 12px; break-inside: avoid; page-break-inside: avoid; }
          .sig-row { display: grid; grid-template-columns: 3fr 5fr 4fr; gap: 12px; align-items: start; margin-bottom: 16px; }
          .sig-role { font-weight: 600; padding-top: 3px; }
          .sig-line-box { text-align: center; }
          .sig-line { border-bottom: 1px solid #0f172a; height: 18px; }
          .sig-name { font-weight: 600; padding-top: 2px; }
          .sig-sub { font-size: 10px; color: #475569; margin-top: 2px; }
        `,
        htmlBody: `
          <div class="wb-wrap">
            <div class="wb-head">
              <div class="wb-title">Накладная № <span class="mono">${escapeHtml(activeWaybill.waybillNo)}</span></div>
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
                  ${showWeight ? '<th class="ta-r" style="width:78px">Вес брутто</th>' : ''}
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
              <tfoot>
                <tr>
                  <td colspan="6" class="ta-r">ИТОГО:</td>
                  <td class="ta-r mono">${activeWaybill.totalQty}</td>
                  <td class="ta-c mono">${activeWaybill.totalTara}</td>
                  ${showWeight ? `<td class="ta-r mono">${activeWaybill.totalGrossWeightKg.toFixed(1)}</td>` : ''}
                </tr>
              </tfoot>
            </table>
            <div class="sigs">
              ${sigItems
                .map(
                  ([role, name]) => `
                <div class="sig-row">
                  <div class="sig-role">${escapeHtml(role)}</div>
                  <div class="sig-line-box"><div class="sig-line"></div><div class="sig-sub">Подпись</div></div>
                  <div class="sig-fio"><div class="sig-name">${escapeHtml(name)}</div><div class="sig-sub">(Ф.И.О.)</div></div>
                </div>`
                )
                .join('')}
            </div>
          </div>`
      });
      return;
    }

    const commonTableCss = `
      .doc-wrap { width: 100%; color: #0f172a; font-family: Arial, sans-serif; }
      .doc-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
      .doc-title { font-size: 16px; font-weight: 900; color: #b91c1c; }
      .doc-meta { font-size: 11px; color: #334155; font-family: monospace; font-weight: 700; }
      .doc-tbl { width: 100%; border-collapse: collapse; font-size: 10.5px; }
      .doc-tbl th, .doc-tbl td { border: 1px solid #334155; padding: 4px 6px; }
      .doc-tbl thead th { background: #4472C4; color: #ffffff; font-weight: 700; }
      .doc-tbl tbody tr:nth-child(odd) { background: #f8fafc; }
      .doc-tbl tfoot td { background: #e2e8f0; font-weight: 900; }
      .ta-c { text-align: center; }
      .ta-r { text-align: right; }
      .bold { font-weight: 700; }
      .mono { font-family: monospace; }
      .bad { background: #dc2626 !important; color: #fff !important; font-weight: 900; }
    `;

    const todayText = new Date().toLocaleDateString('ru-RU');

    if (activeSection === 'packing_list') {
      if (packingRows.length === 0) {
        showNotice('Упаковочный лист пуст — нечего просматривать перед печатью.');
        return;
      }
      const totalQty = packingRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
      const uniqueBags = groupPackingRowsByBag(packingRows).length;
      openPrintPreview({
        title: 'Упаковочный лист',
        subtitle: `Позиций: ${packingRows.length} · Уникальных тар: ${uniqueBags} · Кол-во: ${totalQty} шт`,
        format: 'a4_portrait',
        marginMm: 10,
        extraCss: commonTableCss,
        htmlBody: `
          <div class="doc-wrap">
            <div class="doc-head">
              <div class="doc-title">Упаковочный лист</div>
              <div class="doc-meta">Дата: ${escapeHtml(todayText)} · Тар: ${uniqueBags}</div>
            </div>
            <table class="doc-tbl">
              <thead>
                <tr>
                  <th class="ta-c" style="width:46px">№</th>
                  <th>Заказ</th>
                  <th>Модель</th>
                  <th>Наименование</th>
                  <th>Цвет</th>
                  <th class="ta-r" style="width:68px">Кол-во</th>
                  <th class="ta-c" style="width:110px">QR-код тары</th>
                </tr>
              </thead>
              <tbody>
                ${packingRows
                  .map(
                    r => `<tr>
                      <td class="ta-c mono bold">${escapeHtml(r.taraNo)}</td>
                      <td class="bold">${escapeHtml(r.orderNo)}</td>
                      <td>${escapeHtml(r.model)}</td>
                      <td>${escapeHtml(r.productName)}</td>
                      <td>${escapeHtml(r.color)}</td>
                      <td class="ta-r mono bold">${escapeHtml(r.qty)}</td>
                      <td class="ta-c mono">${escapeHtml(r.qrCode)}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="5" class="ta-r">ИТОГО:</td>
                  <td class="ta-r mono">${totalQty}</td>
                  <td class="ta-c">Тар: ${uniqueBags}</td>
                </tr>
              </tfoot>
            </table>
          </div>`
      });
      return;
    }

    if (activeSection === 'order_color_summary') {
      const summary = buildOrderColorSummary(packingRows);
      if (summary.length === 0) {
        showNotice('Отчёт «Всего заказ цвет» пуст. Сначала заполните «Упаковочный лист».');
        return;
      }
      const totalQty = summary.reduce((s, r) => s + r.totalQty, 0);
      openPrintPreview({
        title: 'Всего заказ цвет',
        subtitle: `Сводных позиций: ${summary.length} · Итого: ${totalQty} шт`,
        format: 'a4_portrait',
        marginMm: 10,
        extraCss: commonTableCss,
        htmlBody: `
          <div class="doc-wrap">
            <div class="doc-head">
              <div class="doc-title">Всего заказ цвет</div>
              <div class="doc-meta">Дата: ${escapeHtml(todayText)}</div>
            </div>
            <table class="doc-tbl">
              <thead>
                <tr>
                  <th class="ta-c" style="width:46px">№</th>
                  <th>Заказ</th>
                  <th>Модель</th>
                  <th>Наименование</th>
                  <th>Цвет</th>
                  <th class="ta-r" style="width:72px">Кол-во</th>
                </tr>
              </thead>
              <tbody>
                ${summary
                  .map(
                    item => `<tr>
                      <td class="ta-c mono bold">${escapeHtml(item.displayNo)}</td>
                      <td class="bold">${escapeHtml(item.orderNo)}</td>
                      <td>${escapeHtml(item.model)}</td>
                      <td>${escapeHtml(item.productName)}</td>
                      <td>${escapeHtml(item.color)}</td>
                      <td class="ta-r mono bold">${escapeHtml(item.totalQty)}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="5" class="ta-r">ИТОГО ПО ЦВЕТАМ И ЗАКАЗАМ:</td>
                  <td class="ta-r mono">${totalQty}</td>
                </tr>
              </tfoot>
            </table>
          </div>`
      });
      return;
    }

    if (activeSection === 'shipment') {
      const selected = packingRows.filter(r => r.selectedForShipment);
      if (selected.length === 0) {
        showNotice('Нет тар, отмеченных к отгрузке. Отметьте или отсканируйте тары.');
        return;
      }
      const ordered = [...selected].sort((a, b) => (a.shippedScanIndex || 999999) - (b.shippedScanIndex || 999999));
      const totalQty = ordered.reduce((s, r) => s + (Number(r.qty) || 0), 0);
      openPrintPreview({
        title: 'Лист отгрузки по QR',
        subtitle: `Отгружено позиций: ${ordered.length} · Кол-во: ${totalQty} шт`,
        format: 'a4_portrait',
        marginMm: 10,
        extraCss: commonTableCss,
        htmlBody: `
          <div class="doc-wrap">
            <div class="doc-head">
              <div class="doc-title">Ведомость отгрузки по QR</div>
              <div class="doc-meta">Дата: ${escapeHtml(todayText)}</div>
            </div>
            <table class="doc-tbl">
              <thead>
                <tr>
                  <th class="ta-c" style="width:52px">Индекс</th>
                  <th class="ta-c" style="width:56px">№ тары</th>
                  <th>Заказ</th>
                  <th>Модель</th>
                  <th>Цвет</th>
                  <th class="ta-r" style="width:64px">Кол-во</th>
                  <th class="ta-r" style="width:64px">Вес (кг)</th>
                  <th class="ta-c" style="width:74px">№ отгр.</th>
                </tr>
              </thead>
              <tbody>
                ${ordered
                  .map(
                    r => `<tr>
                      <td class="ta-c mono bold">${r.shippedScanIndex ? `#${escapeHtml(r.shippedScanIndex)}` : '—'}</td>
                      <td class="ta-c mono bold">${escapeHtml(r.taraNo)}</td>
                      <td class="bold">${escapeHtml(r.orderNo)}</td>
                      <td>${escapeHtml(r.model)}</td>
                      <td>${escapeHtml(r.color)}</td>
                      <td class="ta-r mono bold">${escapeHtml(r.qty)}</td>
                      <td class="ta-r mono">${r.weightKg === '' ? '—' : escapeHtml(r.weightKg)}</td>
                      <td class="ta-c mono">${escapeHtml(r.shipmentNo || '—')}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="5" class="ta-r">ИТОГО К ОТГРУЗКЕ:</td>
                  <td class="ta-r mono">${totalQty}</td>
                  <td colspan="2"></td>
                </tr>
              </tfoot>
            </table>
          </div>`
      });
      return;
    }

    if (activeSection === 'waybill_registry') {
      if (savedWaybills.length === 0) {
        showNotice('Реестр накладных пуст.');
        return;
      }
      openPrintPreview({
        title: 'Реестр сформированных накладных',
        subtitle: `Всего документов: ${savedWaybills.length}`,
        format: 'a4_portrait',
        marginMm: 10,
        extraCss: commonTableCss,
        htmlBody: `
          <div class="doc-wrap">
            <div class="doc-head">
              <div class="doc-title">Реестр сформированных накладных</div>
              <div class="doc-meta">Дата печати: ${escapeHtml(todayText)}</div>
            </div>
            <table class="doc-tbl">
              <thead>
                <tr>
                  <th class="ta-c" style="width:90px">Накладная №</th>
                  <th class="ta-c" style="width:110px">Дата отправки</th>
                  <th>Создал документ</th>
                  <th class="ta-c" style="width:70px">Тара</th>
                  <th class="ta-r" style="width:80px">Кол-во</th>
                </tr>
              </thead>
              <tbody>
                ${savedWaybills
                  .map(
                    wb => `<tr>
                      <td class="ta-c mono bold">№ ${escapeHtml(wb.waybillNo)}</td>
                      <td class="ta-c mono">${escapeHtml(formatRuDate(wb.waybillDate))}</td>
                      <td>${escapeHtml((wb.createdBy || '').trim() || wb.signatories?.senderName || '—')}</td>
                      <td class="ta-c mono">${escapeHtml(wb.totalTara)}</td>
                      <td class="ta-r mono bold">${escapeHtml(wb.totalQty)}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
      });
      return;
    }

    if (activeSection === 'defect_check') {
      if (defectChecks.length === 0) {
        showNotice('Нет данных в «Проверка брака». Сначала заполните «Упаковочный лист».');
        return;
      }
      openPrintPreview({
        title: 'Проверка брака',
        subtitle: `Позиций: ${defectChecks.length} · Заблокировано: ${blockedDefectCount}`,
        format: 'a4_landscape',
        marginMm: 8,
        extraCss: commonTableCss,
        htmlBody: `
          <div class="doc-wrap">
            <div class="doc-head">
              <div class="doc-title">Проверка брака</div>
              <div class="doc-meta">Дата: ${escapeHtml(todayText)} · Заблокировано: ${blockedDefectCount}</div>
            </div>
            <table class="doc-tbl">
              <thead>
                <tr>
                  <th class="ta-c" style="width:40px">№</th>
                  <th>Заказ</th>
                  <th>Модель</th>
                  <th>Наименование</th>
                  <th>Цвет</th>
                  <th class="ta-r">Кол-во</th>
                  <th class="ta-r">1-Сорт</th>
                  <th class="ta-r">Всего уп.</th>
                  <th class="ta-r">Раздача</th>
                  <th class="ta-r">Разница</th>
                  <th>Контроль</th>
                </tr>
              </thead>
              <tbody>
                ${defectChecks
                  .map(
                    dc => `<tr>
                      <td class="ta-c mono bold">${escapeHtml(dc.row.taraNo)}</td>
                      <td class="bold">${escapeHtml(dc.row.orderNo)}</td>
                      <td>${escapeHtml(dc.row.model)}</td>
                      <td>${escapeHtml(dc.row.productName)}</td>
                      <td>${escapeHtml(dc.row.color)}</td>
                      <td class="ta-r mono">${escapeHtml(dc.row.qty)}</td>
                      <td class="ta-r mono">${escapeHtml(dc.firstSort)}</td>
                      <td class="ta-r mono bold">${escapeHtml(dc.totalPack)}</td>
                      <td class="ta-r mono">${escapeHtml(dc.razdacha)}</td>
                      <td class="ta-r mono ${dc.difference < 0 ? 'bad' : 'bold'}">${escapeHtml(dc.difference)}</td>
                      <td class="bold">${dc.isBlocked ? 'Печать маркировки запрещена' : 'Разрешено'}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
      });
    }
  };

  const handlePackingRowsChange = (next: PackingListRow[]) => {
    setPackingRows(next);
    savePackingRows(next);
  };

  const handleActiveWaybillChange = (wb: WaybillDocument | null) => {
    setActiveWaybill(wb);
    try {
      if (wb) {
        localStorage.setItem(NAKLADNOY_STORAGE_KEYS.ACTIVE_WAYBILL, JSON.stringify(wb));
      } else {
        localStorage.removeItem(NAKLADNOY_STORAGE_KEYS.ACTIVE_WAYBILL);
      }
    } catch {
      // ignore
    }
  };

  const handleSignatoriesChange = (next: WaybillSignatories) => {
    setSignatories(next);
    saveSignatories(next);
  };

  // Авторасчёт «Проверка брака» (Рис. 8)
  const defectChecks = useMemo(
    () => evaluateDefectChecks(packingRows, liveLedgerRows),
    [packingRows, liveLedgerRows]
  );

  const blockedDefectCount = useMemo(
    () => defectChecks.filter(d => d.isBlocked).length,
    [defectChecks]
  );

  // Формирование Накладной (Рис. 4) из выбранных / отсканированных строк «Выбрано к отгрузке» (Рис. 3)
  const handleCreateWaybillFromSelected = (selectedRows: PackingListRow[], shipmentNoHint: string) => {
    if (selectedRows.length === 0) {
      showNotice('Выберите или отсканируйте хотя бы одну тару для формирования накладной.');
      return;
    }

    const newWaybill = createAndSaveWaybillFromRows(
      selectedRows,
      shipmentNoHint,
      currentUserName,
      signatories
    );

    setActiveWaybill(newWaybill);
    setSavedWaybills(loadSavedWaybills());
    setActiveSection('waybill');
    showNotice(`Накладная № ${newWaybill.waybillNo} сформирована (${newWaybill.rows.length} строк).`);
  };

  const handleSaveWaybillToArchive = (wb: WaybillDocument) => {
    const wbWithCreator: WaybillDocument = {
      ...wb,
      createdBy: wb.createdBy || (currentUserName || '').trim() || wb.signatories?.senderName || '—'
    };
    const existsIdx = savedWaybills.findIndex(item => item.id === wbWithCreator.id);
    const updated =
      existsIdx >= 0
        ? savedWaybills.map(item => (item.id === wbWithCreator.id ? wbWithCreator : item))
        : [wbWithCreator, ...savedWaybills];
    setSavedWaybills(updated);
    saveWaybills(updated);
    rememberWaybillNo(wbWithCreator.waybillNo);
    showNotice(`Накладная № ${wbWithCreator.waybillNo} сохранена в реестр.`);
  };

  const handleOpenBagQrTemplate = (bagUid: string) => {
    setSelectedBagUidForTemplate(bagUid);
    setActiveSection('marking_templates');
  };

  const sections: Array<{
    id: NakladnoySectionId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    countText?: string;
    danger?: boolean;
  }> = [
    {
      id: 'packing_list',
      label: 'Упаковочный лист',
      icon: ClipboardList,
      countText: packingRows.length > 0 ? String(packingRows.length) : undefined
    },
    {
      id: 'order_color_summary',
      label: 'Всего заказ цвет',
      icon: Layers
    },
    {
      id: 'shipment',
      label: 'Отгрузка и QR-сканер',
      icon: Truck,
      countText: packingRows.filter(r => r.selectedForShipment).length > 0
        ? String(packingRows.filter(r => r.selectedForShipment).length)
        : undefined
    },
    {
      id: 'waybill',
      label: 'Накладная',
      icon: FileSpreadsheet,
      countText: activeWaybill ? `№${activeWaybill.waybillNo}` : undefined
    },
    {
      id: 'waybill_registry',
      label: 'Реестр накладных',
      icon: Archive,
      countText: savedWaybills.length > 0 ? String(savedWaybills.length) : undefined
    },
    {
      id: 'defect_check',
      label: 'Проверка брака',
      icon: ShieldAlert,
      countText: blockedDefectCount > 0 ? String(blockedDefectCount) : undefined,
      danger: blockedDefectCount > 0
    },
    {
      id: 'marking_templates',
      label: 'Шаблоны маркировки',
      icon: QrCode
    }
  ];

  return (
    <div className="space-y-4 text-slate-100">
      {/* Заголовок модуля и раздельная навигация по бо́лимам */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black text-white tracking-tight">
              Накладная, упаковочный лист и QR-маркировка
            </h1>
            <p className="text-xs text-slate-400">
              Упаковочный лист · Всего заказ цвет · Отгрузка по QR-коду · Накладная · Реестр накладных · Проверка брака · Шаблоны маркировки
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {noticeText && (
              <div className="px-3 py-1.5 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-200 text-xs font-semibold">
                {noticeText}
              </div>
            )}

            <button
              type="button"
              onClick={handleOpenSectionPrintPreview}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
              title="Открыть чистый макет документа для предпросмотра перед печатью"
            >
              <Eye className="w-4 h-4" />
              <span>Предпросмотр печати</span>
            </button>
          </div>
        </div>

        {/* Отдельные вкладки разделов */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
          {sections.map(sec => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isActive
                    ? sec.danger
                      ? 'bg-red-600 text-white'
                      : 'bg-sky-500 text-slate-950'
                    : sec.danger
                    ? 'text-red-300 hover:bg-red-950/60'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{sec.label}</span>
                {sec.countText && (
                  <span
                    className={`text-[11px] font-mono font-black ${
                      isActive
                        ? 'opacity-90'
                        : sec.danger
                        ? 'text-red-400'
                        : 'text-sky-400'
                    }`}
                  >
                    ({sec.countText})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Активный раздел */}
      {activeSection === 'packing_list' && (
        <PackingListTab
          rows={packingRows}
          onChangeRows={handlePackingRowsChange}
          ledgerRows={liveLedgerRows}
          defectChecks={defectChecks}
          signatories={signatories}
          baseWaybillNo={getNextWaybillNo()}
          onOpenBagQrTemplate={handleOpenBagQrTemplate}
          onOpenPrintPreview={openPrintPreview}
          onNotice={showNotice}
        />
      )}

      {activeSection === 'order_color_summary' && (
        <OrderColorSummaryTab rows={packingRows} onNotice={showNotice} />
      )}

      {activeSection === 'shipment' && (
        <ShipmentQrTab
          rows={packingRows}
          onChangeRows={handlePackingRowsChange}
          defaultShipmentNo={getNextWaybillNo()}
          onCreateWaybillFromSelected={handleCreateWaybillFromSelected}
          onNotice={showNotice}
        />
      )}

      {activeSection === 'waybill' && (
        <WaybillTab
          activeWaybill={activeWaybill}
          onChangeActiveWaybill={handleActiveWaybillChange}
          onSaveWaybillToArchive={handleSaveWaybillToArchive}
          signatories={signatories}
          onChangeSignatories={handleSignatoriesChange}
          onGoToShipment={() => setActiveSection('shipment')}
          onOpenPrintPreview={openPrintPreview}
          onNotice={showNotice}
        />
      )}

      {activeSection === 'waybill_registry' && (
        <WaybillsRegistryTab
          waybills={savedWaybills}
          onOpenPrintPreview={openPrintPreview}
        />
      )}

      {activeSection === 'defect_check' && (
        <DefectCheckTab
          rows={packingRows}
          defectChecks={defectChecks}
          onChangeRows={handlePackingRowsChange}
          onNotice={showNotice}
        />
      )}

      {activeSection === 'marking_templates' && (
        <MarkingTemplatesTab
          ref={markingTemplatesRef}
          rows={packingRows}
          ledgerRows={liveLedgerRows}
          sizeMatrices={liveSizeMatrices}
          defectChecks={defectChecks}
          initialBagUid={selectedBagUidForTemplate}
          onOpenPrintPreview={openPrintPreview}
          onNotice={showNotice}
        />
      )}

      {/* Модальное окно «Предпросмотр печати» */}
      {printPreview && (
        <div
          className="fixed inset-0 z-[70] bg-slate-950/85 backdrop-blur-sm flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={`Предпросмотр печати: ${printPreview.title}`}
        >
          {/* Панель управления предпросмотром */}
          <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <Printer className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="truncate">Предпросмотр печати: {printPreview.title}</span>
              </div>
              {printPreview.subtitle && (
                <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                  {printPreview.subtitle}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Переключение ориентации листа A4 */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewFormat('a4_portrait')}
                  className={`px-2.5 py-1 rounded font-bold cursor-pointer whitespace-nowrap ${
                    previewFormat === 'a4_portrait'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Книжная A4
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFormat('a4_landscape')}
                  className={`px-2.5 py-1 rounded font-bold cursor-pointer whitespace-nowrap ${
                    previewFormat === 'a4_landscape'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Альбомная A4
                </button>
              </div>

              {/* Масштаб предпросмотра */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewZoom(z => Math.max(50, z - 25))}
                  disabled={previewZoom <= 50}
                  className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                  title="Уменьшить масштаб"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 font-mono font-bold text-slate-200 min-w-[46px] text-center">
                  {previewZoom}%
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewZoom(z => Math.min(150, z + 25))}
                  disabled={previewZoom >= 150}
                  className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                  title="Увеличить масштаб"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              {printPreview.onDownloadPdf && (
                <button
                  type="button"
                  onClick={handlePreviewDownloadPdf}
                  disabled={isDownloadingPdf}
                  className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{isDownloadingPdf ? 'Создаём PDF...' : 'Скачать PDF'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleConfirmNativePrint}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow whitespace-nowrap shrink-0"
              >
                <Printer className="w-4 h-4" />
                <span>Печать (выбрать принтер)</span>
              </button>

              <button
                type="button"
                onClick={() => setPrintPreview(null)}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <X className="w-4 h-4" />
                <span>Закрыть</span>
              </button>
            </div>
          </div>

          {/* Область просмотра листа A4 */}
          <div className="flex-1 overflow-auto bg-slate-800/90 p-4 sm:p-8 flex justify-center items-start">
            {(() => {
              const paperWidthPx = previewFormat === 'a4_landscape' ? 1123 : 794;
              const minPaperHeightPx = previewFormat === 'a4_landscape' ? 794 : 1123;
              const effectiveHeight = Math.max(minPaperHeightPx, previewIframeHeight);
              const scale = previewZoom / 100;

              return (
                <div
                  style={{
                    width: `${Math.round(paperWidthPx * scale)}px`,
                    height: `${Math.round(effectiveHeight * scale)}px`
                  }}
                  className="shrink-0 relative"
                >
                  <div
                    style={{
                      width: `${paperWidthPx}px`,
                      height: `${effectiveHeight}px`,
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left'
                    }}
                    className="bg-white rounded-sm shadow-2xl border border-slate-300 overflow-hidden"
                  >
                    <iframe
                      title={`Предпросмотр: ${printPreview.title}`}
                      srcDoc={previewDocumentHtml}
                      style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#ffffff' }}
                      onLoad={e => {
                        try {
                          const doc = e.currentTarget.contentDocument;
                          if (doc) {
                            const h = Math.max(
                              doc.documentElement?.scrollHeight || 0,
                              doc.body?.scrollHeight || 0
                            );
                            if (h > 0) {
                              setPreviewIframeHeight(h + 16);
                            }
                          }
                        } catch {
                          // ignore cross-origin access error if any
                        }
                      }}
                    />
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Нижняя информационная строка */}
          <div className="bg-slate-900 border-t border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 shrink-0">
            <span>
              Формат: {previewFormat === 'a4_landscape' ? 'A4 Альбомная (297 × 210 мм)' : 'A4 Книжная (210 × 297 мм)'} · Поля:{' '}
              {printPreview.marginMm ?? (previewFormat === 'a4_landscape' ? 8 : 10)} мм
            </span>
            <span>Проверьте макет документа перед открытием системного окна печати браузера</span>
          </div>
        </div>
      )}
    </div>
  );
}
