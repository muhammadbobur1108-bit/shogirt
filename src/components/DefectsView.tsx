import React, { useMemo, useState } from 'react';
import { DefectItem, Order } from '../types';
import { TRANSLATIONS, Language } from '../locales';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  LayoutGrid,
  Plus,
  Table as TableIcon,
  Trash
} from 'lucide-react';

interface DefectsViewProps {
  defects: DefectItem[];
  orders: Order[];
  onAddDefect: (defect: DefectItem) => void;
  onRemoveDefect: (id: string) => void;
  lang: Language;
}

type DefectSortKey = 'createdAt' | 'orderNumber' | 'defectType' | 'quantity' | 'reporter' | 'actionTaken';

export default function DefectsView({ defects, orders, onAddDefect, onRemoveDefect, lang }: DefectsViewProps) {
  const t = TRANSLATIONS[lang];

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [defectType, setDefectType] = useState<DefectItem['defectType']>('tikuv_xatosi');
  const [qty, setQty] = useState(5);
  const [reporter, setReporter] = useState('');
  const [description, setDescription] = useState('');
  const [actionTaken, setActionTaken] = useState('tuzatildi');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [sortConfig, setSortConfig] = useState<{ key: DefectSortKey; dir: 'asc' | 'desc' }>({
    key: 'createdAt',
    dir: 'desc'
  });

  const toggleSort = (key: DefectSortKey) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: key === 'quantity' || key === 'createdAt' ? 'desc' : 'asc' };
    });
  };

  const sortedDefects = useMemo(() => {
    const dir = sortConfig.dir === 'asc' ? 1 : -1;
    return [...defects].sort((a, b) => {
      if (sortConfig.key === 'quantity') {
        return ((Number(a.quantity) || 0) - (Number(b.quantity) || 0)) * dir;
      }
      if (sortConfig.key === 'createdAt') {
        const ta = Date.parse(a.createdAt || '') || 0;
        const tb = Date.parse(b.createdAt || '') || 0;
        if (ta !== tb) return (ta - tb) * dir;
        return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) * dir;
      }
      const valA = String(a[sortConfig.key] || '');
      const valB = String(b[sortConfig.key] || '');
      return valA.localeCompare(valB, 'ru') * dir;
    });
  }, [defects, sortConfig]);

  // Metrics
  const totalDefectivePcs = defects.reduce((sum, d) => sum + d.quantity, 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderId || !reporter.trim()) {
      alert(lang === 'uz' ? 'Iltimos barcha kerakli maydonlarni to\'ldiring!' : 'Пожалуйста, заполните все обязательные поля!');
      return;
    }

    const order = orders.find(o => o.id === selectedOrderId);
    if (!order) return;

    const newItem: DefectItem = {
      id: `def-${Date.now()}`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      productType: order.productType,
      defectType,
      quantity: qty,
      reporter,
      createdAt: new Date().toISOString().split('T')[0],
      description,
      actionTaken,
      status: 'Ochq'
    };

    onAddDefect(newItem);

    // Reset
    setSelectedOrderId('');
    setQty(5);
    setReporter('');
    setDescription('');
    setIsAddOpen(false);
  };

  const getDefectLabel = (type: string) => {
    return t[`defect_${type}` as keyof typeof t] || type;
  };

  const getActionLabel = (act: string) => {
    return t[`action_${act}` as keyof typeof t] || act;
  };

  return (
    <div className="space-y-4 sm:space-y-6" id="defects-view-module">
      
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-2xl shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="font-extrabold text-white text-base sm:text-lg uppercase tracking-tight flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2 text-rose-500" /> {t.defectTitle}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">{t.defectSub}</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors ${
                viewMode === 'table' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Jadval' : 'Таблица'}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors ${
                viewMode === 'cards' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Kartalar' : 'Карточки'}</span>
            </button>
          </div>

          <button
            onClick={() => {
              if (orders.length > 0) {
                setSelectedOrderId(orders[0].id);
              }
              setIsAddOpen(true);
            }}
            className="flex-1 sm:flex-initial bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl flex items-center justify-center shadow-sm cursor-pointer transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4 mr-1.5" /> {t.addDefect}
          </button>
        </div>
      </div>

      {/* Main KPI widget */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4" id="defects-kpi-row">
        <div className="bg-rose-950/40 p-4 rounded-xl border border-rose-900/60 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider block">{t.defectRate} (JAMI)</span>
            <h3 className="text-xl sm:text-2xl font-black text-rose-300 mt-1">{totalDefectivePcs} {t.pcs}</h3>
          </div>
          <AlertTriangle className="w-8 h-8 text-rose-400 opacity-60" />
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between col-span-1 sm:col-span-2">
          <div className="space-y-1 w-full">
            <span className="text-[10px] text-slate-400 font-bold uppercase block">{t.defectByStage}</span>
            <div className="flex flex-wrap gap-2 pt-1">
              {['mato_shikasti', 'tikuv_xatosi', 'print_brak', 'olcham_farqi'].map(type => {
                const count = defects.filter(d => d.defectType === type).reduce((sum, d) => sum + d.quantity, 0);
                return (
                  <span key={type} className="text-[10px] font-semibold bg-slate-800 text-slate-300 px-2 py-1 rounded-md border border-slate-700">
                    {getDefectLabel(type)}: <strong className="text-white">{count}</strong>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Defects Table / Cards */}
      {viewMode === 'table' ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm" id="defects-table-container">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs text-slate-200">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400 select-none">
                  {(
                    [
                      { key: 'createdAt', label: lang === 'uz' ? 'Sana' : 'Дата', align: 'left' },
                      { key: 'orderNumber', label: lang === 'uz' ? 'Buyurtma' : 'Заказ', align: 'left' },
                      { key: 'defectType', label: t.defectType, align: 'left' },
                      { key: 'quantity', label: lang === 'uz' ? 'Miqdor' : 'Количество', align: 'right' },
                      { key: 'reporter', label: t.reporter, align: 'left' },
                      { key: 'actionTaken', label: t.actionTaken, align: 'left' }
                    ] as Array<{ key: DefectSortKey; label: string; align: 'left' | 'right' }>
                  ).map(col => {
                    const active = sortConfig.key === col.key;
                    return (
                      <th
                        key={col.key}
                        className={`p-3.5 cursor-pointer hover:text-white transition-colors whitespace-nowrap ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                        onClick={() => toggleSort(col.key)}
                        title={lang === 'uz' ? 'Saralash uchun bosing' : 'Нажмите для сортировки'}
                      >
                        <span
                          className={`inline-flex items-center gap-1.5 ${
                            col.align === 'right' ? 'flex-row-reverse' : ''
                          }`}
                        >
                          <span className={active ? 'text-white' : ''}>{col.label}</span>
                          {active ? (
                            sortConfig.dir === 'asc' ? (
                              <ArrowUp className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            ) : (
                              <ArrowDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-600 shrink-0" />
                          )}
                        </span>
                      </th>
                    );
                  })}
                  <th className="p-3.5 text-left">{lang === 'uz' ? 'Izoh' : 'Описание'}</th>
                  <th className="p-3.5 text-right">{lang === 'uz' ? 'Amallar' : 'Действия'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 tabular-nums">
                {sortedDefects.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-slate-400 font-semibold">
                      {t.noDefects}
                    </td>
                  </tr>
                ) : (
                  sortedDefects.map(def => (
                    <tr key={def.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="p-3.5 whitespace-nowrap font-mono text-slate-300">
                        {def.createdAt || '—'}
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        <div className="font-mono font-bold text-white">{def.orderNumber}</div>
                        <div className="text-[11px] text-slate-400">{def.productType}</div>
                      </td>
                      <td className="p-3.5 whitespace-nowrap text-rose-300 font-semibold">
                        {getDefectLabel(def.defectType)}
                      </td>
                      <td className="p-3.5 whitespace-nowrap text-right font-mono font-black text-rose-400">
                        {def.quantity.toLocaleString('ru-RU')} {t.pcs}
                      </td>
                      <td className="p-3.5 whitespace-nowrap text-slate-200 font-medium">
                        {def.reporter}
                      </td>
                      <td className="p-3.5 whitespace-nowrap text-emerald-300 font-semibold">
                        {getActionLabel(def.actionTaken)}
                      </td>
                      <td className="p-3.5 text-slate-300 max-w-xs truncate" title={def.description}>
                        {def.description || '—'}
                      </td>
                      <td className="p-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onRemoveDefect(def.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors cursor-pointer"
                          title={t.delete}
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4" id="defects-list">
          {sortedDefects.map(def => (
            <div key={def.id} className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-xl shadow-xs flex flex-col justify-between hover:border-slate-700 transition-colors">
              <div className="space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-mono text-slate-400 block">
                      {def.createdAt} · Buyurtma: {def.orderNumber}
                    </span>
                    <h4 className="text-xs font-bold text-slate-200">{def.productType}</h4>
                  </div>
                  <span className="text-[10px] font-bold bg-rose-950/70 text-rose-400 border border-rose-800/80 px-2.5 py-0.5 rounded-md uppercase">
                    {getDefectLabel(def.defectType)}
                  </span>
                </div>

                <p className="text-xs text-slate-300 font-medium italic">"{def.description}"</p>

                <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-slate-800">
                  <div>
                    <span className="text-slate-400 block">{t.reporter}</span>
                    <strong className="text-slate-200">{def.reporter}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">{t.actionTaken}</span>
                    <strong className="text-emerald-300 bg-emerald-950/60 border border-emerald-800 px-1.5 py-0.5 rounded">
                      {getActionLabel(def.actionTaken)}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 mt-4 border-t border-slate-800 text-xs">
                <span className="font-extrabold text-rose-400 font-mono tabular-nums">
                  {def.quantity} {t.pcs}
                </span>
                <button
                  onClick={() => onRemoveDefect(def.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors cursor-pointer"
                  title={t.delete}
                >
                  <Trash className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}

          {sortedDefects.length === 0 && (
            <div className="col-span-full bg-slate-900 p-8 text-center text-xs text-slate-400 border border-slate-800 border-dashed rounded-xl">
              {t.noDefects}
            </div>
          )}
        </div>
      )}

      {/* ==================================== MODAL: ADD DEFECT ==================================== */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto animate-fade-in">
          <div className="bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-800 text-slate-100" id="add-defect-modal">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white uppercase">{t.addDefect}</h3>
              <button onClick={() => setIsAddOpen(false)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 mt-4 text-xs">
              
              <div className="space-y-1">
                <label className="block font-bold text-slate-300">Buyurtmani tanlang *</label>
                <select 
                  value={selectedOrderId}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 text-white rounded-xl text-xs"
                >
                  {orders.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.orderNumber} - {o.customerName} ({o.productType})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block font-bold text-slate-300">{t.defectType}</label>
                  <select 
                    value={defectType}
                    onChange={(e: any) => setDefectType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 text-white rounded-xl text-xs"
                  >
                    <option value="mato_shikasti">{getDefectLabel('mato_shikasti')}</option>
                    <option value="tikuv_xatosi">{getDefectLabel('tikuv_xatosi')}</option>
                    <option value="olcham_farqi">{getDefectLabel('olcham_farqi')}</option>
                    <option value="print_brak">{getDefectLabel('print_brak')}</option>
                    <option value="boshqa">{getDefectLabel('boshqa')}</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block font-bold text-slate-300">Brak miqdori ({t.pcs}) *</label>
                  <input 
                    type="number"
                    min="1"
                    required
                    value={qty}
                    onChange={(e) => setQty(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 text-white rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block font-bold text-slate-300">{t.reporter} *</label>
                  <input 
                    type="text"
                    required
                    placeholder="Masalan: Malika T."
                    value={reporter}
                    onChange={(e) => setReporter(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 text-white rounded-xl text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-bold text-slate-300">{t.actionTaken}</label>
                  <select 
                    value={actionTaken}
                    onChange={(e) => setActionTaken(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 text-white rounded-xl text-xs"
                  >
                    <option value="tuzatildi">{getActionLabel('tuzatildi')}</option>
                    <option value="qayta_bichildi">{getActionLabel('qayta_bichildi')}</option>
                    <option value="utilizatsiya">{getActionLabel('utilizatsiya')}</option>
                    <option value="boshqa">{getActionLabel('boshqa')}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block font-bold text-slate-300">Tafsilotlar (Sarlavha/Izoh) *</label>
                <textarea 
                  required
                  rows={3}
                  placeholder="Muammoni batafsil izohlang..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 text-white rounded-xl text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button 
                  type="button" 
                  onClick={() => setIsAddOpen(false)}
                  className="px-3 py-2 border border-slate-700 text-slate-300 rounded-xl font-semibold"
                >
                  {t.cancel}
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl"
                >
                  {t.add}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
}
