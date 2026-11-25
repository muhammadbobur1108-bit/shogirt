import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PrintPreviewPayload, escapeHtml, printHtmlViaIframe } from '../../lib/printBridge';
import {
  Download,
  Eye,
  FileText,
  Lock,
  Printer,
  Search,
  X
} from 'lucide-react';
import {
  WaybillDocument,
  formatRuDate,
  registerCyrillicPdfFont
} from '../../lib/nakladnoyStore';

interface WaybillsRegistryTabProps {
  waybills: WaybillDocument[];
  onOpenPrintPreview?: (payload: PrintPreviewPayload) => void;
}

function formatCreatedDateTime(isoStr: string): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export const WaybillsRegistryTab: React.FC<WaybillsRegistryTabProps> = ({
  waybills,
  onOpenPrintPreview
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewingWaybill, setViewingWaybill] = useState<WaybillDocument | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  const enrichedList = useMemo(() => {
    return waybills.map(wb => {
      const uniqueOrders = Array.from(new Set(wb.rows.map(r => r.orderNo).filter(Boolean)));
      const uniqueModels = Array.from(new Set(wb.rows.map(r => r.model).filter(Boolean)));
      const creatorName = (wb.createdBy || '').trim() || wb.signatories?.senderName || '—';
      return {
        wb,
        uniqueOrders,
        uniqueModels,
        creatorName,
        createdFormatted: formatCreatedDateTime(wb.createdAt)
      };
    });
  }, [waybills]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return enrichedList;
    return enrichedList.filter(item => {
      return (
        item.wb.waybillNo.toLowerCase().includes(q) ||
        item.createdFormatted.toLowerCase().includes(q) ||
        formatRuDate(item.wb.waybillDate).toLowerCase().includes(q) ||
        item.creatorName.toLowerCase().includes(q) ||
        item.uniqueOrders.some(o => o.toLowerCase().includes(q)) ||
        item.uniqueModels.some(m => m.toLowerCase().includes(q))
      );
    });
  }, [enrichedList, searchQuery]);

  const handleExportRegistryExcel = () => {
    if (filtered.length === 0) return;
    const aoa = [
      ['Реестр сформированных накладных (Только просмотр)'],
      ['Накладная №', 'Дата отгрузки', 'Дата и время создания', 'Создал документ'],
      ...filtered.map(item => [
        `№ ${item.wb.waybillNo}`,
        formatRuDate(item.wb.waybillDate),
        item.createdFormatted,
        item.creatorName
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 16 },
      { wch: 16 },
      { wch: 22 },
      { wch: 28 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Реестр накладных');
    XLSX.writeFile(wb, `Реестр_накладных_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const hasGrossWeightInDoc = (wb: WaybillDocument) =>
    wb.rows.some(r => r.grossWeightKg !== '' && Number(r.grossWeightKg) > 0);

  const handlePrintReadonly = () => {
    if (!viewingWaybill) return;
    const wb = viewingWaybill;
    const showWeight = hasGrossWeightInDoc(wb);
    const sig = wb.signatories;

    const rowsHtml = wb.rows
      .map(
        r => `<tr>
          <td class="ta-c mono">${escapeHtml(r.seqNo)}</td>
          <td class="ta-c mono bold">${escapeHtml(r.bagNo)}</td>
          <td class="bold">${escapeHtml(r.orderNo)}</td>
          <td>${escapeHtml(r.model)}</td>
          <td>${escapeHtml(r.productName)}</td>
          <td>${escapeHtml(r.color)}</td>
          <td class="ta-r mono bold">${escapeHtml(r.qty)}</td>
          <td class="ta-c mono">${escapeHtml(r.taraCount)}</td>
          ${showWeight ? `<td class="ta-r mono">${r.grossWeightKg === '' ? '' : escapeHtml(r.grossWeightKg)}</td>` : ''}
        </tr>`
      )
      .join('');

    const sigsHtml = sig
      ? `<div class="sigs">
          <div><span class="muted">Директор:</span><div class="bold">${escapeHtml(sig.directorName)} (Ф.И.О.)</div></div>
          <div><span class="muted">Принял:</span><div class="bold">${escapeHtml(sig.recipientName)} (Ф.И.О.)</div></div>
          <div><span class="muted">Зав. складом:</span><div class="bold">${escapeHtml(sig.warehouseManagerName)} (Ф.И.О.)</div></div>
          <div><span class="muted">Сдал:</span><div class="bold">${escapeHtml(sig.senderName)} (Ф.И.О.)</div></div>
        </div>`
      : '';

    const htmlBody = `
      <div class="wb-wrap">
        <div class="wb-head">
          <div class="wb-title">Накладная № ${escapeHtml(wb.waybillNo)}</div>
          <div class="wb-date">от ${escapeHtml(formatRuDate(wb.waybillDate))}</div>
        </div>
        <table class="wb-tbl">
          <thead>
            <tr>
              <th class="ta-c">№ п/п</th>
              <th class="ta-c">№ мешка</th>
              <th>Заказ</th>
              <th>Модель</th>
              <th>Наименование</th>
              <th>Цвет</th>
              <th class="ta-r">Кол-во</th>
              <th class="ta-c">Тара</th>
              ${showWeight ? '<th class="ta-r">Вес брутто</th>' : ''}
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="6" class="ta-r">ИТОГО:</td>
              <td class="ta-r mono">${wb.totalQty}</td>
              <td class="ta-c mono">${wb.totalTara}</td>
              ${showWeight ? `<td class="ta-r mono">${wb.totalGrossWeightKg.toFixed(1)}</td>` : ''}
            </tr>
          </tfoot>
        </table>
        ${sigsHtml}
      </div>`;

    const extraCss = `
      .wb-wrap { width: 100%; color: #0f172a; font-family: Arial, sans-serif; }
      .wb-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
      .wb-title { font-size: 18px; font-weight: 900; }
      .wb-date { font-size: 14px; font-weight: 700; font-family: monospace; }
      .mono { font-family: monospace; }
      .bold { font-weight: 700; }
      .ta-c { text-align: center; }
      .ta-r { text-align: right; }
      .wb-tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
      .wb-tbl th, .wb-tbl td { border: 1px solid #334155; padding: 5px 6px; }
      .wb-tbl thead th { background: #1F5E9C; color: #ffffff; font-weight: 700; }
      .wb-tbl tfoot td { background: #f1f5f9; font-weight: 900; }
      .sigs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 18px; padding-top: 10px; border-top: 1px solid #cbd5e1; font-size: 11px; break-inside: avoid; page-break-inside: avoid; }
      .muted { color: #475569; }
    `;

    const printOptions: PrintPreviewPayload = {
      title: `Накладная № ${wb.waybillNo}`,
      subtitle: `от ${formatRuDate(wb.waybillDate)} · Только просмотр · Позиций: ${wb.rows.length}`,
      format: 'a4_portrait',
      marginMm: 10,
      extraCss,
      htmlBody,
      onDownloadPdf: handleDownloadPdfReadonly
    };

    if (onOpenPrintPreview) {
      onOpenPrintPreview(printOptions);
      return;
    }

    printHtmlViaIframe(printOptions);
  };

  const handleDownloadPdfReadonly = async () => {
    if (!viewingWaybill) return;
    setIsExportingPdf(true);
    try {
      const wb = viewingWaybill;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicPdfFont(doc);
      const formattedDate = formatRuDate(wb.waybillDate);
      const sig = wb.signatories;
      const showWeight = hasGrossWeightInDoc(wb);

      doc.setFont(fontName, 'bold');
      doc.setFontSize(14);
      doc.text(`Накладная № ${wb.waybillNo}`, 95, 16, { align: 'center' });
      doc.text(`от ${formattedDate}`, 196, 16, { align: 'right' });

      const pdfHead = ['№ п/п', '№ мешка', 'Заказ', 'Модель', 'Наименование', 'Цвет', 'Кол-во', 'Тара'];
      if (showWeight) pdfHead.push('Вес брутто');

      autoTable(doc, {
        startY: 22,
        head: [pdfHead],
        body: [
          ...wb.rows.map(r => [
            String(r.seqNo),
            r.bagNo,
            r.orderNo,
            r.model,
            r.productName,
            r.color,
            String(r.qty),
            String(r.taraCount),
            ...(showWeight ? [r.grossWeightKg === '' ? '' : String(r.grossWeightKg)] : [])
          ]),
          [
            '',
            '',
            '',
            '',
            '',
            'ИТОГО:',
            String(wb.totalQty),
            String(wb.totalTara),
            ...(showWeight ? [wb.totalGrossWeightKg.toFixed(1)] : [])
          ]
        ],
        theme: 'grid',
        margin: { left: 10, right: 10 },
        styles: {
          font: fontName,
          fontSize: 8.5,
          textColor: [15, 23, 42],
          lineColor: [30, 41, 59],
          lineWidth: 0.25
        },
        headStyles: { fillColor: [31, 94, 156], textColor: [255, 255, 255], fontStyle: 'bold' }
      });

      if (sig) {
        let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || 90) + 14;
        const sigRows: [string, string][] = [
          ['Директор:', sig.directorName],
          ['Принял:', sig.recipientName],
          ['Зав. складом:', sig.warehouseManagerName],
          ['Сдал:', sig.senderName]
        ];
        doc.setFont(fontName, 'normal');
        doc.setFontSize(9.5);
        sigRows.forEach(([role, name]) => {
          doc.text(role, 22, y);
          doc.line(54, y, 118, y);
          doc.text(`${name} (Ф.И.О.)`, 124, y);
          doc.setFontSize(7.5);
          doc.text('Подпись', 80, y + 3.8);
          doc.setFontSize(9.5);
          y += 12;
        });
      }

      doc.save(`Накладная_${wb.waybillNo}_${formattedDate}.pdf`);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Верхняя панель (Только просмотр) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по № накладной, дате отправки или создателю..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-amber-300 font-semibold">
            <Lock className="w-3.5 h-3.5" />
            <span>Только просмотр · Изменение и удаление запрещены</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleExportRegistryExcel}
          disabled={filtered.length === 0}
          className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Скачать реестр Excel</span>
        </button>
      </div>

      {/* Таблица реестра созданных накладных */}
      <div className="bg-white text-slate-950 rounded-xl border border-slate-300 overflow-hidden shadow-sm">
        <div className="px-4 py-2.5 border-b border-slate-300 bg-white flex items-center justify-between">
          <h3 className="text-base font-black text-red-600 tracking-wide">
            Реестр сформированных накладных
          </h3>
          <span className="text-xs font-mono font-bold text-slate-600">
            Всего документов: {filtered.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#4472C4] text-white font-bold">
                <th className="px-3 py-2.5 border border-slate-300 text-center w-32">Накладная №</th>
                <th className="px-3 py-2.5 border border-slate-300 text-center w-48">Дата отправки</th>
                <th className="px-3 py-2.5 border border-slate-300 text-left">Создал документ</th>
                <th className="px-3 py-2.5 border border-slate-300 text-center w-36">Просмотр</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-slate-500 text-xs">
                    Список накладных пуст. Сформируйте первую накладную в разделе «Отгрузка и QR-сканер».
                  </td>
                </tr>
              ) : (
                filtered.map((item, idx) => (
                  <tr
                    key={item.wb.id}
                    className={idx % 2 === 0 ? 'bg-[#D9E1F2]/60 hover:bg-sky-50' : 'bg-white hover:bg-sky-50'}
                  >
                    <td className="px-3 py-2.5 border border-slate-300 text-center font-mono font-black text-slate-900">
                      № {item.wb.waybillNo}
                    </td>
                    <td className="px-3 py-2.5 border border-slate-300 text-center font-mono text-slate-800">
                      <span className="font-bold">{formatRuDate(item.wb.waybillDate)}</span>
                      <span className="text-slate-500 ml-1.5 text-[11px]">({item.createdFormatted})</span>
                    </td>
                    <td className="px-3 py-2.5 border border-slate-300 font-semibold text-slate-900">
                      {item.creatorName}
                    </td>
                    <td className="px-3 py-2.5 border border-slate-300 text-center">
                      <button
                        type="button"
                        onClick={() => setViewingWaybill(item.wb)}
                        className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Открыть</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Модальное окно детального просмотра накладной (СТРОГО БЕЗ РЕДАКТИРОВАНИЯ) */}
      {viewingWaybill && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white text-slate-950 rounded-2xl border border-slate-400 w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-black">
                <Lock className="w-4 h-4 text-amber-400" />
                <span>
                  Накладная № {viewingWaybill.waybillNo} · Создана: {formatCreatedDateTime(viewingWaybill.createdAt)} (Только просмотр)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadPdfReadonly}
                  disabled={isExportingPdf}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{isExportingPdf ? 'Создаём PDF...' : 'Скачать PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrintReadonly}
                  className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Печать (выбор принтера)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewingWaybill(null)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-5 sm:p-7 overflow-y-auto space-y-5">
              <div className="flex items-center justify-between border-b-2 border-slate-800 pb-2">
                <div className="text-lg font-black">Накладная № {viewingWaybill.waybillNo}</div>
                <div className="text-sm font-bold font-mono">
                  от {formatRuDate(viewingWaybill.waybillDate)}
                </div>
              </div>

              <div className="overflow-x-auto">
                {(() => {
                  const showWeight = hasGrossWeightInDoc(viewingWaybill);
                  return (
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#1F5E9C] text-white font-bold">
                          <th className="px-2 py-2 border border-slate-700 text-center w-14">№ п/п</th>
                          <th className="px-2 py-2 border border-slate-700 text-center w-18">№ мешка</th>
                          <th className="px-2 py-2 border border-slate-700 text-left">Заказ</th>
                          <th className="px-2 py-2 border border-slate-700 text-left">Модель</th>
                          <th className="px-2 py-2 border border-slate-700 text-left">Наименование</th>
                          <th className="px-2 py-2 border border-slate-700 text-left">Цвет</th>
                          <th className="px-2 py-2 border border-slate-700 text-right">Кол-во</th>
                          <th className="px-2 py-2 border border-slate-700 text-center">Тара</th>
                          {showWeight && <th className="px-2 py-2 border border-slate-700 text-right">Вес брутто</th>}
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {viewingWaybill.rows.map(r => (
                          <tr key={r.id}>
                            <td className="px-2 py-1.5 border border-slate-700 text-center font-mono">{r.seqNo}</td>
                            <td className="px-2 py-1.5 border border-slate-700 text-center font-mono font-bold">{r.bagNo}</td>
                            <td className="px-2 py-1.5 border border-slate-700 font-semibold">{r.orderNo}</td>
                            <td className="px-2 py-1.5 border border-slate-700">{r.model}</td>
                            <td className="px-2 py-1.5 border border-slate-700">{r.productName}</td>
                            <td className="px-2 py-1.5 border border-slate-700">{r.color}</td>
                            <td className="px-2 py-1.5 border border-slate-700 text-right font-mono font-bold">{r.qty}</td>
                            <td className="px-2 py-1.5 border border-slate-700 text-center font-mono">{r.taraCount}</td>
                            {showWeight && (
                              <td className="px-2 py-1.5 border border-slate-700 text-right font-mono">
                                {r.grossWeightKg === '' ? '' : r.grossWeightKg}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-100 font-black">
                          <td colSpan={6} className="px-2 py-2 border border-slate-700 text-right">ИТОГО:</td>
                          <td className="px-2 py-2 border border-slate-700 text-right font-mono">{viewingWaybill.totalQty}</td>
                          <td className="px-2 py-2 border border-slate-700 text-center font-mono">{viewingWaybill.totalTara}</td>
                          {showWeight && (
                            <td className="px-2 py-2 border border-slate-700 text-right font-mono">
                              {viewingWaybill.totalGrossWeightKg.toFixed(1)}
                            </td>
                          )}
                        </tr>
                      </tfoot>
                    </table>
                  );
                })()}
              </div>

              {viewingWaybill.signatories && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-300 text-xs">
                  <div>
                    <div className="text-slate-600">Директор:</div>
                    <div className="font-bold mt-1">{viewingWaybill.signatories.directorName}</div>
                  </div>
                  <div>
                    <div className="text-slate-600">Принял:</div>
                    <div className="font-bold mt-1">{viewingWaybill.signatories.recipientName}</div>
                  </div>
                  <div>
                    <div className="text-slate-600">Зав. складом:</div>
                    <div className="font-bold mt-1">{viewingWaybill.signatories.warehouseManagerName}</div>
                  </div>
                  <div>
                    <div className="text-slate-600">Сдал:</div>
                    <div className="font-bold mt-1">{viewingWaybill.signatories.senderName}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WaybillsRegistryTab;
