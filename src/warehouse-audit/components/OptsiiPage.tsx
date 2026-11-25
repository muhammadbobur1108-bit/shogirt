// 2-sahifa: «Опции» — bir martalik etalon (reference) ma'lumotlar va rang qisqartmalari

import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  CopyPlus,
  FileSpreadsheet,
  Download,
  ClipboardPaste,
  Search,
  AlertCircle,
  AlertTriangle,
  Wand2,
  RotateCcw,
  X,
  Check,
} from 'lucide-react';
import {
  DEFAULT_COLOR_ABBREVIATIONS,
  OPTION_COLUMNS,
  OptionColumnKey,
  OptionRow,
  OptionRowValidationResult,
  SkladRow,
} from '../types';
import {
  exportOptionsToExcel,
  importOptionsFromExcelFile,
  mapMatrixToOptionRows,
  parseClipboardToMatrix,
} from '../services/excelService';
import {
  buildDraftOptionsFromSklad,
  createEmptyOptionRow,
} from '../validators/validators';

interface OptsiiPageProps {
  options: OptionRow[];
  optionValidations: Map<string, OptionRowValidationResult>;
  skladRows: SkladRow[];
  colorAbbreviations: string[];
  onUpdateColorAbbreviations: (next: string[]) => void;
  onUpdateOptionCell: (optId: string, field: OptionColumnKey, value: string) => void;
  onAddOptionRow: (partial?: Partial<OptionRow>) => void;
  onDeleteOptionRow: (optId: string) => void;
  onAppendOptionRows: (rows: OptionRow[], replaceAll?: boolean) => void;
  onNotify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const OPT_COL_WIDTHS: Record<OptionColumnKey, number> = {
  Заказ: 130,
  Этикетка: 130,
  Модель: 150,
  Наименование: 170,
  Описание: 170,
  Группа: 120,
  Документ: 120,
  Цвет: 145,
  'Кол.кор.': 90,
  Фабрика: 115,
  Упаковка: 115,
  'Цвет бирки': 120,
  Надпись: 165,
  Примечание: 165,
};

interface OptCellProps {
  value: string;
  status: 'ok' | 'error' | 'warning' | 'unvalidated';
  tooltip?: string;
  onCommit: (v: string) => void;
}

const OptCellInput: React.FC<OptCellProps> = React.memo(({ value, status, tooltip, onCommit }) => {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  const cls =
    status === 'error'
      ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-900 dark:text-rose-100 ring-1 ring-inset ring-rose-400 dark:ring-rose-500/80'
      : status === 'warning'
      ? 'bg-amber-50/70 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100'
      : 'bg-transparent text-slate-900 dark:text-slate-100';

  return (
    <div className="relative flex items-center w-full h-full" title={tooltip}>
      <input
        type="text"
        value={focused ? draft : value}
        onFocus={e => {
          setFocused(true);
          setDraft(value);
          e.currentTarget.select();
        }}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false);
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(value);
            setFocused(false);
            e.currentTarget.blur();
          }
        }}
        className={`w-full h-[36px] px-2 text-xs focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-500 ${cls}`}
      />
    </div>
  );
});

OptCellInput.displayName = 'OptCellInput';

