import { WhatsAppContactRecord, WhatsAppCriteriaScores, TunisianOperator, ScriptType, ConfidenceLevel, WhatsAppFileAnalysis } from '../src/types';
import { GoogleGenAI, Type } from '@google/genai';

// Initialize GoogleGenAI lazily to avoid crashing on startup if API key is not yet set
let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
      aiClient = new GoogleGenAI({ 
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });
    }
  }
  return aiClient;
}

// Convert Eastern Arabic numerals (٠-٩) to Western Arabic (0-9)
function normalizeArabicNumerals(str: string): string {
  const easternNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return str.replace(/[٠-٩]/g, match => easternNumerals.indexOf(match).toString());
}

// Common Arabic noise words that are definitely not personal names
const ARABIC_NOISE_WORDS = new Set([
  'هاتف', 'جوال', 'موبايل', 'واتساب', 'واتس', 'اتصال', 'تلفون', 'فاكس', 'رقم',
  'العنوان', 'تونس', 'سوسة', 'صفاقس', 'نابل', 'بنزرت', 'المنستير', 'أريانة', 'بن عروس', 'منوبة',
  'السعر', 'دينار', 'د.ت', 'dt', 'دنانير', 'ميليم', 'ثمن', 'سوم', 'سومه',
  'مرحبا', 'شكرا', 'السلام', 'عليكم', 'صباح الخير', 'مساء الخير',
  'للبيع', 'للشراء', 'كراء', 'عاجل', 'هام', 'توصيل', 'مجاني', 'متوفر', 'جديد', 'مستعمل',
  'صفحة', 'إعلان', 'اعلان', 'رسالة', 'تعليق', 'موقع', 'فيسبوك', 'فايسبوك', 'انستغرام',
  'مشاركة', 'ملاحظة', 'تحذير', 'مساعدة', 'خدمة', 'خدمات', 'شركة', 'محل', 'مكتب',
  'الرجاء', 'يرجى', 'الاتصال', 'للاتصال', 'للحجز', 'للاستفسار', 'المزيد', 'التفاصيل',
  'تخفيض', 'عرض', 'خاص', 'فرصة', 'الكمية', 'محدودة', 'حالة', 'ممتازة', 'نظيفة', 'نظيف',
  'شارع', 'نهج', 'طريق', 'مسلك', 'زنقة', 'حي', 'عمارة', 'إقامة', 'اقامة', 'مركب', 'طابق', 'عدد'
]);

// Common Latin noise words that are not personal names
const LATIN_NOISE_WORDS = new Set([
  'tel', 'tél', 'telephone', 'gsm', 'whatsapp', 'wa', 'mobile', 'fixe', 'fax', 'phone', 'numero', 'numéro',
  'tunisie', 'tunis', 'ariana', 'sousse', 'sfax', 'nabeul', 'bizerte', 'monastir', 'ben arous', 'manouba',
  'prix', 'dinars', 'dinar', 'dt', 'tnd', 'millimes', 'choc', 'promo', 'promotion', 'solde',
  'bonjour', 'bonsoir', 'salut', 'merci', 'svp', 'urgent', 'disponible', 'nouveau', 'occasion', 'etat', 'neuf',
  'vendre', 'achat', 'location', 'louer', 'livraison', 'gratuite', 'dispo', 'page', 'facebook', 'instagram',
  'contact', 'contactez', 'appelez', 'infos', 'info', 'details', 'annonce', 'boutique', 'agence', 'societe',
  'entreprise', 'service', 'services', 'magasin', 'offre', 'special', 'qualite', 'garantie', 'original',
  'de', 'a', 'à', 'le', 'la', 'les', 'pour', 'avec', 'sans', 'dans', 'sur', 'sous',
  'rue', 'avenue', 'boulevard', 'residence', 'immeuble', 'batiment', 'etage', 'appartement'
]);

// Arabic address indicators (Street, Avenue, Road, Quarter, Building, Number...)
const ARABIC_ADDRESS_KEYWORDS = [
  'شارع', 'نهج', 'طريق', 'مسلك', 'زنقة', 'حي', 'عمارة', 'إقامة', 'اقامة',
  'مركب', 'مركز', 'برج', 'مدرج', 'درج', 'طابق', 'عدد', 'مكرر', 'ص.ب', 'صندوق بريد',
  'ساحة', 'مقر', 'تقاطع', 'مدخل', 'بلوك', 'منطقة', 'المنطقة الصناعية', 'قرب', 'قبالة',
  'وراء', 'بجانب', 'شقة', 'محل', 'سوق', 'باب'
];

