/**
 * Tunisian Arabic-to-French Name Transliteration Engine
 * STE DigiWare SUARL - Lead Intelligence Architecture
 * 
 * Accurately transliterates Arabic personal and commercial names
 * into their common Tunisian French / Latin script equivalents.
 */

// Common Tunisian First Names (Arabic -> French/Latin representations)
const TUNISIAN_FIRST_NAMES: Record<string, string[]> = {
  'احمد': ['Ahmed'],
  'أحمد': ['Ahmed'],
  'محمد': ['Mohamed', 'Mohammed', 'Med'],
  'محمود': ['Mahmoud'],
  'علي': ['Ali'],
  'يوسف': ['Youssef', 'Yousef'],
  'خليل': ['Khalil'],
  'كريم': ['Karim'],
  'سليم': ['Slim', 'Salim'],
  'طارق': ['Tarek', 'Tariq'],
  'حاتم': ['Hatem'],
  'سامي': ['Sami'],
  'عمر': ['Omar'],
  'منصف': ['Moncef'],
  'مهدي': ['Mehdi'],
  'مراد': ['Mourad'],
  'وليد': ['Walid'],
  'حسام': ['Houssem'],
  'ايمن': ['Aymen'],
  'أيمن': ['Aymen'],
  'انيس': ['Anis'],
  'أنيس': ['Anis'],
  'مروان': ['Marwen', 'Marouane'],
  'حمزة': ['Hamza'],
  'نزار': ['Nizar'],
  'عادل': ['Adel'],
  'شكري': ['Chokri'],
  'قيس': ['Kais'],
  'عماد': ['Imed'],
  'زياد': ['Zied'],
  'خالد': ['Khaled'],
  'بشير': ['Bechir'],
  'نبيل': ['Nabil'],
  'رضا': ['Ridha'],
  'فوزي': ['Faouzi'],
  'لطفي': ['Lotfi'],
  'فاتن': ['Faten'],
  'مريم': ['Mariem', 'Meriem'],
  'سنية': ['Sonia'],
  'ايناس': ['Ines'],
  'إيناس': ['Ines'],
  'ريم': ['Rym', 'Rim'],
  'هالة': ['Hela'],
  'عبير': ['Abir'],
  'سارة': ['Sarra'],
  'اميرة': ['Amira'],
  'أميرة': ['Amira'],
  'سمية': ['Soumaya'],
  'نجلاء': ['Najla'],
  'عفاف': ['Afef'],
  'الهام': ['Ilhem', 'Elhem'],
  'إلهام': ['Ilhem', 'Elhem'],
  'ليلى': ['Leila'],
  'صابرين': ['Sabrine'],
  'اسماء': ['Asma'],
  'أسماء': ['Asma'],
  'يسرى': ['Yosra'],
  'هند': ['Henda'],
  'درة': ['Dorra'],
  'شريف': ['Cherif'],
  'سفيan': ['Sofiene'],
  'سفيان': ['Sofiene', 'Soufiane'],
  'معز': ['Moez'],
  'عصام': ['Issam'],
  'باسم': ['Bassem'],
  'رياض': ['Riadh'],
  'هيثم': ['Haythem'],
  'فراس': ['Firas'],
  'اكرم': ['Akram'],
  'أكرم': ['Akram'],
  'حبيب': ['Habib'],
  'منير': ['Mounir'],
  'فخر الدين': ['Fakhreddine'],
  'نور الدين': ['Noureddine'],
  'صلاح الدين': ['Slaheddine'],
  'سيف الدين': ['Seifeddine'],
  'حسان': ['Hassen'],
  'بلحسن': ['Belhassen'],
  'عبد السلام': ['Abdesslem'],
  'عبد الحميد': ['Abdelhamid'],
  'عبد الرؤوف': ['Abderraouf'],
  'عبد العزيز': ['Abdelaziz'],
  'عبد الكريم': ['Abdelkrim'],
  'عبد الله': ['Abdallah'],
  'عبد المجيد': ['Abdelmajid'],
  'عبد الجليل': ['Abdeljelil']
};

