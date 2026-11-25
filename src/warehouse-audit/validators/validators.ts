// Ombor ma'lumotlarini tekshirish uchun UI dan ajratilgan sof tekshiruv funksiyalari (Pure functions)

import {
  ALLOWED_SORT_VALUES,
  ALLOWED_VYD_VALUES,
  CellStatus,
  DEFAULT_COLOR_ABBREVIATIONS,
  FieldIssue,
  InfoBoxErrorDetail,
  InfoReportResult,
  InfoSummaryRow,
  OPTION_COLUMNS,
  OptionColumnKey,
  OptionRow,
  OptionRowValidationResult,
  RowStatus,
  RowValidationResult,
  SKLAD_COLUMNS,
  SkladColumnKey,
  SkladRow,
  VALIDATED_SKLAD_FIELDS,
} from '../types';

/** Maksimal katak uzunligi (xavfsizlik va unumdorlik uchun) */
export const MAX_TEXT_LENGTH = 500;
export const MAX_NOTE_LENGTH = 1500;

/** Kirill o'xshash harflarni lotin analogiga almashtirish xaritasi */
const CYRILLIC_LOOKALIKE_MAP: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  У: 'Y',
};

const CYRILLIC_CHAR_REGEX = /[\u0400-\u04FF]/;
const SPACE_CHAR_REGEX = /[\s\u00A0\u200B]/;

/** Qiymatni xavfsiz satrga aylantirish */
export function safeStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Sanani dd.mm.yyyy formatida qo'lda yig'ish (locale ga bog'liq emas)
 */
export function formatDateDdMmYyyy(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Standart kutilgan sana: bugundan bir kun oldingi sana (dd.mm.yyyy)
 */
export function getYesterdayDdMmYyyy(now: Date = new Date()): string {
  const copy = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return formatDateDdMmYyyy(copy);
}

/**
 * dd.mm.yyyy formatini tekshirish
 */
export function isValidDdMmYyyy(value: string): boolean {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(year, month - 1, day);
  return check.getFullYear() === year && check.getMonth() === month - 1 && check.getDate() === day;
}

/**
 * Turli sana kirishlarini (YYYY-MM-DD, DD/MM/YYYY, DDMMYYYY, Excel serial raqami) dd.mm.yyyy ga keltirish
 */
export function normalizeDateInput(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 90000) {
    // Excel 1900 serial sanasi
    const utcDays = Math.floor(raw - 25569);
    const utcMs = utcDays * 86400 * 1000;
    const d = new Date(utcMs);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getUTCFullYear());
    return `${dd}.${mm}.${yyyy}`;
  }
  const rawStr = safeStr(raw);
  // Boshida/oxirida probel bo'lsa — tekshiruv xatoni ushlashi uchun aslicha qoldiramiz
  if (rawStr !== rawStr.trim()) return rawStr;
  const str = rawStr;
  if (!str) return '';
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) return str;
  const ddmmyyyy = /^(\d{2})(\d{2})(\d{4})$/.exec(str);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]);
    const year = Number(ddmmyyyy[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      const check = new Date(year, month - 1, day);
      if (check.getFullYear() === year && check.getMonth() === month - 1 && check.getDate() === day) {
        return `${ddmmyyyy[1]}.${ddmmyyyy[2]}.${ddmmyyyy[3]}`;
      }
    }
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const slash = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(str);
  if (slash) {
    return `${slash[1].padStart(2, '0')}.${slash[2].padStart(2, '0')}.${slash[3]}`;
  }
  return rawStr;
}

/**
 * Normallashtirilgan kalit:
 * 1) Katta harfga o'tkazish
 * 2) Probellarni (NBSP ham) olib tashlash
 * 3) Kirill o'xshash harflarni (А В Е К М Н О Р С Т Х У) lotin analogiga almashtirish
 */
export function normalizeKey(value: unknown): string {
  const raw = safeStr(value)
    .replace(/[\s\u00A0\u200B]+/g, '')
    .toUpperCase();
  let result = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    result += CYRILLIC_LOOKALIKE_MAP[ch] ?? ch;
  }
  return result;
}

export function buildCompositeKey(order: unknown, model: unknown): string {
  return `${normalizeKey(order)}__${normalizeKey(model)}`;
}

/**
 * Matndagi barcha kirill harflarni (U+0400–U+04FF) va ularning 1-indeksli o'rinlarini topish
 */
export function findCyrillicChars(text: string): Array<{ char: string; pos: number }> {
  const found: Array<{ char: string; pos: number }> = [];
  for (let i = 0; i < text.length; i++) {
    if (CYRILLIC_CHAR_REGEX.test(text[i])) {
      found.push({ char: text[i], pos: i + 1 });
    }
  }
  return found;
}

/**
 * Matndagi probellarni (oddiy probel, NBSP, tab) va ularning 1-indeksli o'rinlarini topish
 */
export function findSpaces(text: string): number[] {
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (SPACE_CHAR_REGEX.test(text[i])) {
      positions.push(i + 1);
    }
  }
  return positions;
}