// French/Latin address indicators
const LATIN_ADDRESS_KEYWORDS = [
  'rue', 'avenue', 'av.', 'av ', 'boulevard', 'bd', 'route', 'rte', 'impasse',
  'residence', 'résidence', 'res.', 'immeuble', 'imm.', 'imm ', 'batiment', 'bâtiment', 'bat.', 'bloc',
  'complexe', 'centre', 'etage', 'étage', 'etg', 'appartement', 'appt', 'apt', 'bureau', 'local',
  'n°', 'no', 'numero', 'numéro', 'lot', 'ilot', 'zone', 'z.i', 'zi', 'bp', 'b.p',
  'boite postale', 'boîte postale', 'code postal', 'cp'
];

// Tunisian Governorates & Major Localities
const TUNISIAN_GOVERNORATES = new Set([
  'tunis', 'ariana', 'ben arous', 'manouba', 'nabeul', 'zaghouan', 'bizerte',
  'beja', 'béja', 'jendouba', 'le kef', 'kef', 'siliana', 'sousse', 'monastir',
  'mahdia', 'sfax', 'kairouan', 'kasserine', 'sidi bouzid', 'gabes', 'gabès',
  'medenine', 'médenine', 'tataouine', 'gafsa', 'tozeur', 'kebili', 'kébili',
  'la marsa', 'carthage', 'sidi bou said', 'le bardo', 'ennasr', 'lac', 'berges du lac',
  'تونس', 'أريانة', 'اريانة', 'بن عروس', 'منوبة', 'نابل', 'زغوان', 'بنزرت',
  'باجة', 'جندوبة', 'الكاف', 'سليانة', 'سوسة', 'المنستير', 'المهدية', 'صفاقس',
  'القيروان', 'القصرين', 'سيدي بوزيد', 'قابس', 'مدنين', 'تطاوين', 'قفصة', 'توزر', 'قبلي',
  'المرسى', 'قرطاج', 'سيدي بوسعيد', 'باردو', 'النصر', 'البحيرة'
]);

// Professional Job Titles / Status words alone (must not be taken as a person's name)
const JOB_STATUS_WORDS = new Set([
  'stagiaire', 'متمرن', 'titulaire', 'مرسم', 'avocat', 'محامي', 'محامية',
  'notaire', 'عدل إشهاد', 'عدل اشهاد', 'huissier', 'عدل منفذ', 'docteur', 'دكتور',
  'ingénieur', 'ingenieur', 'مهندس', 'architecte', 'معماري', 'expert', 'خبير',
  'comptable', 'محاسب', 'directeur', 'مدير', 'gérant', 'gerant', 'وكيل', 'secrétaire', 'كاتب',
  'professeur', 'أستاذ', 'استاذ'
]);

// Labels to strip from the beginning of candidate names
const ARABIC_PREFIX_LABELS = [
  'الاسم', 'الإسم', 'اسم', 'إسم', 'المشتري', 'البائع', 'صاحب الإعلان', 'صاحب الرقم', 
  'الاتصال ب', 'للاتصال ب', 'اتصل ب', 'المعني', 'الزبون', 'الحريف', 'السيد', 'السيدة', 
  'الأخ', 'الأخت', 'الدكتور', 'الأستاذ', 'الأستاذة', 'المهندس', 'المحامي', 'المحامية',
  'المرسم', 'المتمرن', 'الحاج', 'الشيخ'
];

const LATIN_PREFIX_LABELS = [
  'nom', 'prenom', 'prénom', 'client', 'vendeur', 'contact', 'mr', 'mme', 'dr', 'docteur',
  'ing', 'maitre', 'maître', 'me', 'avocat', 'avocate', 'de', 'par', 'interlocuteur', 'responsable'
];

/**
 * Checks if a string or line is an Address / Street (Rue, Avenue, Immeuble, Numéro...)
 */