// Common Tunisian Family Names / Surnames
const TUNISIAN_SURNAMES: Record<string, string[]> = {
  'التمتام': ['Temtam', 'Tamtam', 'El Temtam'],
  'تمتام': ['Temtam', 'Tamtam'],
  'الطرابلسي': ['Trabelsi', 'El Trabelsi'],
  'طرابلسي': ['Trabelsi'],
  'العياري': ['Ayari', 'El Ayari'],
  'عياري': ['Ayari'],
  'الرياحي': ['Riahi', 'El Riahi'],
  'رياحي': ['Riahi'],
  'اليعقوبي': ['Yacoubi', 'El Yacoubi'],
  'يعقوبي': ['Yacoubi'],
  'الهمامي': ['Hammami', 'Hemmami', 'El Hammami'],
  'همامي': ['Hammami'],
  'الجلاصي': ['Jlassi', 'El Jlassi'],
  'جلاصي': ['Jlassi'],
  'الماجري': ['Mejri', 'El Mejri'],
  'ماجري': ['Mejri'],
  'القاسمي': ['Guesmi', 'Kacemi'],
  'قاسمي': ['Guesmi', 'Kacemi'],
  'الورتاني': ['Ouertani'],
  'ورتاني': ['Ouertani'],
  'الغربي': ['Gharbi', 'El Gharbi'],
  'غربي': ['Gharbi'],
  'المرزوقي': ['Marzouki'],
  'مرزوقي': ['Marzouki'],
  'البجاوي': ['Bejaoui'],
  'بجاوي': ['Bejaoui'],
  'الزواري': ['Zouari'],
  'زواري': ['Zouari'],
  'الشاوش': ['Chaouch'],
  'شاوش': ['Chaouch'],
  'المباركي': ['Mbarek', 'Mbarki'],
  'مباركي': ['Mbarek', 'Mbarki'],
  'الفرشيشي': ['Ferchichi'],
  'فرشيشي': ['Ferchichi'],
  'الدريدي': ['Dridi'],
  'دريدي': ['Dridi'],
  'النفاتي': ['Neffati'],
  'نفاتي': ['Neffati'],
  'الوسلاتي': ['Oueslati'],
  'وسلاتي': ['Oueslati'],
  'الجريدي': ['Jeridi'],
  'جريدي': ['Jeridi'],
  'المحواشي': ['Mhouachi'],
  'الحاجي': ['Haji', 'Hadji'],
  'البكوش': ['Baccouche'],
  'بكوش': ['Baccouche'],
  'الشريف': ['Cherif'],
  'التليلي': ['Tlili'],
  'تليلي': ['Tlili'],
  'المهيري': ['Mhiri', 'Mhirsi'],
  'الرويسي': ['Rouissi'],
  'القابسي': ['Gabsi'],
  'الصفاقسي': ['Sfaxi'],
  'الجموسي': ['Jammoussi'],
  'الساحلي': ['Sahli'],
  'الناصفي': ['Nacefi'],
  'الجباري': ['Jebari'],
  'العكرمي': ['Akremi'],
  'الغرياني': ['Gharyani'],
  'المسعودي': ['Messaoudi'],
  'المشرقي': ['Machregui'],
  'الشابي': ['Chabbi'],
  'اليحياوي': ['Yahyaoui'],
  'العرفاوي': ['Arfaoui'],
  'المنصوري': ['Mansouri'],
  'الصالحي': ['Salhi'],
  'السوسي': ['Soussi'],
  'الجزيري': ['Jeziri'],
  'المعموري': ['Maamouri'],
  'العلوي': ['Alaoui'],
  'الداودي': ['Daoudi']
};

export interface TransliteratedNameResult {
  isArabic: boolean;
  primaryFrench: string;
  variants: string[];
  firstNameFrench: string;
  lastNameFrench: string;
}

/**
 * Checks if a string contains Arabic script characters
 */
export function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/**
 * Normalizes Arabic string by removing diacritics, tatweel, and normalizing hamzas
 */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove tashkeel
    .replace(/\u0640/g, '')                 // remove tatweel
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

/**
 * Rule-based fallback phonetic transliteration from Arabic to Tunisian French
 */
