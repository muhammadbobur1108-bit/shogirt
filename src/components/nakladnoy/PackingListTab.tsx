import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Plus,
  Trash2,
  QrCode,
  Download,
  Upload,
  Search,
  Layers,
  ClipboardPaste,
  CheckCircle2,
  FileText,
  Eye,
  X
} from 'lucide-react';
import { FactoryLedgerRow, COMMON_COLORS } from '../../lib/ordersSizeStore';
import { PrintPreviewPayload } from '../../lib/printBridge';
import {
  PackingListRow,
  DefectCheckRow,
  WaybillSignatories,
  generateUniqueQrCode,
  groupPackingRowsByBag,
  checkBagPrintPermission,
  exportMultiOrderWaybillPdf,
  buildMultiOrderWaybillPrintPayload
} from '../../lib/nakladnoyStore';

interface PackingListTabProps {
  rows: PackingListRow[];
  onChangeRows: (next: PackingListRow[]) => void;
  ledgerRows: FactoryLedgerRow[];
  defectChecks: DefectCheckRow[];
  signatories?: WaybillSignatories;
  baseWaybillNo?: string;
  onOpenBagQrTemplate: (bagUid: string) => void;
  onOpenPrintPreview?: (payload: PrintPreviewPayload) => void;
  onNotice: (msg: string) => void;
}