function formatCyrillicList(items: Array<{ char: string; pos: number }>): string {
  const shown = items.slice(0, 5).map(item => `«${item.char}» (${item.pos}-o'rin)`);
  if (items.length > 5) {
    shown.push(`yana ${items.length - 5} ta`);
  }
  return shown.join(', ');
}

function formatSpacePositions(positions: number[]): string {
  const shown = positions.slice(0, 5).map(p => `${p}-o'rin`);
  if (positions.length > 5) {
    shown.push(`yana ${positions.length - 5} ta`);
  }
  return shown.join(', ');
}

/** Rang qisqartmalari xaritasini (lowercase -> standart yozilish) tayyorlash */
export function buildColorAbbrMap(abbrList: string[] = DEFAULT_COLOR_ABBREVIATIONS): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of abbrList) {
    const clean = safeStr(item).trim();
    if (clean) {
      map.set(clean.toLowerCase(), clean);
    }
  }
  return map;
}

/**
 * Модель ichidagi rang qisqartmalarini nuqta bo'yicha bo'lib tekshirish
 * Masalan: WHT -> Wht; ro'yxatda yo'q bo'laklar e'tiborga olinmaydi
 */
export function findColorAbbrCaseMismatches(
  model: string,
  abbrMap: Map<string, string>
): Array<{ found: string; expected: string }> {
  if (!model) return [];
  const mismatches: Array<{ found: string; expected: string }> = [];
  const parts = model.split('.');
  for (const rawPart of parts) {
    const part = rawPart.replace(/[\s\u00A0]+/g, '');
    if (!part) continue;
    const expected = abbrMap.get(part.toLowerCase());
    if (expected && part !== expected) {
      mismatches.push({ found: part, expected });
    }
  }
  return mismatches;
}

/** Ruxsat etilgan variantlarni "|" (va Цвет uchun ",") bo'yicha ajratish */
function parseOptionCandidates(rawOptionValue: string, isColorField: boolean): {
  exactCandidates: string[];
  colorTokenPool: Set<string>;
} {
  const exactCandidates = rawOptionValue
    .split('|')
    .map(part => part.trim())
    .filter(Boolean);

  const colorTokenPool = new Set<string>();
  if (isColorField) {
    for (const cand of exactCandidates) {
      if (cand.includes(',')) {
        for (const piece of cand.split(',')) {
          const cleanPiece = piece.trim();
          if (cleanPiece) colorTokenPool.add(cleanPiece);
        }
      } else {
        colorTokenPool.add(cand);
      }
    }
  }

  return { exactCandidates, colorTokenPool };
}

/**
 * Haqiqiy qiymatni etalon nomzodlari bilan katta-kichik harfni hisobga olib solishtirish
 */
function compareWithEtalon(
  field: SkladColumnKey,
  actual: string,
  rawEtalon: string
): string | null {
  if (!rawEtalon || rawEtalon.trim() === '') {
    // Bo'sh etalon maydon tekshirilmaydi
    return null;
  }

  const isColor = field === 'Цвет';
  const isNadpis = field === 'Надпись';
  const { exactCandidates, colorTokenPool } = parseOptionCandidates(rawEtalon, isColor);

  if (exactCandidates.length === 0) return null;

  // 1. To'g'ridan-to'g'ri aniq moslik (katta-kichik harf va probelsiz)
  if (exactCandidates.includes(actual)) {
    return null;
  }

  // 2. Цвет uchun vergul orqali bitta yoki ko'p rangli aniq moslikni tekshirish
  if (isColor && !SPACE_CHAR_REGEX.test(actual[0] || '') && !SPACE_CHAR_REGEX.test(actual[actual.length - 1] || '')) {
    if (colorTokenPool.has(actual)) {
      return null;
    }
    if (actual.includes(',')) {
      const actualTokens = actual.split(',').map(s => s.trim());
      if (actualTokens.length > 0 && actualTokens.every(tok => tok.length > 0 && colorTokenPool.has(tok))) {
        // Verguldan keyin ortiqcha probel bormi tekshiramiz:
        // "Blk, Wht" yoki "Blk,Wht" ko'rinishlaridan etalon shaklga mos bo'lishi mumkin
        const hasDoubleSpaces = /\s{2,}/.test(actual);
        if (!hasDoubleSpaces) {
          return null;
        }
      }
    }
  }

  // Mos kelmadi -> eng yaqin nomzod bilan sababini aniqlaymiz
  const expectedDisplay = exactCandidates.join(' | ');
  const actualStripped = actual.replace(/[\s\u00A0\u200B]+/g, '');

  // A) Ortiqcha probel tekshiruvi
  for (const cand of exactCandidates) {
    const candStripped = cand.replace(/[\s\u00A0\u200B]+/g, '');
    if (actual.trim() === cand.trim() || (actualStripped === candStripped && actual !== cand)) {
      return `${field}: ortiqcha probel bor (kutilgan: «${cand}»)`;
    }
  }

  // B) Katta-kichik harf farqi
  for (const cand of exactCandidates) {
    if (actual.trim().toLowerCase() === cand.trim().toLowerCase()) {
      if (actual !== actual.trim()) {
        return `${field}: ortiqcha probel va katta-kichik harf farqi (kutilgan: «${cand}»)`;
      }
      return `${field}: katta-kichik harf farqi (kutilgan: «${cand}»)`;
    }
  }

  // C) Надпись uchun: faqat etalondan farq qilsa kirill harflarni ham ko'rsatish
  if (isNadpis) {
    const cyr = findCyrillicChars(actual);
    if (cyr.length > 0) {
      return `${field}: kirill harflar ${formatCyrillicList(cyr)}, etalondan farq (kutilgan: «${expectedDisplay}»)`;
    }
  }

  // D) Oddiy farq (bo'sh yoki boshqa qiymat)
  if (actual === '') {
    return `${field}: maydon bo'sh (kutilgan: «${expectedDisplay}»)`;
  }
  return `${field}: etalondan farq qiladi (kutilgan: «${expectedDisplay}»)`;
}

