import mountainSunriseImg from '../assets/images/nature_mountain_sunrise_1794931723362.jpg';
import turquoiseLakeImg from '../assets/images/nature_turquoise_lake_1794931724063.jpg';
import greenValleyImg from '../assets/images/nature_green_valley_1794931723959.jpg';
import winterForestImg from '../assets/images/winter_snowy_forest_1795189559303.jpg';
import autumnForestImg from '../assets/images/autumn_golden_forest_1795189560155.jpg';
import forestWaterfallImg from '../assets/images/forest_waterfall_sunny_1795189559490.jpg';
import sunsetMountainImg from '../assets/images/sunset_mountain_glow_1795189559945.jpg';
import nightMoonImg from '../assets/images/night_moon_mountains_1795189559450.jpg';
import type { WeatherEffect } from '../components/WeatherOverlay';

export type NatureBgId =
  | 'auto'
  | 'winter_forest'
  | 'green_valley'
  | 'turquoise_lake'
  | 'autumn_forest'
  | 'forest_waterfall'
  | 'mountain_sunrise'
  | 'mountain_sunset'
  | 'night_moon';

export type WeatherSettingMode = 'auto' | WeatherEffect;
export type AnnouncementBadgeType = 'holiday' | 'event' | 'announcement';
export type SeasonId = 'winter' | 'spring' | 'summer' | 'autumn';
export type DayPhaseId = 'sunrise' | 'day' | 'sunset' | 'night';

export interface NatureBackgroundOption {
  id: Exclude<NatureBgId, 'auto'>;
  category: 'season' | 'nature' | 'sky';
  seasonTag?: SeasonId;
  nameRu: string;
  nameUz: string;
  subtitleRu: string;
  subtitleUz: string;
  imageUrl: string;
}

export const NATURE_BACKGROUNDS: NatureBackgroundOption[] = [
  {
    id: 'winter_forest',
    category: 'season',
    seasonTag: 'winter',
    nameRu: 'Зима: Заснеженный лес и горы',
    nameUz: "Qish: Qorli o'rmon va tog'lar",
    subtitleRu: 'Чистый зимний снег и горные вершины',
    subtitleUz: "Qishki oppoq qor va tog' cho'qqilari",
    imageUrl: winterForestImg
  },
  {
    id: 'green_valley',
    category: 'season',
    seasonTag: 'spring',
    nameRu: 'Весна: Зелёная долина и горы',
    nameUz: "Bahor: Yashil vodiy va tog'lar",
    subtitleRu: 'Свежие весенние луга и горный воздух',
    subtitleUz: "Bahorgi ko'klam vodiylar",
    imageUrl: greenValleyImg
  },
  {
    id: 'turquoise_lake',
    category: 'season',
    seasonTag: 'summer',
    nameRu: 'Лето: Бирюзовое горное озеро',
    nameUz: "Yoz: Firuzako'l va quyosh",
    subtitleRu: 'Ясный солнечный день на альпийском озере',
    subtitleUz: "Yozgi quyoshli kun va tog' ko'li",
    imageUrl: turquoiseLakeImg
  },
  {
    id: 'autumn_forest',
    category: 'season',
    seasonTag: 'autumn',
    nameRu: 'Осень: Золотой лес и горы',
    nameUz: "Kuz: Oltin o'rmon va tog'lar",
    subtitleRu: 'Багряный и золотой осенний пейзаж',
    subtitleUz: "Kuzgi oltin barglar va salqin tog'lar",
    imageUrl: autumnForestImg
  },
  {
    id: 'forest_waterfall',
    category: 'nature',
    nameRu: 'Лесной водопад',
    nameUz: "O'rmon sharsharasi",
    subtitleRu: 'Солнечный лес и хрустальный водопад',
    subtitleUz: "Quyosh nuri ostidagi o'rmon sharsharasi",
    imageUrl: forestWaterfallImg
  },
  {
    id: 'mountain_sunrise',
    category: 'sky',
    nameRu: 'Восход солнца в горах',
    nameUz: "Quyosh chiqishi (tog'lar)",
    subtitleRu: 'Золотой утренний рассвет над хребтами',
    subtitleUz: "Tog'lar uzra tonggi quyosh chiqishi",
    imageUrl: mountainSunriseImg
  },
  {
    id: 'mountain_sunset',
    category: 'sky',
    nameRu: 'Закат солнца в горах',
    nameUz: "Quyosh botishi (tog'lar)",
    subtitleRu: 'Тёплое закатное небо и горная долина',
    subtitleUz: "Kechki quyosh botishi manzarasi",
    imageUrl: sunsetMountainImg
  },
  {
    id: 'night_moon',
    category: 'sky',
    nameRu: 'Ночь: Луна и звёздное небо',
    nameUz: 'Tun: Osmonda oy va yulduzlar',
    subtitleRu: 'Спокойная лунная ночь над вершинами',
    subtitleUz: "Tog'lar ustida to'lin oy va yulduzli osmon",
    imageUrl: nightMoonImg
  }
];

