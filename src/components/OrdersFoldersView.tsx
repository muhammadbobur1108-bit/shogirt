import React, { useMemo, useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Folder,
  FolderOpen,
  ArrowLeft,
  Search,
  FileText,
  Save,
  Plus,
  Filter,
  Ruler,
  MessageSquare,
  CheckCircle2,
  Trash2
} from 'lucide-react';
import {
  FactoryLedgerRow,
  OrderSizeMatrix,
  SizeCellValues,
  SizePresetId,
  SIZE_PRESETS,
  COMMON_COLORS,
  ROST_OPTIONS,
  getEffectiveDisplaySizes
} from '../lib/ordersSizeStore';
import { registerCyrillicFonts } from '../lib/pdfCyrillicFonts';
import { Language } from '../locales';

interface OrdersFoldersViewProps {
  allRows: FactoryLedgerRow[];
  sizeMatrices: Record<string, OrderSizeMatrix>;
  monthsList: string[];
  brandsList: string[];
  hasUnsavedChanges: boolean;
  onUpdateRowField: (
    rowId: string,
    field: 'brand' | 'orderNo' | 'model' | 'color' | 'colorCode' | 'rost' | 'month' | 'notes' | 'qtyShipped',
    val: string
  ) => void;
  onUpdateSizeCell: (rowId: string, sizeName: string, stage: keyof SizeCellValues, val: string) => void;
  onUpdateDefect: (rowId: string, val: string) => void;
  onChangeSizePreset: (rowId: string, presetId: Exclude<SizePresetId, 'custom'>) => void;
  onAddSizeColumn: (rowId: string, newSize: string) => void;
  onAddColorToFolder: (orderNo: string, templateRow?: FactoryLedgerRow) => void;
  onRequestDeleteFolder: (orderNo: string) => void;
  onRequestDeleteRow: (row: FactoryLedgerRow) => void;
  onSaveAll: () => void;
  onNotice: (msg: string) => void;
  lang: Language;
}

const STAGES: Array<{ key: keyof SizeCellValues; uz: string; ru: string; tone: string }> = [
  { key: 'order', uz: 'Buyurtma', ru: 'Заказ', tone: 'text-blue-300' },
  { key: 'cut', uz: 'Kroy', ru: 'Крой', tone: 'text-sky-300' },
  { key: 'dist', uz: 'Taqsimot', ru: 'Раздача', tone: 'text-teal-300' },
  { key: 'sew', uz: 'Tikuv', ru: 'Пошив', tone: 'text-emerald-300' },
  { key: 'pack', uz: 'Qadoq (1-sort)', ru: 'Упак. (1-сорт)', tone: 'text-amber-300 font-bold' }
];

