// «Ombor ma'lumotlarini tekshirish» asosiy veb-moduli (4 sahifali yon menyu, IndexedDB, Undo/Redo, tema va zaxira)

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Table2,
  SlidersHorizontal,
  ClipboardCheck,
  ListChecks,
  Sun,
  Moon,
  Download,
  Upload,
  FileJson,
  FileSpreadsheet,
  Menu,
  X,
  CheckCircle2,
  AlertCircle,
  Info,
} from 'lucide-react';
import {
  AuditPageId,
  AuditSettings,
  DEFAULT_COLOR_ABBREVIATIONS,
  OptionColumnKey,
  OptionRow,
  SkladColumnKey,
  SkladRow,
  ThemeMode,
} from '../types';
import {
  buildInfoCheckReport,
  createEmptyOptionRow,
  createEmptySkladRow,
  createValidationCache,
  getYesterdayDdMmYyyy,
  validateAllOptions,
  validateSkladBatchIncremental,
} from '../validators/validators';
import {
  buildBackupJsonPayload,
  getDefaultAuditSettings,
  parseBackupJsonPayload,
  warehouseAuditStorage,
} from '../services/storageService';
import {
  exportFullBackupExcel,
  importFullBackupExcel,
} from '../services/excelService';
import SkladPage from './SkladPage';
import OptsiiPage from './OptsiiPage';
import InfoProverkaPage from './InfoProverkaPage';
import TekshiruvPage from './TekshiruvPage';

const MAX_UNDO_STEPS = 250;

interface SkladHistoryState {
  past: SkladRow[][];
  present: SkladRow[];
  future: SkladRow[][];
}

