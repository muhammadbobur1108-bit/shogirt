import { describe, it, expect } from 'vitest';
import {
  buildColorAbbrMap,
  buildInfoCheckReport,
  buildOptionsIndex,
  createEmptyOptionRow,
  createEmptySkladRow,
  formatDateDdMmYyyy,
  getYesterdayDdMmYyyy,
  normalizeKey,
  validateAllOptions,
  validateSkladBatchIncremental,
  validateSkladRow,
  createValidationCache,
} from './validators';
import { DEFAULT_COLOR_ABBREVIATIONS, OptionRow, SkladRow } from '../types';

function makeValidOption(overrides: Partial<OptionRow> = {}): OptionRow {
  return createEmptyOptionRow({
    id: 'opt-1',
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
    ...overrides,
  });
}

function makeValidSklad(expectedDate: string, overrides: Partial<SkladRow> = {}): SkladRow {
  return createEmptySkladRow(
    {
      id: 'skl-1',
      Выд: 'Да',
      '№ тары': '1',
      Сорт: '1-сорт',
      Заказ: 'MOS-2610.01',
      Этикетка: 'LC Waikiki',
      Модель: 'FN-OW.Blk',
      Наименование: 'Футболка мужская',
      Описание: 'Кулирка 100% хлопок',
      Группа: 'Мужская',
      Документ: 'Д-101',
      Цвет: 'Черный',
      'Кол.кор.': '40',
      Фабрика: 'Chust',
      Упаковка: 'Пакет',
      'Цвет бирки': 'Белый',
      Надпись: 'Made in Uzbekistan',
      'Дата упак.': expectedDate,
      'Дата склад.': expectedDate,
      Примечание: 'Основной',
      ...overrides,
    },
    expectedDate
  );
}