/** Опция qidiruv indekslari */
export interface OptionsLookupIndex {
  byOrderNorm: Map<string, OptionRow[]>;
  byCompositeKey: Map<string, OptionRow>;
}

export function buildOptionsIndex(options: OptionRow[]): OptionsLookupIndex {
  const byOrderNorm = new Map<string, OptionRow[]>();
  const byCompositeKey = new Map<string, OptionRow>();

  for (const opt of options) {
    const normOrd = normalizeKey(opt.Заказ);
    const normMod = normalizeKey(opt.Модель);
    if (!normOrd) continue;

    const list = byOrderNorm.get(normOrd);
    if (list) {
      list.push(opt);
    } else {
      byOrderNorm.set(normOrd, [opt]);
    }

    if (normMod) {
      const compKey = `${normOrd}__${normMod}`;
      if (!byCompositeKey.has(compKey)) {
        byCompositeKey.set(compKey, opt);
      }
    }
  }

  return { byOrderNorm, byCompositeKey };
}

/**
 * Bitta Опция qatorini o'z-o'zidan tekshirish
 */
export function validateOptionRow(
  opt: OptionRow,
  duplicateCounts: Map<string, number>,
  abbrMap: Map<string, string>
): OptionRowValidationResult {
  const fieldStatuses: Partial<Record<OptionColumnKey, CellStatus>> = {};
  const fieldMessages: Partial<Record<OptionColumnKey, string[]>> = {};
  const errors: string[] = [];
  const warnings: string[] = [];

  const pushIssue = (field: OptionColumnKey, level: 'error' | 'warning', msg: string) => {
    if (!fieldMessages[field]) fieldMessages[field] = [];
    fieldMessages[field]!.push(msg);
    if (level === 'error') {
      fieldStatuses[field] = 'error';
      errors.push(msg);
    } else {
      if (fieldStatuses[field] !== 'error') {
        fieldStatuses[field] = 'warning';
      }
      warnings.push(msg);
    }
  };

  const orderVal = safeStr(opt.Заказ);
  const modelVal = safeStr(opt.Модель);
  const normKey = buildCompositeKey(orderVal, modelVal);

  // Заказ tekshiruvi
  if (!orderVal.trim()) {
    pushIssue('Заказ', 'error', 'Заказ: bo\'sh bo\'lmasligi kerak');
  } else {
    const cyr = findCyrillicChars(orderVal);
    if (cyr.length > 0) {
      pushIssue('Заказ', 'error', `Заказ: kirill harf ${formatCyrillicList(cyr)}`);
    }
  }

  // Модель tekshiruvi
  if (!modelVal.trim()) {
    pushIssue('Модель', 'error', 'Модель: bo\'sh bo\'lmasligi kerak');
  } else {
    const cyr = findCyrillicChars(modelVal);
    if (cyr.length > 0) {
      pushIssue('Модель', 'error', `Модель: kirill harf ${formatCyrillicList(cyr)}`);
    }
    const spaces = findSpaces(modelVal);
    if (spaces.length > 0) {
      pushIssue('Модель', 'error', `Модель: probel bo'lmasligi kerak (${formatSpacePositions(spaces)})`);
    }
    const abbrMismatches = findColorAbbrCaseMismatches(modelVal, abbrMap);
    for (const m of abbrMismatches) {
      pushIssue('Модель', 'error', `Модель: rang qisqartmasi «${m.found}» → «${m.expected}»`);
    }
  }

  // Takroriy Заказ + Модель
  const isDuplicate = Boolean(orderVal.trim() && modelVal.trim() && (duplicateCounts.get(normKey) || 0) > 1);
  if (isDuplicate) {
    pushIssue('Заказ', 'error', 'Заказ + Модель: Опция jadvalida takrorlangan qator');
    pushIssue('Модель', 'error', 'Заказ + Модель: Опция jadvalida takrorlangan qator');
  }

  // Bo'sh etalon maydonlarni tekshirish ("Опция to'liq emas")
  const emptyFields: OptionColumnKey[] = [];
  for (const col of OPTION_COLUMNS) {
    const raw = safeStr(opt[col]);
    const maxLen = col === 'Примечание' ? MAX_NOTE_LENGTH : MAX_TEXT_LENGTH;
    if (raw.length > maxLen) {
      pushIssue(col, 'error', `${col}: matn juda uzun (maks. ${maxLen} belgi)`);
    }
    if (raw.trim() === '') {
      emptyFields.push(col);
      if (fieldStatuses[col] !== 'error') {
        fieldStatuses[col] = 'warning';
        if (!fieldMessages[col]) fieldMessages[col] = [];
        fieldMessages[col]!.push(`${col}: bo'sh etalon maydon (tekshirilmaydi)`);
      }
    } else if (!fieldStatuses[col]) {
      fieldStatuses[col] = 'ok';
    }
  }

  const isIncomplete = emptyFields.length > 0;
  if (isIncomplete) {
    warnings.push(`Опция to'liq emas (${emptyFields.length} ta bo'sh maydon: ${emptyFields.slice(0, 4).join(', ')}${emptyFields.length > 4 ? '...' : ''})`);
  }

  return {
    optionId: opt.id,
    normKey,
    isIncomplete,
    emptyFields,
    isDuplicate,
    fieldStatuses,
    fieldMessages,
    errors,
    warnings,
  };
}

