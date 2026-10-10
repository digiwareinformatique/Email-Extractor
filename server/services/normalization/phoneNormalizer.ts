/**
 * Phone Number Normalization Engine for Tunisian Telecom Networks (+216)
 * STE DigiWare SUARL
 */

export interface NormalizedPhoneResult {
  isValid: boolean;
  rawInput: string;
  normalizedE164: string;    // e.g. +21656047243
  e164: string;              // Alias for normalizedE164
  clean8: string;             // e.g. 56047243
  nationalFormatted: string;  // e.g. 56 047 243
  national: string;          // Alias for nationalFormatted
  operator: 'Ooredoo' | 'Orange' | 'Tunisie Telecom' | 'Lycamobile' | 'Fixe/VoIP' | 'Autre';
  isMobile: boolean;
}

/**
 * Detects Tunisian Telecom Operator by initial digits
 */
export function getTunisianOperator(clean8: string): NormalizedPhoneResult['operator'] {
  if (clean8.length !== 8) return 'Autre';

  const prefix2 = clean8.slice(0, 2);
  const prefix1 = clean8.slice(0, 1);

  // Ooredoo Tunisia
  if (['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'].includes(prefix2) || prefix1 === '2') {
    return 'Ooredoo';
  }

  // Orange Tunisie
  if (['50', '51', '52', '53', '54', '55', '56', '57', '58', '59'].includes(prefix2) || prefix1 === '5') {
    return 'Orange';
  }

  // Tunisie Telecom (Mobile)
  if (['90', '91', '92', '93', '94', '95', '96', '97', '98', '99', '40', '41', '42', '44', '46', '48'].includes(prefix2) || prefix1 === '9') {
    return 'Tunisie Telecom';
  }

  // Lycamobile Tunisie
  if (['43', '45', '47', '49'].includes(prefix2)) {
    return 'Lycamobile';
  }

  // Fixed Landline / VoIP (70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 30, 31, 32, 36, 39, 80, 81, 82, 88)
  if (['70', '71', '72', '73', '74', '75', '76', '77', '78', '79', '30', '31', '32', '36', '39', '80', '81', '82', '88'].includes(prefix2) || prefix1 === '7' || prefix1 === '3') {
    return 'Fixe/VoIP';
  }

  return 'Autre';
}

/**
 * Normalizes any raw phone input to E.164 and Tunisian 8-digit format
 */
export function normalizeTunisianPhone(raw: string): NormalizedPhoneResult {
  if (!raw) {
    return {
      isValid: false,
      rawInput: '',
      normalizedE164: '',
      e164: '',
      clean8: '',
      nationalFormatted: '',
      national: '',
      operator: 'Autre',
      isMobile: false
    };
  }

  const rawClean = raw.trim();
  // Strip all non-digit characters except leading plus
  let digits = rawClean.replace(/\D/g, '');

  let clean8 = '';

  if (digits.startsWith('00216') && digits.length === 13) {
    clean8 = digits.slice(5);
  } else if (digits.startsWith('216') && digits.length === 11) {
    clean8 = digits.slice(3);
  } else if (digits.length === 8) {
    clean8 = digits;
  } else if (digits.length > 8 && digits.endsWith(digits.slice(-8))) {
    const candidate = digits.slice(-8);
    if (['2', '3', '4', '5', '7', '8', '9'].includes(candidate[0])) {
      clean8 = candidate;
    }
  }

  // Validate 8 digits starting with 2, 3, 4, 5, 7, 8, 9
  const firstDigit = clean8.charAt(0);
  const isValid = clean8.length === 8 && ['2', '3', '4', '5', '7', '8', '9'].includes(firstDigit) && !/^(\d)\1{7}$/.test(clean8);

  if (!isValid) {
    return {
      isValid: false,
      rawInput: raw,
      normalizedE164: '',
      e164: '',
      clean8: '',
      nationalFormatted: rawClean,
      national: rawClean,
      operator: 'Autre',
      isMobile: false
    };
  }

  const operator = getTunisianOperator(clean8);
  const isMobile = ['Ooredoo', 'Orange', 'Tunisie Telecom', 'Lycamobile'].includes(operator);
  const normalizedE164 = `+216${clean8}`;
  const nationalFormatted = `${clean8.slice(0, 2)} ${clean8.slice(2, 5)} ${clean8.slice(5, 8)}`;

  return {
    isValid: true,
    rawInput: raw,
    normalizedE164,
    e164: normalizedE164,
    clean8,
    nationalFormatted,
    national: nationalFormatted,
    operator,
    isMobile
  };
}
