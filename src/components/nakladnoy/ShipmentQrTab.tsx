import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import {
  ArrowDownUp,
  Camera,
  CheckCircle2,
  CheckSquare,
  FilePlus2,
  Flashlight,
  Hash,
  Image as ImageIcon,
  QrCode,
  RotateCcw,
  ScanLine,
  Search,
  Square,
  X
} from 'lucide-react';
import {
  PackingListRow,
  extractQrTokenFromScan
} from '../../lib/nakladnoyStore';

interface ShipmentQrTabProps {
  rows: PackingListRow[];
  onChangeRows: (next: PackingListRow[]) => void;
  defaultShipmentNo: string;
  onCreateWaybillFromSelected: (selectedRows: PackingListRow[], shipmentNoHint: string) => void;
  onNotice: (msg: string) => void;
}

interface ScanFeedItem {
  id: string;
  bagUid: string;
  taraNo: string;
  orderNo: string;
  index: number;
  time: string;
  duplicate: boolean;
}

export const ShipmentQrTab: React.FC<ShipmentQrTabProps> = ({
  rows,
  onChangeRows,
  defaultShipmentNo,
  onCreateWaybillFromSelected,
  onNotice
}) => {
  const [activeShipmentNo, setActiveShipmentNo] = useState<string>(defaultShipmentNo || '1');
  const [syncIndexToShipmentNo, setSyncIndexToShipmentNo] = useState<boolean>(false);
  const [scannerInput, setScannerInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'shipped' | 'pending'>('all');
  const [sortByScanIndex, setSortByScanIndex] = useState<boolean>(false);

  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');

  const [lastScannedBanner, setLastScannedBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [recentScans, setRecentScans] = useState<ScanFeedItem[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastDecodedRef = useRef<{ code: string; ts: number }>({ code: '', ts: 0 });
  const scannerInputRef = useRef<HTMLInputElement | null>(null);
  const qrImageInputRef = useRef<HTMLInputElement | null>(null);

  // Рефы для защиты от устаревшего замыкания (stale closure) при непрерывном сканировании камерой или 2D-сканером
  const rowsRef = useRef<PackingListRow[]>(rows);
  rowsRef.current = rows;

  const activeShipmentNoRef = useRef<string>(activeShipmentNo);
  activeShipmentNoRef.current = activeShipmentNo;

  const defaultShipmentNoRef = useRef<string>(defaultShipmentNo);
  defaultShipmentNoRef.current = defaultShipmentNo;

  const syncIndexToShipmentNoRef = useRef<boolean>(syncIndexToShipmentNo);
  syncIndexToShipmentNoRef.current = syncIndexToShipmentNo;

  const onChangeRowsRef = useRef(onChangeRows);
  onChangeRowsRef.current = onChangeRows;

  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;

  const playScanBeep = (ok: boolean) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = ok ? 'sine' : 'triangle';
      osc.frequency.value = ok ? 1046 : 310;
      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } catch {
      // audio optional
    }
  };

  const applyQrScanResult = useCallback((rawScan: string) => {
    const { qrToken, taraNo, orderNo } = extractQrTokenFromScan(rawScan);
    if (!qrToken && !taraNo) return;

    const currentRows = rowsRef.current;

    // 1) Прямое совпадение по уникальному QR-коду тары (CT-...)
    let matchedRows = currentRows.filter(
      r => qrToken && r.qrCode.trim().toUpperCase() === qrToken.toUpperCase()
    );

    // 2) Запасное совпадение по № тары + Заказу
    if (matchedRows.length === 0 && taraNo && orderNo) {
      matchedRows = currentRows.filter(
        r =>
          r.taraNo.trim().toLowerCase() === taraNo.toLowerCase() &&
          r.orderNo.trim().toUpperCase() === orderNo.toUpperCase()
      );
    }

    // 3) Запасное совпадение по введённому вручную № тары, если номер уникален или с префиксом
    if (matchedRows.length === 0 && qrToken && !qrToken.includes('|')) {
      const directByTara = currentRows.filter(
        r => r.taraNo.trim().toLowerCase() === qrToken.trim().toLowerCase()
      );
      const distinctBags = new Set(directByTara.map(r => r.bagUid));
      if (distinctBags.size === 1) {
        matchedRows = directByTara;
      }
    }

    if (matchedRows.length === 0) {
      playScanBeep(false);
      const msg = `Тара по QR-коду «${qrToken || rawScan}» не найдена в Упаковочном листе.`;
      setLastScannedBanner({ ok: false, text: msg });
      onNoticeRef.current(msg);
      return;
    }

    const targetBagUid = matchedRows[0].bagUid;
    const alreadyShipped = matchedRows.every(r => r.selectedForShipment);
    const existingIndex = matchedRows.find(
      r => typeof r.shippedScanIndex === 'number' && r.shippedScanIndex > 0
    )?.shippedScanIndex;

    const maxIndex = currentRows.reduce((max, r) => {
      const idx = typeof r.shippedScanIndex === 'number' ? r.shippedScanIndex : 0;
      return idx > max ? idx : max;
    }, 0);

    const assignedIndex =
      alreadyShipped && existingIndex ? existingIndex : existingIndex || maxIndex + 1;

    const nowTime = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const batchShipNo = activeShipmentNoRef.current.trim() || defaultShipmentNoRef.current || '1';
    const targetShipNo = syncIndexToShipmentNoRef.current
      ? String(assignedIndex)
      : matchedRows[0].shipmentNo?.trim() || batchShipNo;

    const updated = currentRows.map(r => {
      if (r.bagUid !== targetBagUid) return r;
      return {
        ...r,
        selectedForShipment: true,
        shippedScanIndex: assignedIndex,
        scannedAt: r.scannedAt || nowTime,
        shipmentNo: syncIndexToShipmentNoRef.current
          ? String(assignedIndex)
          : r.shipmentNo?.trim() || batchShipNo
      };
    });

    // Синхронно обновляем ref до следующей коллбэк-итерации камеры
    rowsRef.current = updated;
    onChangeRowsRef.current(updated);
    playScanBeep(true);

    const bagDesc = matchedRows.map(m => `${m.color} (${m.qty} шт)`).join(' + ');
    const msg =
      alreadyShipped && existingIndex
        ? `Повторный скан: Тара № ${matchedRows[0].taraNo} уже отмечена (Индекс #${assignedIndex} • ${matchedRows[0].orderNo})`
        : `Отгружено • Индекс #${assignedIndex}: Тара № ${matchedRows[0].taraNo} • Заказ ${matchedRows[0].orderNo} [${bagDesc}] → Отгрузка № ${targetShipNo}`;

    setLastScannedBanner({ ok: true, text: msg });
    onNoticeRef.current(msg);

    setRecentScans(prev => [
      {
        id: `${targetBagUid}-${Date.now()}`,
        bagUid: targetBagUid,
        taraNo: matchedRows[0].taraNo,
        orderNo: matchedRows[0].orderNo,
        index: assignedIndex,
        time: nowTime,
        duplicate: Boolean(alreadyShipped && existingIndex)
      },
      ...prev.filter(item => item.bagUid !== targetBagUid || !(alreadyShipped && existingIndex))
    ].slice(0, 8));
  }, []);

  // Глобальный перехватчик USB / Bluetooth 2D-сканера (клавиатурный ввод без обязательного клика в поле)
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = 0;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase();
      const isEditable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        Boolean(target?.isContentEditable);

      // Если фокус уже в нашем поле сканера — его обработает onKeyDown самого input
      if (isEditable) return;

      const now = Date.now();
      if (now - lastKeyTime > 90) {
        buffer = '';
      }
      lastKeyTime = now;

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buffer.trim().length >= 4) {
          e.preventDefault();
          const payload = buffer.trim();
          buffer = '';
          applyQrScanResult(payload);
        } else {
          buffer = '';
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buffer += e.key;
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [applyQrScanResult]);

  const stopCamera = useCallback(() => {
    if (controlsRef.current) {
      try {
        controlsRef.current.stop();
      } catch {
        // ignore
      }
      controlsRef.current = null;
    }
    const vid = videoRef.current;
    if (vid && vid.srcObject) {
      const stream = vid.srcObject as MediaStream;
      stream.getTracks().forEach(t => t.stop());
      vid.srcObject = null;
    }
    setTorchOn(false);
    setTorchSupported(false);
    setIsCameraOpen(false);
  }, []);

  useEffect(() => {
    if (!isCameraOpen) return;
    let cancelled = false;

    const startCamera = async () => {
      setCameraError('');
      setTorchOn(false);
      setTorchSupported(false);
      try {
        const reader = new BrowserQRCodeReader();
        const videoEl = videoRef.current;
        if (!videoEl) return;

        let deviceToUse: string | undefined = selectedDeviceId || undefined;
        try {
          const devices = await BrowserQRCodeReader.listVideoInputDevices();
          if (!cancelled) setVideoDevices(devices);
          if (!deviceToUse && devices.length > 0) {
            const backCam = devices.find(d => /back|rear|environment|задн/i.test(d.label));
            deviceToUse = (backCam || devices[0])?.deviceId;
            if (deviceToUse && !cancelled) setSelectedDeviceId(deviceToUse);
          }
        } catch {
          // fallback to browser default
        }

        const controls = await reader.decodeFromVideoDevice(
          deviceToUse,
          videoEl,
          (result) => {
            if (!result || cancelled) return;
            const text = result.getText();
            const now = Date.now();
            // Антидребезг 1.6 сек для одного и того же QR
            if (lastDecodedRef.current.code === text && now - lastDecodedRef.current.ts < 1600) {
              return;
            }
            lastDecodedRef.current = { code: text, ts: now };
            applyQrScanResult(text);
          }
        );

        if (cancelled) {
          controls.stop();
        } else {
          controlsRef.current = controls;
          // Проверка поддержки фонарика на мобильном устройстве
          setTimeout(() => {
            try {
              const stream = videoEl.srcObject as MediaStream | null;
              const track = stream?.getVideoTracks()?.[0];
              const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
              if (caps?.torch) setTorchSupported(true);
            } catch {
              // torch unsupported
            }
          }, 350);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setCameraError(
            'Не удалось включить камеру. Разрешите доступ к камере в браузере, либо используйте кнопку «С фото» или USB/Bluetooth-сканер.'
          );
        }
      }
    };

    const timer = setTimeout(startCamera, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (controlsRef.current) {
        try {
          controlsRef.current.stop();
        } catch {
          // ignore
        }
        controlsRef.current = null;
      }
      const vid = videoRef.current;
      if (vid && vid.srcObject) {
        const stream = vid.srcObject as MediaStream;
        stream.getTracks().forEach(t => t.stop());
        vid.srcObject = null;
      }
    };
  }, [isCameraOpen, selectedDeviceId, applyQrScanResult]);

  const handleToggleTorch = async () => {
    try {
      const vid = videoRef.current;
      const stream = vid?.srcObject as MediaStream | null;
      const track = stream?.getVideoTracks()?.[0];
      if (!track) return;
      const next = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet]
      });
      setTorchOn(next);
    } catch {
      onNotice('Подсветка недоступна на данной камере.');
    }
  };

  const handleQrImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const reader = new BrowserQRCodeReader();
      const result = await reader.decodeFromImageUrl(url);
      applyQrScanResult(result.getText());
    } catch {
      playScanBeep(false);
      const msg = 'QR-код на фото не распознан. Попробуйте более чёткий снимок.';
      setLastScannedBanner({ ok: false, text: msg });
      onNotice(msg);
    } finally {
      URL.revokeObjectURL(url);
      e.target.value = '';
    }
  };

  const handleToggleBagSelection = (row: PackingListRow) => {
    const nextSelected = !row.selectedForShipment;
    const shipNum = activeShipmentNo.trim() || defaultShipmentNo || '1';
    const maxIndex = rows.reduce((max, r) => {
      const idx = typeof r.shippedScanIndex === 'number' ? r.shippedScanIndex : 0;
      return idx > max ? idx : max;
    }, 0);
    const assignedIndex = nextSelected ? row.shippedScanIndex || maxIndex + 1 : undefined;
    const nowTime = new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    onChangeRows(
      rows.map(r => {
        if (r.bagUid !== row.bagUid) return r;
        return {
          ...r,
          selectedForShipment: nextSelected,
          shippedScanIndex: assignedIndex,
          scannedAt: nextSelected ? r.scannedAt || nowTime : undefined,
          shipmentNo: nextSelected
            ? syncIndexToShipmentNo && assignedIndex
              ? String(assignedIndex)
              : r.shipmentNo || shipNum
            : r.shipmentNo
        };
      })
    );
  };

  const handleRowIndexChange = (bagUid: string, val: string) => {
    const trimmed = val.trim();
    const parsed = trimmed === '' ? undefined : Math.max(1, parseInt(trimmed, 10) || 1);
    onChangeRows(
      rows.map(r => {
        if (r.bagUid !== bagUid) return r;
        return {
          ...r,
          shippedScanIndex: parsed,
          shipmentNo: syncIndexToShipmentNo && parsed ? String(parsed) : r.shipmentNo
        };
      })
    );
  };

  const handleRowWeightChange = (rowId: string, val: string) => {
    const parsed = val === '' ? '' : Math.max(0, parseFloat(val.replace(',', '.')) || 0);
    onChangeRows(
      rows.map(r => (r.id === rowId ? { ...r, weightKg: parsed } : r))
    );
  };

  const handleRowShipmentNoChange = (bagUid: string, val: string) => {
    onChangeRows(
      rows.map(r => (r.bagUid === bagUid ? { ...r, shipmentNo: val } : r))
    );
  };

  const handleReindexSequentially = () => {
    const selectedBagsInOrder: string[] = [];
    const selectedRowsSorted = [...rows]
      .filter(r => r.selectedForShipment)
      .sort((a, b) => (a.shippedScanIndex || 999999) - (b.shippedScanIndex || 999999));

    selectedRowsSorted.forEach(r => {
      if (!selectedBagsInOrder.includes(r.bagUid)) {
        selectedBagsInOrder.push(r.bagUid);
      }
    });

    if (selectedBagsInOrder.length === 0) {
      onNotice('Нет отгруженных тар для пересчёта индексов.');
      return;
    }

    const bagToIndex = new Map<string, number>();
    selectedBagsInOrder.forEach((bUid, i) => bagToIndex.set(bUid, i + 1));

    onChangeRows(
      rows.map(r => {
        if (!r.selectedForShipment) return r;
        const newIdx = bagToIndex.get(r.bagUid);
        return {
          ...r,
          shippedScanIndex: newIdx,
          shipmentNo: syncIndexToShipmentNo && newIdx ? String(newIdx) : r.shipmentNo
        };
      })
    );
    onNotice(`Индексы отгрузки пересчитаны последовательно (1–${selectedBagsInOrder.length}).`);
  };

  const handleResetShipmentSelections = () => {
    onChangeRows(
      rows.map(r => ({
        ...r,
        selectedForShipment: false,
        shippedScanIndex: undefined,
        scannedAt: undefined
      }))
    );
    setRecentScans([]);
    setLastScannedBanner(null);
    onNotice('Отметки отгрузки и индексы сканирования очищены.');
  };

  const handleSelectAllToggle = () => {
    const allSelected = filteredRows.length > 0 && filteredRows.every(r => r.selectedForShipment);
    const shipNum = activeShipmentNo.trim() || defaultShipmentNo || '1';
    const visibleBagIds = new Set(filteredRows.map(r => r.bagUid));

    let nextIdx = rows.reduce((max, r) => {
      const idx = typeof r.shippedScanIndex === 'number' ? r.shippedScanIndex : 0;
      return idx > max ? idx : max;
    }, 0);
    const assignedForVisibleBag = new Map<string, number>();

    if (!allSelected) {
      filteredRows.forEach(r => {
        if (!r.selectedForShipment && !assignedForVisibleBag.has(r.bagUid)) {
          if (r.shippedScanIndex) {
            assignedForVisibleBag.set(r.bagUid, r.shippedScanIndex);
          } else {
            nextIdx += 1;
            assignedForVisibleBag.set(r.bagUid, nextIdx);
          }
        }
      });
    }

    onChangeRows(
      rows.map(r => {
        if (!visibleBagIds.has(r.bagUid)) return r;
        const nextState = !allSelected;
        const idxVal = nextState ? (r.shippedScanIndex || assignedForVisibleBag.get(r.bagUid)) : undefined;
        return {
          ...r,
          selectedForShipment: nextState,
          shippedScanIndex: idxVal,
          shipmentNo: nextState
            ? syncIndexToShipmentNo && idxVal
              ? String(idxVal)
              : r.shipmentNo || shipNum
            : r.shipmentNo
        };
      })
    );
  };

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = rows.filter(r => {
      if (statusFilter === 'shipped' && !r.selectedForShipment) return false;
      if (statusFilter === 'pending' && r.selectedForShipment) return false;
      if (!q) return true;
      return (
        r.taraNo.toLowerCase().includes(q) ||
        r.orderNo.toLowerCase().includes(q) ||
        r.model.toLowerCase().includes(q) ||
        r.color.toLowerCase().includes(q) ||
        r.shipmentNo.toLowerCase().includes(q) ||
        r.qrCode.toLowerCase().includes(q) ||
        String(r.shippedScanIndex || '').includes(q)
      );
    });

    if (sortByScanIndex) {
      list = [...list].sort((a, b) => {
        const aIdx = a.selectedForShipment ? (a.shippedScanIndex || 999998) : 999999;
        const bIdx = b.selectedForShipment ? (b.shippedScanIndex || 999998) : 999999;
        return aIdx - bIdx;
      });
    }
    return list;
  }, [rows, searchQuery, statusFilter, sortByScanIndex]);

  const selectedRows = useMemo(
    () => rows.filter(r => r.selectedForShipment),
    [rows]
  );

  const statusCounts = useMemo(() => {
    const shippedBags = new Set(rows.filter(r => r.selectedForShipment).map(r => r.bagUid)).size;
    const totalBags = new Set(rows.map(r => r.bagUid)).size;
    return {
      totalRows: rows.length,
      shippedRows: selectedRows.length,
      pendingRows: rows.length - selectedRows.length,
      shippedBags,
      totalBags
    };
  }, [rows, selectedRows]);

  const selectedStats = useMemo(() => {
    const bagSet = new Set(selectedRows.map(r => r.bagUid));
    const qtySum = selectedRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const kgSum = selectedRows.reduce((s, r) => s + (Number(r.weightKg) || 0), 0);
    return {
      rowsCount: selectedRows.length,
      bagsCount: bagSet.size,
      qtySum,
      kgSum
    };
  }, [selectedRows]);

  // Первые строки каждой тары, чтобы вес для общего мешка вводить один раз
  const firstRowIdByBag = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach(r => {
      if (!map.has(r.bagUid)) map.set(r.bagUid, r.id);
    });
    return map;
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Панель QR-сканирования (Телефон / USB / Bluetooth 2D-сканер) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <QrCode className="w-4 h-4 text-sky-400" />
              <span>Сканер QR-кодов тары для отгрузки</span>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold">
              <ScanLine className="w-3 h-3" />
              <span>USB/Bluetooth автоприём активен</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => (isCameraOpen ? stopCamera() : setIsCameraOpen(true))}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                isCameraOpen
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : 'bg-sky-500 hover:bg-sky-400 text-slate-950'
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>{isCameraOpen ? 'Остановить камеру' : 'Сканировать камерой (Телефон)'}</span>
            </button>

            <input
              ref={qrImageInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleQrImageUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => qrImageInputRef.current?.click()}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
              <span>С фото</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-3">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Номер отгрузки (для накладной)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={activeShipmentNo}
                onChange={e => setActiveShipmentNo(e.target.value)}
                placeholder="1"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-amber-300 font-mono font-black text-sm focus:outline-none focus:border-sky-500"
              />
              <label
                className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer whitespace-nowrap shrink-0 select-none"
                title="Если включено, поле «Номер отгрузки» в таблице также заполняется порядковым индексом сканирования"
              >
                <input
                  type="checkbox"
                  checked={syncIndexToShipmentNo}
                  onChange={e => setSyncIndexToShipmentNo(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-950 text-sky-500"
                />
                <span>= Индекс</span>
              </label>
            </div>
          </div>

          <div className="lg:col-span-7">
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Поле USB / Bluetooth QR-сканера (либо введите QR-код / № тары и нажмите Enter)
            </label>
            <input
              ref={scannerInputRef}
              type="text"
              value={scannerInput}
              onChange={e => setScannerInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (scannerInput.trim()) {
                    applyQrScanResult(scannerInput);
                    setScannerInput('');
                  }
                }
              }}
              placeholder="Наведите 2D-сканер на QR-код мешка (CHUST|CT-10001-...|1|MOS-545.4)..."
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-sky-500/60 text-white text-xs font-mono focus:outline-none focus:border-sky-400"
            />
          </div>

          <div className="lg:col-span-2">
            <button
              type="button"
              onClick={() => {
                if (scannerInput.trim()) {
                  applyQrScanResult(scannerInput);
                  setScannerInput('');
                }
                scannerInputRef.current?.focus();
              }}
              className="w-full px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer"
            >
              Принять скан
            </button>
          </div>
        </div>

        {lastScannedBanner && (
          <div
            className={`px-3 py-2 rounded-lg text-xs font-semibold border flex items-center gap-2 ${
              lastScannedBanner.ok
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/60 border-rose-500/40 text-rose-200'
            }`}
          >
            {lastScannedBanner.ok && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            <span>{lastScannedBanner.text}</span>
          </div>
        )}

        {/* Лента последних отсканированных мешков */}
        {recentScans.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[11px] font-semibold text-slate-400 mr-1">
              Порядок сканирования:
            </span>
            {recentScans.map(item => (
              <span
                key={item.id}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-950 border border-slate-700 text-[11px] font-mono text-slate-200"
              >
                <strong className="text-sky-400">#{item.index}</strong>
                <span>Тара №{item.taraNo}</span>
                <span className="text-slate-400">({item.orderNo})</span>
                <span className="text-slate-500">{item.time}</span>
              </span>
            ))}
          </div>
        )}

        {/* Живое окно камеры телефона / веб-камеры */}
        {isCameraOpen && (
          <div className="mt-2 bg-slate-950 border border-slate-700 rounded-xl p-3 flex flex-col items-center gap-2.5 relative">
            <div className="w-full flex flex-wrap items-center justify-between gap-2 pr-8">
              <div className="text-xs font-bold text-sky-300">
                Наведите камеру на QR-код — тара автоматически отметится «Отгружено» и получит порядковый Индекс
              </div>

              <div className="flex items-center gap-2">
                {videoDevices.length > 1 && (
                  <select
                    value={selectedDeviceId}
                    onChange={e => setSelectedDeviceId(e.target.value)}
                    className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
                  >
                    {videoDevices.map((dev, idx) => (
                      <option key={dev.deviceId} value={dev.deviceId}>
                        {dev.label || `Камера ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                )}

                {torchSupported && (
                  <button
                    type="button"
                    onClick={handleToggleTorch}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1 border cursor-pointer ${
                      torchOn
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-800 text-slate-200 border-slate-700'
                    }`}
                  >
                    <Flashlight className="w-3.5 h-3.5" />
                    <span>Подсветка</span>
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={stopCamera}
              className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              title="Закрыть камеру"
            >
              <X className="w-4 h-4" />
            </button>

            {cameraError ? (
              <div className="text-xs text-rose-400 py-4 text-center max-w-md">{cameraError}</div>
            ) : (
              <div className="relative w-full max-w-sm">
                <video
                  ref={videoRef}
                  className="w-full rounded-lg border border-slate-700 bg-black aspect-video object-cover"
                  muted
                  playsInline
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-40 h-40 border-2 border-sky-400/80 rounded-xl shadow-[0_0_0_9999px_rgba(2,6,23,0.28)]" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Панель фильтров, индексов и формирования накладной */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Фильтр: заказ / № тары / индекс..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1.5 rounded-md cursor-pointer ${
                statusFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Все ({statusCounts.totalRows})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('shipped')}
              className={`px-2.5 py-1.5 rounded-md cursor-pointer ${
                statusFilter === 'shipped' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Отгружено ({statusCounts.shippedRows})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('pending')}
              className={`px-2.5 py-1.5 rounded-md cursor-pointer ${
                statusFilter === 'pending' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Ожидает ({statusCounts.pendingRows})
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSortByScanIndex(prev => !prev)}
            className={`px-2.5 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              sortByScanIndex
                ? 'bg-sky-500/20 border-sky-500/60 text-sky-300'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
            }`}
            title="Сортировать таблицу по возрастанию индекса сканирования"
          >
            <ArrowDownUp className="w-3.5 h-3.5" />
            <span>По индексу</span>
          </button>

          <button
            type="button"
            onClick={handleReindexSequentially}
            disabled={selectedRows.length === 0}
            className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            title="Выровнять индексы отгруженных тар без пропусков (1, 2, 3...)"
          >
            <Hash className="w-3.5 h-3.5 text-sky-400" />
            <span>1..N</span>
          </button>

          <button
            type="button"
            onClick={handleSelectAllToggle}
            disabled={filteredRows.length === 0}
            className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          >
            Выбрать / Снять все
          </button>

          {selectedRows.length > 0 && (
            <button
              type="button"
              onClick={handleResetShipmentSelections}
              className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/70 text-slate-300 hover:text-rose-200 border border-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              title="Сбросить все отметки отгрузки и индексы"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Сброс</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs font-mono text-slate-300 tabular-nums">
            Отгружено: <strong className="text-white">{selectedStats.bagsCount}</strong> тар ·{' '}
            <strong className="text-sky-300">{selectedStats.qtySum.toLocaleString()}</strong> шт ·{' '}
            <strong className="text-amber-300">{selectedStats.kgSum.toFixed(1)}</strong> кг
          </div>

          <button
            type="button"
            onClick={() => onCreateWaybillFromSelected(selectedRows, activeShipmentNo)}
            disabled={selectedRows.length === 0}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="w-4 h-4" />
            <span>Сформировать накладную ({selectedStats.rowsCount})</span>
          </button>
        </div>
      </div>

      {/* Таблица «Выбрано к отгрузке» (Рис. 3 + авто-индекс сканирования) */}
      <div className="bg-white text-slate-950 rounded-xl border border-slate-300 overflow-hidden shadow-sm">
        <div className="text-center py-2 border-b border-slate-300 bg-white">
          <h3 className="text-base font-black text-red-600 tracking-wide">Выбрано к отгрузке</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#4472C4] text-white font-bold">
                <th className="px-2 py-2 border border-slate-300 text-center w-14">№ тары</th>
                <th className="px-2 py-2 border border-slate-300 text-center w-20">Индекс</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[110px]">Заказ</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[175px]">Модель</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[175px]">Наименование</th>
                <th className="px-2.5 py-2 border border-slate-300 text-left min-w-[100px]">Цвет</th>
                <th className="px-2.5 py-2 border border-slate-300 text-right w-20">Кол-во</th>
                <th className="px-2.5 py-2 border border-slate-300 text-center w-24">кг</th>
                <th className="px-2.5 py-2 border border-slate-300 text-center w-32">Статус</th>
                <th className="px-2.5 py-2 border border-slate-300 text-center w-28">Номер отгрузки</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500 text-xs">
                    {rows.length === 0
                      ? 'Нет позиций для отгрузки. Сначала добавьте тары во вкладке «Упаковочный лист».'
                      : 'По текущему фильтру позиции не найдены.'}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => {
                  const isFirstOfBag = firstRowIdByBag.get(row.bagUid) === row.id;
                  return (
                    <tr
                      key={row.id}
                      className={
                        row.selectedForShipment
                          ? 'bg-emerald-50 hover:bg-emerald-100/70'
                          : idx % 2 === 0
                          ? 'bg-[#D9E1F2]/60 hover:bg-sky-50'
                          : 'bg-white hover:bg-sky-50'
                      }
                    >
                      <td className="px-2 py-1.5 border border-slate-300 text-center font-mono font-bold">
                        {row.taraNo}
                      </td>
                      <td className="px-1.5 py-1 border border-slate-300 text-center">
                        <input
                          type="number"
                          min="1"
                          value={row.shippedScanIndex ?? ''}
                          onChange={e => handleRowIndexChange(row.bagUid, e.target.value)}
                          placeholder="—"
                          className={`w-16 text-center font-mono font-black border rounded px-1 py-1 text-xs ${
                            row.shippedScanIndex
                              ? 'bg-sky-100 border-sky-400 text-sky-900'
                              : 'bg-white/90 border-slate-300 text-slate-500'
                          }`}
                          title={row.scannedAt ? `Отсканировано в ${row.scannedAt}` : 'Порядковый индекс отгрузки'}
                        />
                      </td>
                      <td className="px-2.5 py-1.5 border border-slate-300 font-semibold">{row.orderNo}</td>
                      <td className="px-2.5 py-1.5 border border-slate-300">{row.model}</td>
                      <td className="px-2.5 py-1.5 border border-slate-300">{row.productName}</td>
                      <td className="px-2.5 py-1.5 border border-slate-300">{row.color}</td>
                      <td className="px-2.5 py-1.5 border border-slate-300 text-right font-mono font-bold">
                        {row.qty}
                      </td>
                      <td className="px-1.5 py-1 border border-slate-300 text-center">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={row.weightKg}
                          onChange={e => handleRowWeightChange(row.id, e.target.value)}
                          placeholder={isFirstOfBag ? '0.0' : 'в таре'}
                          className="w-20 text-center font-mono font-semibold bg-white/90 border border-slate-300 focus:border-sky-500 rounded px-1.5 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5 border border-slate-300 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleBagSelection(row)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer text-xs font-bold ${
                            row.selectedForShipment
                              ? 'bg-emerald-600/15 text-emerald-800 hover:bg-emerald-600/25'
                              : 'text-slate-600 hover:bg-slate-200/70'
                          }`}
                        >
                          {row.selectedForShipment ? (
                            <CheckSquare className="w-4 h-4 text-emerald-700" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500" />
                          )}
                          <span>{row.selectedForShipment ? 'Отгружено' : 'Ожидает'}</span>
                        </button>
                      </td>
                      <td className="px-1.5 py-1 border border-slate-300 text-center">
                        <input
                          type="text"
                          value={row.shipmentNo}
                          onChange={e => handleRowShipmentNoChange(row.bagUid, e.target.value)}
                          placeholder="—"
                          className="w-24 text-center font-mono font-bold bg-white/90 border border-slate-300 focus:border-sky-500 rounded px-1.5 py-1 text-xs"
                        />
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

export default ShipmentQrTab;
