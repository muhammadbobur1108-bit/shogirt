import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Calendar,
  ShoppingBag,
  FileSpreadsheet,
  Settings as SettingsIcon,
  ArrowRight,
  Sun,
  Megaphone,
  PartyPopper,
  QrCode,
  Printer,
  Layers,
  ShieldCheck,
  ClipboardCheck
} from 'lucide-react';
import { AppUser } from '../types';
import { Language } from '../locales';
import {
  HomeAnnouncementConfig,
  HOME_CONFIG_UPDATED_EVENT,
  loadHomeConfig
} from '../lib/homeStore';

interface HomeViewProps {
  currentUser?: AppUser | null;
  lang?: Language;
  onNavigateToTab: (tab: string) => void;
  canAccessSettings?: boolean;
  distinctOrdersCount?: number;
}

export default function HomeView({
  currentUser,
  lang = 'ru',
  onNavigateToTab,
  canAccessSettings = true,
  distinctOrdersCount = 0
}: HomeViewProps) {
  const [config, setConfig] = useState<HomeAnnouncementConfig>(() => loadHomeConfig());

  useEffect(() => {
    const sync = () => setConfig(loadHomeConfig());
    window.addEventListener(HOME_CONFIG_UPDATED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(HOME_CONFIG_UPDATED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const badgeMeta = (() => {
    if (config.badgeType === 'holiday') {
      return {
        label: lang === 'uz' ? 'YAQIN BAYRAM / TABRIK' : 'БЛИЖАЙШИЙ ПРАЗДНИК',
        icon: PartyPopper,
        cls: 'bg-amber-400 text-slate-950 border-amber-200'
      };
    }
    if (config.badgeType === 'event') {
      return {
        label: lang === 'uz' ? 'KORXONA TADBIRI' : 'МЕРОПРИЯТИЕ КОМПАНИИ',
        icon: Calendar,
        cls: 'bg-emerald-400 text-slate-950 border-emerald-200'
      };
    }
    return {
      label: lang === 'uz' ? "MUHIM E'LON" : 'ВАЖНОЕ ОБЪЯВЛЕНИЕ',
      icon: Megaphone,
      cls: 'bg-sky-400 text-slate-950 border-sky-200'
    };
  })();

  const BadgeIcon = badgeMeta.icon;
  const firstName = currentUser?.fullName?.split(' ')[0] || 'Коллега';

  return (
    <div className="relative min-h-[calc(100vh-7rem)] rounded-2xl">
      {/* Контент поверх глобального природного фона системы */}
      <div className="p-2 sm:p-4 lg:p-6 space-y-6 max-w-[1440px] mx-auto">
        {/* Верхнее приветствие */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-slate-950/70 backdrop-blur-md border border-white/15 text-slate-100 text-xs sm:text-sm font-semibold shadow-lg">
            <Sun className="w-4 h-4 text-amber-300 shrink-0" />
            <span>
              {lang === 'uz'
                ? `Xush kelibsiz, ${firstName}! Bugungi ish kuningiz barakali o'tsin.`
                : `Доброе утро, ${firstName}! Пусть рабочий день начнётся с хорошего настроения.`}
            </span>
          </div>
        </div>

        {/* ГЛАВНЫЙ КРУПНЫЙ БЛОК ОБЪЯВЛЕНИЯ / ПРАЗДНИКОВ / МЕРОПРИЯТИЙ */}
        {config.enabled && (
          <section className="rounded-3xl bg-slate-950/65 backdrop-blur-xl border-2 border-amber-300/40 p-6 sm:p-10 lg:p-12 shadow-[0_24px_60px_rgba(0,0,0,0.55)] space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs sm:text-sm font-black uppercase tracking-wider ${badgeMeta.cls}`}
                >
                  <BadgeIcon className="w-4 h-4 shrink-0" />
                  <span>{badgeMeta.label}</span>
                </span>
                {config.eventDate.trim() && (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white/10 border border-white/20 text-amber-200 text-xs sm:text-sm font-black uppercase tracking-wider">
                    <Calendar className="w-4 h-4 text-amber-300" />
                    <span>{config.eventDate}</span>
                  </span>
                )}
              </div>

              {canAccessSettings && (
                <button
                  type="button"
                  onClick={() => onNavigateToTab('settings')}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <SettingsIcon className="w-3.5 h-3.5 text-amber-300" />
                  <span>{lang === 'uz' ? "E'lon va fonni sozlash" : 'Объявление и фон в настройках'}</span>
                </button>
              )}
            </div>

            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black uppercase tracking-wide text-white leading-tight drop-shadow-md">
              {config.title}
            </h1>

            {config.message.trim() && (
              <p className="text-lg sm:text-2xl lg:text-3xl font-extrabold uppercase tracking-wide text-amber-100 leading-snug max-w-5xl">
                {config.message}
              </p>
            )}
          </section>
        )}

        {/* ИНФОРМАЦИЯ О СИСТЕМЕ ERP И БЫСТРЫЙ ПЕРЕХОД К РАБОТЕ */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-white drop-shadow-sm">
              <Sparkles className="w-5 h-5 text-sky-300" />
              <h2 className="text-lg sm:text-xl font-black tracking-tight">
                {lang === 'uz'
                  ? 'Chust Textile ERP — Ishlab chiqarish tizimi imkoniyatlari'
                  : 'О системе Chust Textile ERP — рабочие разделы'}
              </h2>
            </div>
            {!config.enabled && canAccessSettings && (
              <button
                type="button"
                onClick={() => onNavigateToTab('settings')}
                className="px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer"
              >
                <Megaphone className="w-4 h-4" />
                <span>{lang === 'uz' ? "E'lonni yoqish" : 'Включить объявление'}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Раздел 1: Заказы */}
            <div className="rounded-2xl bg-slate-950/75 backdrop-blur-md border border-white/15 p-5 flex flex-col justify-between gap-4 hover:border-amber-400/60 transition-colors shadow-xl">
              <div className="space-y-3">
                <div className="w-11 h-11 rounded-xl bg-amber-400/20 border border-amber-400/40 text-amber-300 flex items-center justify-center">
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-black text-white">{lang === 'uz' ? 'Zakazlar' : 'Заказы'}</h3>
                  {distinctOrdersCount > 0 && (
                    <span className="px-2 py-0.5 rounded-md bg-amber-400/20 border border-amber-400/40 text-amber-200 text-xs font-bold">
                      {distinctOrdersCount} шт.
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {lang === 'uz'
                    ? "Excel ko'rinishidagi qulay jadval orqali zakaz soni, o'lchamlar va bosqichlarni kiritish, import va eksport, bosmaga chiqarish."
                    : 'Удобная Excel-таблица для ввода заказов и размеров, импорт и выгрузка в Excel, контроль этапов и печать на A4 или термопринтер.'}
                </p>
                <ul className="space-y-1.5 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <span>{lang === 'uz' ? "Excel jadval ko'rinishida tezkor kiritish" : 'Быстрый ввод в таблице Excel и мониторинг'}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Printer className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <span>{lang === 'uz' ? 'Printerga bevosita chiqarish' : 'Печать напрямую на принтер устройства'}</span>
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={() => onNavigateToTab('buyurtmalar')}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <span>{lang === 'uz' ? "«Zakazlar» bo'limiga o'tish" : 'Открыть «Заказы»'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Раздел 2: Накладная */}
            <div className="rounded-2xl bg-slate-950/75 backdrop-blur-md border border-white/15 p-5 flex flex-col justify-between gap-4 hover:border-sky-400/60 transition-colors shadow-xl">
              <div className="space-y-3">
                <div className="w-11 h-11 rounded-xl bg-sky-500/20 border border-sky-400/40 text-sky-300 flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-black text-white">Накладная</h3>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {lang === 'uz'
                    ? "Qop va qutilar hisobi, har bir tara uchun QR-kod yaratish, kamera yoki 2D-skaner bilan yuklash va nakladnoy shakllantirish."
                    : 'Учёт мешков и коробок в упаковочном листе, генерация уникальных QR-кодов на каждую тару, сканирование и формирование накладных.'}
                </p>
                <ul className="space-y-1.5 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <QrCode className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                    <span>{lang === 'uz' ? 'A4 varaqda QR-yorliqlar va skaner' : 'QR-маркировка по 2 шт. на лист A4 и сканер отгрузки'}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                    <span>{lang === 'uz' ? "Brak farqi bo'lsa bosmani avtomatik bloklash" : 'Автоблокировка печати при расхождении брака'}</span>
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={() => onNavigateToTab('nakladnoy')}
                className="w-full py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <span>{lang === 'uz' ? "«Накладная» bo'limiga o'tish" : 'Открыть «Накладная»'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Раздел 2.5: Ombor ma'lumotlarini tekshirish */}
            <div className="rounded-2xl bg-slate-950/75 backdrop-blur-md border border-white/15 p-5 flex flex-col justify-between gap-4 hover:border-cyan-400/60 transition-colors shadow-xl">
              <div className="space-y-3">
                <div className="w-11 h-11 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 flex items-center justify-center">
                  <ClipboardCheck className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-black text-white">Ombor tekshiruvi</h3>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {lang === 'uz'
                    ? "Склад va Опции ma'lumotlarini solishtirish, kirill/probel/sana/qisqartma xatolarini avtomatik aniqlash va hisobot yuklash."
                    : 'Сверка данных склада и эталонов (Опции), выявление ошибок кириллицы, пробелов, дат и выгрузка отчётов в Excel и PDF.'}
                </p>
                <ul className="space-y-1.5 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                    <span>{lang === 'uz' ? "15 000+ qatorli tezkor jadval va Ctrl+V" : 'Таблица на 15 000+ строк и вставка Ctrl+V'}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                    <span>{lang === 'uz' ? "Инфо проверка va PDF/Excel eksport" : 'Сводка Инфо проверка и экспорт PDF/Excel'}</span>
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={() => onNavigateToTab('ombor_tekshiruvi')}
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <span>{lang === 'uz' ? "«Ombor tekshiruvi»ga o'tish" : 'Открыть «Ombor tekshiruvi»'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Раздел 3: Настройки и сотрудники */}
            <div className="rounded-2xl bg-slate-950/75 backdrop-blur-md border border-white/15 p-5 flex flex-col justify-between gap-4 hover:border-emerald-400/60 transition-colors shadow-xl">
              <div className="space-y-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 flex items-center justify-center">
                  <SettingsIcon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-black text-white">{lang === 'uz' ? 'Sozlamalar va xodimlar' : 'Настройки и персонал'}</h3>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {lang === 'uz'
                    ? "Bayram tabriklari, 4 fasl va vaqtga moslashuvchi tabiat manzaralari, ob-havo effektlari hamda xodimlar ruxsati."
                    : 'Публикация поздравлений, выбор 4 сезонов и пейзажей для всей системы с автосменой по времени, а также управление доступом.'}
                </p>
                <ul className="space-y-1.5 text-xs text-slate-300">
                  <li className="flex items-center gap-2">
                    <Megaphone className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                    <span>{lang === 'uz' ? "E'lonlar, 4 fasl va tizim manzaralari" : '4 сезона, природные пейзажи и погода системы'}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                    <span>{lang === 'uz' ? 'Zaxira eksport va kirish huquqlari' : 'Резервный экспорт базы данных и управление доступом'}</span>
                  </li>
                </ul>
              </div>
              {canAccessSettings ? (
                <button
                  type="button"
                  onClick={() => onNavigateToTab('settings')}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <span>{lang === 'uz' ? "«Sozlamalar» bo'limiga o'tish" : 'Открыть «Настройки»'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <div className="py-2.5 px-4 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-400 text-xs font-bold text-center">
                  {lang === 'uz' ? 'Faqat administrator uchun' : 'Доступно администратору системы'}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
