// IndexedDB (idb) asosidagi saqlash qatlami — keyin REST API ga osongina almashtirish uchun interfeys bilan ajratilgan

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  AuditBackupPayload,
  AuditSettings,
  DEFAULT_COLOR_ABBREVIATIONS,
  OPTION_COLUMNS,
  OptionRow,
  SKLAD_COLUMNS,
  SkladRow,
  ThemeMode,
} from '../types';
import { getYesterdayDdMmYyyy, isValidDdMmYyyy, safeStr } from '../validators/validators';

const DB_NAME = 'ombor_audit_erp_db';
const DB_VERSION = 1;
const SETTINGS_KEY = 'audit_settings';

interface OmborAuditDB extends DBSchema {
  sklad: {
    key: string;
    value: SkladRow;
  };
  options: {
    key: string;
    value: OptionRow;
  };
  settings: {
    key: string;
    value: AuditSettings;
  };
}

/** Keyinchalik REST API implementation bilan almashtirish uchun umumiy saqlash interfeysi */
export interface IWarehouseAuditStorage {
  loadAll(): Promise<{
    sklad: SkladRow[];
    options: OptionRow[];
    settings: AuditSettings;
  }>;
  replaceAllSklad(rows: SkladRow[]): Promise<void>;
  putSkladRow(row: SkladRow): Promise<void>;
  putSkladRows(rows: SkladRow[]): Promise<void>;
  deleteSkladRows(ids: string[]): Promise<void>;
  replaceAllOptions(rows: OptionRow[]): Promise<void>;
  putOptionRow(row: OptionRow): Promise<void>;
  deleteOptionRow(id: string): Promise<void>;
  saveSettings(settings: AuditSettings): Promise<void>;
}

export function getDefaultAuditSettings(): AuditSettings {
  let theme: ThemeMode = 'light';
  try {
    const saved = localStorage.getItem('ombor_audit_theme');
    if (saved === 'dark' || saved === 'light') {
      theme = saved;
    }
  } catch {
    // ignore
  }
  return {
    expectedDate: getYesterdayDdMmYyyy(),
    colorAbbreviations: [...DEFAULT_COLOR_ABBREVIATIONS],
    theme,
  };
}

/** IndexedDB implementation */
export class IndexedDbWarehouseStorage implements IWarehouseAuditStorage {
  private dbPromise: Promise<IDBPDatabase<OmborAuditDB>> | null = null;

  private getDb(): Promise<IDBPDatabase<OmborAuditDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<OmborAuditDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('sklad')) {
            db.createObjectStore('sklad', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('options')) {
            db.createObjectStore('options', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings');
          }
        },
      });
    }
    return this.dbPromise;
  }

  async loadAll(): Promise<{
    sklad: SkladRow[];
    options: OptionRow[];
    settings: AuditSettings;
  }> {
    const db = await this.getDb();
    const tx = db.transaction(['sklad', 'options', 'settings'], 'readonly');
    const [sklad, options, savedSettings] = await Promise.all([
      tx.objectStore('sklad').getAll(),
      tx.objectStore('options').getAll(),
      tx.objectStore('settings').get(SETTINGS_KEY),
    ]);
    await tx.done;

    const defaults = getDefaultAuditSettings();
    const settings: AuditSettings = savedSettings
      ? {
          expectedDate: isValidDdMmYyyy(savedSettings.expectedDate)
            ? savedSettings.expectedDate
            : defaults.expectedDate,
          colorAbbreviations:
            Array.isArray(savedSettings.colorAbbreviations) && savedSettings.colorAbbreviations.length > 0
              ? savedSettings.colorAbbreviations
              : defaults.colorAbbreviations,
          theme: savedSettings.theme === 'dark' ? 'dark' : 'light',
        }
      : defaults;

    // Yangi qo'shilgan/tartiblangan tartibni saqlash uchun updatedAt bo'yicha tartiblash mumkin
    sklad.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    options.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));

    return { sklad, options, settings };
  }

  async replaceAllSklad(rows: SkladRow[]): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction('sklad', 'readwrite');
    await tx.store.clear();
    for (const row of rows) {
      tx.store.put(row);
    }
    await tx.done;
  }

  async putSkladRow(row: SkladRow): Promise<void> {
    const db = await this.getDb();
    await db.put('sklad', row);
  }

  async putSkladRows(rows: SkladRow[]): Promise<void> {
    if (rows.length === 0) return;
    const db = await this.getDb();
    const tx = db.transaction('sklad', 'readwrite');
    for (const row of rows) {
      tx.store.put(row);
    }
    await tx.done;
  }

  async deleteSkladRows(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.getDb();
    const tx = db.transaction('sklad', 'readwrite');
    for (const id of ids) {
      tx.store.delete(id);
    }
    await tx.done;
  }

  async replaceAllOptions(rows: OptionRow[]): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction('options', 'readwrite');
    await tx.store.clear();
    for (const row of rows) {
      tx.store.put(row);
    }
    await tx.done;
  }

  async putOptionRow(row: OptionRow): Promise<void> {
    const db = await this.getDb();
    await db.put('options', row);
  }

  async deleteOptionRow(id: string): Promise<void> {
    const db = await this.getDb();
    await db.delete('options', id);
  }

  async saveSettings(settings: AuditSettings): Promise<void> {
    const db = await this.getDb();
    await db.put('settings', settings, SETTINGS_KEY);
    try {
      localStorage.setItem('ombor_audit_theme', settings.theme);
    } catch {
      // ignore
    }
  }
}