/** Barcha Опция qatorlarini tekshirish */
export function validateAllOptions(
  options: OptionRow[],
  colorAbbreviations: string[] = DEFAULT_COLOR_ABBREVIATIONS
): Map<string, OptionRowValidationResult> {
  const abbrMap = buildColorAbbrMap(colorAbbreviations);
  const duplicateCounts = new Map<string, number>();

  for (const opt of options) {
    if (safeStr(opt.Заказ).trim() && safeStr(opt.Модель).trim()) {
      const k = buildCompositeKey(opt.Заказ, opt.Модель);
      duplicateCounts.set(k, (duplicateCounts.get(k) || 0) + 1);
    }
  }

  const result = new Map<string, OptionRowValidationResult>();
  for (const opt of options) {
    result.set(opt.id, validateOptionRow(opt, duplicateCounts, abbrMap));
  }
  return result;
}

const OPTION_COMPARED_FIELDS: SkladColumnKey[] = [
  'Этикетка',
  'Модель',
  'Наименование',
  'Описание',
  'Группа',
  'Документ',
  'Цвет',
  'Кол.кор.',
  'Фабрика',
  'Упаковка',
  'Цвет бирки',
  'Надпись',
  'Примечание',
];

export interface ValidateRowContext {
  optionsIndex: OptionsLookupIndex;
  expectedDate: string;
  abbrMap: Map<string, string>;
}

/**
 * Bitta Склад qatorini barcha qoidalar bo'yicha tekshirish (Pure function)
 */
