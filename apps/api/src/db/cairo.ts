import type { PricingTier } from '@goturtle/shared';

/** Launch network: Greater Cairo. Coordinates are zone centres (WGS84). */
export const GOVERNORATES = [
  { code: 'CAI', nameEn: 'Cairo', nameAr: 'القاهرة' },
  { code: 'GIZ', nameEn: 'Giza', nameAr: 'الجيزة' },
  { code: 'QAL', nameEn: 'Qalyubia', nameAr: 'القليوبية' },
] as const;

export const CITIES = [
  { code: 'CAI', gov: 'CAI', nameEn: 'Cairo', nameAr: 'القاهرة' },
  { code: 'NCAI', gov: 'CAI', nameEn: 'New Cairo', nameAr: 'القاهرة الجديدة' },
  { code: 'GIZ', gov: 'GIZ', nameEn: 'Giza', nameAr: 'الجيزة' },
  { code: 'OCT', gov: 'GIZ', nameEn: '6th of October', nameAr: '٦ أكتوبر' },
  { code: 'SHB', gov: 'QAL', nameEn: 'Shubra El Kheima', nameAr: 'شبرا الخيمة' },
] as const;

export const HUBS = [
  { code: 'HUB-NSR', name: 'Nasr City Hub', nameAr: 'مخزن مدينة نصر', address: 'Abbas El Akkad St, Nasr City, Cairo', lat: 30.0566, lng: 31.3372, phone: '+201000000101' },
  { code: 'HUB-MAD', name: 'Maadi Hub', nameAr: 'مخزن المعادي', address: 'Road 9, Maadi, Cairo', lat: 29.9602, lng: 31.2569, phone: '+201000000102' },
  { code: 'HUB-GIZ', name: 'Mohandessin Hub', nameAr: 'مخزن المهندسين', address: 'Gameat El Dowal El Arabeya St, Mohandessin, Giza', lat: 30.0566, lng: 31.2003, phone: '+201000000103' },
  { code: 'HUB-OCT', name: 'October Hub', nameAr: 'مخزن أكتوبر', address: 'Central Axis, 6th of October City', lat: 29.9727, lng: 30.9431, phone: '+201000000104' },
] as const;

export interface ZoneSeed {
  code: string;
  city: string;
  hub: string;
  tier: PricingTier;
  nameEn: string;
  nameAr: string;
  lat: number;
  lng: number;
  keywords: string[];
  slaHours?: number;
}