describe('validators.ts — Ombor ma’lumotlarini tekshirish qoidalari', () => {
  const EXPECTED_DATE = '20.11.2026';

  it("to'g'ri to'ldirilgan Склад qatorida xato va ogohlantirish chiqmasligi kerak", () => {
    const opt = makeValidOption();
    const row = makeValidSklad(EXPECTED_DATE, {
      // Razmerlar va Всего tekshirilmasligi kerak
      '2XS': 'abc',
      XS: '10',
      Всего: '99999',
    });
    const res = validateSkladRow(row, {
      optionsIndex: buildOptionsIndex([opt]),
      expectedDate: EXPECTED_DATE,
      abbrMap: buildColorAbbrMap(DEFAULT_COLOR_ABBREVIATIONS),
    });

    expect(res.status).toBe('ok');
    expect(res.errorCount).toBe(0);
    expect(res.warningCount).toBe(0);
    expect(res.matchedOptionId).toBe(opt.id);
  });

  it("kirill harf xatosini (Заказ va Модель da) o'rni bilan aniqlashi va shunga qaramay Опция ga bog'lay olishi kerak", () => {
    const opt = makeValidOption();
    // Заказ da lotin 'O' o'rniga kirill 'О' (5-o'rin? "MОS-2610.01" -> 'О' 2-o'rin)
    // Модель da lotin 'F' va 'O' o'rniga kirill 'О' ("FN-ОW.Blk" -> 4-o'rin)
    const row = makeValidSklad(EXPECTED_DATE, {
      Заказ: 'MОS-2610.01',
      Модель: 'FN-ОW.Blk',
    });

    expect(normalizeKey(row.Заказ)).toBe('MOS-2610.01');
    expect(normalizeKey(row.Модель)).toBe('FN-OW.BLK');

    const res = validateSkladRow(row, {
      optionsIndex: buildOptionsIndex([opt]),
      expectedDate: EXPECTED_DATE,
      abbrMap: buildColorAbbrMap(DEFAULT_COLOR_ABBREVIATIONS),
    });

    // Baribir Опция ga bog'lanadi!
    expect(res.matchedOptionId).toBe(opt.id);
    expect(res.isUnlinkedOrder).toBe(false);
    expect(res.fieldStatuses.Заказ).toBe('error');
    expect(res.fieldStatuses.Модель).toBe('error');
    expect(res.fieldMessages.Заказ?.[0]).toContain('«О» (2-o\'rin)');
    expect(res.fieldMessages.Модель?.[0]).toContain('«О» (4-o\'rin)');
  });

  it("Модель da rang qisqartmasi katta-kichik harfini (WHT -> Wht) tekshirishi va ro'yxatda yo'q bo'laklarni e'tiborga olmasligi kerak", () => {
    const opt = makeValidOption({ Модель: 'FN-OW.Wht.CUSTOM12' });
    const row = makeValidSklad(EXPECTED_DATE, {
      Модель: 'FN-OW.WHT.CUSTOM12',
    });

    const res = validateSkladRow(row, {
      optionsIndex: buildOptionsIndex([opt]),
      expectedDate: EXPECTED_DATE,
      abbrMap: buildColorAbbrMap(DEFAULT_COLOR_ABBREVIATIONS),
    });

    expect(res.fieldStatuses.Модель).toBe('error');
    expect(res.fieldMessages.Модель?.some(m => m.includes('«WHT» → «Wht»'))).toBe(true);
    // CUSTOM12 ro'yxatda yo'q, shuning uchun rang qisqartmasi tekshiruvida e'tiborga olinmaydi
    expect(res.fieldMessages.Модель?.some(m => m.includes('rang qisqartmasi') && m.includes('CUSTOM12'))).toBe(false);
  });

  it("Модель da probel (oddiy va NBSP) bo'lsa aniq o'rni bilan xato berishi kerak", () => {
    const opt = makeValidOption({ Модель: 'FN-OW.Blk' });
    const row = makeValidSklad(EXPECTED_DATE, {
      Модель: 'FN-OW.\u00A0Blk',
    });

    const res = validateSkladRow(row, {
      optionsIndex: buildOptionsIndex([opt]),
      expectedDate: EXPECTED_DATE,
      abbrMap: buildColorAbbrMap(DEFAULT_COLOR_ABBREVIATIONS),
    });

    expect(res.matchedOptionId).toBe(opt.id);
    expect(res.fieldStatuses.Модель).toBe('error');
    expect(res.fieldMessages.Модель?.some(m => m.includes("probel") && m.includes("7-o'rin"))).toBe(true);
  });

  it("sana ustunlari (Дата упак. va Дата склад.) tekshirilmasligi, bo'sh yoki boshqa sana bo'lsa ham xato bermasligi kerak", () => {
    const opt = makeValidOption();
    const row = makeValidSklad(EXPECTED_DATE, {
      'Дата упак.': '19.11.2026',
      'Дата склад.': '',
    });

    const res = validateSkladRow(row, {
      optionsIndex: buildOptionsIndex([opt]),
      expectedDate: EXPECTED_DATE,
      abbrMap: buildColorAbbrMap(DEFAULT_COLOR_ABBREVIATIONS),
    });

    expect(res.status).toBe('ok');
    expect(res.errorCount).toBe(0);
    expect(res.fieldStatuses['Дата упак.']).toBeUndefined();
    expect(res.fieldStatuses['Дата склад.']).toBeUndefined();

    // Sanani qo'lda formatlash funksiyasini ham tekshiramiz
    expect(formatDateDdMmYyyy(new Date(2026, 10, 21))).toBe('21.11.2026');
    expect(getYesterdayDdMmYyyy(new Date(2026, 10, 21))).toBe('20.11.2026');
  });

  it("Сорт va Выд noto'g'ri qiymatlarini ushlashi kerak", () => {
    const opt = makeValidOption();
    const rowBad = makeValidSklad(EXPECTED_DATE, {
      Выд: 'Нет',
      Сорт: '4-сорт',
    });

    const resBad = validateSkladRow(rowBad, {
      optionsIndex: buildOptionsIndex([opt]),
      expectedDate: EXPECTED_DATE,
      abbrMap: buildColorAbbrMap(DEFAULT_COLOR_ABBREVIATIONS),
    });

    expect(resBad.fieldStatuses.Выд).toBe('error');
    expect(resBad.fieldStatuses.Сорт).toBe('error');

    // Bo'sh Выд va 2-сорт/3-сорт ruxsat etiladi
    const rowOk = makeValidSklad(EXPECTED_DATE, {
      Выд: '',
      Сорт: '3-сорт',
    });
    const resOk = validateSkladRow(rowOk, {
      optionsIndex: buildOptionsIndex([opt]),
      expectedDate: EXPECTED_DATE,
      abbrMap: buildColorAbbrMap(DEFAULT_COLOR_ABBREVIATIONS),
    });
    expect(resOk.fieldStatuses.Выд).toBe('ok');
    expect(resOk.fieldStatuses.Сорт).toBe('ok');
  });

  it("Опцияда zakaz umuman yo'q bo'lsa xato emas, sariq ogohlantirish chiqishi; zakaz bor-u model yo'q bo'lsa Модель xato bo'lishi kerak", () => {
    const opt = makeValidOption({ Заказ: 'MOS-100', Модель: 'M-1.Blk' });
    const ctx = {
      optionsIndex: buildOptionsIndex([opt]),
      expectedDate: EXPECTED_DATE,
      abbrMap: buildColorAbbrMap(DEFAULT_COLOR_ABBREVIATIONS),
    };

    // Holat 1: Zakaz Опцияда umuman yo'q
    const rowUnlinked = makeValidSklad(EXPECTED_DATE, {
      Заказ: 'NEW-999',
      Модель: 'ANY.Blk',
    });
    const resUnlinked = validateSkladRow(rowUnlinked, ctx);
    expect(resUnlinked.isUnlinkedOrder).toBe(true);
    expect(resUnlinked.status).toBe('warning');
    expect(resUnlinked.errorCount).toBe(0);
    expect(resUnlinked.warningCount).toBe(1);
    expect(resUnlinked.fieldStatuses.Заказ).toBe('warning');

    // Holat 2: Zakaz bor, lekin Модель yo'q
    const rowMissingModel = makeValidSklad(EXPECTED_DATE, {
      Заказ: 'MOS-100',
      Модель: 'M-2.Wht',
    });
    const resMissingModel = validateSkladRow(rowMissingModel, ctx);
    expect(resMissingModel.isUnlinkedOrder).toBe(false);
    expect(resMissingModel.status).toBe('error');
    expect(resMissingModel.fieldStatuses.Модель).toBe('error');
    expect(resMissingModel.fieldMessages.Модель?.[0]).toContain('Опцияда topilmadi');
  });

  it("Надпись da kirill harf etalon bilan bir xil bo'lsa ruxsat etilishi, faqat farq qilsa kirill ko'rsatilishi kerak", () => {
    const optCyr = makeValidOption({ Надпись: 'Сделано в Узбекистане' });
    const ctx = {
      optionsIndex: buildOptionsIndex([optCyr]),
      expectedDate: EXPECTED_DATE,
      abbrMap: buildColorAbbrMap(DEFAULT_COLOR_ABBREVIATIONS),
    };

    const rowMatch = makeValidSklad(EXPECTED_DATE, { Надпись: 'Сделано в Узбекистане' });
    expect(validateSkladRow(rowMatch, ctx).fieldStatuses.Надпись).toBe('ok');

    const rowDiff = makeValidSklad(EXPECTED_DATE, { Надпись: 'Сделано в Узбекистан' });
    const resDiff = validateSkladRow(rowDiff, ctx);
    expect(resDiff.fieldStatuses.Надпись).toBe('error');
    expect(resDiff.fieldMessages.Надпись?.[0]).toContain('kirill harflar');
  });

  it("Опция o'z-o'zini tekshiruvi: bo'sh maydon -> 'Опция to'liq emas', takroriy Заказ+Модель -> xato", () => {
    const opt1 = makeValidOption({ id: 'o1', Примечание: '' });
    const opt2 = makeValidOption({ id: 'o2', Заказ: 'mos-2610.01', Модель: 'fn-ow.blk' });
    const optMap = validateAllOptions([opt1, opt2], DEFAULT_COLOR_ABBREVIATIONS);

    expect(optMap.get('o1')?.isIncomplete).toBe(true);
    expect(optMap.get('o1')?.warnings.some(w => w.includes("Опция to'liq emas"))).toBe(true);
    expect(optMap.get('o1')?.isDuplicate).toBe(true);
    expect(optMap.get('o2')?.isDuplicate).toBe(true);
  });

  it("Inkremenal keshlash va Инфо проверка hisobot yig'ish to'g'ri ishlashi kerak", () => {
    const opt = makeValidOption();
    const row1 = makeValidSklad(EXPECTED_DATE, { id: 'r1', '№ тары': '101' });
    const row2 = makeValidSklad(EXPECTED_DATE, { id: 'r2', '№ тары': '102', Цвет: 'Белый' });
    const row3 = makeValidSklad(EXPECTED_DATE, { id: 'r3', '№ тары': '103', Заказ: 'UNLINKED-1' });

    const cache = createValidationCache();
    const validations = validateSkladBatchIncremental(
      [row1, row2, row3],
      [opt],
      EXPECTED_DATE,
      DEFAULT_COLOR_ABBREVIATIONS,
      cache
    );
    const optVals = validateAllOptions([opt], DEFAULT_COLOR_ABBREVIATIONS);
    const report = buildInfoCheckReport([row1, row2, row3], [opt], validations, optVals, EXPECTED_DATE);

    expect(report.totalBoxesCount).toBe(3);
    expect(report.errorBoxesCount).toBe(1);
    expect(report.unlinkedBoxesCount).toBe(1);
    // 1-qator doim "Опцияда topilmagan zakazlar"
    expect(report.rows[0].isUnmatchedSummary).toBe(true);
    expect(report.rows[0].boxCount).toBe(1);
    // 2-qator MOS-2610.01 (2 ta quti, 1 ta xato)
    expect(report.rows[1].boxCount).toBe(2);
    expect(report.rows[1].errorBoxCount).toBe(1);
    expect(report.rows[1].fieldErrorCounts.Цвет).toBe(1);
  });
});