export const VALID_NATURE_BG_IDS: NatureBgId[] = [
  'auto',
  'winter_forest',
  'green_valley',
  'turquoise_lake',
  'autumn_forest',
  'forest_waterfall',
  'mountain_sunrise',
  'mountain_sunset',
  'night_moon'
];

export function getSeasonId(now: Date = new Date()): SeasonId {
  const m = now.getMonth(); // 0=Jan..11=Dec
  if (m === 11 || m <= 1) return 'winter';
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  return 'autumn';
}

export function getDayPhaseId(now: Date = new Date()): DayPhaseId {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= 5.5 && h < 8.5) return 'sunrise';
  if (h >= 8.5 && h < 17.5) return 'day';
  if (h >= 17.5 && h < 20.0) return 'sunset';
  return 'night';
}

export function getSeasonLabel(season: SeasonId, lang: 'ru' | 'uz' = 'ru'): string {
  const map: Record<SeasonId, { ru: string; uz: string }> = {
    winter: { ru: 'Зима', uz: 'Qish' },
    spring: { ru: 'Весна', uz: 'Bahor' },
    summer: { ru: 'Лето', uz: 'Yoz' },
    autumn: { ru: 'Осень', uz: 'Kuz' }
  };
  return map[season][lang];
}

export function getDayPhaseLabel(phase: DayPhaseId, lang: 'ru' | 'uz' = 'ru'): string {
  const map: Record<DayPhaseId, { ru: string; uz: string }> = {
    sunrise: { ru: 'Рассвет', uz: 'Quyosh chiqishi' },
    day: { ru: 'День', uz: 'Kunduzi' },
    sunset: { ru: 'Закат', uz: 'Quyosh botishi' },
    night: { ru: 'Ночь (Луна)', uz: 'Tun (Osmonda oy)' }
  };
  return map[phase][lang];
}

export function resolveActiveBackground(
  bgTheme: NatureBgId,
  now: Date = new Date()
): NatureBackgroundOption {
  if (bgTheme !== 'auto') {
    const exact = NATURE_BACKGROUNDS.find(b => b.id === bgTheme);
    if (exact) return exact;
  }

  const season = getSeasonId(now);
  const phase = getDayPhaseId(now);
  const hour = now.getHours();

  let targetId: Exclude<NatureBgId, 'auto'>;

  if (phase === 'night') {
    targetId = 'night_moon';
  } else if (season === 'winter') {
    targetId = phase === 'sunset' ? 'mountain_sunset' : 'winter_forest';
  } else if (phase === 'sunrise') {
    targetId = 'mountain_sunrise';
  } else if (phase === 'sunset') {
    targetId = 'mountain_sunset';
  } else {
    // Daytime in spring / summer / autumn
    if (season === 'spring') {
      targetId = hour % 2 === 0 ? 'green_valley' : 'forest_waterfall';
    } else if (season === 'summer') {
      targetId = hour % 2 === 0 ? 'turquoise_lake' : 'forest_waterfall';
    } else {
      targetId = 'autumn_forest';
    }
  }

  return NATURE_BACKGROUNDS.find(b => b.id === targetId) || NATURE_BACKGROUNDS[0];
}

