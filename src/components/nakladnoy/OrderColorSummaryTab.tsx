import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, Search } from 'lucide-react';
import { PackingListRow, buildOrderColorSummary } from '../../lib/nakladnoyStore';

interface OrderColorSummaryTabProps {
  rows: PackingListRow[];
  onNotice: (msg: string) => void;
}

export const OrderColorSummaryTab: React.FC<OrderColorSummaryTabProps> = ({ rows, onNotice }) => {
  const [searchQuery, setSearchQuery] = useState<string>('');

  const summaryRows = useMemo(() => buildOrderColorSummary(rows), [rows]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return summaryRows;
    return summaryRows.filter(
      r =>
        r.orderNo.toLowerCase().includes(q) ||
        r.model.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        r.color.toLowerCase().includes(q) ||
        r.taraList.some(t => t.toLowerCase().includes(q))
    );
  }, [summaryRows, searchQuery]);

  const grandTotalQty = useMemo(() => filtered.reduce((s, r) => s + r.totalQty, 0), [filtered]);

  const handleExportXlsx = () => {
    if (filtered.length === 0) return;
    const aoa = [
      ['Всего заказ цвет'],
      ['№', 'Заказ', 'Модель', 'Наименование', 'Цвет', 'Кол-во', 'Тары'],
      ...filtered.map(r => [
        r.displayNo,
        r.orderNo,
        r.model,
        r.productName,
        r.color,
        r.totalQty,
        r.taraList.join(', ')
      ]),
      ['', '', '', '', 'ИТОГО', grandTotalQty, '']
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 10 },
      { wch: 16 },
      { wch: 26 },
      { wch: 28 },
      { wch: 16 },
      { wch: 12 },
      { wch: 18 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Всего заказ цвет');
    XLSX.writeFile(wb, `Всего_заказ_цвет_${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotice('Отчёт «Всего заказ цвет» выгружен в Excel.');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Поиск по заказу, модели или цвету..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500"
          />
        </div>

        <button
          type="button"
          onClick={handleExportXlsx}
          disabled={filtered.length === 0}
          className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Скачать Excel</span>
        </button>
      </div>

      {/* Таблица «Всего заказ цвет» (Рис. 2) */}
      <div className="bg-white text-slate-950 rounded-xl border border-slate-300 overflow-hidden shadow-sm">
        <div className="text-center py-2 border-b border-slate-300 bg-white">
          <h3 className="text-base font-black text-red-600 tracking-wide">Всего заказ цвет</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#4472C4] text-white font-bold">
                <th className="px-2.5 py-2 border border-slate-300 text-center w-16">№</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[120px]">Заказ</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[180px]">Модель</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[180px]">Наименование</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[120px]">Цвет</th>
                <th className="px-2.5 py-2 border border-slate-300 text-right w-28">Кол-во</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500 text-xs">
                    Нет данных для сводного отчёта. Сначала заполните «Упаковочный лист».
                  </td>
                </tr>
              ) : (
                filtered.map((item, idx) => (
                  <tr
                    key={item.key}
                    className={idx % 2 === 0 ? 'bg-[#D9E1F2]/60 hover:bg-sky-50' : 'bg-white hover:bg-sky-50'}
                  >
                    <td
                      className="px-2.5 py-2 border border-slate-300 text-center font-mono font-bold"
                      title={item.taraList.length > 1 ? `Номера тар: ${item.taraList.join(', ')}` : undefined}
                    >
                      {item.displayNo}
                    </td>
                    <td className="px-2.5 py-2 border border-slate-300 font-semibold">{item.orderNo}</td>
                    <td className="px-2.5 py-2 border border-slate-300">{item.model}</td>
                    <td className="px-2.5 py-2 border border-slate-300">{item.productName}</td>
                    <td className="px-2.5 py-2 border border-slate-300">{item.color}</td>
                    <td className="px-2.5 py-2 border border-slate-300 text-right font-mono font-bold">
                      {item.totalQty}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="bg-slate-200 font-black text-slate-950">
                  <td colSpan={5} className="px-2.5 py-2 border border-slate-300 text-right">
                    ИТОГО ПО ЦВЕТАМ И ЗАКАЗАМ:
                  </td>
                  <td className="px-2.5 py-2 border border-slate-300 text-right font-mono">
                    {grandTotalQty.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};

export default OrderColorSummaryTab;