export function validateSkladRow(row: SkladRow, ctx: ValidateRowContext): RowValidationResult {
  const fieldStatuses: Partial<Record<SkladColumnKey, CellStatus>> = {};
  const fieldMessages: Partial<Record<SkladColumnKey, string[]>> = {};
  const errors: FieldIssue[] = [];
  const warnings: FieldIssue[] = [];

  const addIssue = (field: SkladColumnKey, level: 'error' | 'warning', message: string) => {
    if (!fieldMessages[field]) fieldMessages[field] = [];
    if (!fieldMessages[field]!.includes(message)) {
      fieldMessages[field]!.push(message);
    }
    if (level === 'error') {
      fieldStatuses[field] = 'error';
      errors.push({ field, level, message });
    } else {
      if (fieldStatuses[field] !== 'error') {
        fieldStatuses[field] = 'warning';
      }
      warnings.push({ field, level, message });
    }
  };

  // Kirish uzunligini himoyalash
  for (const col of SKLAD_COLUMNS) {
    const val = safeStr(row[col]);
    const limit = col === 'Примечание' ? MAX_NOTE_LENGTH : MAX_TEXT_LENGTH;
    if (val.length > limit) {
      addIssue(col, 'error', `${col}: matn juda uzun (maks. ${limit} belgi)`);
    }
  }

  // 1. Выд: faqat "Да" yoki bo'sh
  const vydVal = safeStr(row.Выд);
  if (!ALLOWED_VYD_VALUES.has(vydVal)) {
    addIssue('Выд', 'error', `Выд: faqat «Да» yoki bo'sh bo'lishi kerak (topildi: «${vydVal}»)`);
  }

  // 2. Сорт: faqat "1-сорт", "2-сорт" yoki "3-сорт"
  const sortVal = safeStr(row.Сорт);
  if (!ALLOWED_SORT_VALUES.has(sortVal)) {
    addIssue(
      'Сорт',
      'error',
      sortVal.trim() === ''
        ? 'Сорт: faqat «1-сорт», «2-сорт» yoki «3-сорт» bo\'lishi kerak (bo\'sh)'
        : `Сорт: faqat «1-сорт», «2-сорт» yoki «3-сорт» bo'lishi kerak (topildi: «${sortVal}»)`
    );
  }

  // 3. Заказ: kirill harf va bo'shlik tekshiruvi
  const orderVal = safeStr(row.Заказ);
  if (orderVal.trim() === '') {
    addIssue('Заказ', 'error', 'Заказ: maydon bo\'sh bo\'lmasligi kerak');
  } else {
    const orderCyr = findCyrillicChars(orderVal);
    if (orderCyr.length > 0) {
      addIssue('Заказ', 'error', `Заказ: kirill harf ${formatCyrillicList(orderCyr)}`);
    }
  }

  // 4. Модель: kirill harf, probel va rang qisqartmasi tekshiruvi
  const modelVal = safeStr(row.Модель);
  if (modelVal.trim() === '') {
    addIssue('Модель', 'error', 'Модель: maydon bo\'sh bo\'lmasligi kerak');
  } else {
    const modelCyr = findCyrillicChars(modelVal);
    if (modelCyr.length > 0) {
      addIssue('Модель', 'error', `Модель: kirill harf ${formatCyrillicList(modelCyr)}`);
    }
    const modelSpaces = findSpaces(modelVal);
    if (modelSpaces.length > 0) {
      addIssue('Модель', 'error', `Модель: probel bo'lmasin (${formatSpacePositions(modelSpaces)})`);
    }
    const abbrMismatches = findColorAbbrCaseMismatches(modelVal, ctx.abbrMap);
    for (const m of abbrMismatches) {
      addIssue('Модель', 'error', `Модель: rang qisqartmasi «${m.found}» → «${m.expected}»`);
    }
  }

  // 5. Normallashtirilgan kalit orqali Опция ga bog'lash
  const normOrder = normalizeKey(orderVal);
  const normModel = normalizeKey(modelVal);
  const compositeKey = `${normOrder}__${normModel}`;

  let matchedOptionId: string | null = null;
  let isUnlinkedOrder = false;

  if (normOrder) {
    const orderExistsInOptions = ctx.optionsIndex.byOrderNorm.has(normOrder);
    if (!orderExistsInOptions) {
      // Zakaz Опцияда umuman yo'q -> xato emas, sariq ogohlantirish
      isUnlinkedOrder = true;
      addIssue('Заказ', 'warning', 'Заказ: Опцияда topilmadi (etalon bo\'yicha tekshirib bo\'lmadi)');
    } else {
      const matchedOpt = ctx.optionsIndex.byCompositeKey.get(compositeKey);
      if (!matchedOpt) {
        // Zakaz bor, lekin Модель shu zakaz uchun yo'q -> Модель da xato
        if (normModel) {
          addIssue('Модель', 'error', `Модель: «${orderVal.trim()}» zakazi uchun Опцияда topilmadi`);
        }
      } else {
        matchedOptionId = matchedOpt.id;

        // Заказ da probel/case farqi bo'lsa ham aniqlaymiz
        const optOrderCandidates = safeStr(matchedOpt.Заказ)
          .split('|')
          .map(s => s.trim())
          .filter(Boolean);
        if (optOrderCandidates.length > 0 && !optOrderCandidates.includes(orderVal)) {
          const onlySpaceDiff = optOrderCandidates.some(
            c => c.replace(/[\s\u00A0]+/g, '') === orderVal.replace(/[\s\u00A0]+/g, '')
          );
          const onlyCaseDiff = optOrderCandidates.some(c => c.trim().toLowerCase() === orderVal.trim().toLowerCase());
          if (onlySpaceDiff) {
            addIssue('Заказ', 'error', `Заказ: ortiqcha probel (kutilgan: «${optOrderCandidates[0]}»)`);
          } else if (onlyCaseDiff && findCyrillicChars(orderVal).length === 0) {
            addIssue('Заказ', 'error', `Заказ: katta-kichik harf farqi (kutilgan: «${optOrderCandidates[0]}»)`);
          }
        }

        // Barcha 13 ta etalon maydonni solishtirish
        for (const field of OPTION_COMPARED_FIELDS) {
          const optFieldKey = field as OptionColumnKey;
          const etalonVal = safeStr(matchedOpt[optFieldKey]);
          if (etalonVal.trim() === '') {
            // Bo'sh etalon maydon tekshirilmaydi
            continue;
          }
          const actualVal = safeStr(row[field]);

          // Agar Модель maydonida allaqachon kirill yoki probel bo'lsa va etalondan faqat shular bilan farq qilsa,
          // etalon farq xabarini faqat boshqa farq bo'lganda qo'shamiz (dublikat bo'lmasligi uchun)
          if (field === 'Модель') {
            const hasModelStructureIssue =
              findCyrillicChars(actualVal).length > 0 || findSpaces(actualVal).length > 0;
            if (hasModelStructureIssue) {
              continue;
            }
          }

          const diffMsg = compareWithEtalon(field, actualVal, etalonVal);
          if (diffMsg) {
            addIssue(field, 'error', diffMsg);
          }
        }
      }
    }
  }

  // Qolgan tekshirilgan maydonlarga 'ok' statusini qo'yish
  for (const field of VALIDATED_SKLAD_FIELDS) {
    if (!fieldStatuses[field]) {
      fieldStatuses[field] = 'ok';
    }
  }

  const status: RowStatus =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok';

  const combinedParts = [
    ...errors.map(e => e.message),
    ...warnings.map(w => `[Ogohlantirish] ${w.message}`),
  ];

  return {
    rowId: row.id,
    normOrder,
    normModel,
    compositeKey,
    matchedOptionId,
    isUnlinkedOrder,
    status,
    errorCount: errors.length,
    warningCount: warnings.length,
    fieldStatuses,
    fieldMessages,
    errors,
    warnings,
    combinedText: combinedParts.join('; '),
  };
}