export function isAddressLine(line: string): boolean {
  if (!line || !line.trim()) return false;
  const lower = line.toLowerCase().trim();

  // Arabic address check
  for (const kw of ARABIC_ADDRESS_KEYWORDS) {
    const regex = new RegExp(`(?:^|[\\s,;.:/\\-])${kw}(?:[\\s,;.:/\\-]|$|\\d)`, 'u');
    if (regex.test(lower)) return true;
  }

  // Latin address check
  for (const kw of LATIN_ADDRESS_KEYWORDS) {
    const escaped = kw.replace('.', '\\.');
    const regex = new RegExp(`(?:^|[\\s,;.:/\\-])${escaped}(?:[\\s,;.:/\\-]|$|\\d)`, 'i');
    if (regex.test(lower)) return true;
  }

  // Postal code pattern (e.g. 1000 Tunis, 2080 Ariana, etc.)
  if (/\b[1-9]\d{3}\s+(?:tunis|ariana|sousse|sfax|nabeul|bizerte|بن عروس|أريانة|تونس|سوسة|صفاقس)\b/i.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Checks if a line is pure metadata, directory header, URL, or standalone status
 */
export function isMetadataOrHeaderLine(line: string): boolean {
  if (!line || !line.trim()) return true;
  const trimmed = line.trim();
  const lower = trimmed.toLowerCase();

  // Standalone numbers or record index (e.g. "1", "2", "123")
  if (/^\d{1,4}$/.test(trimmed)) return true;

  // Very short category code or abbreviation (<= 2 chars e.g. "أخ", "أ", "ب", "N/A")
  if (trimmed.length <= 2) return true;

  // Gouvernorat headers
  if (/^(?:gouvernorat|gouv|ولاية|الولاية|ville|المدينة)\s*[:\-]?\s*$/i.test(trimmed)) return true;
  if (/^(?:gouvernorat|gouv|ولاية|الولاية)\s*[:\-]?\s*[\p{L}\s]+$/iu.test(trimmed)) return true;

  // Pure Governorate or city name alone
  if (TUNISIAN_GOVERNORATES.has(lower)) return true;

  // Pure Job Status / Title alone
  if (JOB_STATUS_WORDS.has(lower)) return true;

  // URLs, email addresses or web paths (e.g. avocat.org.tn, /annuaire/...)
  if (/(?:\.tn|\.com|\.org|\.net|\.fr|\/annuaire|\bhttps?:\/\/|\bwww\.)/i.test(trimmed)) return true;

  // Phone / Fax / GSM label alone or prefix line
  if (/^(?:tél|tel|gsm|fax|fixe|mobile|phone|هاتف|فاكس|جوال|واتساب)\s*[:\-]?\s*(?:\d+.*)?$/i.test(trimmed)) return true;

  return false;
}

/**
 * 1. Clean raw text, normalize Arabic digits, strip HTML
 */
export function cleanText(rawText: string): string {
  if (!rawText) return '';
  
  let cleaned = normalizeArabicNumerals(rawText);

  // Strip HTML tags if present
  if (/<[a-z][\s\S]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  }

  // Replace common HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  // Normalize line returns
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return cleaned;
}

/**
 * Determine Tunisian Operator based on the first 2 digits of the 8-digit number
 */
export function getTunisianOperator(clean8Digits: string): TunisianOperator {
  if (!clean8Digits || clean8Digits.length !== 8) return 'Autre';
  const prefix = clean8Digits.slice(0, 2);
  const firstDigit = clean8Digits.charAt(0);

  // Ooredoo: 2x (20-29)
  if (firstDigit === '2') {
    return 'Ooredoo';
  }

  // Orange: 5x (50-58)
  if (firstDigit === '5') {
    return 'Orange';
  }

  // Tunisie Telecom: 9x (90-99)
  if (firstDigit === '9') {
    return 'Tunisie Telecom';
  }

  // Lycamobile: 4x (40-48)
  if (firstDigit === '4') {
    return 'Lycamobile';
  }

  // Fixe / VoIP: 7x (Fixe Telecom/Orange/Ooredoo) or 3x (VoIP/FAI)
  if (firstDigit === '7' || firstDigit === '3') {
    return 'Fixe/VoIP';
  }

  return 'Autre';
}

/**
 * Checks if a string contains Arabic characters
 */
export function isArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

/**
 * Format 8-digit phone number
 */
export function formatPhoneNumber(clean8Digits: string): {
  national: string;
  international: string;
  waLink: string;
} {
  const p1 = clean8Digits.slice(0, 2);
  const p2 = clean8Digits.slice(2, 5);
  const p3 = clean8Digits.slice(5, 8);

  const national = `${p1} ${p2} ${p3}`;
  const international = `+216 ${p1} ${p2} ${p3}`;
  const waLink = `https://wa.me/216${clean8Digits}`;

  return { national, international, waLink };
}

/**
 * Cleans and formats a name candidate
 */
export function sanitizeName(raw: string): { name: string; scriptType: ScriptType } {
  if (!raw) return { name: 'Inconnu', scriptType: 'latin' };

  let text = raw.trim();

  // Address check: if raw line is an address, reject immediately
  if (isAddressLine(text)) {
    return { name: 'Inconnu', scriptType: 'latin' };
  }

  // Strip punctuation & symbols (keeping Arabic and Latin letters, spaces, hyphens, and apostrophes)
  text = text.replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '').trim();

  // Strip leading Arabic prefix labels
  for (const label of ARABIC_PREFIX_LABELS) {
    const regex = new RegExp(`^${label}\\s*[:\\-]?\\s*`, 'iu');
    if (regex.test(text)) {
      text = text.replace(regex, '').trim();
    }
  }

  // Strip leading Latin prefix labels
  for (const label of LATIN_PREFIX_LABELS) {
    const regex = new RegExp(`^${label}\\s*[:\\-]?\\s*`, 'i');
    if (regex.test(text)) {
      text = text.replace(regex, '').trim();
    }
  }

  // Check script type
  const hasArabic = isArabic(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  let scriptType: ScriptType = 'latin';
  if (hasArabic && hasLatin) scriptType = 'mixed';
  else if (hasArabic) scriptType = 'arabic';
  else scriptType = 'latin';

  // Filter out if words are just noise
  const words = text.split(/\s+/).filter(Boolean);
  const meaningfulWords = words.filter(w => {
    const lower = w.toLowerCase();
    return !ARABIC_NOISE_WORDS.has(lower) && 
           !LATIN_NOISE_WORDS.has(lower) && 
           !TUNISIAN_GOVERNORATES.has(lower) &&
           !JOB_STATUS_WORDS.has(lower) &&
           w.length >= 2;
  });

  if (meaningfulWords.length === 0) {
    return { name: 'Inconnu', scriptType };
  }

  // Double check if remaining text constitutes an address or metadata
  const combined = meaningfulWords.join(' ');
  if (isAddressLine(combined) || isMetadataOrHeaderLine(combined)) {
    return { name: 'Inconnu', scriptType };
  }

  // Format Latin names with proper capitalization
  if (scriptType === 'latin') {
    const formatted = meaningfulWords
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
    return { name: formatted, scriptType };
  }

  // Arabic names: join cleanly
  const formattedArabic = meaningfulWords.join(' ');
  return { name: formattedArabic, scriptType };
}

/**
 * Evaluates candidate line or segment for name quality
 */
function evaluateNameCandidate(line: string, phoneStr: string): { name: string; scoreBonus: number } {
  if (!line || !line.trim()) {
    return { name: '', scoreBonus: 0 };
  }

  // 1. Explicit Address Check: if line contains street, avenue, building, address number -> REJECT
  if (isAddressLine(line)) {
    return { name: '', scoreBonus: 0 };
  }

  // 2. Explicit Metadata Check: if line is governorate, URL, title alone, index -> REJECT
  if (isMetadataOrHeaderLine(line)) {
    return { name: '', scoreBonus: 0 };
  }

  // Remove the phone string from the line
  let candidate = line.replace(phoneStr, ' ').trim();

  // Strip common phone indicators (tel, gsm, whatsapp, etc.)
  candidate = candidate
    .replace(/(?:whatsapp|wa\.me|wa|gsm|tél|tel|phone|téléphone|هاتف|واتساب|جوال|اتصال|رقم)[\s:\-.]*/gi, ' ')
    .trim();

  // Strip price tags (e.g. 150 dt, 200 dinars, 150د.ت)
  candidate = candidate.replace(/\b\d+\s*(?:dt|tnd|dinars?|د\.ت|دينار)\b/gi, ' ').trim();

  // Strip remaining solitary digits
  candidate = candidate.replace(/\b\d+\b/g, ' ').trim();

  // Re-verify that stripped candidate is not address or metadata
  if (isAddressLine(candidate) || isMetadataOrHeaderLine(candidate)) {
    return { name: '', scoreBonus: 0 };
  }

  const { name } = sanitizeName(candidate);
  if (name === 'Inconnu') {
    return { name: '', scoreBonus: 0 };
  }

  const words = name.split(/\s+/).filter(Boolean);
  let bonus = 15;
  if (words.length >= 2 && words.length <= 4) {
    bonus = 30; // Ideal full name (Prénom + Nom)
  } else if (words.length === 1) {
    bonus = 15;
  } else if (words.length > 4) {
    bonus = 10; // Might be a long phrase
  }

  return { name, scoreBonus: bonus };
}

/**
 * 2. Perform Heuristic Extraction of Tunisian Phone Numbers & Names
 */
export function parseWhatsAppTextHeuristically(rawText: string, fileName: string = 'fichier.txt'): WhatsAppContactRecord[] {
  const text = cleanText(rawText);
  if (!text.trim()) return [];

  const lines = text.split('\n');
  const contacts: WhatsAppContactRecord[] = [];
  const seenPhones = new Set<string>();

  // Comprehensive Tunisian Phone Regex
  // Matches:
  // - +216 22 123 456
  // - 00216 22 123 456
  // - (216) 22 123 456
  // - 22 123 456, 50-456-789, 98.765.432, 22123456
  // Leading prefix: 2x, 4x, 5x, 7x, 9x, or 3x
  const tunisianPhoneRegex = /(?:(?:\+|00)?216\s*[\(\-\.\s]?\s*)?([2345789]\d)[\)\-\.\s]?\s*(\d{2,3})[\-\.\s]?\s*(\d{2,4})/g;

  // We scan line by line to maintain exact line indices for proximity calculation
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (!line.trim()) continue;

    // Reject obvious dates on this line before parsing numbers (e.g. 12/03/2026 or 2026-03-12)
    if (/\b(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/.test(line) && !/(?:tel|tél|gsm|whatsapp|هاتف|واتساب)/i.test(line)) {
      // Check if this line is purely a date header
      if (/^\s*(?:date|le|publié|posted|time)?\s*[:\-]?\s*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/i.test(line.trim())) {
        continue;
      }
    }

    let match: RegExpExecArray | null;
    tunisianPhoneRegex.lastIndex = 0;

    while ((match = tunisianPhoneRegex.exec(line)) !== null) {
      const fullMatch = match[0].trim();
      
      // Extract digits only
      const digitsOnly = fullMatch.replace(/\D/g, '');
      let clean8 = '';

      if (digitsOnly.startsWith('216') && digitsOnly.length === 11) {
        clean8 = digitsOnly.slice(3);
      } else if (digitsOnly.startsWith('00216') && digitsOnly.length === 13) {
        clean8 = digitsOnly.slice(5);
      } else if (digitsOnly.length === 8) {
        clean8 = digitsOnly;
      } else {
        // Doesn't strictly normalize to 8 digits
        continue;
      }

      // Validate valid Tunisian initial digits: 2, 3, 4, 5, 7, 8, 9
      const firstDigit = clean8.charAt(0);
      if (!['2', '3', '4', '5', '7', '8', '9'].includes(firstDigit)) {
        continue;
      }

      // Check if this is a false positive (e.g. year 2026 repeated, price like 25000000)
      if (/^(\d)\1{7}$/.test(clean8)) {
        // Repeated single digit (e.g. 22222222)
        continue;
      }

      // Anti-CIN check: if explicitly preceded by CIN / ب.ت.و or Carte d'identité
      const beforeMatchContext = line.slice(0, match.index).toLowerCase();
      if (/(?:cin|ب\.ت\.و|بطاقة|identité)/i.test(beforeMatchContext)) {
        continue;
      }

      const operator = getTunisianOperator(clean8);
      const isMobile = ['Ooredoo', 'Orange', 'Tunisie Telecom', 'Lycamobile'].includes(operator);

      // Search for the best Name candidate within surrounding record block:
      // In directory cards and structured listings:
      // - Name is placed at the top of the card (often 1 to 10 lines above phone number, right before "Gouvernorat :", Address, or Status).
      // - Same line is common in compact listings (e.g. "Omar Trabelsi 22 123 456").
      let bestName = '';
      let bestNameScore = 0;
      let distanceScore = 0;
      let bestNameLineIndex = -1;
      let highestCandidateScore = -999;

      // 1. Same line check
      const sameLineEval = evaluateNameCandidate(line, fullMatch);
      if (sameLineEval.name) {
        bestName = sameLineEval.name;
        bestNameScore = sameLineEval.scoreBonus;
        distanceScore = 10;
        bestNameLineIndex = lineIndex;
        highestCandidateScore = sameLineEval.scoreBonus + 30; // Strong bonus for same-line
      }

      // 2. Scan backwards (up to 12 lines above)
      // Stop if we hit an earlier contact's phone number that isn't immediately adjacent
      const maxLookback = Math.max(0, lineIndex - 12);
      for (let prevIdx = lineIndex - 1; prevIdx >= maxLookback; prevIdx--) {
        const prevLine = lines[prevIdx];
        if (!prevLine.trim()) {
          // If we hit an empty line and already have a strong candidate, stop so we don't cross into earlier card
          if (bestName && highestCandidateScore >= 50) break;
          continue;
        }

        // Check if this line is an index separator (e.g. "1", "2") and we already found a strong candidate
        if (/^\d{1,4}$/.test(prevLine.trim()) && bestName && highestCandidateScore >= 50) {
          break;
        }

        // Check if this line contains another phone number belonging to a PREVIOUS record.
        // It is NOT a previous record if it's metadata (e.g. /annuaire/9000012078) or if it's an adjacent phone line in the same card.
        if (!isMetadataOrHeaderLine(prevLine)) {
          const isPhoneLine = /(?:^|[^\w/])(?:(?:\+|00)?216\s*)?[2345789]\d[\s\-\.]?\d{2,3}[\s\-\.]?\d{2,4}(?:[^\w/]|$)/.test(prevLine);
          if (isPhoneLine && prevIdx < lineIndex - 1) {
            if (bestName && highestCandidateScore >= 50) {
              break;
            }
          }
        }

        // Evaluate candidate line
        const evalRes = evaluateNameCandidate(prevLine, '');
        if (evalRes.name) {
          let candidateScore = evalRes.scoreBonus;

          // DIRECTORY PATTERN RECOGNITION:
          // Check if the line immediately following this candidate (or +2 lines) is a Governorate header,
          // a Governorate name, or an address block.
          // Example from Tunisian directories:
          //   [Nom de la personne: أمل خالدي]
          //   Gouvernorat : Tunis
          //   شارع الحبيب ثامر عدد 23
          let isDirectoryHeader = false;
          if (prevIdx + 1 < lines.length) {
            const nextLineAfterCand = lines[prevIdx + 1].trim();
            if (/^(?:gouvernorat|gouv|ولاية|الولاية|ville|المدينة)/i.test(nextLineAfterCand) ||
                TUNISIAN_GOVERNORATES.has(nextLineAfterCand.toLowerCase())) {
              isDirectoryHeader = true;
            }
          }
          if (!isDirectoryHeader && prevIdx + 2 < lines.length) {
            const linePlus2 = lines[prevIdx + 2].trim();
            if (/^(?:gouvernorat|gouv|ولاية|الولاية)/i.test(linePlus2)) {
              isDirectoryHeader = true;
            }
          }

          if (isDirectoryHeader) {
            // Massive bonus: this is the explicit person's name at the head of a directory entry!
            candidateScore += 75;
          }

          // Proximity discount: slight decrease for distance (1 pt per line)
          const lineDistance = lineIndex - prevIdx;
          candidateScore -= lineDistance * 1.5;

          if (candidateScore > highestCandidateScore) {
            highestCandidateScore = candidateScore;
            bestName = evalRes.name;
            bestNameScore = evalRes.scoreBonus;
            bestNameLineIndex = prevIdx;
            distanceScore = Math.max(3, 10 - lineDistance);

            // Once the directory header name is found (e.g. "أمل خالدي" followed by "Gouvernorat :"),
            // we have reached the true header of this directory card! Stop scanning further up.
            if (isDirectoryHeader) {
              break;
            }
          }
        }
      }

      // 3. Forward scan fallback (up to 3 lines below) if still no candidate
      if (!bestName) {
        const maxLookahead = Math.min(lines.length - 1, lineIndex + 3);
        for (let nextIdx = lineIndex + 1; nextIdx <= maxLookahead; nextIdx++) {
          const nextLine = lines[nextIdx];
          if (!nextLine.trim()) break;
          const nextEval = evaluateNameCandidate(nextLine, '');
          if (nextEval.name) {
            bestName = nextEval.name;
            bestNameScore = nextEval.scoreBonus;
            distanceScore = 4;
            bestNameLineIndex = nextIdx;
            break;
          }
        }
      }

      // Context block for preview: include from candidate name down to phone number
      const contextStart = Math.max(0, bestNameLineIndex >= 0 ? Math.min(bestNameLineIndex, lineIndex - 2) : lineIndex - 2);
      const contextEnd = Math.min(lines.length - 1, lineIndex + 2);
      const rawContext = lines.slice(contextStart, contextEnd + 1).join('\n');

      // Check context for telephone / whatsapp keywords
      const hasContextKeyword = /(?:tel|tél|gsm|whatsapp|wa\.me|wa|phone|contact|هاتف|واتساب|جوال|اتصال)/i.test(rawContext);

      // Determine script type
      const finalNameObj = sanitizeName(bestName);
      const displayName = finalNameObj.name === 'Inconnu' ? 'Inconnu' : finalNameObj.name;
      const scriptType = finalNameObj.scriptType;

      // Compute Confidence Score (0-100)
      let score = 35; // Base for valid Tunisian number
      if (isMobile) score += 15; // Mobile is primary for WhatsApp
      if (displayName !== 'Inconnu') score += bestNameScore;
      if (hasContextKeyword) score += 10;
      if (distanceScore >= 8) score += 10;

      // Cap score between 0 and 100
      score = Math.min(100, Math.max(20, score));

      let confidenceLevel: ConfidenceLevel = 'Low';
      if (score >= 75) confidenceLevel = 'High';
      else if (score >= 50) confidenceLevel = 'Medium';

      const { national, international, waLink } = formatPhoneNumber(clean8);

      const criteriaScores: WhatsAppCriteriaScores = {
        validTunisianNumber: true,
        operatorDetected: operator !== 'Autre',
        nameFound: displayName !== 'Inconnu',
        distanceScore,
        hasContextKeyword,
        nameWordCount: displayName === 'Inconnu' ? 0 : displayName.split(/\s+/).length,
        scriptType,
        isMobile
      };

      const record: WhatsAppContactRecord = {
        id: `wa-${clean8}-${contacts.length + 1}`,
        name: displayName,
        rawPhone: fullMatch,
        cleanPhone: clean8,
        formattedNational: national,
        formattedInternational: international,
        waLink,
        operator,
        scriptType,
        rawContext,
        confidenceScore: score,
        confidenceLevel,
        criteriaScores,
        sourceFile: fileName
      };

      // Handle duplicate phone numbers within the same file:
      // If we've seen this phone before, keep the record with higher confidence score or a better name!
      const existingIdx = contacts.findIndex(c => c.cleanPhone === clean8);
      if (existingIdx !== -1) {
        const existing = contacts[existingIdx];
        if (record.confidenceScore > existing.confidenceScore || (existing.name === 'Inconnu' && record.name !== 'Inconnu')) {
          contacts[existingIdx] = record;
        }
      } else {
        contacts.push(record);
        seenPhones.add(clean8);
      }
    }
  }

  // Auto-validation pass: sort by confidence descending
  contacts.sort((a, b) => b.confidenceScore - a.confidenceScore);

  return contacts;
}

/**
 * 3. File Content Analysis for Metrics Dashboard
 */
export function analyzeWhatsAppFileContent(rawText: string, contacts: WhatsAppContactRecord[]): WhatsAppFileAnalysis {
  const text = cleanText(rawText);
  const lines = text.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim().length > 0).length;

  let ooredooCount = 0;
  let orangeCount = 0;
  let ttCount = 0;
  let lycaCount = 0;
  let fixeCount = 0;
  let otherCount = 0;
  let arabicScriptCount = 0;
  let latinScriptCount = 0;

  for (const c of contacts) {
    switch (c.operator) {
      case 'Ooredoo': ooredooCount++; break;
      case 'Orange': orangeCount++; break;
      case 'Tunisie Telecom': ttCount++; break;
      case 'Lycamobile': lycaCount++; break;
      case 'Fixe/VoIP': fixeCount++; break;
      default: otherCount++; break;
    }

    if (c.scriptType === 'arabic') arabicScriptCount++;
    else if (c.scriptType === 'latin') latinScriptCount++;
    else if (c.scriptType === 'mixed') {
      arabicScriptCount++;
      latinScriptCount++;
    }
  }

  const operatorDistribution: { operator: TunisianOperator; count: number }[] = [
    { operator: 'Ooredoo' as const, count: ooredooCount },
    { operator: 'Orange' as const, count: orangeCount },
    { operator: 'Tunisie Telecom' as const, count: ttCount },
    { operator: 'Lycamobile' as const, count: lycaCount },
    { operator: 'Fixe/VoIP' as const, count: fixeCount },
    { operator: 'Autre' as const, count: otherCount }
  ].filter(op => op.count > 0);

  const characterCount = text.length;
  const averageLineLength = lines.length > 0 ? Math.round(characterCount / lines.length) : 0;

  return {
    totalLines: lines.length,
    nonEmptyLines,
    totalPhonesDetected: contacts.length,
    operatorDistribution,
    ooredooCount,
    orangeCount,
    ttCount,
    lycaCount,
    fixeCount,
    otherCount,
    arabicScriptCount,
    latinScriptCount,
    averageLineLength,
    characterCount
  };
}

/**
 * 4. Optional AI Refinement with Gemini for Ambiguous WhatsApp Contacts
 */
export async function refineWhatsAppWithAI(
  contacts: WhatsAppContactRecord[]
): Promise<WhatsAppContactRecord[]> {
  const ai = getAiClient();
  if (!ai) return contacts;

  // Filter contacts with low or medium confidence or with 'Inconnu' name
  const candidatesForRefinement = contacts.filter(
    c => c.confidenceLevel !== 'High' || c.name === 'Inconnu'
  );

  if (candidatesForRefinement.length === 0) return contacts;

  // Limit to top 10 most ambiguous to protect latency & tokens
  const subsetToRefine = candidatesForRefinement.slice(0, 10);

  const promptBlocks = subsetToRefine.map(c => ({
    id: c.id,
    cleanPhone: c.cleanPhone,
    currentName: c.name,
    rawContext: c.rawContext
  }));

  const systemInstruction = `Tu es un expert en analyse de texte et extraction d'annuaires professionnels tunisiens (avocats, médecins, sociétés, etc.).
Tu reçois des blocs de texte contenant des numéros de téléphone tunisiens et des contextes multi-lignes.
Ta tâche est de trouver le VRAI nom et prénom de la personne titulaire du contact.

RÈGLES CRUCIALES :
1. RÈGLE D'OR (ANTI-ADRESSE) : Ne confonds JAMAIS une adresse ou un nom de rue/quartier avec le nom de la personne !
   Les lignes contenant شارع, نهج, طريق, حي, عمارة, إقامة, عدد, طابق, rue, avenue, bd, résidence, immeuble, etc. (ex: "شارع الحبيب ثامر عدد 23", "نهج فلسطين", "عمارة السلام") sont des ADRESSES et NE DOIVENT JAMAIS être extraites comme nom.
2. STRUCTURE D'ANNUAIRE : Dans les annuaires professionnels tunisiens, le nom de la personne se trouve souvent tout en haut de la fiche, placé juste avant "Gouvernorat :", la ville, ou l'adresse (ex: "أمل خالدي" placé avant "Gouvernorat : Tunis").
3. Les noms peuvent être en arabe (ex: أمل خالدي, محمد بن علي, سارة) ou en caractères latins (ex: Amel Khaldi, Mohamed Ali).
4. Ignore les titres ou statuts professionnels isolés (ex: Stagiaire, Titulaire, Avocat, متمرن, مرسم).
5. Ignore les mots parasites (ex: للبيع, هاتف, واتساب, Tél, GSM, urgent, prix, contact, etc.).
6. Si un nom réel de personne est présent dans le bloc, retourne-le exactement tel quel avec sa bonne casse.
7. Si aucun nom de personne réel n'existe dans le contexte, retourne "Inconnu".`;

  const userPrompt = `Analyse ces ${promptBlocks.length} contacts tunisiens incertains et donne pour chacun le nom extrait le plus précis :\n${JSON.stringify(promptBlocks, null, 2)}`;

  // Wrap in timeout race for safe execution (15s max)
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('AI Enhancement Timeout (15s)')), 15000);
  });

  const aiPromise = ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: userPrompt,
    config: {
      temperature: 0.1,
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            refinedName: { type: Type.STRING },
            confidence: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] }
          },
          required: ['id', 'refinedName']
        }
      }
    }
  });

  try {
    const response: any = await Promise.race([aiPromise, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);

    const rawText = typeof response?.text === 'function' ? response.text() : response?.text;
    const responseText = rawText || '[]';
    const parsedResults: { id: string; refinedName: string; confidence?: ConfidenceLevel }[] = JSON.parse(responseText);

    const updated = contacts.map(c => {
      const matchAi = parsedResults.find(r => r.id === c.id);
      if (matchAi && matchAi.refinedName && matchAi.refinedName !== 'Inconnu') {
        const { name, scriptType } = sanitizeName(matchAi.refinedName);
        if (name !== 'Inconnu') {
          return {
            ...c,
            name,
            scriptType,
            confidenceScore: Math.min(95, c.confidenceScore + 25),
            confidenceLevel: (matchAi.confidence || 'High') as ConfidenceLevel,
            criteriaScores: {
              ...c.criteriaScores,
              nameFound: true,
              scriptType
            }
          };
        }
      }
      return c;
    });

    return updated;
  } catch (err) {
    console.warn('[WhatsApp Extractor] Gemini AI refinement skipped or timed out, keeping heuristic results:', err);
    return contacts;
  }
}