function phoneticArabicToFrench(word: string): string {
  let clean = word.trim();
  if (!clean) return '';

  let prefix = '';
  // Check if starts with "ال" (El)
  if (clean.startsWith('ال') && clean.length > 3) {
    clean = clean.slice(2);
    prefix = ''; // in Tunisia, the article is often omitted in Latin surnames (e.g. الطرابلسي -> Trabelsi)
  }

  // Phonetic letter map (Tunisian French standards)
  const map: Record<string, string> = {
    'ا': 'a',
    'أ': 'a',
    'إ': 'i',
    'آ': 'a',
    'ب': 'b',
    'ت': 't',
    'ث': 'th',
    'ج': 'j',
    'ح': 'h',
    'خ': 'kh',
    'د': 'd',
    'ذ': 'dh',
    'ر': 'r',
    'ز': 'z',
    'س': 's',
    'ش': 'ch',
    'ص': 's',
    'ض': 'd',
    'ط': 't',
    'ظ': 'dh',
    'ع': 'a',
    'غ': 'gh',
    'ف': 'f',
    'ق': 'k',
    'ك': 'k',
    'ل': 'l',
    'م': 'm',
    'ن': 'n',
    'ه': 'h',
    'و': 'ou',
    'ي': 'i',
    'ة': 'a',
    'ى': 'a'
  };

  let result = '';
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    result += map[char] !== undefined ? map[char] : char;
  }

  // Cleanup French vocalic flow
  result = result
    .replace(/a{2,}/g, 'a')
    .replace(/i{2,}/g, 'i')
    .replace(/ou{2,}/g, 'ou');

  // Capitalize first letter
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  return prefix ? `${prefix} ${result}`.trim() : result;
}

/**
 * Main Transliteration Function:
 * Translates an Arabic full name or title into Tunisian French representations
 */
export function transliterateArabicName(rawName: string): TransliteratedNameResult {
  if (!rawName || !containsArabic(rawName)) {
    return {
      isArabic: false,
      primaryFrench: rawName || '',
      variants: rawName ? [rawName] : [],
      firstNameFrench: '',
      lastNameFrench: ''
    };
  }

  // Clean titles (Maître, Dr, etc. in Arabic)
  let cleanName = rawName
    .replace(/^(الأستاذ|الاستاذ|الأستاذة|الاستاذة|الدكتور|الدكتورة|المهندس|المهندسة|م\.|د\.)\s+/g, '')
    .trim();

  const tokens = cleanName.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return {
      isArabic: true,
      primaryFrench: rawName,
      variants: [rawName],
      firstNameFrench: '',
      lastNameFrench: ''
    };
  }

  const firstToken = tokens[0];
  const lastTokens = tokens.slice(1);
  const remainingString = lastTokens.join(' ');

  // 1. Resolve First Name
  let firstCandidates = TUNISIAN_FIRST_NAMES[firstToken] ||
    TUNISIAN_FIRST_NAMES[normalizeArabic(firstToken)] ||
    [phoneticArabicToFrench(firstToken)];

  // 2. Resolve Last Name
  let lastCandidates: string[] = [];
  if (remainingString) {
    if (TUNISIAN_SURNAMES[remainingString]) {
      lastCandidates = TUNISIAN_SURNAMES[remainingString];
    } else if (TUNISIAN_SURNAMES[normalizeArabic(remainingString)]) {
      lastCandidates = TUNISIAN_SURNAMES[normalizeArabic(remainingString)];
    } else {
      // Check each token in remaining
      const parts = lastTokens.map(t => {
        if (t === 'بن') return 'Ben';
        if (TUNISIAN_SURNAMES[t]) return TUNISIAN_SURNAMES[t][0];
        if (TUNISIAN_SURNAMES[normalizeArabic(t)]) return TUNISIAN_SURNAMES[normalizeArabic(t)][0];
        return phoneticArabicToFrench(t);
      });
      lastCandidates = [parts.join(' ')];
    }
  }

  const primaryFirst = firstCandidates[0] || '';
  const primaryLast = lastCandidates[0] || '';
  const primaryFrench = `${primaryFirst} ${primaryLast}`.trim();

  // Generate list of distinct plausible French transliteration variants
  const variantsSet = new Set<string>();
  if (primaryFrench) variantsSet.add(primaryFrench);

  for (const f of firstCandidates) {
    for (const l of (lastCandidates.length > 0 ? lastCandidates : [''])) {
      const v = `${f} ${l}`.trim();
      if (v) variantsSet.add(v);
    }
  }

  return {
    isArabic: true,
    primaryFrench,
    variants: Array.from(variantsSet),
    firstNameFrench: primaryFirst,
    lastNameFrench: primaryLast
  };
}