export const PackingListTab: React.FC<PackingListTabProps> = ({
  rows,
  onChangeRows,
  ledgerRows,
  defectChecks,
  signatories,
  baseWaybillNo,
  onOpenBagQrTemplate,
  onOpenPrintPreview,
  onNotice
}) => {
  const [taraNo, setTaraNo] = useState<string>('1');
  const [orderNo, setOrderNo] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [productName, setProductName] = useState<string>('');
  const [color, setColor] = useState<string>('');
  const [qty, setQty] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showPasteBox, setShowPasteBox] = useState<boolean>(false);
  const [pasteText, setPasteText] = useState<string>('');
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const [isGeneratingBulkPdf, setIsGeneratingBulkPdf] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const masterCheckboxRef = useRef<HTMLInputElement | null>(null);

  // Автодополнение из базы «Заказы» (без демо-данных)
  const orderSuggestions = useMemo(
    () => Array.from(new Set(ledgerRows.map(r => r.orderNo).filter(Boolean))),
    [ledgerRows]
  );
  const modelSuggestions = useMemo(
    () => Array.from(new Set(ledgerRows.map(r => r.model).filter(Boolean))),
    [ledgerRows]
  );
  const colorSuggestions = useMemo(() => {
    const fromOrders = ledgerRows.map(r => r.color).filter(Boolean);
    return Array.from(new Set([...fromOrders, ...COMMON_COLORS]));
  }, [ledgerRows]);

  const bagGroups = useMemo(() => groupPackingRowsByBag(rows), [rows]);

  // Следующий свободный номер тары (если текущий ещё пуст или пользователь ввёл сам — учитываем)
  const computeNextTaraNo = (currentRows: PackingListRow[]): string => {
    const nums = currentRows
      .map(r => parseInt(String(r.taraNo).trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0);
    if (nums.length === 0) return '1';
    return String(Math.max(...nums) + 1);
  };

  const handleOrderSelect = (val: string) => {
    setOrderNo(val);
    const matched = ledgerRows.find(r => r.orderNo.trim().toUpperCase() === val.trim().toUpperCase());
    if (matched) {
      if (!model.trim()) setModel(matched.model);
      if (!color.trim()) setColor(matched.color);
    }
  };

  const addRowWithBagResolution = (
    draft: {
      taraNo: string;
      orderNo: string;
      model: string;
      productName: string;
      color: string;
      qty: number;
    },
    currentList: PackingListRow[]
  ): { nextList: PackingListRow[]; qrCode: string; reusedBag: boolean } => {
    const cleanTara = draft.taraNo.trim() || computeNextTaraNo(currentList);
    const cleanOrder = draft.orderNo.trim();

    // Ищем существующую тару с тем же № тары и Заказом (чтобы 2 цвета в 1 мешке получили общий № и один QR-код)
    const existingBagRow = currentList.find(
      r =>
        r.taraNo.trim().toLowerCase() === cleanTara.toLowerCase() &&
        r.orderNo.trim().toUpperCase() === cleanOrder.toUpperCase()
    );

    const bagUid = existingBagRow ? existingBagRow.bagUid : `bag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const qrCode = existingBagRow ? existingBagRow.qrCode : generateUniqueQrCode();

    const newRow: PackingListRow = {
      id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      bagUid,
      qrCode,
      taraNo: cleanTara,
      orderNo: cleanOrder,
      model: draft.model.trim(),
      productName: draft.productName.trim(),
      color: draft.color.trim(),
      qty: draft.qty,
      weightKg: existingBagRow ? existingBagRow.weightKg : '',
      selectedForShipment: existingBagRow ? existingBagRow.selectedForShipment : false,
      shipmentNo: existingBagRow ? existingBagRow.shipmentNo : '',
      createdAt: new Date().toISOString()
    };

    return {
      nextList: [...currentList, newRow],
      qrCode,
      reusedBag: Boolean(existingBagRow)
    };
  };

  const handleAddRow = (e: React.FormEvent) => {
    e.preventDefault();
    const numericQty = Number(qty) || 0;
    if (!taraNo.trim() || !orderNo.trim() || !color.trim() || numericQty <= 0) {
      onNotice('Заполните № тары, Заказ, Цвет и Кол-во (> 0).');
      return;
    }

    const { nextList, qrCode, reusedBag } = addRowWithBagResolution(
      {
        taraNo,
        orderNo,
        model,
        productName,
        color,
        qty: numericQty
      },
      rows
    );

    onChangeRows(nextList);
    setColor('');
    setQty('');
    onNotice(
      reusedBag
        ? `Цвет «${color.trim()}» добавлен в тару № ${taraNo.trim()} (общий QR: ${qrCode}).`
        : `Тара № ${taraNo.trim()} добавлена • Уникальный QR: ${qrCode}`
    );
  };

  const handlePrepareSameBagColor = (sourceRow: PackingListRow) => {
    setTaraNo(sourceRow.taraNo);
    setOrderNo(sourceRow.orderNo);
    setModel(sourceRow.model);
    setProductName(sourceRow.productName);
    setColor('');
    setQty('');
    onNotice(`Готово к добавлению ещё одного цвета в тару № ${sourceRow.taraNo} (QR: ${sourceRow.qrCode}).`);
  };

  const handlePrepareNextBag = () => {
    const nextNum = computeNextTaraNo(rows);
    setTaraNo(nextNum);
    setColor('');
    setQty('');
  };

  const handleUpdateCell = (rowId: string, field: keyof PackingListRow, value: string | number) => {
    const target = rows.find(r => r.id === rowId);
    if (!target) return;

    const updated = rows.map(r => {
      if (r.id !== rowId) return r;
      if (field === 'qty') {
        return { ...r, qty: Math.max(0, Number(value) || 0) };
      }
      return { ...r, [field]: value };
    });

    // Если изменили № тары или Заказ — проверяем, не объединить ли с существующей тарой или выдать новый QR
    if (field === 'taraNo' || field === 'orderNo') {
      const editedRow = updated.find(r => r.id === rowId)!;
      const peer = updated.find(
        r =>
          r.id !== rowId &&
          r.taraNo.trim().toLowerCase() === editedRow.taraNo.trim().toLowerCase() &&
          r.orderNo.trim().toUpperCase() === editedRow.orderNo.trim().toUpperCase()
      );
      const finalRows = updated.map(r => {
        if (r.id !== rowId) return r;
        if (peer) {
          return { ...r, bagUid: peer.bagUid, qrCode: peer.qrCode };
        }
        // Если у старого bagUid остались другие строки — выделяем этой строке свой уникальный QR
        const othersShareOld = rows.some(o => o.id !== rowId && o.bagUid === target.bagUid);
        if (othersShareOld) {
          return {
            ...r,
            bagUid: `bag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            qrCode: generateUniqueQrCode()
          };
        }
        return r;
      });
      onChangeRows(finalRows);
      return;
    }

    onChangeRows(updated);
  };

  const handleDeleteRow = (rowId: string) => {
    onChangeRows(rows.filter(r => r.id !== rowId));
  };

  const handleClearAll = () => {
    if (rows.length === 0) return;
    onChangeRows([]);
    setTaraNo('1');
    onNotice('Упаковочный лист очищен.');
  };

  const handleImportPaste = () => {
    const lines = pasteText
      .split(/\r?\n/)
      .map(l => l.trimEnd())
      .filter(l => l.trim().length > 0);
    if (lines.length === 0) return;

    let current = [...rows];
    let added = 0;

    lines.forEach(line => {
      const cols = line.split('\t').map(c => c.trim());
      if (cols.length < 2) return;
      // Пропускаем возможную строку заголовка
      const firstLower = cols[0].toLowerCase();
      if (firstLower === '№' || firstLower.includes('номер') || firstLower === 'заказ') return;

      const rawTara = cols[0] || computeNextTaraNo(current);
      const rawOrder = cols[1] || orderNo;
      const rawModel = cols[2] || model;
      const rawName = cols[3] || productName;
      const rawColor = cols[4] || '';
      const rawQty = parseInt(String(cols[5] || '0').replace(/\s+/g, ''), 10) || 0;

      if (!rawOrder || rawQty <= 0) return;
      const res = addRowWithBagResolution(
        {
          taraNo: rawTara,
          orderNo: rawOrder,
          model: rawModel,
          productName: rawName,
          color: rawColor || 'Без цвета',
          qty: rawQty
        },
        current
      );
      current = res.nextList;
      added++;
    });

    if (added > 0) {
      onChangeRows(current);
      setPasteText('');
      setShowPasteBox(false);
      onNotice(`Вставлено строк из Excel: ${added}`);
    } else {
      onNotice('Не найдены подходящие строки. Формат колонок: № | Заказ | Модель | Наименование | Цвет | Кол-во');
    }
  };

  const handleImportXlsx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const sheetRows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

      let current = [...rows];
      let added = 0;

      sheetRows.forEach(cols => {
        if (!Array.isArray(cols) || cols.length < 4) return;
        const c0 = String(cols[0] ?? '').trim();
        const c1 = String(cols[1] ?? '').trim();
        if (!c0 || c0 === '№' || c0.toLowerCase().includes('упаков') || c1.toLowerCase() === 'заказ') return;

        const qtyVal = Number(String(cols[5] ?? '0').replace(/\s+/g, '')) || 0;
        if (!c1 || qtyVal <= 0) return;

        const res = addRowWithBagResolution(
          {
            taraNo: c0,
            orderNo: c1,
            model: String(cols[2] ?? '').trim(),
            productName: String(cols[3] ?? '').trim(),
            color: String(cols[4] ?? '').trim() || 'Без цвета',
            qty: qtyVal
          },
          current
        );
        current = res.nextList;
        added++;
      });

      if (added > 0) {
        onChangeRows(current);
        onNotice(`Импортировано из Excel: ${added} строк.`);
      } else {
        onNotice('Подходящие строки не найдены в файле.');
      }
    } catch (err) {
      console.error(err);
      onNotice('Ошибка чтения Excel файла.');
    } finally {
      e.target.value = '';
    }
  };

  const handleExportXlsx = () => {
    if (rows.length === 0) return;
    const aoa = [
      ['Упаковочный лист'],
      ['№', 'Заказ', 'Модель', 'Наименование', 'Цвет', 'Кол-во', 'QR-код тары'],
      ...rows.map(r => [r.taraNo, r.orderNo, r.model, r.productName, r.color, r.qty, r.qrCode]),
      ['', '', '', '', 'ИТОГО', rows.reduce((s, r) => s + (Number(r.qty) || 0), 0), '']
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 10 },
      { wch: 16 },
      { wch: 26 },
      { wch: 28 },
      { wch: 16 },
      { wch: 10 },
      { wch: 18 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Упаковочный лист');
    XLSX.writeFile(wb, `Упаковочный_лист_${new Date().toISOString().slice(0, 10)}.xlsx`);
    onNotice('Упаковочный лист выгружен в Excel.');
  };

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      r =>
        r.taraNo.toLowerCase().includes(q) ||
        r.orderNo.toLowerCase().includes(q) ||
        r.model.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        r.color.toLowerCase().includes(q) ||
        r.qrCode.toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

  const totalQty = useMemo(() => filteredRows.reduce((s, r) => s + (Number(r.qty) || 0), 0), [filteredRows]);

  // Уникальные заказы в упаковочном листе для быстрого пакетного выбора
  const uniqueOrdersInList = useMemo(() => {
    const map = new Map<
      string,
      { orderKey: string; orderNo: string; rowIds: string[]; bagUids: Set<string>; totalQty: number }
    >();
    rows.forEach(r => {
      const cleanOrder = (r.orderNo || '').trim();
      const key = cleanOrder ? cleanOrder.toUpperCase() : '__NO_ORDER__';
      const existing = map.get(key) || {
        orderKey: key,
        orderNo: cleanOrder || 'Без заказа',
        rowIds: [],
        bagUids: new Set<string>(),
        totalQty: 0
      };
      existing.rowIds.push(r.id);
      existing.bagUids.add(r.bagUid);
      existing.totalQty += Number(r.qty) || 0;
      map.set(key, existing);
    });
    return Array.from(map.values());
  }, [rows]);

  const selectedRows = useMemo(
    () => rows.filter(r => selectedRowIds.has(r.id)),
    [rows, selectedRowIds]
  );

  const selectedStats = useMemo(() => {
    const orderSet = new Set(
      selectedRows.map(r => ((r.orderNo || '').trim().toUpperCase() || '__NO_ORDER__'))
    );
    const bagSet = new Set(selectedRows.map(r => r.bagUid));
    const qtySum = selectedRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    return {
      rowCount: selectedRows.length,
      orderCount: orderSet.size,
      bagCount: bagSet.size,
      totalQty: qtySum
    };
  }, [selectedRows]);

  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every(r => selectedRowIds.has(r.id));
  const someFilteredSelected =
    filteredRows.some(r => selectedRowIds.has(r.id)) && !allFilteredSelected;

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = someFilteredSelected;
    }
  }, [someFilteredSelected]);

  // Очищаем несуществующие ID после удаления/очистки строк
  useEffect(() => {
    const existingIds = new Set(rows.map(r => r.id));
    setSelectedRowIds(prev => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach(id => {
        if (existingIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [rows]);

  const toggleRowSelection = (rowId: string) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredRows.forEach(r => next.delete(r.id));
      } else {
        filteredRows.forEach(r => next.add(r.id));
      }
      return next;
    });
  };

  const toggleOrderSelection = (orderRowIds: string[]) => {
    const allOrderRowsSelected =
      orderRowIds.length > 0 && orderRowIds.every(id => selectedRowIds.has(id));
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (allOrderRowsSelected) {
        orderRowIds.forEach(id => next.delete(id));
      } else {
        orderRowIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedRowIds(new Set());
  };

  const handleGenerateBulkPdf = async () => {
    if (selectedRows.length === 0) {
      onNotice('Выберите хотя бы одну строку или заказ для формирования PDF накладной.');
      return;
    }
    setIsGeneratingBulkPdf(true);
    try {
      const res = await exportMultiOrderWaybillPdf({
        selectedRows,
        baseWaybillNo,
        signatories
      });
      onNotice(
        `Сформирован многостраничный PDF (${res.pageCount} стр., заказов: ${res.orderCount}) — ${res.fileName}`
      );
    } catch (err) {
      console.error(err);
      onNotice('Ошибка формирования многостраничного PDF накладной.');
    } finally {
      setIsGeneratingBulkPdf(false);
    }
  };

  const handlePreviewBulkWaybill = () => {
    if (selectedRows.length === 0) {
      onNotice('Выберите заказы или строки для предпросмотра накладной.');
      return;
    }
    if (!onOpenPrintPreview) return;
    const payload = buildMultiOrderWaybillPrintPayload({
      selectedRows,
      baseWaybillNo,
      signatories,
      onDownloadPdf: handleGenerateBulkPdf
    });
    onOpenPrintPreview(payload);
  };

  return (
    <div className="space-y-4">
      {/* Панель добавления новой тары / цвета */}
      <form
        onSubmit={handleAddRow}
        className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <span>Упаковочный лист — ввод тары (мешков / коробок)</span>
            <span className="text-xs font-mono text-slate-400">
              · Тар: {bagGroups.length} · Позиций: {rows.length}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrepareNextBag}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            >
              Следующая тара (№ {computeNextTaraNo(rows)})
            </button>
            <button
              type="button"
              onClick={() => setShowPasteBox(v => !v)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ClipboardPaste className="w-3.5 h-3.5 text-amber-400" />
              <span>Вставить из Excel</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleImportXlsx}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5 text-sky-400" />
              <span>Импорт Excel</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-12 gap-2.5 items-end">
          <div className="lg:col-span-1">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">№ тары</label>
            <input
              type="text"
              value={taraNo}
              onChange={e => setTaraNo(e.target.value)}
              placeholder="1"
              className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono font-bold focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Заказ</label>
            <input
              type="text"
              list="nakladnoy-orders-dl"
              value={orderNo}
              onChange={e => handleOrderSelect(e.target.value)}
              placeholder="MOS-545.4"
              className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-semibold focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="lg:col-span-3">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Модель</label>
            <input
              type="text"
              list="nakladnoy-models-dl"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="SM-OW-1111/160-ВК (брак)"
              className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="lg:col-span-3">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Наименование</label>
            <input
              type="text"
              list="nakladnoy-names-dl"
              value={productName}
              onChange={e => setProductName(e.target.value)}
              placeholder="Фуфайка (футболка) мужская"
              className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="lg:col-span-1">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Цвет</label>
            <input
              type="text"
              list="nakladnoy-colors-dl"
              value={color}
              onChange={e => setColor(e.target.value)}
              placeholder="Белый"
              className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="lg:col-span-1">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">Кол-во</label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={e => setQty(e.target.value)}
              placeholder="40"
              className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs font-mono font-bold text-right focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="lg:col-span-1">
            <button
              type="submit"
              className="w-full px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить</span>
            </button>
          </div>
        </div>

        <p className="text-[11px] text-slate-400">
          Если указать одинаковый <strong className="text-slate-200">№ тары</strong> и <strong className="text-slate-200">Заказ</strong> для нескольких цветов, они помещаются в один общий мешок и получают единый уникальный QR-код.
        </p>

        {/* Списки автодополнения */}
        <datalist id="nakladnoy-orders-dl">
          {orderSuggestions.map(o => <option key={o} value={o} />)}
        </datalist>
        <datalist id="nakladnoy-models-dl">
          {modelSuggestions.map(m => <option key={m} value={m} />)}
        </datalist>
        <datalist id="nakladnoy-colors-dl">
          {colorSuggestions.map(c => <option key={c} value={c} />)}
        </datalist>
        <datalist id="nakladnoy-names-dl">
          <option value="Фуфайка (футболка) мужская" />
          <option value="Фуфайка (футболка) женская" />
          <option value="Майка мужская" />
          <option value="Топ футболка женский" />
          <option value="Толстовка мужская" />
          <option value="Брюки спортивные" />
        </datalist>

        {/* Окно вставки из Excel */}
        {showPasteBox && (
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Вставьте строки из Excel (колонки: № тары, Заказ, Модель, Наименование, Цвет, Кол-во):</span>
              <button type="button" onClick={() => setShowPasteBox(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              rows={4}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder={"1\tMOS-545.4\tSM-OW-1111/160-ВК (брак)\tФуфайка (футболка) мужская\tБелый\t40\n1\tMOS-545.4\tSM-OW-1111/160-ВК (брак)\tФуфайка (футболка) мужская\tЧерный\t60"}
              className="w-full p-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-sky-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleImportPaste}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Загрузить строки</span>
              </button>
            </div>
          </div>
        )}
      </form>

      {/* Поиск и выгрузка */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Поиск по № тары, заказу, модели, цвету или QR..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportXlsx}
            disabled={rows.length === 0}
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Скачать Excel</span>
          </button>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-rose-950/60 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Очистить список</span>
            </button>
          )}
        </div>
      </div>

      {/* Пакетный выбор заказов для формирования многостраничной Накладной PDF */}
      {rows.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-300 whitespace-nowrap">
                Быстрый выбор по заказам:
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {uniqueOrdersInList.map(ord => {
                  const selectedCount = ord.rowIds.filter(id => selectedRowIds.has(id)).length;
                  const isAll = selectedCount === ord.rowIds.length && ord.rowIds.length > 0;
                  const isPartial = selectedCount > 0 && !isAll;
                  return (
                    <button
                      key={`bulk-ord-${ord.orderKey}`}
                      type="button"
                      onClick={() => toggleOrderSelection(ord.rowIds)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                        isAll
                          ? 'bg-sky-500 text-slate-950 border-sky-400 font-bold'
                          : isPartial
                          ? 'bg-sky-950/70 text-sky-200 border-sky-500/60'
                          : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-500 hover:text-white'
                      }`}
                      title={`Выбрать или снять все позиции заказа ${ord.orderNo}`}
                    >
                      <span>{ord.orderNo}</span>
                      <span className="font-mono tabular-nums text-[11px] opacity-85">
                        · {ord.totalQty.toLocaleString('ru-RU')} шт
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={toggleSelectAllFiltered}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                {allFilteredSelected ? 'Снять все' : `Выбрать все (${filteredRows.length})`}
              </button>
              {selectedRows.length > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Сбросить</span>
                </button>
              )}
            </div>
          </div>

          {selectedRows.length > 0 && (
            <div className="pt-2.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-300 font-mono tabular-nums">
                Выбрано: <strong className="text-sky-300">{selectedStats.orderCount}</strong> зак.
                <span aria-hidden="true"> · </span>
                <strong className="text-white">{selectedStats.bagCount}</strong> тар
                <span aria-hidden="true"> · </span>
                <strong className="text-white">{selectedStats.rowCount}</strong> поз.
                <span aria-hidden="true"> · </span>
                <strong className="text-emerald-300">{selectedStats.totalQty.toLocaleString('ru-RU')}</strong> шт
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenPrintPreview && (
                  <button
                    type="button"
                    onClick={handlePreviewBulkWaybill}
                    className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Предпросмотр ({selectedStats.orderCount} стр.)</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleGenerateBulkPdf}
                  disabled={isGeneratingBulkPdf}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>
                    {isGeneratingBulkPdf
                      ? 'Формирование PDF...'
                      : `Скачать Nakladnoy PDF (${selectedStats.orderCount} стр.)`}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Таблица «Упаковочный лист» (Рис. 1) */}
      <div className="bg-white text-slate-950 rounded-xl border border-slate-300 overflow-hidden shadow-sm">
        <div className="text-center py-2 border-b border-slate-300 bg-white">
          <h3 className="text-base font-black text-red-600 tracking-wide">Упаковочный лист</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#4472C4] text-white font-bold">
                <th className="px-2 py-2 border border-slate-300 text-center w-10 print:hidden">
                  <input
                    ref={masterCheckboxRef}
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    aria-label="Выбрать все строки в таблице"
                    title={allFilteredSelected ? 'Снять выделение со всех видимых строк' : 'Выбрать все видимые строки'}
                    className="w-4 h-4 rounded accent-sky-400 cursor-pointer align-middle"
                  />
                </th>
                <th className="px-2.5 py-2 border border-slate-300 text-center w-16">№</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[115px]">Заказ</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[180px]">Модель</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[180px]">Наименование</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[110px]">Цвет</th>
                <th className="px-2.5 py-2 border border-slate-300 text-right w-24">Кол-во</th>
                <th className="px-2.5 py-2 border border-slate-300 text-center w-36">QR-код тары</th>
                <th className="px-2.5 py-2 border border-slate-300 text-center w-36 print:hidden">Действия</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500 text-xs">
                    Упаковочный лист пуст. Добавьте первую тару (№, Заказ, Модель, Наименование, Цвет, Кол-во) выше или вставьте из Excel.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => {
                  const bagCheck = checkBagPrintPermission(row.bagUid, defectChecks);
                  const bagColorCount = rows.filter(r => r.bagUid === row.bagUid).length;
                  const isRowSelected = selectedRowIds.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      className={
                        isRowSelected
                          ? 'bg-sky-100/90 hover:bg-sky-100'
                          : idx % 2 === 0
                          ? 'bg-[#D9E1F2]/60 hover:bg-sky-50'
                          : 'bg-white hover:bg-sky-50'
                      }
                    >
                      <td
                        onClick={() => toggleRowSelection(row.id)}
                        className="px-2 py-1 border border-slate-300 text-center cursor-pointer print:hidden"
                      >
                        <input
                          type="checkbox"
                          checked={isRowSelected}
                          onChange={() => toggleRowSelection(row.id)}
                          onClick={e => e.stopPropagation()}
                          aria-label={`Выбрать тару № ${row.taraNo} заказ ${row.orderNo}`}
                          className="w-4 h-4 rounded accent-sky-600 cursor-pointer align-middle"
                        />
                      </td>
                      <td className="px-1.5 py-1 border border-slate-300 text-center">
                        <input
                          type="text"
                          value={row.taraNo}
                          onChange={e => handleUpdateCell(row.id, 'taraNo', e.target.value)}
                          className="w-12 text-center font-mono font-bold bg-transparent border border-transparent focus:border-sky-500 focus:bg-white rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-1.5 py-1 border border-slate-300">
                        <input
                          type="text"
                          value={row.orderNo}
                          onChange={e => handleUpdateCell(row.id, 'orderNo', e.target.value)}
                          className="w-full font-semibold bg-transparent border border-transparent focus:border-sky-500 focus:bg-white rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-1.5 py-1 border border-slate-300">
                        <input
                          type="text"
                          value={row.model}
                          onChange={e => handleUpdateCell(row.id, 'model', e.target.value)}
                          className="w-full bg-transparent border border-transparent focus:border-sky-500 focus:bg-white rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-1.5 py-1 border border-slate-300">
                        <input
                          type="text"
                          value={row.productName}
                          onChange={e => handleUpdateCell(row.id, 'productName', e.target.value)}
                          className="w-full bg-transparent border border-transparent focus:border-sky-500 focus:bg-white rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-1.5 py-1 border border-slate-300">
                        <input
                          type="text"
                          value={row.color}
                          onChange={e => handleUpdateCell(row.id, 'color', e.target.value)}
                          className="w-full bg-transparent border border-transparent focus:border-sky-500 focus:bg-white rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-1.5 py-1 border border-slate-300 text-right">
                        <input
                          type="number"
                          min={0}
                          value={row.qty}
                          onChange={e => handleUpdateCell(row.id, 'qty', e.target.value)}
                          className="w-20 text-right font-mono font-bold bg-transparent border border-transparent focus:border-sky-500 focus:bg-white rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-2 py-1 border border-slate-300 text-center font-mono text-[11px] text-slate-700">
                        <div className="flex items-center justify-center gap-1">
                          <span>{row.qrCode}</span>
                          {bagColorCount > 1 && (
                            <span className="text-[10px] text-sky-700 font-bold" title="Общий мешок для нескольких цветов">
                              ({bagColorCount} цв.)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1 border border-slate-300 text-center print:hidden">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handlePrepareSameBagColor(row)}
                            title="Добавить ещё один цвет в эту же тару"
                            className="px-1.5 py-1 rounded bg-slate-100 hover:bg-sky-100 text-slate-800 border border-slate-300 text-[10px] font-bold flex items-center gap-0.5 cursor-pointer"
                          >
                            <Layers className="w-3 h-3 text-sky-600" />
                            <span>+Цвет</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenBagQrTemplate(row.bagUid)}
                            title={
                              bagCheck.allowed
                                ? 'Открыть QR-маркировку тары'
                                : 'Печать маркировки запрещена (Проверка брака < 0)'
                            }
                            className={`p-1 rounded border cursor-pointer ${
                              bagCheck.allowed
                                ? 'bg-slate-100 hover:bg-amber-100 text-slate-800 border-slate-300'
                                : 'bg-red-100 text-red-700 border-red-400'
                            }`}
                          >
                            <QrCode className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(row.id)}
                            title="Удалить строку"
                            className="p-1 rounded bg-slate-100 hover:bg-rose-100 text-rose-600 border border-slate-300 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-200 font-black text-slate-950">
                  <td colSpan={6} className="px-2.5 py-2 border border-slate-300 text-right">
                    ИТОГО:
                  </td>
                  <td className="px-2.5 py-2 border border-slate-300 text-right font-mono tabular-nums">
                    {totalQty.toLocaleString()}
                  </td>
                  <td colSpan={2} className="px-2.5 py-2 border border-slate-300 text-xs font-normal text-slate-600">
                    Уникальных тар: {bagGroups.length}
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

export default PackingListTab;
