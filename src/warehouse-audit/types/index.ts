// Ombor ma'lumotlarini tekshirish moduli uchun barcha TypeScript turlari va konstantalari

export type AuditPageId = 'sklad' | 'optsii' | 'info' | 'tekshiruv';

export type ThemeMode = 'light' | 'dark';

export type CellStatus = 'ok' | 'error' | 'warning' | 'unvalidated';

export type RowStatus = 'ok' | 'error' | 'warning';

export type InfoSummaryStatus = 'ok' | 'error' | 'missing_in_warehouse' | 'incomplete_option';

/**
 * Склад jadvalining barcha 41 ta ustun kalitlari (ruscha asl nomlar saqlangan)
 */
export const SKLAD_COLUMNS = [
  'Выд',
  '№ тары',
  'Сорт',
  'Заказ',
  'Этикетка',
  'Модель',
  'Наименование',
  'Описание',
  'Группа',
  'Документ',
  'Цвет',
  '2XS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  '7XL',
  '8XL',
  '9XL',
  '10XL',
  '11XL',
  '12XL',
  'Всего',
  'Кол.кор.',
  'Фабрика',
  'Упаковка',
  'Куб.м.',
  'Цвет бирки',
  'Надпись',
  'Вес нетто',
  'Вес брутто',
  'Дата упак.',
  'Дата склад.',
  '№ отгруз.',
  'Примечание',
] as const;

export type SkladColumnKey = (typeof SKLAD_COLUMNS)[number];

/** Razmer ustunlari, Всего va sana ustunlari — faqat saqlanadi va ko'rsatiladi, tekshirilmaydi */
export const UNVALIDATED_SKLAD_COLUMNS = new Set<SkladColumnKey>([
  '2XS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  '4XL',
  '5XL',
  '6XL',
  '7XL',
  '8XL',
  '9XL',
  '10XL',
  '11XL',
  '12XL',
  'Всего',
  'Дата упак.',
  'Дата склад.',
]);

/** Опции jadvalining 14 ta ustun kalitlari */
export const OPTION_COLUMNS = [
  'Заказ',
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
] as const;

export type OptionColumnKey = (typeof OPTION_COLUMNS)[number];

/** Tekshiriladigan barcha Склад maydonlari (hisobot va batafsil natija uchun) */
export const VALIDATED_SKLAD_FIELDS: SkladColumnKey[] = [
  'Выд',
  'Сорт',
  'Заказ',
  'Модель',
  'Этикетка',
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

/** Boshlang'ich rang qisqartmalari ro'yxati */
export const DEFAULT_COLOR_ABBREVIATIONS: string[] = [
  'Blk',
  'Wht',
  'Gr',
  'Gy',
  'Lgy',
  'Dgy',
  'Dbl',
  'Bl',
  'Red',
  'Org',
  'Ylw',
  'Brw',
  'Brg',
  'Bg',
  'Lbg',
  'Kh',
  'Olv',
  'Prp',
  'El',
  'Mnt',
  'Trk',
  'Cof',
  'Ant',
];

/** Ruxsat etilgan Выд qiymatlari */
export const ALLOWED_VYD_VALUES = new Set(['', 'Да']);

/** Ruxsat etilgan Сорт qiymatlari */
export const ALLOWED_SORT_VALUES = new Set(['1-сорт', '2-сорт', '3-сорт']);

export interface SkladRow {
  id: string;
  updatedAt: number;
  Выд: string;
  '№ тары': string;
  Сорт: string;
  Заказ: string;
  Этикетка: string;
  Модель: string;
  Наименование: string;
  Описание: string;
  Группа: string;
  Документ: string;
  Цвет: string;
  '2XS': string;
  XS: string;
  S: string;
  M: string;
  L: string;
  XL: string;
  '2XL': string;
  '3XL': string;
  '4XL': string;
  '5XL': string;
  '6XL': string;
  '7XL': string;
  '8XL': string;
  '9XL': string;
  '10XL': string;
  '11XL': string;
  '12XL': string;
  Всего: string;
  'Кол.кор.': string;
  Фабрика: string;
  Упаковка: string;
  'Куб.м.': string;
  'Цвет бирки': string;
  Надпись: string;
  'Вес нетто': string;
  'Вес брутто': string;
  'Дата упак.': string;
  'Дата склад.': string;
  '№ отгруз.': string;
  Примечание: string;
}

export interface OptionRow {
  id: string;
  updatedAt: number;
  Заказ: string;
  Этикетка: string;
  Модель: string;
  Наименование: string;
  Описание: string;
  Группа: string;
  Документ: string;
  Цвет: string;
  'Кол.кор.': string;
  Фабрика: string;
  Упаковка: string;
  'Цвет бирки': string;
  Надпись: string;
  Примечание: string;
}

export interface FieldIssue {
  field: SkladColumnKey;
  level: 'error' | 'warning';
  message: string;
}

export interface RowValidationResult {
  rowId: string;
  normOrder: string;
  normModel: string;
  compositeKey: string;
  matchedOptionId: string | null;
  /** Zakaz Опцияда umuman topilmagan holat */
  isUnlinkedOrder: boolean;
  status: RowStatus;
  errorCount: number;
  warningCount: number;
  /** Har bir maydon uchun holat (katak rangi uchun) */
  fieldStatuses: Partial<Record<SkladColumnKey, CellStatus>>;
  /** Har bir maydon uchun barcha xato va ogohlantirish xabarlari */
  fieldMessages: Partial<Record<SkladColumnKey, string[]>>;
  errors: FieldIssue[];
  warnings: FieldIssue[];
  /** Barcha xato va ogohlantirishlar bitta matnda */
  combinedText: string;
}

export interface OptionRowValidationResult {
  optionId: string;
  normKey: string;
  isIncomplete: boolean;
  emptyFields: OptionColumnKey[];
  isDuplicate: boolean;
  fieldStatuses: Partial<Record<OptionColumnKey, CellStatus>>;
  fieldMessages: Partial<Record<OptionColumnKey, string[]>>;
  errors: string[];
  warnings: string[];
}

export interface InfoBoxErrorDetail {
  rowId: string;
  taraNo: string;
  order: string;
  model: string;
  field: SkladColumnKey;
  level: 'error' | 'warning';
  message: string;
}

export interface InfoSummaryRow {
  key: string;
  isUnmatchedSummary?: boolean;
  Заказ: string;
  Модель: string;
  Цвет: string;
  status: InfoSummaryStatus;
  boxCount: number;
  errorBoxCount: number;
  fieldErrorCounts: Partial<Record<SkladColumnKey, number>>;
  boxDetails: InfoBoxErrorDetail[];
}

export interface InfoReportResult {
  expectedDate: string;
  totalOrdersCount: number;
  totalBoxesCount: number;
  errorBoxesCount: number;
  unlinkedBoxesCount: number;
  errorOrderModelRowsCount: number;
  rows: InfoSummaryRow[];
}

export interface AuditSettings {
  expectedDate: string;
  colorAbbreviations: string[];
  theme: ThemeMode;
}

export interface AuditBackupPayload {
  version: number;
  exportedAt: string;
  settings: AuditSettings;
  options: OptionRow[];
  sklad: SkladRow[];
}