export const warehouseAuditStorage: IWarehouseAuditStorage = new IndexedDbWarehouseStorage();

/** JSON zaxira nusxasini yaratish */
export function buildBackupJsonPayload(
  sklad: SkladRow[],
  options: OptionRow[],
  settings: AuditSettings
): AuditBackupPayload {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    options,
    sklad,
  };
}

/** JSON zaxira faylini tekshirib va xavfsiz tozalab o'qish */
export function parseBackupJsonPayload(rawJson: string): AuditBackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("JSON fayl tuzilmasi noto'g'ri yoki buzilgan.");
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error("Zaxira fayl formati noto'g'ri (obyekt kutilgan).");
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.sklad) || !Array.isArray(obj.options)) {
    throw new Error("Zaxira faylda 'sklad' va 'options' jadvallari bo'lishi shart.");
  }

  const sanitizedSklad: SkladRow[] = obj.sklad.map((item, idx) => {
    const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const row: Record<string, unknown> = {
      id: safeStr(rec.id).trim() || `skl-rest-${Date.now()}-${idx}`,
      updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now() + idx,
    };
    for (const col of SKLAD_COLUMNS) {
      row[col] = safeStr(rec[col]);
    }
    return row as unknown as SkladRow;
  });

  const sanitizedOptions: OptionRow[] = obj.options.map((item, idx) => {
    const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const row: Record<string, unknown> = {
      id: safeStr(rec.id).trim() || `opt-rest-${Date.now()}-${idx}`,
      updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now() + idx,
    };
    for (const col of OPTION_COLUMNS) {
      row[col] = safeStr(rec[col]);
    }
    return row as unknown as OptionRow;
  });

  const rawSettings = (obj.settings && typeof obj.settings === 'object'
    ? obj.settings
    : {}) as Record<string, unknown>;

  const defaults = getDefaultAuditSettings();
  const expectedDate = isValidDdMmYyyy(safeStr(rawSettings.expectedDate))
    ? safeStr(rawSettings.expectedDate)
    : defaults.expectedDate;

  const colorAbbreviations = Array.isArray(rawSettings.colorAbbreviations)
    ? rawSettings.colorAbbreviations.map(v => safeStr(v).trim()).filter(Boolean)
    : defaults.colorAbbreviations;

  const theme: ThemeMode = rawSettings.theme === 'dark' ? 'dark' : 'light';

  return {
    version: Number(obj.version) || 1,
    exportedAt: safeStr(obj.exportedAt) || new Date().toISOString(),
    settings: {
      expectedDate,
      colorAbbreviations: colorAbbreviations.length > 0 ? colorAbbreviations : defaults.colorAbbreviations,
      theme,
    },
    options: sanitizedOptions,
    sklad: sanitizedSklad,
  };
}