/** Qator uchun tezkor xesh (memoizatsiya keshlash uchun) */
export function computeSkladRowHash(row: SkladRow): string {
  return [
    row.updatedAt,
    row.Выд,
    row['№ тары'],
    row.Сорт,
    row.Заказ,
    row.Этикетка,
    row.Модель,
    row.Наименование,
    row.Описание,
    row.Группа,
    row.Документ,
    row.Цвет,
    row['Кол.кор.'],
    row.Фабрика,
    row.Упаковка,
    row['Цвет бирки'],
    row.Надпись,
    row['Дата упак.'],
    row['Дата склад.'],
    row.Примечание,
  ].join('\u0001');
}

export interface IncrementalValidationCache {
  contextSignature: string;
  rowCache: Map<string, { hash: string; result: RowValidationResult }>;
}

export function createValidationCache(): IncrementalValidationCache {
  return {
    contextSignature: '',
    rowCache: new Map(),
  };
}

/**
 * Faqat o'zgargan qatorlarni qayta hisoblaydigan tezkor batch tekshiruv (15 000 qator uchun)
 */
export function validateSkladBatchIncremental(
  skladRows: SkladRow[],
  options: OptionRow[],
  expectedDate: string,
  colorAbbreviations: string[] = DEFAULT_COLOR_ABBREVIATIONS,
  cache?: IncrementalValidationCache
): Map<string, RowValidationResult> {
  const abbrKey = colorAbbreviations.join('|');
  const optionsSig = options
    .map(o => `${o.id}:${o.updatedAt}:${o.Заказ}:${o.Модель}:${o.Цвет}`)
    .join(';');
  const contextSignature = `${expectedDate}##${abbrKey}##${optionsSig}`;

  const optionsIndex = buildOptionsIndex(options);
  const abbrMap = buildColorAbbrMap(colorAbbreviations);
  const ctx: ValidateRowContext = {
    optionsIndex,
    expectedDate,
    abbrMap,
  };

  if (cache && cache.contextSignature !== contextSignature) {
    cache.rowCache.clear();
    cache.contextSignature = contextSignature;
  }

  const results = new Map<string, RowValidationResult>();
  const activeIds = new Set<string>();

  for (const row of skladRows) {
    activeIds.add(row.id);
    const hash = computeSkladRowHash(row);
    const cached = cache?.rowCache.get(row.id);
    if (cached && cached.hash === hash) {
      results.set(row.id, cached.result);
    } else {
      const res = validateSkladRow(row, ctx);
      results.set(row.id, res);
      if (cache) {
        cache.rowCache.set(row.id, { hash, result: res });
      }
    }
  }

  if (cache) {
    for (const id of cache.rowCache.keys()) {
      if (!activeIds.has(id)) {
        cache.rowCache.delete(id);
      }
    }
  }

  return results;
}

/**
 * «Инфо проверка» hisobotini yig'ish:
 * - Birinchi qator: "Опцияда topilmagan zakazlar"
 * - Har bir Опция (Заказ + Модель) qatori bo'yicha qutilar, xatolar va maydon kesimida hisob
 * - Omborda bor lekin Zakaz bor-u Модель topilmagan qatorlar ham hisobotda ko'rinadi
 */