export default function OptsiiPage({
  options,
  optionValidations,
  skladRows,
  colorAbbreviations,
  onUpdateColorAbbreviations,
  onUpdateOptionCell,
  onAddOptionRow,
  onDeleteOptionRow,
  onAppendOptionRows,
  onNotify,
}: OptsiiPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'error' | 'incomplete'>('all');
  const [newAbbr, setNewAbbr] = useState('');
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [draftPreview, setDraftPreview] = useState<Array<{ selected: boolean; row: OptionRow }> | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return options.filter(opt => {
      const val = optionValidations.get(opt.id);
      if (filterMode === 'error' && (val?.errors.length || 0) === 0) return false;
      if (filterMode === 'incomplete' && !val?.isIncomplete) return false;
      if (q) {
        const hay = `${opt.Заказ} ${opt.Модель} ${opt.Цвет} ${opt.Наименование} ${opt.Этикетка}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [options, optionValidations, searchQuery, filterMode]);

  const counts = useMemo(() => {
    let err = 0;
    let inc = 0;
    for (const o of options) {
      const v = optionValidations.get(o.id);
      if (v && v.errors.length > 0) err++;
      if (v?.isIncomplete) inc++;
    }
    return { total: options.length, err, inc };
  }, [options, optionValidations]);

  const handleAddAbbr = () => {
    const clean = newAbbr.trim();
    if (!clean) return;
    if (colorAbbreviations.some(a => a.toLowerCase() === clean.toLowerCase())) {
      onNotify(`«${clean}» qisqartmasi ro'yxatda allaqachon bor.`, 'info');
      return;
    }
    onUpdateColorAbbreviations([...colorAbbreviations, clean]);
    setNewAbbr('');
  };

  const handleExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { rows: imported } = await importOptionsFromExcelFile(file);
      if (imported.length === 0) {
        onNotify("Excel faylda Опции qatorlari topilmadi.", 'error');
        return;
      }
      onAppendOptionRows(imported, false);
      onNotify(`Опции jadvaliga ${imported.length} ta qator qo'shildi.`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Excel faylni o'qishda xatolik.", 'error');
    }
  };

  const handleConfirmPaste = () => {
    if (!pasteText.trim()) return;
    const matrix = parseClipboardToMatrix('', pasteText);
    const { rows: parsed } = mapMatrixToOptionRows(matrix);
    if (parsed.length === 0) {
      onNotify("Matndan jadval qatorlari ajratilmadi.", 'error');
      return;
    }
    onAppendOptionRows(parsed, false);
    setPasteText('');
    setIsPasteModalOpen(false);
    onNotify(`Clipboard'dan ${parsed.length} ta etalon qator qo'shildi.`, 'success');
  };

  const handleOpenDraftFromSklad = () => {
    const drafts = buildDraftOptionsFromSklad(skladRows, options);
    if (drafts.length === 0) {
      onNotify("Склад jadvalida Опцияда yo'q bo'lgan yangi Заказ+Модель topilmadi.", 'info');
      return;
    }
    setDraftPreview(drafts.map(r => ({ selected: true, row: r })));
  };

  const handleConfirmDrafts = () => {
    if (!draftPreview) return;
    const chosen = draftPreview.filter(d => d.selected).map(d => d.row);
    if (chosen.length > 0) {
      onAppendOptionRows(chosen, false);
      onNotify(`${chosen.length} ta etalon qatori Опции jadvaliga qo'shildi.`, 'success');
    }
    setDraftPreview(null);
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleExcelFileChange}
        className="hidden"
      />

      {/* Yuqori boshqaruv paneli */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Опции — Bir martalik etalon (reference) ma&apos;lumotlar
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Jami: <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">{counts.total}</span>
              {' · '}
              Xatoli: <span className="font-mono tabular-nums font-semibold text-rose-600 dark:text-rose-400">{counts.err}</span>
              {' · '}
              To&apos;liq emas: <span className="font-mono tabular-nums font-semibold text-amber-600 dark:text-amber-400">{counts.inc}</span>
              {' · '}
              Ko&apos;p qiymatlar «|» bilan ajratiladi (Цвет uchun «,» ham mumkin)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onAddOptionRow()}
              className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Qator qo&apos;shish</span>
            </button>

            <button
              type="button"
              onClick={handleOpenDraftFromSklad}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Склад ma&apos;lumotidan Опцияни to&apos;ldirish</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPasteModalOpen(true)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ClipboardPaste className="w-3.5 h-3.5 text-emerald-600" />
              <span>Ctrl+V qo&apos;yish</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Excel import</span>
            </button>

            <button
              type="button"
              onClick={() => exportOptionsToExcel(options)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-sky-600" />
              <span>Excel eksport</span>
            </button>
          </div>
        </div>

        {/* Rang qisqartmalari ro'yxati */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Rang qisqartmalari ro&apos;yxati ({colorAbbreviations.length} ta) — Модель nuqta bo&apos;laklarida katta-kichik harf tekshiruvi:
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newAbbr}
                onChange={e => setNewAbbr(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddAbbr();
                }}
                placeholder="Yangi (masalan: Nvy)"
                className="w-36 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="button"
                onClick={handleAddAbbr}
                className="px-2.5 py-1 rounded-lg bg-slate-800 dark:bg-slate-700 text-white text-xs font-medium cursor-pointer"
              >
                Qo&apos;shish
              </button>
              <button
                type="button"
                onClick={() => onUpdateColorAbbreviations([...DEFAULT_COLOR_ABBREVIATIONS])}
                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
                title="Boshlang'ich ro'yxatga qaytarish"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Asl holat</span>
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {colorAbbreviations.map(abbr => (
              <span
                key={abbr}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-800 dark:text-slate-200"
              >
                <span>{abbr}</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateColorAbbreviations(colorAbbreviations.filter(a => a !== abbr))
                  }
                  className="text-slate-400 hover:text-rose-600 cursor-pointer"
                  title="Olib tashlash"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Filtr va qidiruv */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Barchasi ({counts.total})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('error')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                filterMode === 'error'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Xatoli ({counts.err})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('incomplete')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                filterMode === 'incomplete'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              To&apos;liq emas ({counts.inc})
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Qidiruv (Заказ, Модель, Цвет...)"
              className="pl-8 pr-3 py-1.5 w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>
      </div>

      {/* Опции jadvali */}
      <div className="flex-1 min-h-[380px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-auto max-h-[62vh]">
        {options.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-3">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Опции (etalon) jadvali hozircha bo&apos;sh
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
              Etalon qatorlarni qo&apos;lda qo&apos;shing, Excel&apos;dan yuklang yoki Склад ma&apos;lumotlaridan avtomatik qoralama yarating.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onAddOptionRow()}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 text-xs font-semibold cursor-pointer"
              >
                Qator qo&apos;shish
              </button>
              <button
                type="button"
                onClick={handleOpenDraftFromSklad}
                className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold cursor-pointer"
              >
                Склад ma&apos;lumotidan to&apos;ldirish
              </button>
            </div>
          </div>
        ) : (
          <table className="border-collapse table-fixed text-xs w-max min-w-full">
            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700">
              <tr>
                <th className="w-12 border-r border-slate-200 dark:border-slate-700 px-2 py-2 text-center font-semibold text-slate-600 dark:text-slate-300">
                  №
                </th>
                <th className="w-36 border-r border-slate-200 dark:border-slate-700 px-2 py-2 text-left font-semibold text-slate-700 dark:text-slate-200">
                  Holat
                </th>
                {OPTION_COLUMNS.map(col => (
                  <th
                    key={col}
                    style={{ width: OPT_COL_WIDTHS[col] }}
                    className="border-r border-slate-200 dark:border-slate-700 px-2 py-2 text-left font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
                <th className="w-20 px-2 py-2 text-center font-semibold text-slate-700 dark:text-slate-200">
                  Amal
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredOptions.map((opt, idx) => {
                const val = optionValidations.get(opt.id);
                const hasErrors = (val?.errors.length || 0) > 0;
                const isIncomplete = Boolean(val?.isIncomplete);
                const statusTooltip = [...(val?.errors || []), ...(val?.warnings || [])].join('\n');

                return (
                  <tr
                    key={opt.id}
                    className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="border-r border-slate-200 dark:border-slate-800 px-2 text-center font-mono tabular-nums text-[11px] text-slate-500">
                      {idx + 1}
                    </td>
                    <td
                      className="border-r border-slate-200 dark:border-slate-800 px-2 py-1 text-[11px]"
                      title={statusTooltip || "To'g'ri"}
                    >
                      {hasErrors ? (
                        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">Xato ({val!.errors.length})</span>
                        </span>
                      ) : isIncomplete ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">Опция to&apos;liq emas</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                          <Check className="w-3.5 h-3.5 shrink-0" />
                          <span>To&apos;g&apos;ri</span>
                        </span>
                      )}
                    </td>
                    {OPTION_COLUMNS.map(col => (
                      <td
                        key={`${opt.id}-${col}`}
                        style={{ width: OPT_COL_WIDTHS[col] }}
                        className="border-r border-slate-200 dark:border-slate-800 p-0"
                      >
                        <OptCellInput
                          value={opt[col] || ''}
                          status={val?.fieldStatuses[col] || 'ok'}
                          tooltip={val?.fieldMessages[col]?.join('\n')}
                          onCommit={nextVal => onUpdateOptionCell(opt.id, col, nextVal)}
                        />
                      </td>
                    ))}
                    <td className="px-1 py-1 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            onAddOptionRow(createEmptyOptionRow({ ...opt, id: undefined }))
                          }
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                          title="Nusxalash"
                        >
                          <CopyPlus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteOptionRow(opt.id)}
                          className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 cursor-pointer"
                          title="O'chirish"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Ctrl+V modali */}
      {isPasteModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Опции — Excel&apos;dan Ctrl+V qo&apos;yish
              </h3>
              <button
                type="button"
                onClick={() => setIsPasteModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={8}
              placeholder="Заказ&#9;Этикетка&#9;Модель&#9;Наименование..."
              className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsPasteModalOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleConfirmPaste}
                className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 text-xs font-semibold cursor-pointer"
              >
                Qo&apos;shish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Склад dan qoralama tasdiqlash modali */}
      {draftPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[85vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Склад ma&apos;lumotidan Опция qoralamasi ({draftPreview.length} ta unikal Заказ+Модель)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Qo&apos;shiladigan qatorlarni tekshirib tasdiqlang. Keyin ularni Опции jadvalida tahrirlashingiz mumkin.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDraftPreview(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-3">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                    <th className="p-2 border border-slate-200 dark:border-slate-700 w-10 text-center">✓</th>
                    <th className="p-2 border border-slate-200 dark:border-slate-700 text-left">Заказ</th>
                    <th className="p-2 border border-slate-200 dark:border-slate-700 text-left">Модель</th>
                    <th className="p-2 border border-slate-200 dark:border-slate-700 text-left">Цвет</th>
                    <th className="p-2 border border-slate-200 dark:border-slate-700 text-left">Этикетка</th>
                    <th className="p-2 border border-slate-200 dark:border-slate-700 text-left">Наименование</th>
                  </tr>
                </thead>
                <tbody>
                  {draftPreview.map((item, idx) => (
                    <tr
                      key={item.row.id}
                      className="border-b border-slate-200 dark:border-slate-800"
                    >
                      <td className="p-2 border border-slate-200 dark:border-slate-800 text-center">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => {
                            setDraftPreview(prev =>
                              prev
                                ? prev.map((p, i) =>
                                    i === idx ? { ...p, selected: !p.selected } : p
                                  )
                                : null
                            );
                          }}
                          className="accent-sky-600 cursor-pointer"
                        />
                      </td>
                      <td className="p-2 border border-slate-200 dark:border-slate-800 font-mono font-semibold">
                        {item.row.Заказ}
                      </td>
                      <td className="p-2 border border-slate-200 dark:border-slate-800 font-mono">
                        {item.row.Модель}
                      </td>
                      <td className="p-2 border border-slate-200 dark:border-slate-800">
                        {item.row.Цвет || '—'}
                      </td>
                      <td className="p-2 border border-slate-200 dark:border-slate-800">
                        {item.row.Этикетка || '—'}
                      </td>
                      <td className="p-2 border border-slate-200 dark:border-slate-800">
                        {item.row.Наименование || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraftPreview(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleConfirmDrafts}
                className="px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950 text-xs font-semibold cursor-pointer"
              >
                Tasdiqlash va qo&apos;shish ({draftPreview.filter(d => d.selected).length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