function fmtInt(val: number): string {
  return Math.round(val || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export default function OrdersFoldersView({
  allRows,
  sizeMatrices,
  monthsList,
  brandsList,
  hasUnsavedChanges,
  onUpdateRowField,
  onUpdateSizeCell,
  onUpdateDefect,
  onChangeSizePreset,
  onAddSizeColumn,
  onAddColorToFolder,
  onRequestDeleteFolder,
  onRequestDeleteRow,
  onSaveAll,
  onNotice,
  lang
}: OrdersFoldersViewProps) {
  const isUz = lang === 'uz';

  // Filters for Folder List & Report Export
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterBrand, setFilterBrand] = useState<string>('all');
  const [searchOrder, setSearchOrder] = useState<string>('');

  // Currently opened folder (null = list view showing ONLY Order No)
  const [openedOrderNo, setOpenedOrderNo] = useState<string | null>(null);

  // Filters inside an opened folder
  const [insideColorFilter, setInsideColorFilter] = useState<string>('all');
  const [insideStageFilter, setInsideStageFilter] = useState<'all' | keyof SizeCellValues>('all');
  const [customSizeInputs, setCustomSizeInputs] = useState<Record<string, string>>({});

  const availableMonths = useMemo(() => {
    const s = new Set<string>(monthsList);
    allRows.forEach(r => {
      if (r.month?.trim()) s.add(r.month.trim());
    });
    return Array.from(s);
  }, [allRows, monthsList]);

  const availableBrands = useMemo(() => {
    const s = new Set<string>(brandsList);
    allRows.forEach(r => {
      if (r.brand?.trim()) s.add(r.brand.trim());
    });
    return Array.from(s);
  }, [allRows, brandsList]);

  // Filtered rows across folder list filters
  const filteredCommittedRows = useMemo(() => {
    const q = searchOrder.trim().toLowerCase();
    return allRows.filter(r => {
      if (filterMonth !== 'all' && (r.month || '') !== filterMonth) return false;
      if (filterBrand !== 'all' && (r.brand || '') !== filterBrand) return false;
      if (q && !(r.orderNo || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allRows, filterMonth, filterBrand, searchOrder]);

  // Distinct folder names (ONLY orderNo)
  const folderOrderNos = useMemo(() => {
    const set = new Set<string>();
    filteredCommittedRows.forEach(r => {
      const ord = (r.orderNo || '').trim();
      if (ord) set.add(ord);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [filteredCommittedRows]);

  // Rows belonging to currently opened order folder
  const folderRowsAll = useMemo(() => {
    if (!openedOrderNo) return [];
    return allRows.filter(r => (r.orderNo || '').trim() === openedOrderNo);
  }, [allRows, openedOrderNo]);

  // Close folder automatically if all its rows were deleted
  useEffect(() => {
    if (openedOrderNo && !allRows.some(r => (r.orderNo || '').trim() === openedOrderNo)) {
      setOpenedOrderNo(null);
    }
  }, [openedOrderNo, allRows]);

  const folderColorsList = useMemo(() => {
    const set = new Set<string>();
    folderRowsAll.forEach(r => {
      const lbl = (r.color || '').trim() || (isUz ? 'Rangsiz' : 'Без цвета');
      set.add(lbl);
    });
    return Array.from(set);
  }, [folderRowsAll, isUz]);

  const visibleFolderRows = useMemo(() => {
    return folderRowsAll.filter(r => {
      if (insideColorFilter === 'all') return true;
      const lbl = (r.color || '').trim() || (isUz ? 'Rangsiz' : 'Без цвета');
      return lbl === insideColorFilter;
    });
  }, [folderRowsAll, insideColorFilter, isUz]);

  // Export PDF for filtered list OR opened folder OR single color row
  const handleExportFolderReportPdf = async (
    rowsToPrint: FactoryLedgerRow[],
    reportTitle: string,
    fileName: string
  ) => {
    if (rowsToPrint.length === 0) {
      onNotice(isUz ? "PDF uchun ma'lumot topilmadi." : 'Нет данных для формирования PDF.');
      return;
    }
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontName = await registerCyrillicFonts(doc);

      doc.setFont(fontName, 'bold');
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text(reportTitle, 12, 14);

      doc.setFont(fontName, 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      doc.text(
        `${isUz ? 'Sana' : 'Дата'}: ${new Date().toLocaleDateString('ru-RU')}   |   ${
          isUz ? 'Qatorlar' : 'Строк'
        }: ${rowsToPrint.length}`,
        12,
        20
      );

      // Summary table of rows + differences + notes
      autoTable(doc, {
        startY: 24,
        head: [
          [
            '№',
            isUz ? 'Zakaz' : 'Заказ',
            isUz ? 'Model' : 'Модель',
            isUz ? 'Rang / Rost' : 'Цвет / Рост',
            isUz ? 'Buyurtma' : 'Заказ',
            isUz ? 'Kroy' : 'Крой',
            isUz ? 'Taqsimot' : 'Раздача',
            isUz ? 'Kroy−Taqs' : 'Крой−Разд',
            isUz ? 'Tikuv' : 'Пошив',
            isUz ? 'Taqs−Tik' : 'Разд−Пош',
            isUz ? 'Qadoq (1-s)' : 'Уп (1-с)',
            isUz ? 'Tik−Qad(1s)' : 'Пош−Уп(1с)',
            isUz ? 'Brak' : 'Брак',
            isUz ? 'Tik−(1s+Brak)' : 'Пош−(1с+Бр)',
            isUz ? 'Izoh' : 'Примечание'
          ]
        ],
        body: rowsToPrint.map((r, i) => {
          const totalPack = (r.qtyPackaging || 0) + (r.qtyDefect || 0);
          return [
            String(i + 1),
            r.orderNo || '—',
            r.model || '—',
            [r.color || (isUz ? 'Rangsiz' : 'Без цвета'), r.rost].filter(Boolean).join(' • '),
            fmtInt(r.qtyOrder),
            fmtInt(r.qtyCut),
            fmtInt(r.qtyDistribution),
            fmtInt((r.qtyCut || 0) - (r.qtyDistribution || 0)),
            fmtInt(r.qtySewing),
            fmtInt((r.qtyDistribution || 0) - (r.qtySewing || 0)),
            fmtInt(r.qtyPackaging),
            fmtInt((r.qtySewing || 0) - (r.qtyPackaging || 0)),
            fmtInt(r.qtyDefect),
            fmtInt((r.qtySewing || 0) - totalPack),
            r.notes || ''
          ];
        }),
        theme: 'grid',
        styles: { font: fontName, fontSize: 6.5, cellPadding: 1.2, textColor: [15, 23, 42] },
        headStyles: { fillColor: [14, 116, 144], textColor: [255, 255, 255], fontStyle: 'bold' },
        margin: { left: 8, right: 8 }
      });

      // Add per-color size breakdown pages for detailed view
      rowsToPrint.forEach(r => {
        const mat = sizeMatrices[r.id];
        if (!mat) return;
        const sizes = getEffectiveDisplaySizes(mat);
        if (sizes.length === 0) return;

        doc.addPage('a4', 'landscape');
        doc.setFont(fontName, 'bold');
        doc.setFontSize(12);
        doc.text(
          `${r.orderNo} — ${r.model} — ${r.color || (isUz ? 'Rangsiz' : 'Без цвета')}${r.rost ? ` (${r.rost})` : ''}`,
          12,
          14
        );
        doc.setFont(fontName, 'normal');
        doc.setFontSize(8.5);
        doc.text(
          `${r.brand ? `${r.brand} | ` : ''}${r.month || ''} | ${isUz ? 'Izoh' : 'Примечание'}: ${r.notes || '—'}`,
          12,
          20
        );

        const stagesRows = STAGES.map(st => {
          let sum = 0;
          const cells = sizes.map(sz => {
            const v = Number(mat.values?.[sz]?.[st.key]) || 0;
            sum += v;
            return v > 0 ? String(v) : '-';
          });
          return [isUz ? st.uz : st.ru, ...cells, fmtInt(sum)];
        });

        autoTable(doc, {
          startY: 25,
          head: [[isUz ? 'Bosqich' : 'Этап', ...sizes, isUz ? 'JAMI' : 'ВСЕГО']],
          body: stagesRows,
          theme: 'grid',
          styles: { font: fontName, fontSize: 8, halign: 'center', cellPadding: 2 },
          headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold' },
          margin: { left: 10, right: 10 }
        });
      });

      doc.save(fileName);
      onNotice(isUz ? 'PDF hisobot muvaffaqiyatli yuklab olindi!' : 'PDF-отчёт успешно скачан!');
    } catch (err) {
      console.error('Folder PDF export error:', err);
      onNotice(isUz ? 'PDF yaratishda xatolik.' : 'Ошибка при создании PDF.');
    }
  };

  // =========================================================================
  // VIEW 1: CLEAN FOLDER LIST (Shows ONLY Order No as requested)
  // =========================================================================
  if (!openedOrderNo) {
    return (
      <div className="space-y-4 text-white animate-fadeIn">
        {/* Top Filters & Separate Report PDF Bar */}
        <div className="bg-[#060f28]/95 backdrop-blur-md border border-[#1e3a6e] rounded-2xl p-4 shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                <Folder className="w-5 h-5 text-amber-400" />
                <span>
                  {isUz
                    ? "ZAKAZLARNI YANGILASH (PAPKALAR BO'YICHA)"
                    : 'ОБНОВЛЕНИЕ ЗАКАЗОВ (ПО ПАПКАМ)'}
                </span>
              </h2>
              <p className="text-xs text-cyan-300 mt-0.5">
                {isUz
                  ? "Zakaz papkasini oching — ichidagi barcha ranglar va bosqichlarni alohida tahrirlash hamda PDF olish mumkin."
                  : 'Откройте папку заказа — внутри доступны все цвета, этапы для отдельного редактирования и PDF-отчёты.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleExportFolderReportPdf(
                    filteredCommittedRows,
                    isUz ? 'ZAKAZLAR PAPKALARI HISOBOTI — CHUST TEXTILE' : 'ОТЧЁТ ПО ПАПКАМ ЗАКАЗОВ — CHUST TEXTILE',
                    `Zakazlar_Hisobot_${new Date().toISOString().split('T')[0]}.pdf`
                  )
                }
                className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-black rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow border border-rose-400/40 whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{isUz ? 'Alohida Otchet PDF' : 'Отдельный отчёт PDF'}</span>
              </button>
            </div>
          </div>

          {/* Filter Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchOrder}
                onChange={e => setSearchOrder(e.target.value)}
                placeholder={isUz ? 'Zakaz № bo‘yicha qidirish...' : 'Поиск по № заказа...'}
                className="w-full pl-9 pr-3 py-2 bg-[#0b1838] border border-[#1e3a6e] rounded-xl text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-400"
              />
            </div>

            <select
              value={filterMonth}
              onChange={e => setFilterMonth(e.target.value)}
              className="px-3 py-2 bg-[#0b1838] border border-[#1e3a6e] rounded-xl text-xs font-bold text-slate-100 focus:outline-none cursor-pointer"
            >
              <option value="all">{isUz ? 'Barcha oylar' : 'Все месяцы'}</option>
              {availableMonths.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <select
              value={filterBrand}
              onChange={e => setFilterBrand(e.target.value)}
              className="px-3 py-2 bg-[#0b1838] border border-[#1e3a6e] rounded-xl text-xs font-bold text-slate-100 focus:outline-none cursor-pointer"
            >
              <option value="all">{isUz ? 'Barcha brendlar' : 'Все бренды'}</option>
              {availableBrands.map(b => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Folder Grid — Strictly Clean Order Numbers Only */}
        {folderOrderNos.length === 0 ? (
          <div className="bg-[#060f28]/90 border border-[#1e3a6e] rounded-2xl p-12 text-center text-slate-300 text-sm">
            {isUz
              ? "Saqlangan zakazlar topilmadi. Avval «Ma'lumot kiritish (Excel)» bo'limida zakaz qo'shib saqlang."
              : 'Сохранённых заказов не найдено. Сначала добавьте и сохраните заказы в «Ввод данных (Excel-таблица)».'}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {folderOrderNos.map(orderNo => (
              <div
                key={`fld-${orderNo}`}
                className="group relative bg-[#0b1838]/95 hover:bg-[#122658] border border-[#1e3a6e] hover:border-amber-400/70 rounded-xl flex items-center shadow-lg transition-all"
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpenedOrderNo(orderNo);
                    setInsideColorFilter('all');
                    setInsideStageFilter('all');
                  }}
                  className="flex-1 min-w-0 px-3.5 py-4 flex items-center gap-2.5 cursor-pointer text-left"
                >
                  <Folder className="w-6 h-6 text-amber-400 group-hover:scale-110 transition-transform shrink-0" />
                  <span className="font-black text-sm text-white truncate tracking-wide">{orderNo}</span>
                </button>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onRequestDeleteFolder(orderNo);
                  }}
                  className="mr-2 p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/20 border border-transparent hover:border-rose-500/40 cursor-pointer transition-colors shrink-0"
                  title={isUz ? "Zakaz papkasini o'chirish" : 'Удалить папку заказа'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: INSIDE AN ORDER FOLDER (All colors of that order editable separately)
  // =========================================================================
  const firstRow = folderRowsAll[0];

  return (
    <div className="space-y-4 text-white animate-fadeIn">
      {/* Top Folder Header + Filters + PDF + Save */}
      <div className="bg-[#060f28]/95 backdrop-blur-md border border-[#1e3a6e] rounded-2xl p-4 shadow-2xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setOpenedOrderNo(null)}
              className="px-3 py-2 bg-[#0b1838] hover:bg-[#132554] border border-[#1e3a6e] rounded-xl text-xs font-bold text-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4 text-cyan-400" />
              <span>{isUz ? 'Papkalar ro‘yxati' : 'Назад к папкам'}</span>
            </button>

            <div className="flex items-center gap-2">
              <FolderOpen className="w-6 h-6 text-amber-400 shrink-0" />
              <div>
                <h2 className="text-base sm:text-lg font-black text-white tracking-wide">
                  {openedOrderNo}
                </h2>
                <div className="text-[11px] text-cyan-300 flex flex-wrap items-center gap-1.5">
                  <span>{firstRow?.brand || '—'}</span>
                  <span>·</span>
                  <span>{firstRow?.model || '—'}</span>
                  <span>·</span>
                  <span>
                    {folderRowsAll.length} {isUz ? 'ta rang/qator' : 'цветов/строк'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onAddColorToFolder(openedOrderNo, firstRow)}
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isUz ? 'Yangi rang qo‘shish' : 'Добавить цвет'}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                handleExportFolderReportPdf(
                  visibleFolderRows,
                  `${isUz ? 'ZAKAZ HISOBOTI' : 'ОТЧЁТ ПО ЗАКАЗУ'}: ${openedOrderNo}`,
                  `Zakaz_${openedOrderNo}_${new Date().toISOString().split('T')[0]}.pdf`
                )
              }
              className="px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white font-black rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow border border-rose-400/40 whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{isUz ? 'Zakaz PDF' : 'PDF заказа'}</span>
            </button>

            <button
              type="button"
              onClick={onSaveAll}
              className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow whitespace-nowrap shrink-0 border ${
                hasUnsavedChanges
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-300'
                  : 'bg-emerald-700 hover:bg-emerald-600 text-white border-emerald-500/60'
              }`}
            >
              {hasUnsavedChanges ? <Save className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              <span>
                {hasUnsavedChanges
                  ? isUz
                    ? "O'zgarishlarni saqlash"
                    : 'Сохранить изменения'
                  : isUz
                  ? 'Saqlangan'
                  : 'Сохранено'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onRequestDeleteFolder(openedOrderNo)}
              className="px-3 py-2 bg-rose-950/90 hover:bg-rose-700 text-rose-200 hover:text-white border border-rose-500/40 font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer shadow whitespace-nowrap shrink-0 transition-colors"
              title={isUz ? "Butun zakazni o'chirish" : 'Удалить весь заказ'}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isUz ? "Zakazni o'chirish" : 'Удалить заказ'}</span>
            </button>
          </div>
        </div>

        {/* Filters Inside Folder */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-[#1e3a6e]/70 text-xs">
          <div className="flex items-center gap-1.5 text-cyan-300 font-bold">
            <Filter className="w-3.5 h-3.5" />
            <span>{isUz ? 'Filtrlar:' : 'Фильтры:'}</span>
          </div>

          <select
            value={insideColorFilter}
            onChange={e => setInsideColorFilter(e.target.value)}
            className="px-3 py-1.5 bg-[#0b1838] border border-[#1e3a6e] rounded-lg text-xs font-bold text-white focus:outline-none cursor-pointer"
          >
            <option value="all">{isUz ? 'Barcha ranglar' : 'Все цвета'} ({folderRowsAll.length})</option>
            {folderColorsList.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 flex-wrap bg-[#0b1838] border border-[#1e3a6e] rounded-lg p-1">
            <button
              type="button"
              onClick={() => setInsideStageFilter('all')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer ${
                insideStageFilter === 'all' ? 'bg-cyan-500 text-slate-950 font-black' : 'text-slate-300 hover:text-white'
              }`}
            >
              {isUz ? 'Barcha bosqichlar' : 'Все этапы'}
            </button>
            {STAGES.map(st => (
              <button
                key={`flt-st-${st.key}`}
                type="button"
                onClick={() => setInsideStageFilter(st.key)}
                className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer ${
                  insideStageFilter === st.key ? 'bg-amber-400 text-slate-950 font-black' : 'text-slate-300 hover:text-white'
                }`}
              >
                {isUz ? st.uz : st.ru}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Individual Editable Color Cards inside the Order Folder */}
      <div className="space-y-4">
        {visibleFolderRows.map((row, idx) => {
          const mat = sizeMatrices[row.id];
          const sizes = mat ? (mat.sizes.length > 0 ? mat.sizes : [...SIZE_PRESETS.alpha_xs_3xl.sizes]) : [...SIZE_PRESETS.alpha_xs_3xl.sizes];
          const activeStages = insideStageFilter === 'all' ? STAGES : STAGES.filter(s => s.key === insideStageFilter);

          const diffCutDist = (row.qtyCut || 0) - (row.qtyDistribution || 0);
          const diffDistSew = (row.qtyDistribution || 0) - (row.qtySewing || 0);
          const diffSewPack1 = (row.qtySewing || 0) - (row.qtyPackaging || 0);
          const totalPack = (row.qtyPackaging || 0) + (row.qtyDefect || 0);
          const diffSewTotal = (row.qtySewing || 0) - totalPack;

          return (
            <div
              key={`fld-row-${row.id}`}
              className="bg-[#0b1838]/95 border border-[#1e3a6e] rounded-2xl p-4 shadow-xl space-y-3"
            >
              {/* Color Header + Meta Inputs + Individual Color PDF */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#1e3a6e]/80">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono font-black text-amber-300 px-2 py-0.5 bg-[#060f28] rounded border border-[#1e3a6e]">
                    #{idx + 1}
                  </span>
                  <input
                    type="text"
                    list="folder-color-suggestions"
                    value={row.color}
                    onChange={e => onUpdateRowField(row.id, 'color', e.target.value)}
                    placeholder={isUz ? 'Rang nomi...' : 'Цвет...'}
                    className="px-2.5 py-1 bg-[#060f28] border border-cyan-500/40 rounded-lg text-xs font-black text-white w-36 focus:outline-none focus:border-amber-400"
                  />
                  <input
                    type="text"
                    value={row.colorCode || ''}
                    onChange={e => onUpdateRowField(row.id, 'colorCode', e.target.value)}
                    placeholder={isUz ? 'Artikul' : 'Артикул'}
                    className="px-2.5 py-1 bg-[#060f28] border border-[#1e3a6e] rounded-lg text-xs font-mono text-slate-200 w-28 focus:outline-none"
                  />
                  <select
                    value={row.rost || ''}
                    onChange={e => onUpdateRowField(row.id, 'rost', e.target.value)}
                    className="px-2 py-1 bg-[#060f28] border border-[#1e3a6e] rounded-lg text-xs text-slate-200 focus:outline-none cursor-pointer"
                  >
                    <option value="">{isUz ? 'Rost' : 'Рост'}</option>
                    {ROST_OPTIONS.map(ro => (
                      <option key={ro} value={ro}>
                        {ro}
                      </option>
                    ))}
                  </select>
                  <select
                    value={row.month}
                    onChange={e => onUpdateRowField(row.id, 'month', e.target.value)}
                    className="px-2 py-1 bg-[#060f28] border border-[#1e3a6e] rounded-lg text-xs text-cyan-200 font-bold focus:outline-none cursor-pointer"
                  >
                    {availableMonths.map(m => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={row.model}
                    onChange={e => onUpdateRowField(row.id, 'model', e.target.value)}
                    placeholder={isUz ? 'Model' : 'Модель'}
                    className="px-2.5 py-1 bg-[#060f28] border border-[#1e3a6e] rounded-lg text-xs text-slate-200 w-40 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Preset selector */}
                  <div className="flex items-center gap-1">
                    <Ruler className="w-3.5 h-3.5 text-amber-400" />
                    <select
                      value={mat?.presetId || 'custom'}
                      onChange={e => {
                        const val = e.target.value;
                        if (val !== 'custom') {
                          onChangeSizePreset(row.id, val as Exclude<SizePresetId, 'custom'>);
                        }
                      }}
                      className="px-2 py-1 bg-[#060f28] border border-[#1e3a6e] rounded-lg text-[11px] font-bold text-amber-200 focus:outline-none cursor-pointer"
                    >
                      {Object.entries(SIZE_PRESETS).map(([k, p]) => (
                        <option key={k} value={k}>
                          {p.shortLabel}
                        </option>
                      ))}
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handleExportFolderReportPdf(
                        [row],
                        `${row.orderNo} — ${row.color || (isUz ? 'Rangsiz' : 'Без цвета')}`,
                        `Zakaz_${row.orderNo}_${row.color || 'color'}_${new Date().toISOString().split('T')[0]}.pdf`
                      )
                    }
                    className="px-2.5 py-1 bg-rose-600/90 hover:bg-rose-500 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                    title={isUz ? 'Faqat shu rang bo‘yicha PDF' : 'PDF только по этому цвету'}
                  >
                    <FileText className="w-3 h-3" />
                    <span>{isUz ? 'Rang PDF' : 'PDF цвета'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onRequestDeleteRow(row)}
                    className="px-2.5 py-1 bg-rose-950/90 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-500/40 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                    title={isUz ? "Shu rangni o'chirish" : 'Удалить этот цвет'}
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>{isUz ? "Rangni o'chirish" : 'Удалить цвет'}</span>
                  </button>
                </div>
              </div>

              {/* Editable Size Matrix Grid for this Color */}
              <div className="overflow-x-auto bg-[#060f28] rounded-xl border border-[#1e3a6e]">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#0d1f47] text-cyan-200 border-b border-[#1e3a6e]">
                      <th className="py-2 px-3 text-left font-black min-w-[125px]">
                        {isUz ? 'Bosqich' : 'Этап'}
                      </th>
                      {sizes.map(sz => (
                        <th key={`fh-${row.id}-${sz}`} className="py-2 px-1.5 text-center font-mono text-amber-300 min-w-[60px]">
                          {sz}
                        </th>
                      ))}
                      <th className="py-2 px-2 text-center bg-[#091636] min-w-[90px]">
                        <div className="flex items-center gap-1 justify-center">
                          <input
                            type="text"
                            value={customSizeInputs[row.id] || ''}
                            onChange={e => setCustomSizeInputs(prev => ({ ...prev, [row.id]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && (customSizeInputs[row.id] || '').trim()) {
                                onAddSizeColumn(row.id, customSizeInputs[row.id].trim());
                                setCustomSizeInputs(prev => ({ ...prev, [row.id]: '' }));
                              }
                            }}
                            placeholder={isUz ? '+ razmer' : '+ размер'}
                            className="w-14 px-1 py-0.5 bg-[#060f28] border border-slate-700 rounded text-[10px] text-white text-center"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if ((customSizeInputs[row.id] || '').trim()) {
                                onAddSizeColumn(row.id, customSizeInputs[row.id].trim());
                                setCustomSizeInputs(prev => ({ ...prev, [row.id]: '' }));
                              }
                            }}
                            className="p-0.5 bg-amber-400 text-slate-950 rounded font-black text-[10px] cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </th>
                      <th className="py-2 px-3 text-right font-black bg-[#122658] text-white min-w-[78px]">
                        {isUz ? 'JAMI' : 'ВСЕГО'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums divide-y divide-[#1a2f5d]/70">
                    {activeStages.map(st => {
                      let sum = 0;
                      sizes.forEach(sz => {
                        sum += Number(mat?.values?.[sz]?.[st.key]) || 0;
                      });
                      return (
                        <tr key={`fr-${row.id}-${st.key}`} className="hover:bg-[#0d1f47]/60">
                          <td className={`py-1.5 px-3 font-sans font-bold ${st.tone}`}>
                            {isUz ? st.uz : st.ru}
                          </td>
                          {sizes.map(sz => {
                            const val = Number(mat?.values?.[sz]?.[st.key]) || 0;
                            return (
                              <td key={`fc-${row.id}-${st.key}-${sz}`} className="p-1">
                                <input
                                  type="number"
                                  min={0}
                                  value={val === 0 ? '' : val}
                                  placeholder="0"
                                  onChange={e => onUpdateSizeCell(row.id, sz, st.key, e.target.value)}
                                  className="w-full px-1.5 py-1 bg-[#0b1838] focus:bg-[#132554] border border-[#1e3a6e]/80 focus:border-amber-400 rounded text-right text-white font-mono text-xs focus:outline-none"
                                />
                              </td>
                            );
                          })}
                          <td className="p-1"></td>
                          <td className="py-1.5 px-3 text-right font-black text-amber-300 bg-[#0d1f47]/60">
                            {fmtInt(sum)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Bottom Bar per Color: Brak + Shipped + Differences + Primechaniya */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start pt-1">
                <div className="lg:col-span-4 grid grid-cols-3 gap-2">
                  <div className="bg-[#060f28] border border-rose-500/40 rounded-xl p-2">
                    <label className="text-[10px] font-bold text-rose-300 block mb-1">
                      {isUz ? 'Brak (dona)' : 'Брак (шт)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={row.qtyDefect === 0 ? '' : row.qtyDefect}
                      placeholder="0"
                      onChange={e => onUpdateDefect(row.id, e.target.value)}
                      className="w-full px-2 py-1 bg-[#0b1838] border border-rose-500/30 rounded text-right font-mono font-black text-rose-300 text-xs focus:outline-none focus:border-rose-400"
                    />
                  </div>
                  <div className="bg-[#060f28] border border-amber-500/40 rounded-xl p-2">
                    <label className="text-[10px] font-bold text-amber-300 block mb-1">
                      {isUz ? "Jo'natildi (dona)" : 'Отгружено (шт)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={row.qtyShipped === 0 ? '' : row.qtyShipped}
                      placeholder="0"
                      onChange={e => onUpdateRowField(row.id, 'qtyShipped', e.target.value)}
                      className="w-full px-2 py-1 bg-[#0b1838] border border-amber-500/30 rounded text-right font-mono font-black text-amber-300 text-xs focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div className="bg-[#060f28] border border-purple-500/40 rounded-xl p-2">
                    <span className="text-[10px] font-bold text-purple-300 block mb-1">
                      {isUz ? "Ombor qoldig'i" : 'Остаток склад'}
                    </span>
                    <div className="font-mono font-black text-sm text-white text-right pt-0.5 tabular-nums">
                      {fmtInt(row.qtyStock)}
                    </div>
                  </div>
                </div>

                {/* Live Stage Differences Strip */}
                <div className="lg:col-span-4 grid grid-cols-2 gap-1.5 text-[11px] bg-[#060f28] border border-[#1e3a6e] rounded-xl p-2 font-mono tabular-nums">
                  <div className="flex items-center justify-between gap-1 px-1.5 py-0.5 rounded bg-[#0b1838]">
                    <span className="text-slate-300 font-sans">{isUz ? 'Kroy−Taqs:' : 'Крой−Разд:'}</span>
                    <strong className={diffCutDist < 0 ? 'text-rose-400' : 'text-sky-300'}>{fmtInt(diffCutDist)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-1 px-1.5 py-0.5 rounded bg-[#0b1838]">
                    <span className="text-slate-300 font-sans">{isUz ? 'Taqs−Tik:' : 'Разд−Пош:'}</span>
                    <strong className={diffDistSew < 0 ? 'text-rose-400' : 'text-teal-300'}>{fmtInt(diffDistSew)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-1 px-1.5 py-0.5 rounded bg-[#0b1838]">
                    <span className="text-slate-300 font-sans">{isUz ? 'Tik−Qad(1s):' : 'Пош−Уп(1с):'}</span>
                    <strong className={diffSewPack1 < 0 ? 'text-rose-400' : 'text-emerald-300'}>{fmtInt(diffSewPack1)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-1 px-1.5 py-0.5 rounded bg-[#0b1838]">
                    <span className="text-slate-300 font-sans">{isUz ? 'Tik−(1s+Br):' : 'Пош−(1с+Бр):'}</span>
                    <strong className={diffSewTotal < 0 ? 'text-rose-400' : 'text-amber-300'}>{fmtInt(diffSewTotal)}</strong>
                  </div>
                </div>

                {/* Primechaniya / Notes */}
                <div className="lg:col-span-4 bg-[#060f28] border border-[#1e3a6e] rounded-xl p-2">
                  <label className="text-[10px] font-bold text-cyan-300 flex items-center gap-1 mb-1">
                    <MessageSquare className="w-3 h-3" />
                    <span>{isUz ? 'Izoh' : 'Примечание'}</span>
                  </label>
                  <input
                    type="text"
                    value={row.notes || ''}
                    onChange={e => onUpdateRowField(row.id, 'notes', e.target.value)}
                    placeholder={isUz ? "O'zgarishlar haqida izoh yozing..." : 'Комментарий по изменениям...'}
                    className="w-full px-2.5 py-1 bg-[#0b1838] border border-[#1e3a6e] rounded text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>
            </div>
          );
        })}

        <datalist id="folder-color-suggestions">
          {COMMON_COLORS.map(c => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
