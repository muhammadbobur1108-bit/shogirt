import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Download,
  RotateCcw,
  Search
} from 'lucide-react';
import {
  DefectCheckRow,
  PackingListRow,
  formatRuDate
} from '../../lib/nakladnoyStore';

interface DefectCheckTabProps {
  rows: PackingListRow[];
  defectChecks: DefectCheckRow[];
  onChangeRows: (next: PackingListRow[]) => void;
  onNotice: (msg: string) => void;
}

type DefectCheckSortKey =
  | 'taraNo'
  | 'date'
  | 'orderNo'
  | 'model'
  | 'productName'
  | 'color'
  | 'qty'
  | 'firstSort'
  | 'totalPack'
  | 'razdacha'
  | 'difference';

export const DefectCheckTab: React.FC<DefectCheckTabProps> = ({
  rows,
  defectChecks,
  onChangeRows,
  onNotice
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'blocked'>('all');
  const [sortConfig, setSortConfig] = useState<{ key: DefectCheckSortKey | null; dir: 'asc' | 'desc' }>({
    key: null,
    dir: 'desc'
  });

  const toggleSort = (key: DefectCheckSortKey) => {
    setSortConfig(prev => {
      if (prev.key !== key) {
        return {
          key,
          dir:
            key === 'date' ||
            key === 'qty' ||
            key === 'firstSort' ||
            key === 'totalPack' ||
            key === 'razdacha' ||
            key === 'difference'
              ? 'desc'
              : 'asc'
        };
      }
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return { key: null, dir: 'desc' };
    });
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = defectChecks.filter(dc => {
      if (filterMode === 'blocked' && !dc.isBlocked) return false;
      if (!q) return true;
      return (
        dc.row.taraNo.toLowerCase().includes(q) ||
        dc.row.orderNo.toLowerCase().includes(q) ||
        dc.row.model.toLowerCase().includes(q) ||
        dc.row.productName.toLowerCase().includes(q) ||
        dc.row.color.toLowerCase().includes(q)
      );
    });

    if (!sortConfig.key) return base;
    const k = sortConfig.key;
    const dir = sortConfig.dir === 'asc' ? 1 : -1;

    return [...base].sort((a, b) => {
      if (k === 'date') {
        const ra = a.row.packDate || a.row.createdAt || '';
        const rb = b.row.packDate || b.row.createdAt || '';
        const ta = Date.parse(ra) || 0;
        const tb = Date.parse(rb) || 0;
        if (ta !== tb) return (ta - tb) * dir;
        return ra.localeCompare(rb) * dir;
      }
      if (k === 'qty') return ((Number(a.row.qty) || 0) - (Number(b.row.qty) || 0)) * dir;
      if (k === 'firstSort') return (a.firstSort - b.firstSort) * dir;
      if (k === 'totalPack') return (a.totalPack - b.totalPack) * dir;
      if (k === 'razdacha') return (a.razdacha - b.razdacha) * dir;
      if (k === 'difference') return (a.difference - b.difference) * dir;
      if (k === 'taraNo') {
        const na = parseFloat(a.row.taraNo);
        const nb = parseFloat(b.row.taraNo);
        if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
        return a.row.taraNo.localeCompare(b.row.taraNo, 'ru') * dir;
      }
      if (k === 'orderNo') return a.row.orderNo.localeCompare(b.row.orderNo, 'ru') * dir;
      if (k === 'model') return a.row.model.localeCompare(b.row.model, 'ru') * dir;
      if (k === 'productName') return a.row.productName.localeCompare(b.row.productName, 'ru') * dir;
      return a.row.color.localeCompare(b.row.color, 'ru') * dir;
    });
  }, [defectChecks, searchQuery, filterMode, sortConfig]);

  const stats = useMemo(() => {
    const blockedCount = defectChecks.filter(d => d.isBlocked).length;
    const allowedCount = defectChecks.length - blockedCount;
    return { total: defectChecks.length, blockedCount, allowedCount };
  }, [defectChecks]);

  const handleOverrideChange = (
    rowId: string,
    field: 'defect1SortOverride' | 'defectRazdachaOverride',
    val: string
  ) => {
    const parsed = val === '' ? '' : Math.max(0, parseInt(val, 10) || 0);
    onChangeRows(
      rows.map(r => (r.id === rowId ? { ...r, [field]: parsed } : r))
    );
  };

  const handleResetOverrides = (rowId: string) => {
    onChangeRows(
      rows.map(r =>
        r.id === rowId
          ? { ...r, defect1SortOverride: '', defectRazdachaOverride: '' }
          : r
      )
    );
    onNotice('Значения 1-Сорт и Раздача сброшены к автоданным из «Заказы».');
  };

  const handleExportXlsx = () => {
    if (filtered.length === 0) return;
    const aoa = [
      ['Проверка брака'],
      ['№', 'Дата', 'Заказ', 'Модель', 'Наименование', 'Цвет', 'Кол-во', '1-Сорт', 'Всего упаковка', 'Раздача', 'Разница', 'Контроль'],
      ...filtered.map(dc => {
        const rawDate = dc.row.packDate || dc.row.createdAt?.slice(0, 10) || '';
        return [
          dc.row.taraNo,
          rawDate ? formatRuDate(rawDate) : '',
          dc.row.orderNo,
          dc.row.model,
          dc.row.productName,
          dc.row.color,
          dc.row.qty,
          dc.firstSort,
          dc.totalPack,
          dc.razdacha,
          dc.difference,
          dc.isBlocked ? 'Печать маркировки запрещена' : 'Разрешено'
        ];
      })
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 8 },
      { wch: 12 },
      { wch: 15 },
      { wch: 24 },
      { wch: 26 },
      { wch: 14 },
      { wch: 10 },
      { wch: 10 },
      { wch: 16 },
      { wch: 10 },
      { wch: 10 },
      { wch: 30 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Проверка брака');
    XLSX.writeFile(wb, `Проверка_брака_${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotice('Отчёт «Проверка брака» выгружен в Excel.');
  };

  return (
    <div className="space-y-4">
      {/* Сводная панель контроля */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="relative min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по заказу, модели или цвету..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 rounded-md text-xs font-bold cursor-pointer ${
                filterMode === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Все ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('blocked')}
              className={`px-3 py-1 rounded-md text-xs font-bold cursor-pointer ${
                filterMode === 'blocked' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Запрещено к печати ({stats.blockedCount})
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-emerald-300 font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" />
            Разрешено: {stats.allowedCount}
          </span>
          {stats.blockedCount > 0 && (
            <span className="text-red-400 font-bold flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" />
              Заблокировано: {stats.blockedCount}
            </span>
          )}
          <button
            type="button"
            onClick={handleExportXlsx}
            disabled={filtered.length === 0}
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Скачать Excel</span>
          </button>
        </div>
      </div>

      {/* Инструкция формулы */}
      <div className="text-[11px] text-slate-400 px-1">
        Формула контроля: <strong className="text-slate-200">Всего упаковка = Кол-во (брак) + 1-Сорт</strong> ·{' '}
        <strong className="text-slate-200">Разница = Раздача − Всего упаковка</strong>. При отрицательной разнице (&lt; 0) печать маркировки для этого заказа/цвета автоматически блокируется. Значения «1-Сорт» и «Раздача» подтягиваются из «Заказы», при необходимости их можно скорректировать вручную в строке.
      </div>

      {/* Таблица «Проверка брака» (Рис. 8) */}
      <div className="bg-white text-slate-950 rounded-xl border border-slate-300 overflow-hidden shadow-sm">
        <div className="text-center py-2 border-b border-slate-300 bg-white">
          <h3 className="text-base font-black text-red-600 tracking-wide">Проверка брака</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#4472C4] text-white font-bold select-none">
                {(
                  [
                    { key: 'taraNo', label: '№', align: 'center', cls: 'w-12' },
                    { key: 'date', label: 'Дата', align: 'center', cls: 'min-w-[88px]' },
                    { key: 'orderNo', label: 'Заказ', align: 'left', cls: 'min-w-[100px]' },
                    { key: 'model', label: 'Модель', align: 'left', cls: 'min-w-[165px]' },
                    { key: 'productName', label: 'Наименование', align: 'left', cls: 'min-w-[165px]' },
                    { key: 'color', label: 'Цвет', align: 'left', cls: 'min-w-[90px]' },
                    { key: 'qty', label: 'Кол-во', align: 'right', cls: 'w-20' },
                    { key: 'firstSort', label: '1-Сорт', align: 'right', cls: 'w-24' },
                    { key: 'totalPack', label: 'Всего упаковка', align: 'right', cls: 'w-28' },
                    { key: 'razdacha', label: 'Раздача', align: 'right', cls: 'w-24' },
                    { key: 'difference', label: 'Разница', align: 'right', cls: 'w-24' }
                  ] as Array<{ key: DefectCheckSortKey; label: string; align: 'left' | 'center' | 'right'; cls: string }>
                ).map(col => {
                  const active = sortConfig.key === col.key;
                  const alignCls =
                    col.align === 'right'
                      ? 'justify-end'
                      : col.align === 'center'
                      ? 'justify-center'
                      : 'justify-start';
                  return (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      title="Нажмите для сортировки"
                      className={`px-2 py-2 border border-slate-300 cursor-pointer hover:bg-[#365fa5] transition-colors whitespace-nowrap ${col.cls}`}
                    >
                      <span className={`flex items-center gap-1 ${alignCls}`}>
                        <span>{col.label}</span>
                        {active ? (
                          sortConfig.dir === 'asc' ? (
                            <ArrowUp className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                          ) : (
                            <ArrowDown className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 text-white/60 shrink-0" />
                        )}
                      </span>
                    </th>
                  );
                })}
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[210px]">Контроль</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-slate-500 text-xs">
                    Нет позиций для проверки. Добавьте тары в разделе «Упаковочный лист».
                  </td>
                </tr>
              ) : (
                filtered.map((dc, idx) => {
                  const hasOverride =
                    (dc.row.defect1SortOverride !== undefined && dc.row.defect1SortOverride !== '') ||
                    (dc.row.defectRazdachaOverride !== undefined && dc.row.defectRazdachaOverride !== '');
                  const rawDate = dc.row.packDate || dc.row.createdAt?.slice(0, 10) || '';
                  const displayDate = rawDate ? formatRuDate(rawDate) : '—';

                  return (
                    <tr
                      key={dc.row.id}
                      className={idx % 2 === 0 ? 'bg-[#D9E1F2]/60 hover:bg-sky-50' : 'bg-white hover:bg-sky-50'}
                    >
                      <td className="px-2 py-1.5 border border-slate-300 text-center font-mono font-bold">
                        {dc.row.taraNo}
                      </td>
                      <td className="px-2 py-1.5 border border-slate-300 text-center font-mono text-slate-700 whitespace-nowrap">
                        {displayDate}
                      </td>
                      <td className="px-2 py-1.5 border border-slate-300 font-semibold">{dc.row.orderNo}</td>
                      <td className="px-2 py-1.5 border border-slate-300">{dc.row.model}</td>
                      <td className="px-2 py-1.5 border border-slate-300">{dc.row.productName}</td>
                      <td className="px-2 py-1.5 border border-slate-300">{dc.row.color}</td>
                      <td className="px-2 py-1.5 border border-slate-300 text-right font-mono font-bold">
                        {dc.row.qty}
                      </td>
                      <td className="px-1.5 py-1 border border-slate-300 text-right">
                        <input
                          type="number"
                          min={0}
                          value={
                            dc.row.defect1SortOverride !== undefined && dc.row.defect1SortOverride !== ''
                              ? dc.row.defect1SortOverride
                              : dc.firstSort
                          }
                          onChange={e => handleOverrideChange(dc.row.id, 'defect1SortOverride', e.target.value)}
                          title={dc.fromOrdersBase ? 'Авто из Заказов (Упаковка 1-сорт)' : 'Введите 1-сорт'}
                          className="w-20 text-right font-mono font-semibold bg-white/90 border border-slate-300 focus:border-sky-500 rounded px-1.5 py-0.5 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5 border border-slate-300 text-right font-mono font-bold">
                        {dc.totalPack}
                      </td>
                      <td className="px-1.5 py-1 border border-slate-300 text-right">
                        <input
                          type="number"
                          min={0}
                          value={
                            dc.row.defectRazdachaOverride !== undefined && dc.row.defectRazdachaOverride !== ''
                              ? dc.row.defectRazdachaOverride
                              : dc.razdacha
                          }
                          onChange={e => handleOverrideChange(dc.row.id, 'defectRazdachaOverride', e.target.value)}
                          title={dc.fromOrdersBase ? 'Авто из Заказов (Раздача)' : 'Введите Раздачу'}
                          className="w-20 text-right font-mono font-semibold bg-white/90 border border-slate-300 focus:border-sky-500 rounded px-1.5 py-0.5 text-xs"
                        />
                      </td>
                      <td
                        className={`px-2 py-1.5 border border-slate-300 text-right font-mono font-black ${
                          dc.difference < 0
                            ? 'bg-red-600 text-white'
                            : 'text-slate-900'
                        }`}
                      >
                        {dc.difference}
                      </td>
                      <td className="px-2.5 py-1.5 border border-slate-300">
                        <div className="flex items-center justify-between gap-2">
                          {dc.isBlocked ? (
                            <span className="text-red-700 font-bold">Печать маркировки запрещена</span>
                          ) : (
                            <span className="text-emerald-700 font-semibold">Разрешено</span>
                          )}
                          {hasOverride && (
                            <button
                              type="button"
                              onClick={() => handleResetOverrides(dc.row.id)}
                              title="Сбросить ручной ввод и взять данные из Заказов"
                              className="p-1 text-slate-500 hover:text-sky-700 cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
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
  );
};

export default DefectCheckTab;
