// 4-sahifa: «Tekshiruv» — Склад qatorlari bo'yicha batafsil tekshiruv natijalari

import React, { useMemo, useRef, useState } from 'react';
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Download,
  Search,
  AlertCircle,
  AlertTriangle,
  Check,
  ArrowUpDown,
} from 'lucide-react';
import {
  RowValidationResult,
  SkladRow,
  VALIDATED_SKLAD_FIELDS,
} from '../types';
import { exportTekshiruvToExcel } from '../services/excelService';

interface TekshiruvPageProps {
  rows: SkladRow[];
  validations: Map<string, RowValidationResult>;
}

interface TekshiruvRowItem {
  row: SkladRow;
  val: RowValidationResult;
}

export default function TekshiruvPage({ rows, validations }: TekshiruvPageProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'error' | 'warning' | 'ok'>('all');
  const [orderFilter, setOrderFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const distinctOrders = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.Заказ.trim()) s.add(r.Заказ.trim());
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredItems = useMemo<TekshiruvRowItem[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const list: TekshiruvRowItem[] = [];

    for (const row of rows) {
      const val = validations.get(row.id);
      if (!val) continue;
      if (statusFilter !== 'all' && val.status !== statusFilter) continue;
      if (orderFilter !== 'all' && row.Заказ.trim() !== orderFilter) continue;
      if (q) {
        const hay = `${row['№ тары']} ${row.Заказ} ${row.Модель} ${val.combinedText}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      list.push({ row, val });
    }
    return list;
  }, [rows, validations, statusFilter, orderFilter, searchQuery]);

  const columns = useMemo<ColumnDef<TekshiruvRowItem>[]>(() => {
    const baseCols: ColumnDef<TekshiruvRowItem>[] = [
      {
        id: '__idx',
        size: 52,
        enableSorting: false,
        header: () => <span>№</span>,
        cell: ({ row }) => (
          <div className="text-center font-mono tabular-nums text-[11px] text-slate-500">
            {row.index + 1}
          </div>
        ),
      },
      {
        id: 'tara',
        accessorFn: item => item.row['№ тары'],
        size: 95,
        header: ({ column }) => (
          <button
            type="button"
            onClick={column.getToggleSortingHandler()}
            className="w-full flex items-center justify-between gap-1 px-2 py-1.5 text-left font-semibold cursor-pointer"
          >
            <span>№ тары</span>
            <ArrowUpDown className="w-3 h-3 text-slate-400" />
          </button>
        ),
        cell: ({ row }) => (
          <div className="px-2 font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
            {row.original.row['№ тары'] || '—'}
          </div>
        ),
      },
      {
        id: 'order',
        accessorFn: item => item.row.Заказ,
        size: 135,
        header: ({ column }) => (
          <button
            type="button"
            onClick={column.getToggleSortingHandler()}
            className="w-full flex items-center justify-between gap-1 px-2 py-1.5 text-left font-semibold cursor-pointer"
          >
            <span>Заказ</span>
            <ArrowUpDown className="w-3 h-3 text-slate-400" />
          </button>
        ),
        cell: ({ row }) => (
          <div className="px-2 font-mono text-slate-800 dark:text-slate-200 truncate">
            {row.original.row.Заказ || '—'}
          </div>
        ),
      },
      {
        id: 'status',
        accessorFn: item => item.val.status,
        size: 115,
        header: () => <span className="px-2">Holat</span>,
        cell: ({ row }) => {
          const st = row.original.val.status;
          if (st === 'error') {
            return (
              <span className="px-2 inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Xato</span>
              </span>
            );
          }
          if (st === 'warning') {
            return (
              <span className="px-2 inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Ogohlantirish</span>
              </span>
            );
          }
          return (
            <span className="px-2 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
              <Check className="w-3.5 h-3.5 shrink-0" />
              <span>To&apos;g&apos;ri</span>
            </span>
          );
        },
      },
      {
        id: 'errorCount',
        accessorFn: item => item.val.errorCount,
        size: 80,
        header: ({ column }) => (
          <button
            type="button"
            onClick={column.getToggleSortingHandler()}
            className="w-full flex items-center justify-between gap-1 px-2 py-1.5 font-semibold cursor-pointer"
          >
            <span>Xato</span>
            <ArrowUpDown className="w-3 h-3 text-slate-400" />
          </button>
        ),
        cell: ({ row }) => {
          const cnt = row.original.val.errorCount;
          return (
            <div
              className={`px-2 text-right font-mono tabular-nums font-bold ${
                cnt > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'
              }`}
            >
              {cnt}
            </div>
          );
        },
      },
      {
        id: 'warningCount',
        accessorFn: item => item.val.warningCount,
        size: 95,
        header: ({ column }) => (
          <button
            type="button"
            onClick={column.getToggleSortingHandler()}
            className="w-full flex items-center justify-between gap-1 px-2 py-1.5 font-semibold cursor-pointer"
          >
            <span>Ogohl.</span>
            <ArrowUpDown className="w-3 h-3 text-slate-400" />
          </button>
        ),
        cell: ({ row }) => {
          const cnt = row.original.val.warningCount;
          return (
            <div
              className={`px-2 text-right font-mono tabular-nums font-bold ${
                cnt > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'
              }`}
            >
              {cnt}
            </div>
          );
        },
      },
      {
        id: 'combinedText',
        accessorFn: item => item.val.combinedText,
        size: 320,
        header: () => <span className="px-2">Barcha xatolar (bitta matnda)</span>,
        cell: ({ row }) => (
          <div
            className="px-2 text-[11px] text-slate-800 dark:text-slate-200 truncate"
            title={row.original.val.combinedText}
          >
            {row.original.val.combinedText || '—'}
          </div>
        ),
      },
    ];

    const fieldCols: ColumnDef<TekshiruvRowItem>[] = VALIDATED_SKLAD_FIELDS.map(field => ({
      id: `f_${field}`,
      size: 165,
      enableSorting: false,
      header: () => <span className="px-2 whitespace-nowrap">{field}</span>,
      cell: ({ row }) => {
        const msgs = row.original.val.fieldMessages[field];
        const status = row.original.val.fieldStatuses[field];
        if (!msgs || msgs.length === 0) {
          return <div className="px-2 text-center text-emerald-600 dark:text-emerald-400 font-bold">✓</div>;
        }
        const text = msgs.join(' | ');
        return (
          <div
            title={text}
            className={`px-2 text-[11px] truncate font-medium ${
              status === 'error'
                ? 'text-rose-700 dark:text-rose-300 bg-rose-50/70 dark:bg-rose-950/40'
                : 'text-amber-700 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/40'
            }`}
          >
            {text}
          </div>
        );
      },
    }));

    return [...baseCols, ...fieldCols];
  }, []);

  const table = useReactTable({
    data: filteredItems,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { rows: tableRows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 36,
    overscan: 15,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Tekshiruv — Qatorlar kesimida batafsil natija
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Har bir quti (№ тары) va maydon bo&apos;yicha batafsil xatolar ro&apos;yxati
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            exportTekshiruvToExcel(
              filteredItems.map(i => i.row),
              validations
            )
          }
          className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Excel eksport</span>
        </button>
      </div>

      {/* Filtrlar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            {(
              [
                { id: 'all', label: 'Barchasi' },
                { id: 'error', label: 'Faqat xatoli' },
                { id: 'warning', label: 'Ogohlantirish' },
                { id: 'ok', label: "To'g'ri" },
              ] as const
            ).map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setStatusFilter(t.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                  statusFilter === t.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <select
            value={orderFilter}
            onChange={e => setOrderFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200"
          >
            <option value="all">Barcha zakazlar</option>
            {distinctOrders.map(ord => (
              <option key={ord} value={ord}>
                {ord}
              </option>
            ))}
          </select>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Qidiruv (№ тары, Заказ, xato matni...)"
            className="pl-8 pr-3 py-1.5 w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
      </div>

      {/* Virtualizatsiya jadvali */}
      <div
        ref={containerRef}
        className="flex-1 min-h-[380px] max-h-[65vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-auto"
      >
        <table className="border-collapse table-fixed text-xs w-max min-w-full">
          <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(h => (
                  <th
                    key={h.id}
                    style={{ width: h.getSize() }}
                    className="border-r border-slate-200 dark:border-slate-700 py-1.5 text-left font-semibold text-[11px] text-slate-700 dark:text-slate-200"
                  >
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} colSpan={columns.length} />
              </tr>
            )}
            {virtualRows.map(vRow => {
              const r = tableRows[vRow.index];
              return (
                <tr
                  key={r.id}
                  style={{ height: '36px' }}
                  className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  {r.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className="border-r border-slate-200 dark:border-slate-800 py-1 align-middle"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} colSpan={columns.length} />
              </tr>
            )}
          </tbody>
        </table>

        {tableRows.length === 0 && (
          <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
            Ma&apos;lumot topilmadi.
          </div>
        )}
      </div>
    </div>
  );
}
