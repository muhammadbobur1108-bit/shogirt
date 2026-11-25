import React, { useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { escapeHtml, printHtmlViaIframe } from '../lib/printBridge';
import {
  Printer,
  X,
  FileText,
  Layers,
  CheckCircle2,
  Image as ImageIcon,
  PenLine,
  SlidersHorizontal
} from 'lucide-react';
import {
  FactoryLedgerRow,
  OrderSizeMatrix,
  DEFAULT_MONTHS,
  getEffectiveDisplaySizes
} from '../lib/ordersSizeStore';

export type PrintFormatMode = 'a4_landscape' | 'a4_portrait' | 'thermal_80' | 'thermal_58';
export type PrintScopeMode = 'single_variant' | 'all_variants';

interface OrderPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeRow: FactoryLedgerRow;
  activeMatrix: OrderSizeMatrix;
  orderVariants: FactoryLedgerRow[];
  sizeMatrices: Record<string, OrderSizeMatrix>;
  modelImages: Record<string, string>;
  registerCyrillicFonts: (doc: jsPDF) => Promise<string>;
  onNotice?: (msg: string) => void;
}

interface VariantPrintData {
  row: FactoryLedgerRow;
  matrix: OrderSizeMatrix;
  sizes: string[];
  totals: {
    order: number;
    cut: number;
    cutPct: number;
    dist: number;
    sew: number;
    pack: number;
    defect: number;
    totalPack: number;
    remOrder: number;
    remDist: number;
    diffDistPct: number;
    closePct: number;
    shipped: number;
    stock: number;
  };
}

function formatPct(num: number, den: number): string {
  if (!den || den <= 0) return '';
  return `${((num / den) * 100).toFixed(1).replace('.', ',')}%`;
}

function computeVariantData(
  row: FactoryLedgerRow,
  mat: OrderSizeMatrix | undefined,
  hideZeroSizes: boolean
): VariantPrintData {
  const safeMatrix: OrderSizeMatrix = mat || {
    rowId: row.id,
    presetId: 'custom',
    sizes: [],
    values: {},
    defect: row.qtyDefect || 0
  };

  const sizes = hideZeroSizes
    ? getEffectiveDisplaySizes(safeMatrix)
    : safeMatrix.sizes.length > 0
    ? [...safeMatrix.sizes]
    : getEffectiveDisplaySizes(safeMatrix);

  let order = 0;
  let cut = 0;
  let dist = 0;
  let sew = 0;
  let pack = 0;

  safeMatrix.sizes.forEach(sz => {
    const c = safeMatrix.values[sz];
    if (!c) return;
    order += Number(c.order) || 0;
    cut += Number(c.cut) || 0;
    dist += Number(c.dist) || 0;
    sew += Number(c.sew) || 0;
    pack += Number(c.pack) || 0;
  });

  if (safeMatrix.sizes.length === 0) {
    order = row.qtyOrder || 0;
    cut = row.qtyCut || 0;
    dist = row.qtyDistribution || 0;
    sew = row.qtySewing || 0;
    pack = row.qtyPackaging || 0;
  }

  const defect = Number(safeMatrix.defect ?? row.qtyDefect) || 0;
  const totalPack = pack + defect;
  const remOrder = order - pack;
  const remDist = dist - pack;
  const cutPct = order > 0 ? (cut / order) * 100 : 0;
  const diffDistPct = dist > 0 ? (remDist / dist) * 100 : 0;
  const closePct = dist > 0 ? (totalPack / dist) * 100 : order > 0 ? (pack / order) * 100 : 0;
  const shipped = Number(row.qtyShipped) || 0;
  const stock = Math.max(0, pack - shipped);

  return {
    row,
    matrix: safeMatrix,
    sizes,
    totals: {
      order,
      cut,
      cutPct,
      dist,
      sew,
      pack,
      defect,
      totalPack,
      remOrder,
      remDist,
      diffDistPct,
      closePct,
      shipped,
      stock
    }
  };
}

function chunkArray(arr: string[], chunkSize: number): string[][] {
  if (arr.length === 0) return [[]];
  const res: string[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    res.push(arr.slice(i, i + chunkSize));
  }
  return res;
}