export function buildInfoCheckReport(
  skladRows: SkladRow[],
  options: OptionRow[],
  validations: Map<string, RowValidationResult>,
  optionValidations: Map<string, OptionRowValidationResult>,
  expectedDate: string
): InfoReportResult {
  const uniqueOrdersSet = new Set<string>();
  let totalBoxesCount = skladRows.length;
  let errorBoxesCount = 0;
  let unlinkedBoxesCount = 0;

  const unmatchedDetails: InfoBoxErrorDetail[] = [];
  const unmatchedFieldCounts: Partial<Record<SkladColumnKey, number>> = {};
  let unmatchedBoxesCount = 0;
  let unmatchedErrorBoxesCount = 0;
  const unmatchedOrderNames = new Set<string>();

  // Опция ID bo'yicha Склад qatorlarini guruhlash
  const boxesByOptionId = new Map<string, SkladRow[]>();
  // Zakaz bor, lekin Модель topilmagan guruhlar (compositeKey -> SkladRow[])
  const missingModelGroups = new Map<string, SkladRow[]>();

  for (const row of skladRows) {
    const val = validations.get(row.id);
    const normOrd = val?.normOrder || normalizeKey(row.Заказ);
    if (normOrd) uniqueOrdersSet.add(normOrd);

    if (val) {
      if (val.errorCount > 0) errorBoxesCount++;
      if (val.isUnlinkedOrder) unlinkedBoxesCount++;
    }

    if (val?.isUnlinkedOrder) {
      unmatchedBoxesCount++;
      if (safeStr(row.Заказ).trim()) unmatchedOrderNames.add(safeStr(row.Заказ).trim());
      if (val.errorCount > 0) unmatchedErrorBoxesCount++;

      // Barcha ogohlantirish va xatolarni yig'amiz
      for (const issue of [...val.errors, ...val.warnings]) {
        if (issue.level === 'error') {
          unmatchedFieldCounts[issue.field] = (unmatchedFieldCounts[issue.field] || 0) + 1;
        }
        unmatchedDetails.push({
          rowId: row.id,
          taraNo: safeStr(row['№ тары']),
          order: safeStr(row.Заказ),
          model: safeStr(row.Модель),
          field: issue.field,
          level: issue.level,
          message: issue.message,
        });
      }
    } else if (val?.matchedOptionId) {
      const list = boxesByOptionId.get(val.matchedOptionId);
      if (list) list.push(row);
      else boxesByOptionId.set(val.matchedOptionId, [row]);
    } else {
      // Zakaz bor lekin model Опцияда yo'q yoki Заказ bo'sh
      const gk = val?.compositeKey || `${normOrd}__${normalizeKey(row.Модель)}`;
      const list = missingModelGroups.get(gk);
      if (list) list.push(row);
      else missingModelGroups.set(gk, [row]);
    }
  }

  // 1-qator: "Опцияда topilmagan zakazlar"
  const unlinkedSummaryRow: InfoSummaryRow = {
    key: '__unmatched_orders__',
    isUnmatchedSummary: true,
    Заказ: 'Опцияда topilmagan zakazlar',
    Модель: unmatchedOrderNames.size > 0 ? Array.from(unmatchedOrderNames).slice(0, 5).join(', ') + (unmatchedOrderNames.size > 5 ? '...' : '') : '—',
    Цвет: '—',
    status: unmatchedBoxesCount > 0 ? (unmatchedErrorBoxesCount > 0 ? 'error' : 'incomplete_option') : 'ok',
    boxCount: unmatchedBoxesCount,
    errorBoxCount: unmatchedErrorBoxesCount,
    fieldErrorCounts: unmatchedFieldCounts,
    boxDetails: unmatchedDetails,
  };

  const summaryRows: InfoSummaryRow[] = [unlinkedSummaryRow];

  // Har bir Опция qatori bo'yicha hisobot qatori
  for (const opt of options) {
    const normOrd = normalizeKey(opt.Заказ);
    if (normOrd) uniqueOrdersSet.add(normOrd);

    const optBoxes = boxesByOptionId.get(opt.id) || [];
    const optVal = optionValidations.get(opt.id);
    const fieldErrorCounts: Partial<Record<SkladColumnKey, number>> = {};
    const boxDetails: InfoBoxErrorDetail[] = [];
    let groupErrorBoxCount = 0;

    for (const box of optBoxes) {
      const val = validations.get(box.id);
      if (!val) continue;
      if (val.errorCount > 0) {
        groupErrorBoxCount++;
      }
      for (const err of val.errors) {
        fieldErrorCounts[err.field] = (fieldErrorCounts[err.field] || 0) + 1;
        boxDetails.push({
          rowId: box.id,
          taraNo: safeStr(box['№ тары']),
          order: safeStr(box.Заказ),
          model: safeStr(box.Модель),
          field: err.field,
          level: 'error',
          message: err.message,
        });
      }
    }

    let status: InfoSummaryRow['status'] = 'ok';
    if (groupErrorBoxCount > 0 || (optVal?.errors.length || 0) > 0) {
      status = 'error';
    } else if (optBoxes.length === 0) {
      status = 'missing_in_warehouse';
    } else if (optVal?.isIncomplete) {
      status = 'incomplete_option';
    }

    summaryRows.push({
      key: opt.id,
      Заказ: safeStr(opt.Заказ),
      Модель: safeStr(opt.Модель),
      Цвет: safeStr(opt.Цвет),
      status,
      boxCount: optBoxes.length,
      errorBoxCount: groupErrorBoxCount,
      fieldErrorCounts,
      boxDetails,
    });
  }

  // Zakaz Опцияда bor, lekin Модель yo'q bo'lgan ombor guruhlarini ham qo'shamiz
  for (const [gk, boxes] of missingModelGroups.entries()) {
    const first = boxes[0];
    const fieldErrorCounts: Partial<Record<SkladColumnKey, number>> = {};
    const boxDetails: InfoBoxErrorDetail[] = [];
    let groupErrorBoxCount = 0;

    for (const box of boxes) {
      const val = validations.get(box.id);
      if (!val) continue;
      if (val.errorCount > 0) groupErrorBoxCount++;
      for (const err of val.errors) {
        fieldErrorCounts[err.field] = (fieldErrorCounts[err.field] || 0) + 1;
        boxDetails.push({
          rowId: box.id,
          taraNo: safeStr(box['№ тары']),
          order: safeStr(box.Заказ),
          model: safeStr(box.Модель),
          field: err.field,
          level: 'error',
          message: err.message,
        });
      }
    }

    summaryRows.push({
      key: `missing-model-${gk}`,
      Заказ: safeStr(first.Заказ) || '(Bo\'sh)',
      Модель: safeStr(first.Модель) || '(Bo\'sh)',
      Цвет: safeStr(first.Цвет) || '—',
      status: 'error',
      boxCount: boxes.length,
      errorBoxCount: groupErrorBoxCount,
      fieldErrorCounts,
      boxDetails,
    });
  }

  const errorOrderModelRowsCount = summaryRows.filter(r => r.status === 'error').length;

  return {
    expectedDate,
    totalOrdersCount: uniqueOrdersSet.size,
    totalBoxesCount,
    errorBoxesCount,
    unlinkedBoxesCount,
    errorOrderModelRowsCount,
    rows: summaryRows,
  };
}

