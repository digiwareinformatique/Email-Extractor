/**
 * Spintax Engine & Opt-Out Classifier
 * Provides nested spinning, token replacement, and opt-out keyword detection.
 */

/**
 * Parses and resolves spintax formatted strings: {option1|option2|{sub1|sub2}}
 */
export function resolveSpintax(text: string): string {
  if (!text || typeof text !== 'string') return '';

  const spintaxRegex = /\{([^{}]+)\}/;
  let matches = spintaxRegex.exec(text);

  while (matches) {
    const choices = matches[1].split('|');
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    text = text.replace(matches[0], randomChoice);
    matches = spintaxRegex.exec(text);
  }

  return text;
}

/**
 * Replaces prospect variables in template: {nom}, {prenom}, {entreprise}, {ville}, {phone}
 */
export function interpolateVariables(template: string, metadata: Record<string, any> = {}, phone = ''): string {
  let result = template;

  const vars: Record<string, string> = {
    nom: metadata.nom || metadata.name || metadata.lastName || '',
    prenom: metadata.prenom || metadata.firstName || '',
    entreprise: metadata.entreprise || metadata.company || metadata.society || '',
    ville: metadata.ville || metadata.city || '',
    phone: phone || metadata.phone || '',
    civilite: metadata.civilite || metadata.title || 'Bonjour',
    specialite: metadata.specialite || metadata.specialty || metadata.category || ''
  };

  // Replace each variable case-insensitively
  for (const [key, val] of Object.entries(vars)) {
    const regex = new RegExp(`\\{${key}\\}`, 'gi');
    result = result.replace(regex, val);
  }

  return result;
}

/**
 * Full message processing pipeline: Spintax + Variable Interpolation
 */
export function processOutreachMessage(rawTemplate: string, metadata: Record<string, any> = {}, phone = ''): string {
  const withVars = interpolateVariables(rawTemplate, metadata, phone);
  return resolveSpintax(withVars);
}

/**
 * Generates N preview variations of a Spintax template
 */
export function generateSpintaxPreviews(template: string, count = 5): string[] {
  const previews: Set<string> = new Set();
  const sampleMeta = {
    nom: 'Ben Salem',
    prenom: 'Karim',
    entreprise: 'Cabinet Médical Ennasr',
    ville: 'Tunis',
    specialite: 'Cardiologie'
  };

  for (let i = 0; i < count * 3 && previews.size < count; i++) {
    previews.add(processOutreachMessage(template, sampleMeta, '+216 98 123 456'));
  }

  return Array.from(previews);
}

/**
 * Detects if an incoming message is an opt-out / STOP request
 */
export function isOptOutMessage(message: string): { isOptOut: boolean; matchedKeyword?: string } {
  if (!message || typeof message !== 'string') return { isOptOut: false };

  const clean = message.trim().toLowerCase();

  // Standalone words or common French/English opt-out phrases
  const stopRegexes: { pattern: RegExp; keyword: string }[] = [
    { pattern: /\bstop\b/i, keyword: 'STOP' },
    { pattern: /^\s*non\b/i, keyword: 'NON' },
    { pattern: /\b(d[eé]sabonner|d[eé]sinscrire|d[eé]sabonnement)\b/i, keyword: 'DESABONNER' },
    { pattern: /\b(ne plus m['’]?[eé]crire|ne m['’]?[eé]crivez plus|arr[eê]ter?|arr[eê]te|stop message)\b/i, keyword: 'NE_PLUS_ECRIRE' },
    { pattern: /\b(pas int[eé]ress[eé]|pas int[eé]ress[eé]e|laissez-moi tranquille)\b/i, keyword: 'PAS_INTERESSE' },
    { pattern: /\b(unsubscribe|remove me|opt\s*out)\b/i, keyword: 'UNSUBSCRIBE' }
  ];

  for (const { pattern, keyword } of stopRegexes) {
    if (pattern.test(clean)) {
      return { isOptOut: true, matchedKeyword: keyword };
    }
  }

  return { isOptOut: false };
}