export const OrderPrintModal: React.FC<OrderPrintModalProps> = ({
  isOpen,
  onClose,
  activeRow,
  activeMatrix,
  orderVariants,
  sizeMatrices,
  modelImages,
  registerCyrillicFonts,
  onNotice
}) => {
  const [format, setFormat] = useState<PrintFormatMode>('a4_landscape');
  const [scope, setScope] = useState<PrintScopeMode>('single_variant');
  const [hideZeroSizes, setHideZeroSizes] = useState<boolean>(true);
  const [includeAllStages, setIncludeAllStages] = useState<boolean>(true);
  const [includeImage, setIncludeImage] = useState<boolean>(true);
  const [includeSignatures, setIncludeSignatures] = useState<boolean>(true);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  const targetRows = useMemo(() => {
    if (scope === 'all_variants' && orderVariants.length > 1) {
      return orderVariants;
    }
    return [activeRow];
  }, [scope, orderVariants, activeRow]);

  const variantsData = useMemo(
    () =>
      targetRows.map(r =>
        computeVariantData(r, r.id === activeRow.id ? activeMatrix : sizeMatrices[r.id], hideZeroSizes)
      ),
    [targetRows, activeRow.id, activeMatrix, sizeMatrices, hideZeroSizes]
  );

  const grandTotals = useMemo(() => {
    const sum = {
      order: 0,
      cut: 0,
      dist: 0,
      sew: 0,
      pack: 0,
      defect: 0,
      totalPack: 0,
      remOrder: 0,
      remDist: 0,
      shipped: 0,
      stock: 0
    };
    variantsData.forEach(v => {
      sum.order += v.totals.order;
      sum.cut += v.totals.cut;
      sum.dist += v.totals.dist;
      sum.sew += v.totals.sew;
      sum.pack += v.totals.pack;
      sum.defect += v.totals.defect;
      sum.totalPack += v.totals.totalPack;
      sum.remOrder += v.totals.remOrder;
      sum.remDist += v.totals.remDist;
      sum.shipped += v.totals.shipped;
      sum.stock += v.totals.stock;
    });
    return {
      ...sum,
      cutPct: sum.order > 0 ? (sum.cut / sum.order) * 100 : 0,
      diffDistPct: sum.dist > 0 ? (sum.remDist / sum.dist) * 100 : 0,
      closePct: sum.dist > 0 ? (sum.totalPack / sum.dist) * 100 : sum.order > 0 ? (sum.pack / sum.order) * 100 : 0
    };
  }, [variantsData]);

  const activePhotoSrc = modelImages[activeRow.id] || modelImages[activeRow.model] || '';
  const printedTimestamp = useMemo(
    () =>
      new Date().toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
    [isOpen]
  );

  if (!isOpen) return null;

  const isThermal = format === 'thermal_80' || format === 'thermal_58';

  const buildThermalPrintHtml = (): string => {
    const is58 = format === 'thermal_58';
    const wrapClass = is58 ? 'th-wrap th-58' : 'th-wrap th-80';
    const metaRows: string[] = [];
    if ((activeRow.brand || '').trim()) {
      metaRows.push(`<div class="kv"><span>Бренд:</span><strong>${escapeHtml(activeRow.brand)}</strong></div>`);
    }
    if ((activeRow.month || '').trim()) {
      metaRows.push(`<div class="kv"><span>Месяц:</span><strong>${escapeHtml(activeRow.month)}</strong></div>`);
    }

    const blocksHtml = variantsData.map(v => {
      const sizeRowsHtml = v.sizes.length > 0
        ? v.sizes.map(sz => {
            const c = v.matrix.values[sz] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
            const rem = c.order - c.pack;
            return `<tr>
              <td class="ta-l bold">${escapeHtml(sz)}</td>
              <td>${c.order || '-'}</td>
              <td>${c.cut || '-'}</td>
              ${!is58 && includeAllStages ? `<td>${c.dist || '-'}</td><td>${c.sew || '-'}</td>` : ''}
              <td class="bold">${c.pack || '-'}</td>
              <td>${c.order || c.pack ? rem : '-'}</td>
            </tr>`;
          }).join('')
        : `<tr><td colspan="${is58 || !includeAllStages ? 5 : 7}">Без разбивки по размерам</td></tr>`;

      const statParts: string[] = [
        `<div class="kv"><span>Крой %:</span><strong>${v.totals.cutPct.toFixed(1)}%</strong></div>`,
        ...(v.totals.defect > 0 || v.totals.shipped > 0
          ? [`<div class="kv"><span>${v.totals.defect > 0 && v.totals.shipped > 0 ? 'Брак / Отгр:' : v.totals.defect > 0 ? 'Брак:' : 'Отгр:'}</span><strong>${v.totals.defect > 0 && v.totals.shipped > 0 ? `${v.totals.defect} / ${v.totals.shipped} шт` : `${v.totals.defect > 0 ? v.totals.defect : v.totals.shipped} шт`}</strong></div>`]
          : []),
        `<div class="kv"><span>Разд−Упак:</span><strong>${v.totals.remDist} (${v.totals.diffDistPct.toFixed(1)}%)</strong></div>`,
        `<div class="kv"><span>Закрытие %:</span><strong>${v.totals.closePct.toFixed(1)}%</strong></div>`
      ];

      return `<div class="th-block">
        <div class="meta-block">
          <div class="kv"><span>Цвет:</span><strong>${escapeHtml(v.row.color)}${v.row.colorCode ? ` (${escapeHtml(v.row.colorCode)})` : ''}</strong></div>
          ${v.row.rost ? `<div class="kv"><span>Рост:</span><strong>${escapeHtml(v.row.rost)}</strong></div>` : ''}
          <div class="kv"><span>Модель:</span><strong>${escapeHtml(v.row.model)}</strong></div>
        </div>
        <table class="th-tbl">
          <thead>
            <tr>
              <th class="ta-l">Разм</th>
              <th>Зак</th>
              <th>Кр</th>
              ${!is58 && includeAllStages ? '<th>Разд</th><th>Пош</th>' : ''}
              <th>Упк</th>
              <th>Ост</th>
            </tr>
          </thead>
          <tbody>
            ${sizeRowsHtml}
            <tr class="tot-row">
              <td class="ta-l">ИТОГО</td>
              <td>${v.totals.order}</td>
              <td>${v.totals.cut}</td>
              ${!is58 && includeAllStages ? `<td>${v.totals.dist}</td><td>${v.totals.sew}</td>` : ''}
              <td>${v.totals.pack}</td>
              <td>${v.totals.remOrder}</td>
            </tr>
          </tbody>
        </table>
        <div class="th-stats">${statParts.join('')}</div>
        ${v.row.notes?.trim() ? `<div class="notes">Прим: ${escapeHtml(v.row.notes)}</div>` : ''}
      </div>`;
    }).join('');

    const grandHtml = variantsData.length > 1
      ? `<div class="th-grand">
          <div class="bold">ОБЩИЙ ИТОГ (${variantsData.length} поз.):</div>
          <div class="kv"><span>Заказ:</span><strong>${grandTotals.order} шт</strong></div>
          <div class="kv"><span>Крой (${grandTotals.cutPct.toFixed(1)}%):</span><strong>${grandTotals.cut} шт</strong></div>
          <div class="kv"><span>Упаковка:</span><strong>${grandTotals.pack} шт</strong></div>
          ${grandTotals.shipped > 0 ? `<div class="kv"><span>Отгружено:</span><strong>${grandTotals.shipped} шт</strong></div>` : ''}
        </div>`
      : '';

    const sigHtml = includeSignatures
      ? `<div class="th-sigs">
          <div class="kv"><span>Выдал/Мастер:</span><span>__________</span></div>
          <div class="kv"><span>Принял/ОТК:</span><span>__________</span></div>
        </div>`
      : '';

    return `<div class="${wrapClass}">
      <div class="th-head">
        <div class="th-brand">CHUST TEXTILE</div>
        <div class="th-title">НАРЯД-ЗАКАЗ № ${escapeHtml(activeRow.orderNo)}</div>
        <div class="th-time">${escapeHtml(printedTimestamp)}</div>
      </div>
      ${metaRows.length > 0 ? `<div class="meta-block dashed-b">${metaRows.join('')}</div>` : ''}
      ${blocksHtml}
      ${grandHtml}
      ${sigHtml}
    </div>`;
  };

  const buildA4PrintHtml = (): string => {
    const maxCols = format === 'a4_portrait' ? 10 : 18;
    const headerMetaParts: string[] = [];
    if ((activeRow.brand || '').trim()) headerMetaParts.push(`Бренд: ${escapeHtml(activeRow.brand)}`);
    if ((activeRow.model || '').trim()) headerMetaParts.push(`Модель: ${escapeHtml(activeRow.model)}`);
    if ((activeRow.month || '').trim()) headerMetaParts.push(`Месяц: ${escapeHtml(activeRow.month)}`);
    headerMetaParts.push(`Позиций: ${variantsData.length}`);

    const imgHtml = includeImage && activePhotoSrc
      ? `<img src="${activePhotoSrc}" alt="Эскиз" class="sketch-img" />`
      : '';

    const variantsHtml = variantsData.map((v, vIdx) => {
      const sizeChunks = chunkArray(v.sizes, maxCols);
      const matricesHtml = sizeChunks.map((szChunk, chIdx) => {
        const showTotal = chIdx === sizeChunks.length - 1;
        return `<table class="mtx-tbl">
          <thead>
            <tr>
              <th class="ta-l col-stage">Этап</th>
              ${szChunk.map(sz => `<th>${escapeHtml(sz)}</th>`).join('')}
              ${showTotal ? '<th class="col-tot">ВСЕГО</th>' : ''}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="ta-l stage-lbl">Заказ</td>
              ${szChunk.map(sz => `<td>${v.matrix.values[sz]?.order || ''}</td>`).join('')}
              ${showTotal ? `<td class="tot-cell">${v.totals.order}</td>` : ''}
            </tr>
            <tr>
              <td class="ta-l stage-lbl">Крой</td>
              ${szChunk.map(sz => `<td>${v.matrix.values[sz]?.cut || ''}</td>`).join('')}
              ${showTotal ? `<td class="tot-cell">${v.totals.cut}</td>` : ''}
            </tr>
            ${includeAllStages ? `
            <tr class="row-sky">
              <td class="ta-l stage-lbl">Крой %</td>
              ${szChunk.map(sz => {
                const cell = v.matrix.values[sz];
                return `<td>${cell ? escapeHtml(formatPct(cell.cut, cell.order)) : ''}</td>`;
              }).join('')}
              ${showTotal ? `<td class="tot-cell">${v.totals.cutPct.toFixed(1).replace('.', ',')}%</td>` : ''}
            </tr>
            <tr>
              <td class="ta-l stage-lbl">Раздача</td>
              ${szChunk.map(sz => `<td>${v.matrix.values[sz]?.dist || ''}</td>`).join('')}
              ${showTotal ? `<td class="tot-cell">${v.totals.dist}</td>` : ''}
            </tr>
            <tr>
              <td class="ta-l stage-lbl">Пошив</td>
              ${szChunk.map(sz => `<td>${v.matrix.values[sz]?.sew || ''}</td>`).join('')}
              ${showTotal ? `<td class="tot-cell">${v.totals.sew}</td>` : ''}
            </tr>` : ''}
            <tr class="row-pack">
              <td class="ta-l stage-lbl">Упаковка</td>
              ${szChunk.map(sz => `<td>${v.matrix.values[sz]?.pack || ''}</td>`).join('')}
              ${showTotal ? `<td>${v.totals.pack}</td>` : ''}
            </tr>
            <tr>
              <td class="ta-l stage-lbl">Остаток</td>
              ${szChunk.map(sz => {
                const c = v.matrix.values[sz];
                return `<td>${c && (c.order > 0 || c.pack > 0) ? c.order - c.pack : ''}</td>`;
              }).join('')}
              ${showTotal ? `<td class="tot-cell">${v.totals.remOrder}</td>` : ''}
            </tr>
            <tr class="row-close">
              <td class="ta-l stage-lbl">Закр. %</td>
              ${szChunk.map(sz => {
                const c = v.matrix.values[sz];
                return `<td>${c ? escapeHtml(formatPct(c.pack, c.order)) : ''}</td>`;
              }).join('')}
              ${showTotal ? `<td>${v.totals.closePct.toFixed(1).replace('.', ',')}%</td>` : ''}
            </tr>
          </tbody>
        </table>`;
      }).join('');

      const sumCols: { label: string; value: string }[] = [
        { label: 'Заказ', value: String(v.totals.order) },
        { label: 'Крой', value: String(v.totals.cut) },
        { label: 'Крой %', value: `${v.totals.cutPct.toFixed(1)}%` },
        { label: 'Раздача', value: String(v.totals.dist) },
        { label: 'Пошив', value: String(v.totals.sew) },
        { label: 'Упаковка', value: String(v.totals.pack) },
        ...(v.totals.defect > 0 ? [{ label: 'Брак', value: String(v.totals.defect) }] : []),
        { label: 'Разд−Упак', value: `${v.totals.remDist} (${v.totals.diffDistPct.toFixed(1)}%)` },
        ...(v.totals.shipped > 0 ? [{ label: 'Отгрузка', value: String(v.totals.shipped) }] : []),
        ...(v.totals.stock > 0 ? [{ label: 'Склад', value: String(v.totals.stock) }] : [])
      ];

      return `<div class="var-card">
        <div class="var-head">
          <div>
            <strong>${vIdx + 1}. ${escapeHtml(v.row.model)}</strong>
            <span class="badge">Цвет: ${escapeHtml(v.row.color)}${v.row.colorCode ? ` (${escapeHtml(v.row.colorCode)})` : ''}</span>
            ${v.row.rost ? `<span class="badge badge-amber">Рост: ${escapeHtml(v.row.rost)}</span>` : ''}
          </div>
          <strong class="mono">Заказ: ${v.totals.order.toLocaleString()} шт</strong>
        </div>
        ${matricesHtml}
        <table class="sum-tbl">
          <thead><tr>${sumCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
          <tbody><tr>${sumCols.map(c => `<td>${escapeHtml(c.value)}</td>`).join('')}</tr></tbody>
        </table>
        ${v.row.notes?.trim() ? `<div class="var-notes"><strong>Примечание:</strong> ${escapeHtml(v.row.notes)}</div>` : ''}
      </div>`;
    }).join('');

    const grandCols: { label: string; value: string }[] = [
      { label: 'Заказ', value: String(grandTotals.order) },
      { label: 'Крой', value: String(grandTotals.cut) },
      { label: 'Крой %', value: `${grandTotals.cutPct.toFixed(1)}%` },
      { label: 'Раздача', value: String(grandTotals.dist) },
      { label: 'Пошив', value: String(grandTotals.sew) },
      { label: 'Упаковка', value: String(grandTotals.pack) },
      ...(grandTotals.defect > 0 ? [{ label: 'Брак', value: String(grandTotals.defect) }] : []),
      { label: 'Разд−Упак', value: String(grandTotals.remDist) },
      ...(grandTotals.shipped > 0 ? [{ label: 'Отгрузка', value: String(grandTotals.shipped) }] : []),
      ...(grandTotals.stock > 0 ? [{ label: 'Склад', value: String(grandTotals.stock) }] : [])
    ];

    const grandHtml = variantsData.length > 1
      ? `<div class="grand-box">
          <div class="grand-title">СВОДНЫЙ ИТОГ ПО ЗАКАЗУ «${escapeHtml(activeRow.orderNo)}» (${variantsData.length} поз.)</div>
          <table class="sum-tbl">
            <thead><tr>${grandCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
            <tbody><tr>${grandCols.map(c => `<td>${escapeHtml(c.value)}</td>`).join('')}</tr></tbody>
          </table>
        </div>`
      : '';

    const sigsHtml = includeSignatures
      ? `<div class="sigs-grid">
          <div class="sig-col"><div>Технолог / Планирование:</div><div class="sig-line"></div></div>
          <div class="sig-col"><div>Начальник производства:</div><div class="sig-line"></div></div>
          <div class="sig-col"><div>ОТК / Склад упаковки:</div><div class="sig-line"></div></div>
        </div>`
      : '';

    return `<div class="a4-doc">
      <div class="doc-head">
        <div>
          <h1 class="doc-title">CHUST TEXTILE — ЗАКАЗ-НАРЯД НА ПРОИЗВОДСТВО № ${escapeHtml(activeRow.orderNo)}</h1>
          <div class="doc-sub">${headerMetaParts.join(' &nbsp;|&nbsp; ')}</div>
        </div>
        <div class="doc-right">
          ${imgHtml}
          <div class="doc-date">
            <div class="bold">Дата печати:</div>
            <div class="mono">${escapeHtml(printedTimestamp)}</div>
          </div>
        </div>
      </div>
      ${variantsHtml}
      ${grandHtml}
      ${sigsHtml}
    </div>`;
  };

  const handleNativeDevicePrint = () => {
    const extraCss = isThermal
      ? `
        .th-wrap { margin: 0 auto; color: #000; font-family: Arial, sans-serif; }
        .th-80 { width: 74mm; font-size: 10px; }
        .th-58 { width: 52mm; font-size: 8.5px; }
        .th-head { text-align: center; border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 6px; }
        .th-brand { font-weight: 900; font-size: ${format === 'thermal_80' ? '13px' : '11px'}; letter-spacing: 0.4px; }
        .th-title { font-weight: 800; font-size: ${format === 'thermal_80' ? '11.5px' : '9.5px'}; margin-top: 2px; }
        .th-time { font-size: 8.5px; margin-top: 2px; }
        .meta-block { margin-bottom: 5px; }
        .dashed-b { border-bottom: 1px dashed #000; padding-bottom: 5px; }
        .th-block { margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed #000; break-inside: avoid; }
        .kv { display: flex; justify-content: space-between; gap: 4px; margin-bottom: 2px; }
        .th-tbl { width: 100%; border-collapse: collapse; text-align: center; font-family: monospace; font-size: ${format === 'thermal_58' ? '8px' : '9px'}; margin: 4px 0; }
        .th-tbl th, .th-tbl td { border: 1px solid #000; padding: 2px 2px; }
        .th-tbl thead th, .tot-row td { background: #f1f5f9; font-weight: 900; }
        .ta-l { text-align: left; }
        .bold { font-weight: 900; }
        .notes { margin-top: 3px; font-size: 8.5px; }
        .th-grand { border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 6px; }
        .th-sigs { padding-top: 4px; }
        .th-sigs .kv { margin-bottom: 6px; }
      `
      : `
        .a4-doc { width: 100%; color: #0f172a; font-family: Arial, sans-serif; }
        .doc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
        .doc-title { margin: 0; font-size: 15px; font-weight: 900; }
        .doc-sub { font-size: 11px; font-weight: 700; color: #334155; margin-top: 3px; }
        .doc-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .sketch-img { height: 48px; width: auto; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px; }
        .doc-date { text-align: right; font-size: 10px; color: #334155; }
        .bold { font-weight: 700; }
        .mono { font-family: monospace; }
        .var-card { border: 1px solid #334155; border-radius: 5px; padding: 8px; margin-bottom: 10px; break-inside: avoid; }
        .var-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: #f1f5f9; border: 1px solid #cbd5e1; padding: 4px 8px; border-radius: 4px; font-size: 11px; margin-bottom: 6px; }
        .badge { display: inline-block; padding: 1px 6px; margin-left: 6px; background: #fff; border: 1px solid #64748b; border-radius: 3px; font-weight: 700; }
        .badge-amber { background: #fef3c7; border-color: #d97706; font-family: monospace; }
        .mtx-tbl { width: 100%; border-collapse: collapse; text-align: center; font-size: 10.5px; margin-bottom: 6px; }
        .mtx-tbl th, .mtx-tbl td { border: 1px solid #334155; padding: 3px 4px; font-family: monospace; font-weight: 600; }
        .mtx-tbl thead th { background: #f8cbad; font-family: Arial, sans-serif; font-weight: 900; }
        .col-stage { min-width: 68px; }
        .col-tot { min-width: 50px; }
        .ta-l { text-align: left; }
        .stage-lbl { font-family: Arial, sans-serif !important; font-weight: 700 !important; background: #f8fafc; }
        .tot-cell { font-weight: 900 !important; background: #f1f5f9; }
        .row-sky td { background: #f0f9ff; color: #0c4a6e; }
        .row-pack td { background: #fef08a !important; font-weight: 900 !important; }
        .row-close td { background: #d1fae5 !important; color: #881337; font-weight: 900 !important; }
        .sum-tbl { width: 100%; border-collapse: collapse; text-align: center; font-size: 10px; }
        .sum-tbl th, .sum-tbl td { border: 1px solid #475569; padding: 3px 4px; }
        .sum-tbl thead th { background: #f1f5f9; font-weight: 900; }
        .sum-tbl tbody td { font-family: monospace; font-weight: 900; }
        .var-notes { margin-top: 5px; padding-top: 4px; border-top: 1px dashed #94a3b8; font-size: 10px; color: #334155; }
        .grand-box { border: 2px solid #0f172a; border-radius: 5px; padding: 8px; background: #f8fafc; margin-top: 8px; break-inside: avoid; }
        .grand-title { font-size: 11px; font-weight: 900; margin-bottom: 5px; }
        .sigs-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 14px; padding-top: 8px; border-top: 1px solid #0f172a; font-size: 10.5px; break-inside: avoid; }
        .sig-col { font-weight: 700; }
        .sig-line { margin-top: 18px; border-bottom: 1px solid #1e293b; }
      `;

    printHtmlViaIframe({
      title: `Наряд-заказ № ${activeRow.orderNo}`,
      format,
      marginMm: isThermal ? 2 : 9,
      extraCss,
      htmlBody: isThermal ? buildThermalPrintHtml() : buildA4PrintHtml(),
      onError: msg => onNotice?.(msg)
    });
  };

  const handleDownloadFormattedPdf = async () => {
    setIsGeneratingPdf(true);
    try {
      const isThermalPdf = isThermal;
      const thermalWidthMm = format === 'thermal_80' ? 80 : 58;
      // Рассчитываем примерную высоту ленты термочека с запасом
      const estRowsCount = variantsData.reduce((s, v) => s + Math.max(2, v.sizes.length) + 12, 12);
      const thermalHeightMm = Math.max(120, Math.min(800, estRowsCount * 5.2));

      const doc = isThermalPdf
        ? new jsPDF({ orientation: 'portrait', unit: 'mm', format: [thermalWidthMm, thermalHeightMm] })
        : new jsPDF({
            orientation: format === 'a4_landscape' ? 'landscape' : 'portrait',
            unit: 'mm',
            format: 'a4'
          });

      const fontName = await registerCyrillicFonts(doc);

      if (isThermalPdf) {
        const margin = 2.5;
        let y = 6;
        doc.setFont(fontName, 'bold');
        doc.setFontSize(format === 'thermal_80' ? 11 : 9.5);
        doc.text('CHUST TEXTILE', thermalWidthMm / 2, y, { align: 'center' });
        y += 4.5;
        doc.setFontSize(format === 'thermal_80' ? 9.5 : 8);
        doc.text(`НАРЯД-ЗАКАЗ № ${activeRow.orderNo}`, thermalWidthMm / 2, y, { align: 'center' });
        y += 4;
        doc.setFont(fontName, 'normal');
        doc.setFontSize(format === 'thermal_80' ? 7.5 : 6.5);
        doc.text(`${activeRow.brand || '—'} | ${printedTimestamp}`, thermalWidthMm / 2, y, { align: 'center' });
        y += 3.5;

        for (const v of variantsData) {
          doc.setFont(fontName, 'bold');
          doc.setFontSize(format === 'thermal_80' ? 8 : 7);
          doc.text(`${v.row.model} • ${v.row.color}${v.row.rost ? ` (${v.row.rost})` : ''}`, margin, y);
          y += 2;

          const head =
            format === 'thermal_58' || !includeAllStages
              ? [['Разм', 'Зак', 'Крой', 'Упак', 'Ост']]
              : [['Разм', 'Зак', 'Крой', 'Разд', 'Пош', 'Упак', 'Ост']];

          const body = [
            ...v.sizes.map(sz => {
              const c = v.matrix.values[sz] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
              const rem = c.order - c.pack;
              return format === 'thermal_58' || !includeAllStages
                ? [sz, String(c.order || '-'), String(c.cut || '-'), String(c.pack || '-'), String(c.order || c.pack ? rem : '-')]
                : [
                    sz,
                    String(c.order || '-'),
                    String(c.cut || '-'),
                    String(c.dist || '-'),
                    String(c.sew || '-'),
                    String(c.pack || '-'),
                    String(c.order || c.pack ? rem : '-')
                  ];
            }),
            format === 'thermal_58' || !includeAllStages
              ? ['ИТОГО', String(v.totals.order), String(v.totals.cut), String(v.totals.pack), String(v.totals.remOrder)]
              : [
                  'ИТОГО',
                  String(v.totals.order),
                  String(v.totals.cut),
                  String(v.totals.dist),
                  String(v.totals.sew),
                  String(v.totals.pack),
                  String(v.totals.remOrder)
                ]
          ];

          autoTable(doc, {
            startY: y,
            head,
            body,
            theme: 'grid',
            margin: { left: margin, right: margin },
            styles: {
              font: fontName,
              fontSize: format === 'thermal_80' ? 6.8 : 5.6,
              cellPadding: 0.9,
              halign: 'center',
              textColor: [0, 0, 0],
              lineColor: [0, 0, 0],
              lineWidth: 0.2
            },
            headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' }
          });

          const thStatsParts: string[] = [`Крой%: ${v.totals.cutPct.toFixed(1)}%`];
          if (v.totals.defect > 0) thStatsParts.push(`Брак: ${v.totals.defect}`);
          if (v.totals.shipped > 0) thStatsParts.push(`Отгр: ${v.totals.shipped}`);
          thStatsParts.push(`Закр: ${v.totals.closePct.toFixed(1)}%`);

          y = ((doc as any).lastAutoTable?.finalY || y + 20) + 4;
          doc.setFont(fontName, 'normal');
          doc.setFontSize(format === 'thermal_80' ? 7.5 : 6.5);
          doc.text(thStatsParts.join(' | '), margin, y);
          y += 5;
        }
      } else {
        const margin = 10;
        let y = 13;
        doc.setFont(fontName, 'bold');
        doc.setFontSize(13);
        doc.text(`CHUST TEXTILE — ЗАКАЗ-НАРЯД № ${activeRow.orderNo}`, margin, y);
        y += 5.5;
        doc.setFont(fontName, 'normal');
        doc.setFontSize(8.5);
        const headerPdfParts: string[] = [];
        if ((activeRow.brand || '').trim()) headerPdfParts.push(`Бренд: ${activeRow.brand}`);
        if ((activeRow.model || '').trim()) headerPdfParts.push(`Модель: ${activeRow.model}`);
        if ((activeRow.month || '').trim()) headerPdfParts.push(`Месяц: ${activeRow.month}`);
        headerPdfParts.push(`Дата: ${printedTimestamp}`);
        doc.text(headerPdfParts.join('   |   '), margin, y);
        y += 5;

        const maxCols = format === 'a4_portrait' ? 10 : 18;
        for (const v of variantsData) {
          doc.setFont(fontName, 'bold');
          doc.setFontSize(9.5);
          doc.text(
            `Цвет: ${v.row.color}${v.row.colorCode ? ` (${v.row.colorCode})` : ''}${v.row.rost ? `   •   Рост: ${v.row.rost}` : ''}   •   Заказ: ${v.totals.order} шт`,
            margin,
            y
          );
          y += 2.5;

          for (const szChunk of chunkArray(v.sizes, maxCols)) {
            const head = [['Этап', ...szChunk, 'ВСЕГО']];
            const body = [
              ['Заказ', ...szChunk.map(s => String(v.matrix.values[s]?.order || '')), String(v.totals.order)],
              ['Крой', ...szChunk.map(s => String(v.matrix.values[s]?.cut || '')), String(v.totals.cut)],
              ...(includeAllStages
                ? [
                    ['Крой %', ...szChunk.map(s => formatPct(v.matrix.values[s]?.cut || 0, v.matrix.values[s]?.order || 0)), `${v.totals.cutPct.toFixed(1)}%`],
                    ['Раздача', ...szChunk.map(s => String(v.matrix.values[s]?.dist || '')), String(v.totals.dist)],
                    ['Пошив', ...szChunk.map(s => String(v.matrix.values[s]?.sew || '')), String(v.totals.sew)]
                  ]
                : []),
              ['Упаковка', ...szChunk.map(s => String(v.matrix.values[s]?.pack || '')), String(v.totals.pack)],
              ['Остаток', ...szChunk.map(s => {
                const c = v.matrix.values[s];
                return c && (c.order > 0 || c.pack > 0) ? String(c.order - c.pack) : '';
              }), String(v.totals.remOrder)],
              ['Закр. %', ...szChunk.map(s => formatPct(v.matrix.values[s]?.pack || 0, v.matrix.values[s]?.order || 0)), `${v.totals.closePct.toFixed(1)}%`]
            ];

            autoTable(doc, {
              startY: y,
              head,
              body,
              theme: 'grid',
              margin: { left: margin, right: margin },
              styles: {
                font: fontName,
                fontSize: format === 'a4_portrait' ? 7.5 : 8,
                halign: 'center',
                textColor: [15, 23, 42],
                lineColor: [51, 65, 85],
                lineWidth: 0.25
              },
              headStyles: { fillColor: [248, 203, 173], textColor: [15, 23, 42], fontStyle: 'bold' }
            });
            y = ((doc as any).lastAutoTable?.finalY || y + 35) + 4;
          }

          const pdfSumHead = [
            'Заказ',
            'Крой',
            'Крой %',
            'Раздача',
            'Пошив',
            'Упаковка',
            ...(v.totals.defect > 0 ? ['Брак'] : []),
            'Разд−Упак',
            ...(v.totals.shipped > 0 ? ['Отгрузка'] : []),
            ...(v.totals.stock > 0 ? ['Склад'] : [])
          ];
          const pdfSumBody = [
            String(v.totals.order),
            String(v.totals.cut),
            `${v.totals.cutPct.toFixed(1)}%`,
            String(v.totals.dist),
            String(v.totals.sew),
            String(v.totals.pack),
            ...(v.totals.defect > 0 ? [String(v.totals.defect)] : []),
            `${v.totals.remDist} (${v.totals.diffDistPct.toFixed(1)}%)`,
            ...(v.totals.shipped > 0 ? [String(v.totals.shipped)] : []),
            ...(v.totals.stock > 0 ? [String(v.totals.stock)] : [])
          ];

          autoTable(doc, {
            startY: y,
            head: [pdfSumHead],
            body: [pdfSumBody],
            theme: 'grid',
            margin: { left: margin, right: margin },
            styles: { font: fontName, fontSize: 7.5, halign: 'center', fontStyle: 'bold' },
            headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] }
          });
          y = ((doc as any).lastAutoTable?.finalY || y + 14) + 7;
        }
      }

      const fmtTag =
        format === 'thermal_80' ? 'Термо80' : format === 'thermal_58' ? 'Термо58' : format === 'a4_portrait' ? 'A4_Книж' : 'A4_Альбом';
      doc.save(`Печать_${activeRow.orderNo}_${fmtTag}.pdf`);
      onNotice?.(`PDF для печати (${fmtTag}) скачан!`);
    } catch (err) {
      console.error('Print PDF error:', err);
      onNotice?.('Ошибка при формировании PDF для печати.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        {/* Шапка модального окна и настройки печати */}
        <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-400/40 text-sky-300 flex items-center justify-center shrink-0">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                <span>Печать заказа-наряда № {activeRow.orderNo}</span>
                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-[11px] font-mono text-amber-300">
                  {activeRow.model}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Выберите формат листа (A4 или термопринтер 80/58 мм) — предпросмотр обновляется мгновенно
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadFormattedPdf}
              disabled={isGeneratingPdf}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-rose-200 border border-rose-500/40 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5 text-rose-400" />
              <span>{isGeneratingPdf ? 'Создаём PDF...' : 'Скачать PDF'}</span>
            </button>

            <button
              type="button"
              onClick={handleNativeDevicePrint}
              className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl text-xs sm:text-sm font-black flex items-center gap-1.5 cursor-pointer shadow-lg whitespace-nowrap shrink-0"
              title="Открыть системный диалог печати для выбора принтера, подключённого к вашему устройству"
            >
              <Printer className="w-4 h-4" />
              <span>Печать (выбор принтера)</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl cursor-pointer"
              title="Закрыть окно печати"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Панель выбора формата, объёма и опций */}
        <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center gap-3 text-xs shrink-0">
          {/* Формат бумаги */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <span className="text-[10px] font-bold uppercase text-slate-400 px-1.5 flex items-center gap-1">
              <SlidersHorizontal className="w-3 h-3 text-sky-400" />
              <span>Формат:</span>
            </span>
            {(
              [
                { id: 'a4_landscape', label: 'A4 Альбом' },
                { id: 'a4_portrait', label: 'A4 Книж.' },
                { id: 'thermal_80', label: 'Термо 80 мм' },
                { id: 'thermal_58', label: 'Термо 58 мм' }
              ] as { id: PrintFormatMode; label: string }[]
            ).map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFormat(opt.id)}
                className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  format === opt.id
                    ? 'bg-sky-500 text-slate-950 shadow'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Объём печати (1 позиция или весь заказ) */}
          {orderVariants.length > 1 && (
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setScope('single_variant')}
                className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  scope === 'single_variant'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Текущий цвет ({activeRow.color})
              </button>
              <button
                type="button"
                onClick={() => setScope('all_variants')}
                className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                  scope === 'all_variants'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>Весь заказ ({orderVariants.length} поз.)</span>
              </button>
            </div>
          )}

          {/* Переключатели деталей */}
          <div className="flex flex-wrap items-center gap-3 ml-auto text-[11px] font-semibold text-slate-200">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideZeroSizes}
                onChange={e => setHideZeroSizes(e.target.checked)}
                className="accent-sky-400"
              />
              <span>Только размеры &gt; 0</span>
            </label>

            {format !== 'thermal_58' && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeAllStages}
                  onChange={e => setIncludeAllStages(e.target.checked)}
                  className="accent-sky-400"
                />
                <span>Все этапы (Разд/Пошив)</span>
              </label>
            )}

            {!isThermal && activePhotoSrc && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeImage}
                  onChange={e => setIncludeImage(e.target.checked)}
                  className="accent-sky-400"
                />
                <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                <span>Фото</span>
              </label>
            )}

            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeSignatures}
                onChange={e => setIncludeSignatures(e.target.checked)}
                className="accent-sky-400"
              />
              <PenLine className="w-3.5 h-3.5 text-emerald-400" />
              <span>Подписи</span>
            </label>
          </div>
        </div>

        {/* Область живого предпросмотра (WYSIWYG лист) */}
        <div className="flex-1 overflow-auto bg-slate-800/90 p-4 sm:p-6 flex justify-center items-start">
          {isThermal ? (
            /* ПРЕДПРОСМОТР ТЕРМОЧЕКА (80мм или 58мм) */
            <div
              className={`bg-white text-black shadow-2xl border border-slate-400 rounded-sm p-3 transition-all ${
                format === 'thermal_80' ? 'w-[320px]' : 'w-[235px]'
              }`}
            >
              <div className="text-center border-b-2 border-black pb-2 mb-2">
                <div className={`font-black tracking-wide ${format === 'thermal_80' ? 'text-sm' : 'text-xs'}`}>
                  CHUST TEXTILE
                </div>
                <div className={`font-extrabold ${format === 'thermal_80' ? 'text-xs' : 'text-[10px]'}`}>
                  НАРЯД-ЗАКАЗ № {activeRow.orderNo}
                </div>
                <div className="text-[9px] text-slate-700 mt-0.5">{printedTimestamp}</div>
              </div>

              <div className={`space-y-0.5 border-b border-dashed border-black pb-2 mb-2 ${format === 'thermal_80' ? 'text-[11px]' : 'text-[9.5px]'}`}>
                <div className="flex justify-between gap-2">
                  <span>Бренд:</span>
                  <strong className="font-black text-right">{activeRow.brand || '—'}</strong>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Месяц:</span>
                  <strong className="font-black text-right">{activeRow.month || DEFAULT_MONTHS[0]}</strong>
                </div>
              </div>

              {variantsData.map(v => {
                const is58 = format === 'thermal_58';
                return (
                  <div key={`prev-th-${v.row.id}`} className="mb-3 pb-2 border-b border-dashed border-black">
                    <div className={`space-y-0.5 mb-1.5 ${is58 ? 'text-[9.5px]' : 'text-[10.5px]'}`}>
                      <div className="flex justify-between gap-1">
                        <span>Цвет:</span>
                        <strong className="font-black text-right">
                          {v.row.color}
                          {v.row.colorCode ? ` (${v.row.colorCode})` : ''}
                        </strong>
                      </div>
                      {v.row.rost && (
                        <div className="flex justify-between gap-1">
                          <span>Рост:</span>
                          <strong className="font-black">{v.row.rost}</strong>
                        </div>
                      )}
                      <div className="flex justify-between gap-1">
                        <span>Модель:</span>
                        <strong className="font-black text-right">{v.row.model}</strong>
                      </div>
                    </div>

                    <table
                      className={`w-full border-collapse text-center font-mono tabular-nums mb-1.5 ${
                        is58 ? 'text-[8.5px]' : 'text-[9.5px]'
                      }`}
                    >
                      <thead>
                        <tr className="border-y border-black font-black bg-slate-100">
                          <th className="border border-black py-0.5 px-1 text-left">Разм</th>
                          <th className="border border-black py-0.5 px-0.5">Зак</th>
                          <th className="border border-black py-0.5 px-0.5">Кр</th>
                          {!is58 && includeAllStages && (
                            <>
                              <th className="border border-black py-0.5 px-0.5">Разд</th>
                              <th className="border border-black py-0.5 px-0.5">Пош</th>
                            </>
                          )}
                          <th className="border border-black py-0.5 px-0.5">Упк</th>
                          <th className="border border-black py-0.5 px-0.5">Ост</th>
                        </tr>
                      </thead>
                      <tbody>
                        {v.sizes.length > 0 ? (
                          v.sizes.map(sz => {
                            const c = v.matrix.values[sz] || { order: 0, cut: 0, dist: 0, sew: 0, pack: 0 };
                            const rem = c.order - c.pack;
                            return (
                              <tr key={`th-sz-${v.row.id}-${sz}`}>
                                <td className="border border-black py-0.5 px-1 text-left font-black">{sz}</td>
                                <td className="border border-black py-0.5 px-0.5">{c.order || '-'}</td>
                                <td className="border border-black py-0.5 px-0.5">{c.cut || '-'}</td>
                                {!is58 && includeAllStages && (
                                  <>
                                    <td className="border border-black py-0.5 px-0.5">{c.dist || '-'}</td>
                                    <td className="border border-black py-0.5 px-0.5">{c.sew || '-'}</td>
                                  </>
                                )}
                                <td className="border border-black py-0.5 px-0.5 font-black">{c.pack || '-'}</td>
                                <td className="border border-black py-0.5 px-0.5">{c.order || c.pack ? rem : '-'}</td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={is58 || !includeAllStages ? 5 : 7} className="border border-black py-1 text-slate-600">
                              Без разбивки по размерам
                            </td>
                          </tr>
                        )}
                        <tr className="font-black bg-slate-100">
                          <td className="border border-black py-0.5 px-1 text-left">ИТОГО</td>
                          <td className="border border-black py-0.5 px-0.5">{v.totals.order}</td>
                          <td className="border border-black py-0.5 px-0.5">{v.totals.cut}</td>
                          {!is58 && includeAllStages && (
                            <>
                              <td className="border border-black py-0.5 px-0.5">{v.totals.dist}</td>
                              <td className="border border-black py-0.5 px-0.5">{v.totals.sew}</td>
                            </>
                          )}
                          <td className="border border-black py-0.5 px-0.5">{v.totals.pack}</td>
                          <td className="border border-black py-0.5 px-0.5">{v.totals.remOrder}</td>
                        </tr>
                      </tbody>
                    </table>

                    <div className={`space-y-0.5 ${is58 ? 'text-[9px]' : 'text-[10px]'}`}>
                      <div className="flex justify-between">
                        <span>Крой %:</span>
                        <strong>{v.totals.cutPct.toFixed(1)}%</strong>
                      </div>
                      {(v.totals.defect > 0 || v.totals.shipped > 0) && (
                        <div className="flex justify-between">
                          <span>
                            {v.totals.defect > 0 && v.totals.shipped > 0
                              ? 'Брак / Отгр:'
                              : v.totals.defect > 0
                              ? 'Брак:'
                              : 'Отгр:'}
                          </span>
                          <strong>
                            {v.totals.defect > 0 && v.totals.shipped > 0
                              ? `${v.totals.defect} / ${v.totals.shipped} шт`
                              : `${v.totals.defect > 0 ? v.totals.defect : v.totals.shipped} шт`}
                          </strong>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>Разд−Упак:</span>
                        <strong>
                          {v.totals.remDist} ({v.totals.diffDistPct.toFixed(1)}%)
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Закрытие %:</span>
                        <strong>{v.totals.closePct.toFixed(1)}%</strong>
                      </div>
                      {v.row.notes && (
                        <div className="pt-1 text-[9px] text-slate-800">Прим: {v.row.notes}</div>
                      )}
                    </div>
                  </div>
                );
              })}

              {variantsData.length > 1 && (
                <div className={`pb-2 mb-2 border-b-2 border-black space-y-0.5 ${format === 'thermal_80' ? 'text-[10px]' : 'text-[9px]'}`}>
                  <div className="font-black">ОБЩИЙ ИТОГ ({variantsData.length} поз.):</div>
                  <div className="flex justify-between">
                    <span>Заказ:</span>
                    <strong>{grandTotals.order} шт</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Крой ({grandTotals.cutPct.toFixed(1)}%):</span>
                    <strong>{grandTotals.cut} шт</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Упаковка:</span>
                    <strong>{grandTotals.pack} шт</strong>
                  </div>
                  {grandTotals.shipped > 0 && (
                    <div className="flex justify-between">
                      <span>Отгружено:</span>
                      <strong>{grandTotals.shipped} шт</strong>
                    </div>
                  )}
                </div>
              )}

              {includeSignatures && (
                <div className={`space-y-2 pt-1 ${format === 'thermal_80' ? 'text-[10px]' : 'text-[9px]'}`}>
                  <div className="flex justify-between">
                    <span>Выдал/Мастер:</span>
                    <span>__________</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Принял/ОТК:</span>
                    <span>__________</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ПРЕДПРОСМОТР ЛИСТА A4 (АЛЬБОМ ИЛИ КНИЖНЫЙ) */
            <div
              className={`bg-white text-slate-950 shadow-2xl border border-slate-400 p-5 sm:p-6 transition-all ${
                format === 'a4_landscape' ? 'w-full max-w-[1060px]' : 'w-full max-w-[740px]'
              }`}
            >
              <div className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-3 mb-4">
                <div>
                  <h3 className="text-base sm:text-lg font-black tracking-wide text-slate-950">
                    CHUST TEXTILE — ЗАКАЗ-НАРЯД НА ПРОИЗВОДСТВО № {activeRow.orderNo}
                  </h3>
                  <div className="text-xs font-bold text-slate-700 mt-1">
                    Бренд: {activeRow.brand || '—'} &nbsp;|&nbsp; Модель: {activeRow.model} &nbsp;|&nbsp; Месяц:{' '}
                    {activeRow.month || DEFAULT_MONTHS[0]} &nbsp;|&nbsp; Позиций: {variantsData.length}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {includeImage && activePhotoSrc && (
                    <img
                      src={activePhotoSrc}
                      alt="Эскиз"
                      className="h-14 w-auto object-contain border border-slate-300 rounded p-0.5 bg-white"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="text-right text-[11px] text-slate-700">
                    <div className="font-bold">Дата печати:</div>
                    <div className="font-mono">{printedTimestamp}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {variantsData.map((v, vIdx) => {
                  const maxCols = format === 'a4_portrait' ? 10 : 18;
                  const sizeChunks = chunkArray(v.sizes, maxCols);

                  return (
                    <div key={`a4-v-${v.row.id}`} className="border border-slate-700 rounded-md p-3 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100 border border-slate-300 px-3 py-1.5 rounded text-xs">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="font-black">
                            {vIdx + 1}. {v.row.model}
                          </span>
                          <span className="px-2 py-0.5 bg-white border border-slate-500 rounded font-bold">
                            Цвет: {v.row.color}
                            {v.row.colorCode ? ` (${v.row.colorCode})` : ''}
                          </span>
                          {v.row.rost && (
                            <span className="px-2 py-0.5 bg-amber-100 border border-amber-500 rounded font-mono font-black">
                              Рост: {v.row.rost}
                            </span>
                          )}
                        </div>
                        <span className="font-mono font-black">Заказ: {v.totals.order.toLocaleString()} шт</span>
                      </div>

                      {sizeChunks.map((szChunk, chIdx) => {
                        const showTotal = chIdx === sizeChunks.length - 1;
                        return (
                          <div key={`a4-ch-${v.row.id}-${chIdx}`} className="overflow-x-auto">
                            <table className="w-full border-collapse text-center text-xs font-sans">
                              <thead>
                                <tr className="bg-[#f8cbad] text-slate-950 font-black">
                                  <th className="px-2 py-1.5 border border-slate-700 text-left min-w-[78px]">Этап</th>
                                  {szChunk.map(sz => (
                                    <th key={`a4-h-${sz}`} className="px-1.5 py-1.5 border border-slate-700 min-w-[38px]">
                                      {sz}
                                    </th>
                                  ))}
                                  {showTotal && (
                                    <th className="px-2 py-1.5 border border-slate-700 min-w-[58px]">ВСЕГО</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody className="font-mono tabular-nums font-semibold">
                                <tr>
                                  <td className="px-2 py-1 border border-slate-700 text-left font-sans font-bold bg-slate-50">
                                    Заказ
                                  </td>
                                  {szChunk.map(sz => (
                                    <td key={`o-${sz}`} className="px-1.5 py-1 border border-slate-700">
                                      {v.matrix.values[sz]?.order || ''}
                                    </td>
                                  ))}
                                  {showTotal && (
                                    <td className="px-2 py-1 border border-slate-700 font-black bg-slate-100">
                                      {v.totals.order}
                                    </td>
                                  )}
                                </tr>
                                <tr>
                                  <td className="px-2 py-1 border border-slate-700 text-left font-sans font-bold bg-slate-50">
                                    Крой
                                  </td>
                                  {szChunk.map(sz => (
                                    <td key={`c-${sz}`} className="px-1.5 py-1 border border-slate-700">
                                      {v.matrix.values[sz]?.cut || ''}
                                    </td>
                                  ))}
                                  {showTotal && (
                                    <td className="px-2 py-1 border border-slate-700 font-black bg-slate-100">
                                      {v.totals.cut}
                                    </td>
                                  )}
                                </tr>
                                {includeAllStages && (
                                  <>
                                    <tr className="bg-sky-50 text-sky-900">
                                      <td className="px-2 py-1 border border-slate-700 text-left font-sans font-bold">
                                        Крой %
                                      </td>
                                      {szChunk.map(sz => {
                                        const cell = v.matrix.values[sz];
                                        return (
                                          <td key={`cp-${sz}`} className="px-1.5 py-1 border border-slate-700">
                                            {cell ? formatPct(cell.cut, cell.order) : ''}
                                          </td>
                                        );
                                      })}
                                      {showTotal && (
                                        <td className="px-2 py-1 border border-slate-700 font-black bg-sky-100">
                                          {v.totals.cutPct.toFixed(1).replace('.', ',')}%
                                        </td>
                                      )}
                                    </tr>
                                    <tr>
                                      <td className="px-2 py-1 border border-slate-700 text-left font-sans font-bold bg-slate-50">
                                        Раздача
                                      </td>
                                      {szChunk.map(sz => (
                                        <td key={`d-${sz}`} className="px-1.5 py-1 border border-slate-700">
                                          {v.matrix.values[sz]?.dist || ''}
                                        </td>
                                      ))}
                                      {showTotal && (
                                        <td className="px-2 py-1 border border-slate-700 font-black bg-slate-100">
                                          {v.totals.dist}
                                        </td>
                                      )}
                                    </tr>
                                    <tr>
                                      <td className="px-2 py-1 border border-slate-700 text-left font-sans font-bold bg-slate-50">
                                        Пошив
                                      </td>
                                      {szChunk.map(sz => (
                                        <td key={`s-${sz}`} className="px-1.5 py-1 border border-slate-700">
                                          {v.matrix.values[sz]?.sew || ''}
                                        </td>
                                      ))}
                                      {showTotal && (
                                        <td className="px-2 py-1 border border-slate-700 font-black bg-slate-100">
                                          {v.totals.sew}
                                        </td>
                                      )}
                                    </tr>
                                  </>
                                )}
                                <tr className="bg-yellow-200 font-black">
                                  <td className="px-2 py-1 border border-slate-700 text-left font-sans">Упаковка</td>
                                  {szChunk.map(sz => (
                                    <td key={`p-${sz}`} className="px-1.5 py-1 border border-slate-700">
                                      {v.matrix.values[sz]?.pack || ''}
                                    </td>
                                  ))}
                                  {showTotal && (
                                    <td className="px-2 py-1 border border-slate-700">{v.totals.pack}</td>
                                  )}
                                </tr>
                                <tr>
                                  <td className="px-2 py-1 border border-slate-700 text-left font-sans font-bold bg-slate-50">
                                    Остаток
                                  </td>
                                  {szChunk.map(sz => {
                                    const c = v.matrix.values[sz];
                                    return (
                                      <td key={`r-${sz}`} className="px-1.5 py-1 border border-slate-700">
                                        {c && (c.order > 0 || c.pack > 0) ? c.order - c.pack : ''}
                                      </td>
                                    );
                                  })}
                                  {showTotal && (
                                    <td className="px-2 py-1 border border-slate-700 font-black bg-slate-100">
                                      {v.totals.remOrder}
                                    </td>
                                  )}
                                </tr>
                                <tr className="bg-emerald-100 text-rose-900 font-black">
                                  <td className="px-2 py-1 border border-slate-700 text-left font-sans">Закр. %</td>
                                  {szChunk.map(sz => {
                                    const c = v.matrix.values[sz];
                                    return (
                                      <td key={`pct-${sz}`} className="px-1.5 py-1 border border-slate-700">
                                        {c ? formatPct(c.pack, c.order) : ''}
                                      </td>
                                    );
                                  })}
                                  {showTotal && (
                                    <td className="px-2 py-1 border border-slate-700">
                                      {v.totals.closePct.toFixed(1).replace('.', ',')}%
                                    </td>
                                  )}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        );
                      })}

                      <table className="w-full border-collapse text-center text-[11px] font-mono tabular-nums">
                        <thead>
                          <tr className="bg-slate-100 font-sans font-black">
                            <th className="px-1.5 py-1 border border-slate-600">Заказ</th>
                            <th className="px-1.5 py-1 border border-slate-600">Крой</th>
                            <th className="px-1.5 py-1 border border-slate-600">Крой %</th>
                            <th className="px-1.5 py-1 border border-slate-600">Раздача</th>
                            <th className="px-1.5 py-1 border border-slate-600">Пошив</th>
                            <th className="px-1.5 py-1 border border-slate-600">Упаковка</th>
                            {v.totals.defect > 0 && <th className="px-1.5 py-1 border border-slate-600">Брак</th>}
                            <th className="px-1.5 py-1 border border-slate-600">Разд−Упак</th>
                            {v.totals.shipped > 0 && <th className="px-1.5 py-1 border border-slate-600">Отгрузка</th>}
                            {v.totals.stock > 0 && <th className="px-1.5 py-1 border border-slate-600">Склад</th>}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="font-black">
                            <td className="px-1.5 py-1 border border-slate-600">{v.totals.order}</td>
                            <td className="px-1.5 py-1 border border-slate-600">{v.totals.cut}</td>
                            <td className="px-1.5 py-1 border border-slate-600">{v.totals.cutPct.toFixed(1)}%</td>
                            <td className="px-1.5 py-1 border border-slate-600">{v.totals.dist}</td>
                            <td className="px-1.5 py-1 border border-slate-600">{v.totals.sew}</td>
                            <td className="px-1.5 py-1 border border-slate-600">{v.totals.pack}</td>
                            {v.totals.defect > 0 && <td className="px-1.5 py-1 border border-slate-600">{v.totals.defect}</td>}
                            <td className="px-1.5 py-1 border border-slate-600">
                              {v.totals.remDist} ({v.totals.diffDistPct.toFixed(1)}%)
                            </td>
                            {v.totals.shipped > 0 && <td className="px-1.5 py-1 border border-slate-600">{v.totals.shipped}</td>}
                            {v.totals.stock > 0 && <td className="px-1.5 py-1 border border-slate-600">{v.totals.stock}</td>}
                          </tr>
                        </tbody>
                      </table>

                      {v.row.notes && (
                        <div className="text-[11px] text-slate-700 border-t border-dashed border-slate-400 pt-1">
                          <strong>Примечание:</strong> {v.row.notes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {variantsData.length > 1 && (
                <div className="mt-4 border-2 border-slate-900 rounded-md p-2.5 bg-slate-50">
                  <div className="text-xs font-black mb-1.5">
                    СВОДНЫЙ ИТОГ ПО ЗАКАЗУ «{activeRow.orderNo}» ({variantsData.length} поз.)
                  </div>
                  <div className="flex flex-wrap gap-2 text-center text-[11px] font-mono font-black">
                    <div className="flex-1 min-w-[72px] border border-slate-400 bg-white p-1 rounded">
                      <div className="text-[9px] font-sans text-slate-600">Заказ</div>
                      {grandTotals.order}
                    </div>
                    <div className="flex-1 min-w-[72px] border border-slate-400 bg-white p-1 rounded">
                      <div className="text-[9px] font-sans text-slate-600">Крой</div>
                      {grandTotals.cut}
                    </div>
                    <div className="flex-1 min-w-[72px] border border-slate-400 bg-white p-1 rounded">
                      <div className="text-[9px] font-sans text-slate-600">Крой %</div>
                      {grandTotals.cutPct.toFixed(1)}%
                    </div>
                    <div className="flex-1 min-w-[72px] border border-slate-400 bg-white p-1 rounded">
                      <div className="text-[9px] font-sans text-slate-600">Раздача</div>
                      {grandTotals.dist}
                    </div>
                    <div className="flex-1 min-w-[72px] border border-slate-400 bg-white p-1 rounded">
                      <div className="text-[9px] font-sans text-slate-600">Пошив</div>
                      {grandTotals.sew}
                    </div>
                    <div className="flex-1 min-w-[72px] border border-slate-400 bg-white p-1 rounded">
                      <div className="text-[9px] font-sans text-slate-600">Упаковка</div>
                      {grandTotals.pack}
                    </div>
                    {grandTotals.defect > 0 && (
                      <div className="flex-1 min-w-[72px] border border-slate-400 bg-white p-1 rounded">
                        <div className="text-[9px] font-sans text-slate-600">Брак</div>
                        {grandTotals.defect}
                      </div>
                    )}
                    <div className="flex-1 min-w-[72px] border border-slate-400 bg-white p-1 rounded">
                      <div className="text-[9px] font-sans text-slate-600">Разд−Упак</div>
                      {grandTotals.remDist}
                    </div>
                    {grandTotals.shipped > 0 && (
                      <div className="flex-1 min-w-[72px] border border-slate-400 bg-white p-1 rounded">
                        <div className="text-[9px] font-sans text-slate-600">Отгрузка</div>
                        {grandTotals.shipped}
                      </div>
                    )}
                    {grandTotals.stock > 0 && (
                      <div className="flex-1 min-w-[72px] border border-slate-400 bg-white p-1 rounded">
                        <div className="text-[9px] font-sans text-slate-600">Склад</div>
                        {grandTotals.stock}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {includeSignatures && (
                <div className="grid grid-cols-3 gap-6 mt-5 pt-3 border-t border-slate-900 text-[11px]">
                  <div>
                    <div className="font-bold">Технолог / Планирование:</div>
                    <div className="mt-5 border-b border-slate-800" />
                  </div>
                  <div>
                    <div className="font-bold">Начальник производства:</div>
                    <div className="mt-5 border-b border-slate-800" />
                  </div>
                  <div>
                    <div className="font-bold">ОТК / Склад упаковки:</div>
                    <div className="mt-5 border-b border-slate-800" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Нижняя подсказка */}
        <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              Режим:{' '}
              <strong className="text-slate-200">
                {format === 'a4_landscape'
                  ? 'A4 Альбом (297×210 мм)'
                  : format === 'a4_portrait'
                  ? 'A4 Книжный (210×297 мм)'
                  : format === 'thermal_80'
                  ? 'Термопринтер 80 мм'
                  : 'Термопринтер 58 мм'}
              </strong>
            </span>
          </div>
          <span>
            При нажатии «Печать» откроется системное окно с принтерами вашего устройства.
          </span>
        </div>
      </div>
    </div>
  );
};

export default OrderPrintModal;
