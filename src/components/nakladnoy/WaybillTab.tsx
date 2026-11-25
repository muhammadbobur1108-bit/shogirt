import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PrintPreviewPayload, escapeHtml, printHtmlViaIframe } from '../../lib/printBridge';
import {
  Printer,
  Download,
  FileText,
  Save,
  Trash2,
  Plus
} from 'lucide-react';
import {
  WaybillDocument,
  WaybillRowItem,
  WaybillSignatories,
  formatRuDate,
  registerCyrillicPdfFont
} from '../../lib/nakladnoyStore';

interface WaybillTabProps {
  activeWaybill: WaybillDocument | null;
  onChangeActiveWaybill: (wb: WaybillDocument | null) => void;
  onSaveWaybillToArchive: (wb: WaybillDocument) => void;
  signatories: WaybillSignatories;
  onChangeSignatories: (next: WaybillSignatories) => void;
  onGoToShipment: () => void;
  onOpenPrintPreview?: (payload: PrintPreviewPayload) => void;
  onNotice: (msg: string) => void;
}

export const WaybillTab: React.FC<WaybillTabProps> = ({
  activeWaybill,
  onChangeActiveWaybill,
  onSaveWaybillToArchive,
  signatories,
  onChangeSignatories,
  onGoToShipment,
  onOpenPrintPreview,
  onNotice
}) => {
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  const recalcWaybill = (wb: WaybillDocument, nextRows: WaybillRowItem[]): WaybillDocument => {
    const totalQty = nextRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const totalTara = nextRows.reduce((s, r) => s + (Number(r.taraCount) || 0), 0);
    const totalGrossWeightKg = nextRows.reduce((s, r) => s + (Number(r.grossWeightKg) || 0), 0);
    return {
      ...wb,
      rows: nextRows,
      totalQty,
      totalTara,
      totalGrossWeightKg
    };
  };

  const handleFieldChange = (field: 'waybillNo' | 'waybillDate', value: string) => {
    if (!activeWaybill) return;
    onChangeActiveWaybill({ ...activeWaybill, [field]: value });
  };

  const handleRowEdit = (rowId: string, field: keyof WaybillRowItem, val: string) => {
    if (!activeWaybill) return;
    const nextRows = activeWaybill.rows.map(r => {
      if (r.id !== rowId) return r;
      if (field === 'seqNo' || field === 'qty' || field === 'taraCount') {
        return { ...r, [field]: Math.max(0, Number(val) || 0) };
      }
      if (field === 'grossWeightKg') {
        return { ...r, grossWeightKg: val === '' ? '' : Math.max(0, parseFloat(val.replace(',', '.')) || 0) };
      }
      return { ...r, [field]: val };
    });
    onChangeActiveWaybill(recalcWaybill(activeWaybill, nextRows));
  };

  const handleSignatoryChange = (key: keyof WaybillSignatories, val: string) => {
    const nextSig = { ...signatories, [key]: val };
    onChangeSignatories(nextSig);
    if (activeWaybill) {
      onChangeActiveWaybill({ ...activeWaybill, signatories: nextSig });
    }
  };

  const handleAddManualRow = () => {
    if (!activeWaybill) return;
    const nextSeq =
      activeWaybill.rows.length > 0
        ? Math.max(...activeWaybill.rows.map(r => Number(r.seqNo) || 0)) + 1
        : 1;
    const newRow: WaybillRowItem = {
      id: `wb-r-${Date.now()}`,
      seqNo: nextSeq,
      bagNo: '',
      orderNo: '',
      model: '',
      productName: '',
      color: '',
      qty: 0,
      taraCount: 1,
      grossWeightKg: ''
    };
    onChangeActiveWaybill(recalcWaybill(activeWaybill, [...activeWaybill.rows, newRow]));
  };

  const handleRemoveRow = (rowId: string) => {
    if (!activeWaybill) return;
    onChangeActiveWaybill(recalcWaybill(activeWaybill, activeWaybill.rows.filter(r => r.id !== rowId)));
  };

  const hasGrossWeightInWaybill = (wb: WaybillDocument) =>
    wb.rows.some(r => r.grossWeightKg !== '' && Number(r.grossWeightKg) > 0);

  const handlePrint = () => {
    if (!activeWaybill) return;
    const wb = activeWaybill;
    const sig = wb.signatories || signatories;
    const formattedDate = formatRuDate(wb.waybillDate);
    const showWeight = hasGrossWeightInWaybill(wb);

    const rowsHtml = wb.rows
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

    const htmlBody = `
      <div class="wb-wrap">
        <div class="wb-head">
          <div class="wb-title">Накладная № <span class="mono">${escapeHtml(wb.waybillNo)}</span></div>
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
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="6" class="ta-r">ИТОГО:</td>
              <td class="ta-r mono">${wb.totalQty}</td>
              <td class="ta-c mono">${wb.totalTara}</td>
              ${showWeight ? `<td class="ta-r mono">${wb.totalGrossWeightKg.toFixed(1)}</td>` : ''}
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
      </div>`;

    const extraCss = `
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
    `;

    const printOptions: PrintPreviewPayload = {
      title: `Накладная № ${wb.waybillNo}`,
      subtitle: `от ${formattedDate} · Позиций: ${wb.rows.length} · Тара: ${wb.totalTara} · Кол-во: ${wb.totalQty} шт`,
      format: 'a4_portrait',
      marginMm: 10,
      extraCss,
      htmlBody,
      onDownloadPdf: handleExportPdf
    };

    if (onOpenPrintPreview) {
      onOpenPrintPreview(printOptions);
      return;
    }

    printHtmlViaIframe({
      ...printOptions,
      onError: msg => onNotice(msg)
    });
  };

  const handleExportExcel = () => {
    if (!activeWaybill) return;
    const formattedDate = formatRuDate(activeWaybill.waybillDate);
    const sig = activeWaybill.signatories || signatories;
    const showWeight = hasGrossWeightInWaybill(activeWaybill);

    const headers = ['№ п/п', '№ мешка', 'Заказ', 'Модель', 'Наименование', 'Цвет', 'Кол-во', 'Тара'];
    if (showWeight) headers.push('Вес брутто');

    const aoa: (string | number)[][] = [
      ['', '', `Накладная № ${activeWaybill.waybillNo}`, '', '', '', '', 'от', formattedDate],
      headers,
      ...activeWaybill.rows.map(r => {
        const rowVals: (string | number)[] = [
          r.seqNo,
          r.bagNo,
          r.orderNo,
          r.model,
          r.productName,
          r.color,
          r.qty,
          r.taraCount
        ];
        if (showWeight) rowVals.push(r.grossWeightKg === '' ? '' : r.grossWeightKg);
        return rowVals;
      }),
      [
        '',
        '',
        '',
        '',
        '',
        'ИТОГО',
        activeWaybill.totalQty,
        activeWaybill.totalTara,
        ...(showWeight ? [Number(activeWaybill.totalGrossWeightKg.toFixed(2))] : [])
      ],
      [],
      ['', '', 'Директор:', '____________________________', sig.directorName, '', '', '', ''],
      ['', '', '', 'Подпись', '(Ф.И.О.)', '', '', '', ''],
      ['', '', 'Принял:', '____________________________', sig.recipientName, '', '', '', ''],
      ['', '', '', 'Подпись', '(Ф.И.О.)', '', '', '', ''],
      ['', '', 'Зав. складом:', '____________________________', sig.warehouseManagerName, '', '', '', ''],
      ['', '', '', 'Подпись', '(Ф.И.О.)', '', '', '', ''],
      ['', '', 'Сдал:', '____________________________', sig.senderName, '', '', '', ''],
      ['', '', '', 'Подпись', '(Ф.И.О.)', '', '', '', '']
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 8 },
      { wch: 10 },
      { wch: 15 },
      { wch: 26 },
      { wch: 28 },
      { wch: 16 },
      { wch: 10 },
      { wch: 8 },
      ...(showWeight ? [{ wch: 12 }] : [])
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Накладная №${activeWaybill.waybillNo}`);
    XLSX.writeFile(wb, `Накладная_${activeWaybill.waybillNo}_${formattedDate}.xlsx`);
    onNotice(`Накладная № ${activeWaybill.waybillNo} скачана в Excel.`);
  };

  const handleExportPdf = async () => {
    if (!activeWaybill) return;
    setIsExportingPdf(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicPdfFont(doc);
      const formattedDate = formatRuDate(activeWaybill.waybillDate);
      const sig = activeWaybill.signatories || signatories;
      const showWeight = hasGrossWeightInWaybill(activeWaybill);

      doc.setFont(fontName, 'bold');
      doc.setFontSize(14);
      doc.text(`Накладная № ${activeWaybill.waybillNo}`, 95, 16, { align: 'center' });
      doc.text(`от ${formattedDate}`, 196, 16, { align: 'right' });

      const pdfHead = ['№ п/п', '№ мешка', 'Заказ', 'Модель', 'Наименование', 'Цвет', 'Кол-во', 'Тара'];
      if (showWeight) pdfHead.push('Вес брутто');

      autoTable(doc, {
        startY: 22,
        head: [pdfHead],
        body: [
          ...activeWaybill.rows.map(r => [
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
            String(activeWaybill.totalQty),
            String(activeWaybill.totalTara),
            ...(showWeight ? [activeWaybill.totalGrossWeightKg.toFixed(1)] : [])
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

      doc.save(`Накладная_${activeWaybill.waybillNo}_${formattedDate}.pdf`);
      onNotice(`Накладная № ${activeWaybill.waybillNo} скачана в PDF.`);
    } catch (err) {
      console.error(err);
      onNotice('Ошибка формирования PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const renderWaybillPaper = (wb: WaybillDocument, interactive: boolean) => {
    const sig = wb.signatories || signatories;
    const formattedDate = formatRuDate(wb.waybillDate);

    return (
      <div className="bg-white text-slate-950 p-5 sm:p-8 rounded-xl border border-slate-300 shadow-sm">
        {/* Шапка накладной (Рис. 4) */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b-2 border-slate-800 mb-3">
          <div className="flex-1 flex items-center justify-center gap-2 text-lg sm:text-xl font-black">
            <span>Накладная №</span>
            {interactive ? (
              <input
                type="text"
                value={wb.waybillNo}
                onChange={e => handleFieldChange('waybillNo', e.target.value)}
                className="w-24 px-2 py-0.5 border border-slate-400 rounded font-mono font-black text-center bg-slate-50"
              />
            ) : (
              <span className="font-mono">{wb.waybillNo}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-base sm:text-lg font-black">
            <span>от</span>
            {interactive ? (
              <input
                type="date"
                value={wb.waybillDate}
                onChange={e => handleFieldChange('waybillDate', e.target.value)}
                className="px-2 py-0.5 border border-slate-400 rounded font-mono text-sm font-bold bg-slate-50"
              />
            ) : (
              <span className="font-mono">{formattedDate}</span>
            )}
          </div>
        </div>

        {/* Основная таблица накладной */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#1F5E9C] text-white font-bold">
                <th className="px-2 py-2 border border-slate-700 text-center w-14">№ п/п</th>
                <th className="px-2 py-2 border border-slate-700 text-center w-18">№ мешка</th>
                <th className="px-2 py-2 border border-slate-700 text-left min-w-[105px]">Заказ</th>
                <th className="px-2 py-2 border border-slate-700 text-left min-w-[165px]">Модель</th>
                <th className="px-2 py-2 border border-slate-700 text-left min-w-[165px]">Наименование</th>
                <th className="px-2 py-2 border border-slate-700 text-left min-w-[100px]">Цвет</th>
                <th className="px-2 py-2 border border-slate-700 text-right w-18">Кол-во</th>
                <th className="px-2 py-2 border border-slate-700 text-center w-14">Тара</th>
                <th className="px-2 py-2 border border-slate-700 text-right w-24">Вес брутто</th>
                {interactive && (
                  <th className="px-1.5 py-2 border border-slate-700 text-center w-10 print:hidden"></th>
                )}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {wb.rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-1.5 py-1 border border-slate-700 text-center font-mono font-bold">
                    {interactive ? (
                      <input
                        type="number"
                        value={r.seqNo}
                        onChange={e => handleRowEdit(r.id, 'seqNo', e.target.value)}
                        className="w-11 text-center bg-transparent border border-transparent focus:border-sky-500 rounded"
                      />
                    ) : (
                      r.seqNo
                    )}
                  </td>
                  <td className="px-1.5 py-1 border border-slate-700 text-center font-mono font-bold">
                    {interactive ? (
                      <input
                        type="text"
                        value={r.bagNo}
                        onChange={e => handleRowEdit(r.id, 'bagNo', e.target.value)}
                        className="w-12 text-center bg-transparent border border-transparent focus:border-sky-500 rounded"
                      />
                    ) : (
                      r.bagNo
                    )}
                  </td>
                  <td className="px-2 py-1 border border-slate-700 font-semibold">
                    {interactive ? (
                      <input
                        type="text"
                        value={r.orderNo}
                        onChange={e => handleRowEdit(r.id, 'orderNo', e.target.value)}
                        className="w-full bg-transparent border border-transparent focus:border-sky-500 rounded"
                      />
                    ) : (
                      r.orderNo
                    )}
                  </td>
                  <td className="px-2 py-1 border border-slate-700">
                    {interactive ? (
                      <input
                        type="text"
                        value={r.model}
                        onChange={e => handleRowEdit(r.id, 'model', e.target.value)}
                        className="w-full bg-transparent border border-transparent focus:border-sky-500 rounded"
                      />
                    ) : (
                      r.model
                    )}
                  </td>
                  <td className="px-2 py-1 border border-slate-700">
                    {interactive ? (
                      <input
                        type="text"
                        value={r.productName}
                        onChange={e => handleRowEdit(r.id, 'productName', e.target.value)}
                        className="w-full bg-transparent border border-transparent focus:border-sky-500 rounded"
                      />
                    ) : (
                      r.productName
                    )}
                  </td>
                  <td className="px-2 py-1 border border-slate-700">
                    {interactive ? (
                      <input
                        type="text"
                        value={r.color}
                        onChange={e => handleRowEdit(r.id, 'color', e.target.value)}
                        className="w-full bg-transparent border border-transparent focus:border-sky-500 rounded"
                      />
                    ) : (
                      r.color
                    )}
                  </td>
                  <td className="px-2 py-1 border border-slate-700 text-right font-mono font-bold">
                    {interactive ? (
                      <input
                        type="number"
                        value={r.qty}
                        onChange={e => handleRowEdit(r.id, 'qty', e.target.value)}
                        className="w-16 text-right bg-transparent border border-transparent focus:border-sky-500 rounded"
                      />
                    ) : (
                      r.qty
                    )}
                  </td>
                  <td className="px-2 py-1 border border-slate-700 text-center font-mono">
                    {interactive ? (
                      <input
                        type="number"
                        value={r.taraCount}
                        onChange={e => handleRowEdit(r.id, 'taraCount', e.target.value)}
                        className="w-10 text-center bg-transparent border border-transparent focus:border-sky-500 rounded"
                      />
                    ) : (
                      r.taraCount
                    )}
                  </td>
                  <td className="px-2 py-1 border border-slate-700 text-right font-mono font-bold">
                    {interactive ? (
                      <input
                        type="number"
                        step="0.1"
                        value={r.grossWeightKg}
                        onChange={e => handleRowEdit(r.id, 'grossWeightKg', e.target.value)}
                        placeholder="0.0"
                        className="w-20 text-right bg-transparent border border-transparent focus:border-sky-500 rounded"
                      />
                    ) : (
                      r.grossWeightKg === '' ? '' : r.grossWeightKg
                    )}
                  </td>
                  {interactive && (
                    <td className="px-1 py-1 border border-slate-700 text-center print:hidden">
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(r.id)}
                        className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                        title="Удалить строку"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-black">
                <td colSpan={6} className="px-2.5 py-2 border border-slate-700 text-right">
                  ИТОГО:
                </td>
                <td className="px-2 py-2 border border-slate-700 text-right font-mono">{wb.totalQty}</td>
                <td className="px-2 py-2 border border-slate-700 text-center font-mono">{wb.totalTara}</td>
                <td className="px-2 py-2 border border-slate-700 text-right font-mono">
                  {wb.totalGrossWeightKg.toFixed(1)}
                </td>
                {interactive && <td className="border border-slate-700 print:hidden" />}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Блок подписей (Рис. 4) */}
        <div className="mt-8 max-w-2xl mx-auto space-y-5 text-xs sm:text-sm">
          {(
            [
              { key: 'directorName', label: 'Директор:' },
              { key: 'recipientName', label: 'Принял:' },
              { key: 'warehouseManagerName', label: 'Зав. складом:' },
              { key: 'senderName', label: 'Сдал:' }
            ] as { key: keyof WaybillSignatories; label: string }[]
          ).map(item => (
            <div key={item.key} className="grid grid-cols-12 items-start gap-3">
              <div className="col-span-3 font-semibold pt-1">{item.label}</div>
              <div className="col-span-5 text-center">
                <div className="border-b border-slate-900 h-5" />
                <div className="text-[11px] text-slate-600 mt-0.5">Подпись</div>
              </div>
              <div className="col-span-4">
                {interactive ? (
                  <input
                    type="text"
                    value={sig[item.key]}
                    onChange={e => handleSignatoryChange(item.key, e.target.value)}
                    className="w-full px-1.5 py-0.5 border border-slate-300 rounded text-xs font-semibold"
                  />
                ) : (
                  <div className="font-semibold pt-0.5">{sig[item.key]}</div>
                )}
                <div className="text-[11px] text-slate-600">(Ф.И.О.)</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Панель действий */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <span>{activeWaybill ? `Накладная № ${activeWaybill.waybillNo}` : 'Накладная не сформирована'}</span>
        </div>

        {activeWaybill && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAddManualRow}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Добавить строку</span>
            </button>

            <button
              type="button"
              onClick={() => onSaveWaybillToArchive(activeWaybill)}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Сохранить в реестр</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Скачать Excel</span>
            </button>

            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              className="px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{isExportingPdf ? 'Создаём PDF...' : 'Скачать PDF'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4" />
              <span>Печать (выбор принтера)</span>
            </button>
          </div>
        )}
      </div>

      {activeWaybill ? (
        renderWaybillPaper(activeWaybill, true)
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center space-y-3">
          <div className="text-sm font-bold text-slate-200">
            Активная накладная ещё не сформирована
          </div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Перейдите во вкладку «Отгрузка и QR-сканер», отметьте нужные тары (или отсканируйте QR-коды) и нажмите кнопку «Сформировать накладную».
          </p>
          <button
            type="button"
            onClick={onGoToShipment}
            className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs cursor-pointer"
          >
            Перейти к отгрузке
          </button>
        </div>
      )}
    </div>
  );
};

export default WaybillTab;