/**
 * Склад ma'lumotidan unikal Заказ+Модель bo'yicha Опция qoralama qatorlarini yaratish
 */
export function buildDraftOptionsFromSklad(
  skladRows: SkladRow[],
  existingOptions: OptionRow[]
): OptionRow[] {
  const existingKeys = new Set(
    existingOptions.map(o => buildCompositeKey(o.Заказ, o.Модель))
  );
  const grouped = new Map<string, SkladRow[]>();

  for (const row of skladRows) {
    const order = safeStr(row.Заказ).trim();
    const model = safeStr(row.Модель).trim();
    if (!order || !model) continue;
    const key = buildCompositeKey(order, model);
    if (existingKeys.has(key)) continue;

    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  }

  const drafts: OptionRow[] = [];
  let idx = 0;

  for (const [, rows] of grouped.entries()) {
    const collectUnique = (field: OptionColumnKey): string => {
      const vals = new Set<string>();
      for (const r of rows) {
        const v = safeStr(r[field as SkladColumnKey]).trim();
        if (v) vals.add(v);
      }
      return Array.from(vals).join(' | ');
    };

    const first = rows[0];
    drafts.push({
      id: `opt-draft-${Date.now()}-${idx++}`,
      updatedAt: Date.now(),
      Заказ: safeStr(first.Заказ).trim(),
      Этикетка: collectUnique('Этикетка'),
      Модель: safeStr(first.Модель).trim(),
      Наименование: collectUnique('Наименование'),
      Описание: collectUnique('Описание'),
      Группа: collectUnique('Группа'),
      Документ: collectUnique('Документ'),
      Цвет: collectUnique('Цвет'),
      'Кол.кор.': collectUnique('Кол.кор.'),
      Фабрика: collectUnique('Фабрика'),
      Упаковка: collectUnique('Упаковка'),
      'Цвет бирки': collectUnique('Цвет бирки'),
      Надпись: collectUnique('Надпись'),
      Примечание: collectUnique('Примечание'),
    });
  }

  return drafts;
}

/** Bo'sh Склад qatori yaratish */
export function createEmptySkladRow(partial?: Partial<SkladRow>, defaultDate = ''): SkladRow {
  const now = Date.now();
  return {
    id: partial?.id || `skl-${now}-${Math.random().toString(36).slice(2, 7)}`,
    updatedAt: now,
    Выд: '',
    '№ тары': '',
    Сорт: '1-сорт',
    Заказ: '',
    Этикетка: '',
    Модель: '',
    Наименование: '',
    Описание: '',
    Группа: '',
    Документ: '',
    Цвет: '',
    '2XS': '',
    XS: '',
    S: '',
    M: '',
    L: '',
    XL: '',
    '2XL': '',
    '3XL': '',
    '4XL': '',
    '5XL': '',
    '6XL': '',
    '7XL': '',
    '8XL': '',
    '9XL': '',
    '10XL': '',
    '11XL': '',
    '12XL': '',
    Всего: '',
    'Кол.кор.': '',
    Фабрика: '',
    Упаковка: '',
    'Куб.м.': '',
    'Цвет бирки': '',
    Надпись: '',
    'Вес нетто': '',
    'Вес брутто': '',
    'Дата упак.': defaultDate,
    'Дата склад.': defaultDate,
    '№ отгруз.': '',
    Примечание: '',
    ...partial,
  };
}

/** Bo'sh Опция qatori yaratish */
export function createEmptyOptionRow(partial?: Partial<OptionRow>): OptionRow {
  const now = Date.now();
  return {
    id: partial?.id || `opt-${now}-${Math.random().toString(36).slice(2, 7)}`,
    updatedAt: now,
    Заказ: '',
    Этикетка: '',
    Модель: '',
    Наименование: '',
    Описание: '',
    Группа: '',
    Документ: '',
    Цвет: '',
    'Кол.кор.': '',
    Фабрика: '',
    Упаковка: '',
    'Цвет бирки': '',
    Надпись: '',
    Примечание: '',
    ...partial,
  };
}