export const ZONES: ZoneSeed[] = [
  { code: 'CAI-NASR', city: 'CAI', hub: 'HUB-NSR', tier: 'A', nameEn: 'Nasr City', nameAr: 'مدينة نصر', lat: 30.0566, lng: 31.3439, keywords: ['nasr city', 'madinet nasr', 'nasr', 'مدينه نصر', 'abbas el akkad', 'makram ebeid', 'عباس العقاد', 'مكرم عبيد', 'el hay el sabea', 'الحي السابع', 'city stars', 'سيتي ستارز'] },
  { code: 'CAI-HELIO', city: 'CAI', hub: 'HUB-NSR', tier: 'A', nameEn: 'Heliopolis', nameAr: 'مصر الجديدة', lat: 30.0911, lng: 31.3225, keywords: ['heliopolis', 'masr el gedida', 'misr el gedida', 'korba', 'الكوربة', 'روكسي', 'roxy', 'merghany', 'الميرغني', 'almaza', 'ألماظة'] },
  { code: 'CAI-SHERATON', city: 'CAI', hub: 'HUB-NSR', tier: 'A', nameEn: 'Sheraton & Nozha', nameAr: 'شيراتون والنزهة', lat: 30.1076, lng: 31.3727, keywords: ['sheraton', 'شيراتون', 'nozha', 'النزهة', 'el nozha', 'airport', 'المطار'] },
  { code: 'CAI-ABBAS', city: 'CAI', hub: 'HUB-NSR', tier: 'A', nameEn: 'Abbassia & Ain Shams', nameAr: 'العباسية وعين شمس', lat: 30.0735, lng: 31.2869, keywords: ['abbassia', 'abbasiya', 'عباسيه', 'ain shams', 'عين شمس', 'el zaitoun', 'الزيتون', 'matareya', 'المطرية'] },
  { code: 'CAI-SALAM', city: 'CAI', hub: 'HUB-NSR', tier: 'B', nameEn: 'El Salam & Obour', nameAr: 'السلام والعبور', lat: 30.1689, lng: 31.4100, keywords: ['el salam', 'madinet el salam', 'مدينة السلام', 'obour', 'العبور', 'el obour'] },
  { code: 'CAI-DOWNTOWN', city: 'CAI', hub: 'HUB-GIZ', tier: 'A', nameEn: 'Downtown', nameAr: 'وسط البلد', lat: 30.0478, lng: 31.2400, keywords: ['downtown', 'wust el balad', 'west el balad', 'وسط البلد', 'tahrir', 'التحرير', 'talaat harb', 'طلعت حرب', 'abdeen', 'عابدين', 'garden city', 'جاردن سيتي', 'ramses', 'رمسيس'] },
  { code: 'CAI-ZAMALEK', city: 'CAI', hub: 'HUB-GIZ', tier: 'A', nameEn: 'Zamalek', nameAr: 'الزمالك', lat: 30.0626, lng: 31.2197, keywords: ['zamalek', 'زمالك', 'el zamalek', '26 july', '٢٦ يوليو'] },
  { code: 'CAI-SHUBRA', city: 'CAI', hub: 'HUB-NSR', tier: 'A', nameEn: 'Shubra', nameAr: 'شبرا', lat: 30.0866, lng: 31.2445, keywords: ['shubra', 'شبرا', 'rod el farag', 'روض الفرج', 'sahel', 'الساحل'] },
  { code: 'CAI-MOKATTAM', city: 'CAI', hub: 'HUB-MAD', tier: 'A', nameEn: 'Mokattam', nameAr: 'المقطم', lat: 30.0135, lng: 31.2933, keywords: ['mokattam', 'mokkatam', 'المقطم', 'مقطم', 'hadaba', 'الهضبة'] },
  { code: 'CAI-MAADI', city: 'CAI', hub: 'HUB-MAD', tier: 'A', nameEn: 'Maadi', nameAr: 'المعادي', lat: 29.9602, lng: 31.2569, keywords: ['maadi', 'معادي', 'el maadi', 'degla', 'دجلة', 'sarayat', 'سرايات', 'zahraa el maadi', 'زهراء المعادي', 'road 9', 'شارع ٩'] },
  { code: 'CAI-HELWAN', city: 'CAI', hub: 'HUB-MAD', tier: 'B', nameEn: 'Helwan & 15th of May', nameAr: 'حلوان و١٥ مايو', lat: 29.8414, lng: 31.3008, keywords: ['helwan', 'حلوان', '15 may', '15th of may', '١٥ مايو', 'maasara', 'المعصرة'] },
  { code: 'CAI-OLDCAIRO', city: 'CAI', hub: 'HUB-MAD', tier: 'A', nameEn: 'Old Cairo & Manial', nameAr: 'مصر القديمة والمنيل', lat: 30.0175, lng: 31.2300, keywords: ['old cairo', 'masr el adima', 'مصر القديمه', 'manial', 'المنيل', 'sayeda zeinab', 'السيدة زينب', 'el sayeda'] },
  { code: 'NCAI-TAGAMOA', city: 'NCAI', hub: 'HUB-NSR', tier: 'B', nameEn: 'New Cairo (Fifth Settlement)', nameAr: 'التجمع الخامس', lat: 30.0074, lng: 31.4913, keywords: ['tagamoa', 'tagamo3', 'el tagamoa el khames', 'fifth settlement', '5th settlement', 'التجمع', 'التجمع الخامس', 'new cairo', 'القاهرة الجديدة', 'auc', 'banafseg', 'البنفسج', 'narges', 'النرجس', 'south 90', 'التسعين'] },
  { code: 'NCAI-REHAB', city: 'NCAI', hub: 'HUB-NSR', tier: 'B', nameEn: 'Rehab & Madinaty', nameAr: 'الرحاب ومدينتي', lat: 30.0626, lng: 31.4925, keywords: ['rehab', 'el rehab', 'الرحاب', 'madinaty', 'مدينتي'] },
  { code: 'NCAI-FIRST', city: 'NCAI', hub: 'HUB-NSR', tier: 'B', nameEn: 'First Settlement & Katameya', nameAr: 'التجمع الأول والقطامية', lat: 30.0263, lng: 31.4300, keywords: ['first settlement', 'tagamoa el awal', 'التجمع الأول', 'katameya', 'kattameya', 'القطامية', 'mivida', 'ميفيدا'] },
  { code: 'NCAI-SHOROUK', city: 'NCAI', hub: 'HUB-NSR', tier: 'C', nameEn: 'El Shorouk & Badr', nameAr: 'الشروق وبدر', lat: 30.1236, lng: 31.6050, keywords: ['shorouk', 'el shorouk', 'الشروق', 'badr city', 'مدينة بدر'] },
  { code: 'NCAI-CAPITAL', city: 'NCAI', hub: 'HUB-NSR', tier: 'C', nameEn: 'New Administrative Capital', nameAr: 'العاصمة الإدارية', lat: 30.0196, lng: 31.7595, keywords: ['new capital', 'administrative capital', 'العاصمة الإدارية', 'العاصمه الاداريه'], slaHours: 48 },
  { code: 'GIZ-MOHANDESSIN', city: 'GIZ', hub: 'HUB-GIZ', tier: 'A', nameEn: 'Mohandessin & Agouza', nameAr: 'المهندسين والعجوزة', lat: 30.0566, lng: 31.2003, keywords: ['mohandessin', 'mohandeseen', 'المهندسين', 'agouza', 'العجوزة', 'gamaat el dewal', 'جامعة الدول', 'shehab', 'شهاب', 'lebanon square', 'ميدان لبنان'] },
  { code: 'GIZ-DOKKI', city: 'GIZ', hub: 'HUB-GIZ', tier: 'A', nameEn: 'Dokki', nameAr: 'الدقي', lat: 30.0384, lng: 31.2110, keywords: ['dokki', 'dokky', 'الدقي', 'mesaha', 'المساحة', 'tahrir st dokki'] },
  { code: 'GIZ-GIZA', city: 'GIZ', hub: 'HUB-GIZ', tier: 'B', nameEn: 'Giza & Haram', nameAr: 'الجيزة والهرم', lat: 30.0131, lng: 31.2089, keywords: ['giza', 'الجيزه', 'haram', 'el haram', 'الهرم', 'faisal', 'فيصل', 'omraneya', 'العمرانية', 'talbeya', 'الطالبية'] },
  { code: 'GIZ-IMBABA', city: 'GIZ', hub: 'HUB-GIZ', tier: 'B', nameEn: 'Imbaba & Warraq', nameAr: 'إمبابة والوراق', lat: 30.0759, lng: 31.2075, keywords: ['imbaba', 'امبابة', 'warraq', 'الوراق', 'kit kat', 'الكيت كات', 'bulaq el dakrour', 'بولاق الدكرور'] },
  { code: 'GIZ-HADAYEK', city: 'GIZ', hub: 'HUB-GIZ', tier: 'B', nameEn: 'Hadayek El Ahram', nameAr: 'حدائق الأهرام', lat: 29.9719, lng: 31.1080, keywords: ['hadayek el ahram', 'pyramids gardens', 'حدائق الاهرام', 'hadaek'] },
  { code: 'OCT-OCTOBER', city: 'OCT', hub: 'HUB-OCT', tier: 'C', nameEn: '6th of October', nameAr: '٦ أكتوبر', lat: 29.9727, lng: 30.9431, keywords: ['october', '6th of october', '6 october', 'sitta october', '٦ اكتوبر', 'اكتوبر', 'مدينة السادس من اكتوبر', 'hosary', 'الحصري', 'mall of arabia', 'مول العرب'] },
  { code: 'OCT-ZAYED', city: 'OCT', hub: 'HUB-OCT', tier: 'C', nameEn: 'Sheikh Zayed', nameAr: 'الشيخ زايد', lat: 30.0444, lng: 30.9763, keywords: ['sheikh zayed', 'zayed', 'el sheikh zayed', 'الشيخ زايد', 'زايد', 'beverly hills', 'arkan', 'أركان'] },
  { code: 'SHB-KHEIMA', city: 'SHB', hub: 'HUB-NSR', tier: 'B', nameEn: 'Shubra El Kheima', nameAr: 'شبرا الخيمة', lat: 30.1286, lng: 31.2422, keywords: ['shubra el kheima', 'shubra elkheima', 'شبرا الخيمة', 'shubra al khaymah', 'bahteem', 'بهتيم'] },
];

/** Default rate card (piasters). Tier A = core Cairo, B = Greater Cairo/Giza, C = new cities. */
export const DEFAULT_RATES: Array<{ tier: PricingTier; STANDARD: number; SAME_DAY: number; EXPRESS: number; SCHEDULED: number }> = [
  { tier: 'A', STANDARD: 5500, SAME_DAY: 7500, EXPRESS: 9500, SCHEDULED: 6000 },
  { tier: 'B', STANDARD: 6500, SAME_DAY: 8500, EXPRESS: 11000, SCHEDULED: 7000 },
  { tier: 'C', STANDARD: 8000, SAME_DAY: 10500, EXPRESS: 13500, SCHEDULED: 8500 },
  { tier: 'D', STANDARD: 9500, SAME_DAY: 12500, EXPRESS: 16000, SCHEDULED: 10000 },
];
