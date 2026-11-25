// 3-sahifa: «Инфо проверка» — har bir zakaz/model/rang bo'yicha jamlanma hisobot

import React, { useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  FileText,
  Search,
  Check,
  AlertCircle,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  InfoReportResult,
  InfoSummaryRow,
  SkladColumnKey,
  VALIDATED_SKLAD_FIELDS,
} from '../types';
import {
  exportInfoReportToExcel,
  exportInfoReportToPdf,
} from '../services/excelService';

interface InfoProverkaPageProps {
  report: InfoReportResult;
  expectedDate?: string;
  onChangeExpectedDate?: (nextDate: string) => void;
  onNotify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function InfoProverkaPage({
  report,
  onNotify,
}: InfoProverkaPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'error' | 'ok' | 'missing_in_warehouse' | 'incomplete_option'
  >('all');
  const [selectedSummaryRow, setSelectedSummaryRow] = useState<InfoSummaryRow | null>(null);
  const [isPdfGenerating, setIsPdfGenerating] = useState(false);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return report.rows.filter((r, idx) => {
      // Birinchi qator ("Опцияда topilmagan zakazlar") qidiruv bo'sh bo'lganda va 'all' holatida doim ko'rinadi
      if (idx === 0 && r.isUnmatchedSummary && statusFilter === 'all' && !q) {
        return true;
      }
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (q) {
        const hay = `${r.Заказ} ${r.Модель} ${r.Цвет}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [report.rows, searchQuery, statusFilter]);

  const handleExportPdf = async () => {
    setIsPdfGenerating(true);
    try {
      await exportInfoReportToPdf(report);
      onNotify('PDF hisobot yuklab olindi.', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'PDF yaratishda xatolik.', 'error');
    } finally {
      setIsPdfGenerating(false);
    }
  };

  const renderStatusBadge = (status: InfoSummaryRow['status']) => {
    switch (status) {
      case 'ok':
        return (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>To&apos;g&apos;ri</span>
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 font-semibold whitespace-nowrap">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Xato bor</span>
          </span>
        );
      case 'missing_in_warehouse':
        return (
          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold whitespace-nowrap">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Omborda yo&apos;q</span>
          </span>
        );
      case 'incomplete_option':
        return (
          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold whitespace-nowrap">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Опция to&apos;liq emas</span>
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Yuqori sana va eksport paneli */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Инфо проверка — Zakaz / Model bo&apos;yicha hisobot
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Xatoli qutilar tafsilotini ko&apos;rish uchun jadvaldagi istalgan qatorni bosing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => exportInfoReportToExcel(report)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Excel eksport</span>
          </button>

          <button
            type="button"
            disabled={isPdfGenerating}
            onClick={handleExportPdf}
            className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-500 hover:bg-slate-800 dark:hover:bg-sky-400 text-white dark:text-slate-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{isPdfGenerating ? 'PDF tayyorlanmoqda...' : 'PDF eksport'}</span>
          </button>
        </div>
      </div>

      {/* 5 ta KPI ko'rsatkich */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Zakazlar soni</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
            {report.totalOrdersCount}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Ombor qutilari</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
            {report.totalBoxesCount}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Xatoli qutilar</p>
          <p
            className={`text-xl font-bold font-mono tabular-nums mt-1 ${
              report.errorBoxesCount > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {report.errorBoxesCount}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Опцияга bog&apos;lanmagan qutilar
          </p>
          <p
            className={`text-xl font-bold font-mono tabular-nums mt-1 ${
              report.unlinkedBoxesCount > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {report.unlinkedBoxesCount}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 col-span-2 sm:col-span-1">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Xatoli zakaz/model qatorlari
          </p>
          <p
            className={`text-xl font-bold font-mono tabular-nums mt-1 ${
              report.errorOrderModelRowsCount > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {report.errorOrderModelRowsCount}
          </p>
        </div>
      </div>

      {/* Filtr va qidiruv */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          {(
            [
              { id: 'all', label: 'Barchasi' },
              { id: 'error', label: 'Xato bor' },
              { id: 'ok', label: "To'g'ri" },
              { id: 'missing_in_warehouse', label: "Omborda yo'q" },
              { id: 'incomplete_option', label: "Опция to'liq emas" },
            ] as const
          ).map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap ${
                statusFilter === tab.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Заказ, Модель, Цвет bo'yicha qidirish..."
            className="pl-8 pr-3 py-1.5 w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
      </div>

      {/* Jadval */}
      <div className="flex-1 min-h-[360px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-auto max-h-[60vh]">
        <table className="border-collapse text-xs w-max min-w-full">
          <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700">
            <tr>
              <th className="border-r border-slate-200 dark:border-slate-700 px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                Заказ
              </th>
              <th className="border-r border-slate-200 dark:border-slate-700 px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                Модель
              </th>
              <th className="border-r border-slate-200 dark:border-slate-700 px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                Цвет
              </th>
              <th className="border-r border-slate-200 dark:border-slate-700 px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                Holat
              </th>
              <th className="border-r border-slate-200 dark:border-slate-700 px-2.5 py-2 text-right font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                Qutilar
              </th>
              <th className="border-r border-slate-200 dark:border-slate-700 px-2.5 py-2 text-right font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                Xatoli quti
              </th>
              {VALIDATED_SKLAD_FIELDS.map(f => (
                <th
                  key={f}
                  className="border-r border-slate-200 dark:border-slate-700 px-2 py-2 text-center font-semibold text-[11px] text-slate-700 dark:text-slate-200 whitespace-nowrap"
                >
                  {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => (
              <tr
                key={row.key}
                onClick={() => setSelectedSummaryRow(row)}
                className={`border-b border-slate-200 dark:border-slate-800 cursor-pointer transition-colors ${
                  row.isUnmatchedSummary
                    ? 'bg-amber-50/70 dark:bg-amber-950/30 hover:bg-amber-100/70 dark:hover:bg-amber-950/50 font-medium'
                    : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <td className="border-r border-slate-200 dark:border-slate-800 px-3 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                  {row.Заказ}
                </td>
                <td className="border-r border-slate-200 dark:border-slate-800 px-3 py-2 font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                  {row.Модель || '—'}
                </td>
                <td className="border-r border-slate-200 dark:border-slate-800 px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  {row.Цвет || '—'}
                </td>
                <td className="border-r border-slate-200 dark:border-slate-800 px-3 py-2 whitespace-nowrap">
                  {renderStatusBadge(row.status)}
                </td>
                <td className="border-r border-slate-200 dark:border-slate-800 px-2.5 py-2 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                  {row.boxCount}
                </td>
                <td
                  className={`border-r border-slate-200 dark:border-slate-800 px-2.5 py-2 text-right font-mono tabular-nums font-bold ${
                    row.errorBoxCount > 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {row.errorBoxCount}
                </td>
                {VALIDATED_SKLAD_FIELDS.map((field: SkladColumnKey) => {
                  const errCnt = row.fieldErrorCounts[field] || 0;
                  return (
                    <td
                      key={`${row.key}-${field}`}
                      className="border-r border-slate-200 dark:border-slate-800 px-2 py-2 text-center font-mono tabular-nums"
                    >
                      {errCnt > 0 ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 font-bold">
                          {errCnt}
                        </span>
                      ) : row.boxCount > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tanlangan qator xatoli qutilari modali */}
      {selectedSummaryRow && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[85vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {selectedSummaryRow.Заказ} — {selectedSummaryRow.Модель} ({selectedSummaryRow.Цвет})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Jami qutilar: {selectedSummaryRow.boxCount} · Xatoli qutilar:{' '}
                  {selectedSummaryRow.errorBoxCount} · Topilgan xabarlar:{' '}
                  {selectedSummaryRow.boxDetails.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSummaryRow(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {selectedSummaryRow.boxDetails.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                  {selectedSummaryRow.boxCount === 0
                    ? "Ushbu Опция qatori bo'yicha Склад jadvalida qutilar topilmadi."
                    : "Barcha qutilar to'g'ri, xatolar aniqlanmadi."}
                </div>
              ) : (
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                      <th className="p-2 text-left font-semibold">№ тары</th>
                      <th className="p-2 text-left font-semibold">Заказ</th>
                      <th className="p-2 text-left font-semibold">Модель</th>
                      <th className="p-2 text-left font-semibold">Maydon</th>
                      <th className="p-2 text-left font-semibold">Xato / Ogohlantirish</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSummaryRow.boxDetails.map((item, i) => (
                      <tr
                        key={`${item.rowId}-${item.field}-${i}`}
                        className="border-b border-slate-200 dark:border-slate-800"
                      >
                        <td className="p-2 font-mono font-semibold text-slate-900 dark:text-slate-100">
                          {item.taraNo || '—'}
                        </td>
                        <td className="p-2 font-mono text-slate-700 dark:text-slate-300">
                          {item.order}
                        </td>
                        <td className="p-2 font-mono text-slate-700 dark:text-slate-300">
                          {item.model}
                        </td>
                        <td className="p-2 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {item.field}
                        </td>
                        <td
                          className={`p-2 ${
                            item.level === 'error'
                              ? 'text-rose-700 dark:text-rose-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {item.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