export default function WarehouseAuditModule() {
  const [activePage, setActivePage] = useState<AuditPageId>('sklad');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [history, setHistory] = useState<SkladHistoryState>({
    past: [],
    present: [],
    future: [],
  });
  const skladRows = history.present;
  const pastHistory = history.past;
  const futureHistory = history.future;
  const [optionRows, setOptionRows] = useState<OptionRow[]>([]);
  const [settings, setSettings] = useState<AuditSettings>(() => getDefaultAuditSettings());

  const [notice, setNotice] = useState<{
    id: number;
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const validationCacheRef = useRef(createValidationCache());

  const showNotice = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setNotice({ id, text, type });
    setTimeout(() => {
      setNotice(prev => (prev?.id === id ? null : prev));
    }, 4000);
  }, []);

  // IndexedDB dan boshlang'ich yuklash
  useEffect(() => {
    let mounted = true;
    warehouseAuditStorage
      .loadAll()
      .then(data => {
        if (!mounted) return;
        setHistory({ past: [], present: data.sklad, future: [] });
        setOptionRows(data.options);
        setSettings(data.settings);
      })
      .catch(err => {
        console.warn('IndexedDB load warning:', err);
        showNotice("Mahalliy bazani yuklashda muammo yuz berdi.", 'error');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [showNotice]);

  // Tema sinxronizatsiyasi (.dark class documentElement ga ham qo'yiladi)
  useEffect(() => {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, [settings.theme]);

  const updateSettings = useCallback((updater: (prev: AuditSettings) => AuditSettings) => {
    setSettings(prev => {
      const next = updater(prev);
      warehouseAuditStorage.saveSettings(next).catch(() => {});
      return next;
    });
  }, []);

  const toggleTheme = () => {
    updateSettings(prev => ({
      ...prev,
      theme: prev.theme === 'dark' ? 'light' : 'dark',
    }));
  };

  const applySkladTransition = useCallback(
    (updater: (current: SkladRow[]) => SkladRow[]) => {
      setHistory(prev => {
        const nextPresent = updater(prev.present);
        if (nextPresent === prev.present) return prev;
        return {
          past: [...prev.past.slice(-(MAX_UNDO_STEPS - 1)), prev.present],
          present: nextPresent,
          future: [],
        };
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    let didUndo = false;
    setHistory(prev => {
      if (prev.past.length === 0) return prev;
      didUndo = true;
      const previous = prev.past[prev.past.length - 1];
      const nextPast = prev.past.slice(0, -1);
      const nextFuture = [prev.present, ...prev.future.slice(0, MAX_UNDO_STEPS - 1)];
      warehouseAuditStorage.replaceAllSklad(previous).catch(() => {});
      return {
        past: nextPast,
        present: previous,
        future: nextFuture,
      };
    });
    if (didUndo) {
      showNotice("Oxirgi o'zgarish bekor qilindi.", 'info');
    }
  }, [showNotice]);

  const handleRedo = useCallback(() => {
    let didRedo = false;
    setHistory(prev => {
      if (prev.future.length === 0) return prev;
      didRedo = true;
      const nextPresent = prev.future[0];
      const nextFuture = prev.future.slice(1);
      const nextPast = [...prev.past.slice(-(MAX_UNDO_STEPS - 1)), prev.present];
      warehouseAuditStorage.replaceAllSklad(nextPresent).catch(() => {});
      return {
        past: nextPast,
        present: nextPresent,
        future: nextFuture,
      };
    });
    if (didRedo) {
      showNotice("Amal qayta tiklandi.", 'info');
    }
  }, [showNotice]);

  // Butun Склад jadvali ustida bitta atomar o'zgarish (Ctrl+V, ko'p katak tozalash, fill handle, Ctrl+D/R)
  const handleCommitSkladRows = useCallback(
    (nextRows: SkladRow[]) => {
      applySkladTransition(() => nextRows);
      warehouseAuditStorage.replaceAllSklad(nextRows).catch(() => {});
    },
    [applySkladTransition]
  );

  // Склад katagini tahrirlash
  const handleUpdateSkladCell = useCallback(
    (rowId: string, field: SkladColumnKey, value: string) => {
      applySkladTransition(prev => {
        let updatedRow: SkladRow | null = null;
        const next = prev.map(r => {
          if (r.id !== rowId) return r;
          if (r[field] === value) return r;
          updatedRow = { ...r, [field]: value, updatedAt: Date.now() };
          return updatedRow;
        });
        if (updatedRow) {
          warehouseAuditStorage.putSkladRow(updatedRow).catch(() => {});
          return next;
        }
        return prev;
      });
    },
    [applySkladTransition]
  );

  // Склад qator qo'shish
  const handleAddSkladRow = useCallback(
    (partial?: Partial<SkladRow>, afterRowId?: string) => {
      const newRow = createEmptySkladRow(partial, settings.expectedDate);
      applySkladTransition(prev => {
        if (afterRowId) {
          const idx = prev.findIndex(r => r.id === afterRowId);
          if (idx !== -1) {
            const copy = [...prev];
            copy.splice(idx + 1, 0, newRow);
            warehouseAuditStorage.replaceAllSklad(copy).catch(() => {});
            return copy;
          }
        }
        const next = [newRow, ...prev];
        warehouseAuditStorage.putSkladRow(newRow).catch(() => {});
        return next;
      });
    },
    [settings.expectedDate, applySkladTransition]
  );

  // Склад bir nechta qatorni o'chirish
  const handleDeleteSkladRows = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      applySkladTransition(prev => {
        const next = prev.filter(r => !idSet.has(r.id));
        warehouseAuditStorage.deleteSkladRows(ids).catch(() => {});
        return next;
      });
      showNotice(`${ids.length} ta qator o'chirildi.`, 'info');
    },
    [applySkladTransition, showNotice]
  );

  // Excel / Ctrl+V orqali Склад qatorlarini qo'shish yoki almashtirish
  const handleAppendSkladRows = useCallback(
    (newRows: SkladRow[], replaceAll = false) => {
      applySkladTransition(prev => {
        const next = replaceAll ? newRows : [...prev, ...newRows];
        if (replaceAll) {
          warehouseAuditStorage.replaceAllSklad(next).catch(() => {});
        } else {
          warehouseAuditStorage.putSkladRows(newRows).catch(() => {});
        }
        return next;
      });
    },
    [applySkladTransition]
  );

  // Опции amallari
  const handleUpdateOptionCell = useCallback(
    (optId: string, field: OptionColumnKey, value: string) => {
      setOptionRows(prev => {
        let updated: OptionRow | null = null;
        const next = prev.map(o => {
          if (o.id !== optId) return o;
          updated = { ...o, [field]: value, updatedAt: Date.now() };
          return updated;
        });
        if (updated) {
          warehouseAuditStorage.putOptionRow(updated).catch(() => {});
        }
        return next;
      });
    },
    []
  );

  const handleAddOptionRow = useCallback((partial?: Partial<OptionRow>) => {
    const row = createEmptyOptionRow(partial);
    setOptionRows(prev => {
      const next = [row, ...prev];
      warehouseAuditStorage.putOptionRow(row).catch(() => {});
      return next;
    });
  }, []);

  const handleDeleteOptionRow = useCallback(
    (optId: string) => {
      setOptionRows(prev => prev.filter(o => o.id !== optId));
      warehouseAuditStorage.deleteOptionRow(optId).catch(() => {});
      showNotice("Опция qatori o'chirildi.", 'info');
    },
    [showNotice]
  );

  const handleAppendOptionRows = useCallback(
    (rowsToAdd: OptionRow[], replaceAll = false) => {
      setOptionRows(prev => {
        const next = replaceAll ? rowsToAdd : [...prev, ...rowsToAdd];
        warehouseAuditStorage.replaceAllOptions(next).catch(() => {});
        return next;
      });
    },
    []
  );

  // Namuna ma'lumot yuklash (foydalanuvchi bo'sh jadvalda sinab ko'rishi uchun)
  const handleLoadSampleData = useCallback(() => {
    const yesterday = getYesterdayDdMmYyyy();
    const sampleOptions: OptionRow[] = [
      createEmptyOptionRow({
        id: 'opt-smp-1',
        Заказ: 'MOS-2610.01',
        Этикетка: 'LC Waikiki',
        Модель: 'FN-OW.Blk',
        Наименование: 'Футболка мужская',
        Описание: 'Кулирка 100% хлопок',
        Группа: 'Мужская',
        Документ: 'Д-101',
        Цвет: 'Черный|Blk',
        'Кол.кор.': '40',
        Фабрика: 'Chust',
        Упаковка: 'Пакет',
        'Цвет бирки': 'Белый',
        Надпись: 'Made in Uzbekistan',
        Примечание: 'Основной',
      }),
      createEmptyOptionRow({
        id: 'opt-smp-2',
        Заказ: 'TM-2609.55',
        Этикетка: 'TodoModa',
        Модель: 'FT-OW-61.Wht',
        Наименование: 'Толстовка',
        Описание: 'Футер 3-нитка',
        Группа: 'Женская',
        Документ: 'ТМ-55',
        Цвет: 'Белый, Молочный',
        'Кол.кор.': '25',
        Фабрика: 'Chust',
        Упаковка: 'Коробка',
        'Цвет бирки': 'Синий',
        Надпись: 'TodoModa ТМ',
        Примечание: '',
      }),
    ];

    const sampleSklad: SkladRow[] = [
      createEmptySkladRow(
        {
          id: 'skl-smp-1',
          Выд: 'Да',
          '№ тары': '1001',
          Сорт: '1-сорт',
          Заказ: 'MOS-2610.01',
          Этикетка: 'LC Waikiki',
          Модель: 'FN-OW.Blk',
          Наименование: 'Футболка мужская',
          Описание: 'Кулирка 100% хлопок',
          Группа: 'Мужская',
          Документ: 'Д-101',
          Цвет: 'Черный',
          M: '10',
          L: '15',
          XL: '15',
          Всего: '40',
          'Кол.кор.': '40',
          Фабрика: 'Chust',
          Упаковка: 'Пакет',
          'Цвет бирки': 'Белый',
          Надпись: 'Made in Uzbekistan',
          'Дата упак.': yesterday,
          'Дата склад.': yesterday,
          Примечание: 'Основной',
        },
        yesterday
      ),
      createEmptySkladRow(
        {
          id: 'skl-smp-2',
          Выд: 'Да',
          '№ тары': '1002',
          Сорт: '1-сорт',
          Заказ: 'MОS-2610.01', // Kirill 'О'
          Этикетка: 'LC Waikiki ', // Ortiqcha probel
          Модель: 'FN-OW.BLK', // Rang qisqartmasi BLK -> Blk
          Наименование: 'Футболка мужская',
          Описание: 'Кулирка 100% хлопок',
          Группа: 'Мужская',
          Документ: 'Д-101',
          Цвет: 'черный', // Case farqi
          M: '20',
          L: '20',
          Всего: '40',
          'Кол.кор.': '40',
          Фабрика: 'Chust',
          Упаковка: 'Пакет',
          'Цвет бирки': 'Белый',
          Надпись: 'Made in Uzbekistan',
          'Дата упак.': '01.01.2026',
          'Дата склад.': yesterday,
          Примечание: 'Основной',
        },
        yesterday
      ),
      createEmptySkladRow(
        {
          id: 'skl-smp-3',
          Выд: '',
          '№ тары': '1003',
          Сорт: '4-сорт', // Noto'g'ri sort
          Заказ: 'TM-2609.55',
          Этикетка: 'TodoModa',
          Модель: 'FT-OW-61.WHT', // WHT -> Wht
          Наименование: 'Толстовка',
          Описание: 'Футер 3-нитка',
          Группа: 'Женская',
          Документ: 'ТМ-55',
          Цвет: 'Белый',
          S: '10',
          M: '15',
          Всего: '25',
          'Кол.кор.': '25',
          Фабрика: 'Chust',
          Упаковка: 'Коробка',
          'Цвет бирки': 'Синий',
          Надпись: 'TodoModa ТМ',
          'Дата упак.': yesterday,
          'Дата склад.': yesterday,
        },
        yesterday
      ),
      createEmptySkladRow(
        {
          id: 'skl-smp-4',
          Выд: '',
          '№ тары': '1004',
          Сорт: '1-сорт',
          Заказ: 'NEW-777', // Опцияда yo'q zakaz
          Модель: 'POLO.Red',
          Цвет: 'Красный',
          L: '30',
          Всего: '30',
          'Дата упак.': yesterday,
          'Дата склад.': yesterday,
        },
        yesterday
      ),
    ];

    setOptionRows(sampleOptions);
    handleCommitSkladRows(sampleSklad);
    updateSettings(prev => ({ ...prev, expectedDate: yesterday }));
    warehouseAuditStorage.replaceAllOptions(sampleOptions).catch(() => {});
    showNotice("Tekshiruv namuna ma'lumotlari yuklandi.", 'success');
  }, [updateSettings, handleCommitSkladRows, showNotice]);

  // JSON zaxira nusxasi yuklab olish
  const handleDownloadJsonBackup = () => {
    const payload = buildBackupJsonPayload(skladRows, optionRows, settings);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Ombor_Zaxira_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotice('JSON zaxira nusxasi yuklab olindi.', 'success');
  };

  // Zaxira nusxasidan qayta yuklash (JSON yoki Excel)
  const handleRestoreBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.json')) {
        const text = await file.text();
        const payload = parseBackupJsonPayload(text);
        setHistory({ past: [], present: payload.sklad, future: [] });
        setOptionRows(payload.options);
        setSettings(payload.settings);
        await Promise.all([
          warehouseAuditStorage.replaceAllSklad(payload.sklad),
          warehouseAuditStorage.replaceAllOptions(payload.options),
          warehouseAuditStorage.saveSettings(payload.settings),
        ]);
        showNotice(
          `JSON zaxiradan tiklandi: ${payload.sklad.length} ta Склад, ${payload.options.length} ta Опция.`,
          'success'
        );
      } else {
        const restored = await importFullBackupExcel(file, settings.expectedDate);
        if (restored.sklad.length > 0) {
          handleCommitSkladRows(restored.sklad);
        }
        if (restored.options.length > 0) {
          setOptionRows(restored.options);
          await warehouseAuditStorage.replaceAllOptions(restored.options);
        }
        if (restored.expectedDate || restored.colorAbbreviations) {
          updateSettings(prev => ({
            ...prev,
            expectedDate: restored.expectedDate || prev.expectedDate,
            colorAbbreviations: restored.colorAbbreviations || prev.colorAbbreviations,
          }));
        }
        showNotice(
          `Excel zaxiradan tiklandi: ${restored.sklad.length} ta Склад, ${restored.options.length} ta Опция.`,
          'success'
        );
      }
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Zaxira faylni tiklashda xatolik.", 'error');
    }
  };

  // Memoizatsiyalangan va inkremental tekshiruv natijalari
  const optionValidations = useMemo(
    () => validateAllOptions(optionRows, settings.colorAbbreviations),
    [optionRows, settings.colorAbbreviations]
  );

  const skladValidations = useMemo(
    () =>
      validateSkladBatchIncremental(
        skladRows,
        optionRows,
        settings.expectedDate,
        settings.colorAbbreviations,
        validationCacheRef.current
      ),
    [skladRows, optionRows, settings.expectedDate, settings.colorAbbreviations]
  );

  const infoReport = useMemo(
    () =>
      buildInfoCheckReport(
        skladRows,
        optionRows,
        skladValidations,
        optionValidations,
        settings.expectedDate
      ),
    [skladRows, optionRows, skladValidations, optionValidations, settings.expectedDate]
  );

  const navItems: Array<{
    id: AuditPageId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
    hasError?: boolean;
  }> = [
    { id: 'sklad', label: 'Склад', icon: Table2, count: skladRows.length },
    { id: 'optsii', label: 'Опции', icon: SlidersHorizontal, count: optionRows.length },
    {
      id: 'info',
      label: 'Инфо проверка',
      icon: ClipboardCheck,
      count: infoReport.errorBoxesCount,
      hasError: infoReport.errorBoxesCount > 0,
    },
    { id: 'tekshiruv', label: 'Tekshiruv', icon: ListChecks, count: skladRows.length },
  ];

  const isDark = settings.theme === 'dark';

  return (
    <div className={isDark ? 'dark' : ''}>
      <input
        ref={restoreInputRef}
        type="file"
        accept=".json,.xlsx,.xls"
        onChange={handleRestoreBackupFile}
        className="hidden"
      />

      <div className="min-h-[calc(100vh-7.5rem)] rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex overflow-hidden shadow-lg relative">
        {/* Desktop Yon Menyu (Sidebar 240px) */}
        <aside className="hidden lg:flex w-60 shrink-0 flex-col justify-between bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-3">
          <div className="space-y-4">
            <div className="px-2 pt-1 pb-2 border-b border-slate-100 dark:border-slate-800">
              <h1 className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-white">
                Ombor tekshiruvi
              </h1>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Garment ERP · Ma&apos;lumot nazorati
              </p>
            </div>

            <nav className="space-y-1" aria-label="Ombor bo'limlari">
              {navItems.map(item => {
                const Icon = item.icon;
                const active = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActivePage(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.count !== undefined && (
                      <span
                        className={`font-mono tabular-nums text-[11px] ${
                          active
                            ? 'opacity-90'
                            : item.hasError
                            ? 'text-rose-600 dark:text-rose-400 font-bold'
                            : 'text-slate-400'
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={toggleTheme}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-600" />}
                <span>{isDark ? "Yorug' rejim" : "Qorong'i rejim"}</span>
              </span>
            </button>

            <div className="space-y-1">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Zaxira nusxa
              </p>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={handleDownloadJsonBackup}
                  className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
                  title="JSON zaxira yuklab olish"
                >
                  <FileJson className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                  <span>JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => exportFullBackupExcel(skladRows, optionRows, settings)}
                  className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-medium flex items-center justify-center gap-1 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
                  title="Excel zaxira yuklab olish"
                >
                  <FileSpreadsheet className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span>Excel</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => restoreInputRef.current?.click()}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Upload className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                <span>Zaxiradan yuklash</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Asosiy ish maydoni */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Mobil va planshetlar uchun yuqori panel */}
          <div className="lg:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <Menu className="w-4 h-4" />
              </button>
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                {navItems.find(n => n.id === activePage)?.label}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleTheme}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
                title="Rejimni almashtirish"
              >
                {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={handleDownloadJsonBackup}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
                title="JSON zaxira"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => restoreInputRef.current?.click()}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
                title="Zaxiradan yuklash"
              >
                <Upload className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Xabarlar / Bildirishnoma */}
          {notice && (
            <div
              className={`mx-3 mt-3 px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-between gap-2 ${
                notice.type === 'error'
                  ? 'bg-rose-50 dark:bg-rose-950/70 border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200'
                  : notice.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
                  : 'bg-sky-50 dark:bg-sky-950/70 border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200'
              }`}
            >
              <span className="flex items-center gap-2">
                {notice.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                ) : notice.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <Info className="w-4 h-4 shrink-0" />
                )}
                <span>{notice.text}</span>
              </span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Sahifalar konteyneri */}
          <div className="flex-1 p-3 sm:p-4 min-w-0 overflow-hidden">
            {isLoading ? (
              <div className="h-full min-h-[360px] flex flex-col gap-3">
                <div className="h-20 rounded-xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
                <div className="flex-1 rounded-xl bg-slate-200/50 dark:bg-slate-800/50 animate-pulse" />
              </div>
            ) : activePage === 'sklad' ? (
              <SkladPage
                rows={skladRows}
                validations={skladValidations}
                expectedDate={settings.expectedDate}
                canUndo={pastHistory.length > 0}
                canRedo={futureHistory.length > 0}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onUpdateCell={handleUpdateSkladCell}
                onCommitRows={handleCommitSkladRows}
                onAddRow={handleAddSkladRow}
                onDeleteRows={handleDeleteSkladRows}
                onAppendRows={handleAppendSkladRows}
                onLoadSampleData={handleLoadSampleData}
                onNotify={showNotice}
              />
            ) : activePage === 'optsii' ? (
              <OptsiiPage
                options={optionRows}
                optionValidations={optionValidations}
                skladRows={skladRows}
                colorAbbreviations={settings.colorAbbreviations}
                onUpdateColorAbbreviations={next =>
                  updateSettings(prev => ({
                    ...prev,
                    colorAbbreviations:
                      next.length > 0 ? next : [...DEFAULT_COLOR_ABBREVIATIONS],
                  }))
                }
                onUpdateOptionCell={handleUpdateOptionCell}
                onAddOptionRow={handleAddOptionRow}
                onDeleteOptionRow={handleDeleteOptionRow}
                onAppendOptionRows={handleAppendOptionRows}
                onNotify={showNotice}
              />
            ) : activePage === 'info' ? (
              <InfoProverkaPage
                report={infoReport}
                expectedDate={settings.expectedDate}
                onChangeExpectedDate={nextDate =>
                  updateSettings(prev => ({ ...prev, expectedDate: nextDate }))
                }
                onNotify={showNotice}
              />
            ) : (
              <TekshiruvPage rows={skladRows} validations={skladValidations} />
            )}
          </div>
        </div>
      </div>

      {/* Mobil yon menyu modali */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex">
          <div className="w-64 bg-white dark:bg-slate-900 h-full p-4 flex flex-col justify-between shadow-2xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  Ombor tekshiruvi
                </span>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="p-1 text-slate-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="space-y-1">
                {navItems.map(item => {
                  const Icon = item.icon;
                  const active = activePage === item.id;
                  return (
                    <button
                      key={`mob-${item.id}`}
                      type="button"
                      onClick={() => {
                        setActivePage(item.id);
                        setMobileNavOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
                        active
                          ? 'bg-slate-900 dark:bg-sky-500 text-white dark:text-slate-950'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </span>
                      {item.count !== undefined && (
                        <span className="font-mono tabular-nums text-[11px]">{item.count}</span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
            <button
              type="button"
              onClick={() => {
                exportFullBackupExcel(skladRows, optionRows, settings);
                setMobileNavOpen(false);
              }}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Excel zaxira nusxasi</span>
            </button>
          </div>
          <div className="flex-1" onClick={() => setMobileNavOpen(false)} />
        </div>
      )}
    </div>
  );
}