export function resolveAdaptiveWeather(
  setting: WeatherSettingMode,
  now: Date = new Date()
): WeatherEffect {
  if (setting !== 'auto') return setting;
  const season = getSeasonId(now);
  const phase = getDayPhaseId(now);

  if (season === 'winter') {
    return 'snow';
  }
  if (phase === 'night') {
    return 'none';
  }
  if (season === 'autumn') {
    return phase === 'day' ? 'wind' : 'none';
  }
  // Spring / Summer sunrise, day, sunset -> bright sunny radiance
  return 'sun';
}

export interface HomeAnnouncementConfig {
  enabled: boolean;
  badgeType: AnnouncementBadgeType;
  title: string;
  message: string;
  eventDate: string;
  bgTheme: NatureBgId;
  updatedAt: string;
}

export const HOME_CONFIG_STORAGE_KEY = 'tex_erp_home_config_v1';
export const HOME_CONFIG_UPDATED_EVENT = 'tex_erp_home_updated';
export const WEATHER_SETTING_STORAGE_KEY = 'tex_erp_weather_effect';

export const DEFAULT_HOME_CONFIG: HomeAnnouncementConfig = {
  enabled: true,
  badgeType: 'holiday',
  title: 'ДОБРО ПОЖАЛОВАТЬ В CHUST TEXTILE ERP!',
  message:
    'ЖЕЛАЕМ ВАМ ОТЛИЧНОГО НАСТРОЕНИЯ, СЛАЖЕННОЙ КОМАНДНОЙ РАБОТЫ И ВЫСОКИХ РЕЗУЛЬТАТОВ СЕГОДНЯ!',
  eventDate: '',
  bgTheme: 'auto',
  updatedAt: new Date().toISOString()
};

export function loadHomeConfig(): HomeAnnouncementConfig {
  try {
    const raw = localStorage.getItem(HOME_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_HOME_CONFIG;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_HOME_CONFIG;
    const themeCandidate = String(parsed.bgTheme || '') as NatureBgId;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      badgeType:
        parsed.badgeType === 'holiday' || parsed.badgeType === 'event' || parsed.badgeType === 'announcement'
          ? parsed.badgeType
          : 'holiday',
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : DEFAULT_HOME_CONFIG.title,
      message: typeof parsed.message === 'string' ? parsed.message : DEFAULT_HOME_CONFIG.message,
      eventDate: typeof parsed.eventDate === 'string' ? parsed.eventDate : '',
      bgTheme: VALID_NATURE_BG_IDS.includes(themeCandidate) ? themeCandidate : 'auto',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    };
  } catch {
    return DEFAULT_HOME_CONFIG;
  }
}

export function saveHomeConfig(config: HomeAnnouncementConfig): HomeAnnouncementConfig {
  const next: HomeAnnouncementConfig = {
    ...config,
    updatedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem(HOME_CONFIG_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(HOME_CONFIG_UPDATED_EVENT));
  } catch (e) {
    console.warn('Failed to save home config:', e);
  }
  return next;
}

export function loadWeatherSetting(): WeatherSettingMode {
  try {
    const saved = localStorage.getItem(WEATHER_SETTING_STORAGE_KEY);
    if (
      saved &&
      ['auto', 'none', 'rain', 'sun', 'wind', 'snow', 'holidays', 'new_year'].includes(saved)
    ) {
      return saved as WeatherSettingMode;
    }
  } catch (e) {
    console.warn(e);
  }
  return 'auto';
}
