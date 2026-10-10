import { ContactRecord, CriteriaScores, ConfidenceLevel } from '../src/types';
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

// Common false positive names (bruit, labels d'interface, etc.)
const FALSE_NAMES = new Set([
  'email', 'e-mail', 'téléphone', 'tel', 'phone', 'adresse', 'address', 'site web', 'website',
  'de', 'à', 'sujet', 'date', 'envoyé', 'cordialement', 'signature', 'page', 'image', 'photo',
  'en savoir plus', 'cliquez ici', 'contact', 'newsletter', 'partager', 'répondre', 'transferer',
  'modifier', 'supprimer', 'ajouter', 'valider', 'annuler', 'suivant', 'précédent', 'inscription',
  'recherche', 'forum', 'sujets', 'messages', 'groupe', 'membres', 'statut', 'profil', 'mot de passe',
  'connexion', 'deconnexion', 'home', 'accueil', 'rubrique', 'catégorie', 'commentaires', 
  'tous droits réservés', 'copyright', 'télécharger', 'téléchargement', 'pièce jointe', 'coordonnées',
  'adresse ip', 'navigateur', 'système', 'erreur', 'attention', 'rejoindre', 'publié par', 'posté par',
  'message', 'réponse', 'discussions', 'membres', 'utilisateurs', 'profil', 'aide', 'faq',
  'note', 'important', 'info', 'alerte', 'générale', 'général', 'ne pas répondre', 'ne pas repondre',
  'reply', 'noreply', 'no-reply', 'support', 'commercial', 'technique', 'principal', 'responsable',
  'directeur', 'service', 'services', 'département', 'departement', 'entreprise', 'société', 'societe',
  'exemples', 'exemple'
]);

// Common system / non-individual email prefixes
const SYSTEM_EMAIL_PREFIXES = [
  'support', 'info', 'noreply', 'no-reply', 'admin', 'contact', 'hello', 'sales', 'marketing',
  'billing', 'facturation', 'jobs', 'recrutement', 'newsletter', 'test', 'spam', 'postmaster',
  'webmaster', 'help', 'service', 'client'
];

/**
 * 1. Clean raw text to normalize spaces, line breaks, and strip HTML
 */
export function cleanText(rawText: string): string {
  if (!rawText) return '';
  
  let cleaned = rawText;
  
  // Strip HTML tags if present (ensuring we do not strip email addresses wrapped in angle brackets like <info@domain.com>)
  if (/<[a-z][\s\S]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
    // Using negative lookahead to avoid matching tags that look like email addresses (e.g., containing an @)
    cleaned = cleaned.replace(/<(?![a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12})[^>]+>/g, ' ');
  }
  
  // Replace HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  // Normalize weird carriage returns
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  return cleaned;
}

/**
 * Helper to check if a string is a valid email
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}$/;
  return emailRegex.test(email);
}

/**
 * Helper to extract name from an email prefix (e.g. jean.dupont@ -> Jean Dupont)
 */
export function extractNameFromEmailPrefix(email: string): string {
  const prefix = email.split('@')[0];
  // Remove numbers at the end or start
  let cleaned = prefix.replace(/\d+/g, ' ').trim();
  // Split by dot, underscore, hyphen
  const parts = cleaned.split(/[._-]/).filter(p => p.length > 1);
  
  if (parts.length === 0) return '';
  
  return parts
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Analyze a candidate name to filter out noise lines
 */
export function isLikelyNoise(name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length < 2 || trimmed.length > 50) return true;
  if (FALSE_NAMES.has(trimmed)) return true;
  
  // If it's mostly numbers/symbols
  const letterCount = (trimmed.match(/[a-zàâäéèêëîïôöùûüç]/g) || []).length;
  if (letterCount / trimmed.length < 0.4) return true;
  
  // Contains common keywords that aren't human names
  if (
    trimmed.includes('http') || 
    trimmed.includes('www') || 
    trimmed.includes('@') || 
    trimmed.includes('.com') ||
    trimmed.includes('tél') ||
    trimmed.includes('fax') ||
    trimmed.includes('coordonnées') ||
    trimmed.includes('société') ||
    trimmed.includes('compte') ||
    trimmed.includes('référence') ||
    trimmed.includes('identifiant') ||
    trimmed.includes('numéro') ||
    trimmed.includes('date') ||
    trimmed.includes('heure') ||
    trimmed.includes('cliquez') ||
    trimmed.includes('partager') ||
    trimmed.includes('clavier') ||
    trimmed.includes('notre site') ||
    trimmed.includes('copyright') ||
    trimmed.includes('tous droits') ||
    trimmed.includes('mentions légales')
  ) {
    return true;
  }
  
  // If it's just a single letter or single characters repeated
  if (/^(.)\1+$/.test(trimmed)) return true;
  
  return false;
}

/**
 * Clean up an extracted name candidate (capitalization, removing brackets/quotes/accents noise)
 * Fully supports hyphenated names like Jean-Pierre Dupont.
 */
export function cleanName(name: string): string {
  let cleaned = name.trim();
  
  // Remove outer quotes, brackets, hyphens, colons, or leading/trailing junk
  cleaned = cleaned.replace(/^[^a-zA-ZàâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]+|[^a-zA-ZàâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]+$/g, '');
  
  // Remove prefixes like "De :", "Nom :", "Mr ", "Mme ", "Dr " case insensitive
  cleaned = cleaned.replace(/^(nom|name|de|from|contact|m\.|mme|mr|mrs|dr|dir|directeur|responsable|technique|intervenant)\s*:\s*/i, '');
  cleaned = cleaned.replace(/^(m\.|mme|mr|mrs|dr)\s+/i, '');
  
  if (cleaned === cleaned.toUpperCase() && cleaned.length > 3) {
    cleaned = cleaned.toLowerCase();
  }
  
  // Capitalize first letter of each word, supporting hyphenated parts cleanly
  return cleaned
    .split(/\s+/)
    .map(word => {
      return word
        .split('-')
        .map(subword => {
          if (subword.length === 0) return '';
          return subword.charAt(0).toUpperCase() + subword.slice(1).toLowerCase();
        })
        .join('-');
    })
    .join(' ')
    .trim();
}

/**
 * Calculate the confidence score of an association between a Name and an Email
 */
export function computeConfidence(
  name: string,
  email: string,
  distanceLines: number,
  contextText: string,
  sameLineMatch: boolean
): { score: number; level: ConfidenceLevel; scores: CriteriaScores } {
  let score = 30; // Base score for finding a valid email
  
  const emailLower = email.toLowerCase();
  const nameLower = name.toLowerCase();
  
  const emailValid = isValidEmail(email);
  if (!emailValid) score -= 20;
  
  // Name criteria
  const hasName = name.length > 0 && name !== 'Inconnu' && name !== email.split('@')[0];
  const isNoise = isLikelyNoise(name);
  
  let nameFound = false;
  if (hasName && !isNoise) {
    nameFound = true;
    score += 20;
  } else if (hasName && isNoise) {
    score -= 10;
  }
  
  // Corporate Domain check
  const domain = emailLower.split('@')[1] || '';
  const isCorporateDomain = domain.length > 0 && 
    !domain.includes('gmail.') && 
    !domain.includes('yahoo.') && 
    !domain.includes('hotmail.') && 
    !domain.includes('outlook.') && 
    !domain.includes('live.') && 
    !domain.includes('free.fr') && 
    !domain.includes('orange.fr') && 
    !domain.includes('wanadoo.fr') && 
    !domain.includes('sfr.fr') && 
    !domain.includes('laposte.net') && 
    !domain.includes('aol.');
  
  if (isCorporateDomain) {
    score += 10;
  }
  
  // Check for system emails
  const prefix = emailLower.split('@')[0] || '';
  const hasSpamKeywords = SYSTEM_EMAIL_PREFIXES.some(sys => prefix.startsWith(sys) || prefix === sys);
  if (hasSpamKeywords) {
    score -= 15;
  }
  
  // Distance scoring (closer is better)
  let distanceScore = 0;
  if (nameFound) {
    if (sameLineMatch) {
      distanceScore = 10;
      score += 20;
    } else if (distanceLines === 1) {
      distanceScore = 8;
      score += 15;
    } else if (distanceLines === 2) {
      distanceScore = 5;
      score += 10;
    } else if (distanceLines <= 4) {
      distanceScore = 3;
      score += 5;
    } else {
      distanceScore = 1;
    }
  }
  
  // Check if Name matches Email prefix structure (e.g. "Jean Dupont" and "j.dupont@")
  let isNameEmailMatch = false;
  if (nameFound) {
    const cleanPrefix = prefix.replace(/[^a-z]/g, '');
    
    // Check if initials or parts of name are in email prefix
    const nameParts = nameLower.split(/\s+/).filter(p => p.length > 1);
    if (nameParts.length >= 2) {
      const first = nameParts[0];
      const last = nameParts[nameParts.length - 1];
      if (
        prefix.includes(first) || 
        prefix.includes(last) || 
        (cleanPrefix.includes(first[0]) && cleanPrefix.includes(last))
      ) {
        isNameEmailMatch = true;
        score += 15;
      }
    }
  }
  
  // Signature and contextual blocks
  const contextLower = contextText.toLowerCase();
  const signaturePresent = 
    contextLower.includes('cordialement') || 
    contextLower.includes('sincèrement') || 
    contextLower.includes('best regards') || 
    contextLower.includes('regards') || 
    contextLower.includes('de:') || 
    contextLower.includes('from:') || 
    contextLower.includes('tél') || 
    contextLower.includes('signé');
    
  if (signaturePresent && nameFound) {
    score += 10;
  }
  
  // Cap score between 0 and 100
  score = Math.max(0, Math.min(100, score));
  
  let level: ConfidenceLevel = 'Low';
  if (score >= 75) {
    level = 'High';
  } else if (score >= 45) {
    level = 'Medium';
  }
  
  return {
    score,
    level,
    scores: {
      nameFound,
      emailValid,
      distanceScore,
      isCorporateDomain,
      hasSpamKeywords,
      isNameEmailMatch,
      signaturePresent
    }
  };
}

/**
 * Main parser module (heuristic-based) - parses text in milliseconds with high efficiency.
 * Employs multi-line window evaluation, candidate segment splitting, and custom heuristic ratings.
 */
/**
 * Perform initial base extraction (heuristics stage)
 */
export function performBaseExtraction(text: string, sourceFileName: string): ContactRecord[] {
  const cleaned = cleanText(text);
  const lines = cleaned.split('\n');
  const contacts: ContactRecord[] = [];
  
  // Maps normalized name key to the email address that claimed it.
  // This allows multiple occurrences of the same email to evaluate or claim the same name,
  // but prevents different email addresses from stealing/reusing that name.
  const assignedNames = new Map<string, string>();
  
  // High-precision email pattern
  // Matches generic email addresses and handles boundaries properly
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}/g;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const emailMatches = line.match(emailRegex);
    
    if (emailMatches) {
      for (const email of emailMatches) {
        const emailLower = email.toLowerCase();
        
        // Define context window (up to 5 lines above, 3 lines below)
        const startIdx = Math.max(0, i - 5);
        const endIdx = Math.min(lines.length - 1, i + 3);
        const contextLines = lines.slice(startIdx, endIdx + 1);
        const rawContext = lines.slice(Math.max(0, i - 4), Math.min(lines.length - 1, i + 2) + 1).join('\n');
        
        // Let's find candidate names in this window
        let bestCandidateName = '';
        let bestCandidateScore = -100;
        let bestCandidateLineDiff = 99;
        let isSameLine = false;
        
        for (let j = startIdx; j <= endIdx; j++) {
          const currentLine = lines[j];
          const lineDiff = j - i; // distance from email line
          
          // Guard: if we are looking at a different line and that line already contains an email address,
          // any name candidates on that line belong to that email and shouldn't be associated here.
          if (lineDiff !== 0 && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}/.test(currentLine)) {
            continue;
          }
          
          // Remove the email address from the line if it is on the same line
          let cleanedLine = currentLine;
          if (lineDiff === 0) {
            cleanedLine = currentLine.replace(email, '');
          }
          
          // Normalize hyphenated separators (surrounded by spaces) so we don't break hyphenated names (Jean-Pierre)
          let normalizedLine = cleanedLine.replace(/\s+[-–—]\s+/g, ' | ');
          
          // Split by common separators (|, :, tab, comma, parenthesis, brackets, bullets, slash, semicolon)
          const segments = normalizedLine.split(/[\t,|•\/\(\)\[\]\:\;]/);
          
          for (const segment of segments) {
            const trimmedSegment = segment.trim();
            if (trimmedSegment.length < 2 || trimmedSegment.length > 45) continue;
            
            // Check if it's the email prefix or a raw email or url
            if (trimmedSegment.includes('@') || trimmedSegment.toLowerCase().startsWith('http') || trimmedSegment.toLowerCase().startsWith('www.')) {
              continue;
            }
            
            // Re-check for noise: noisy segments can never be a human name!
            const isNoise = isLikelyNoise(trimmedSegment);
            if (isNoise) {
              continue;
            }
            
            // Skip if this name has already been assigned to another distinct contact
            const normalizedNameKey = trimmedSegment.toLowerCase().replace(/[^a-z]/g, '');
            const assignedToEmail = assignedNames.get(normalizedNameKey);
            if (assignedToEmail && assignedToEmail !== emailLower) {
              continue;
            }
            
            // Base candidate scoring
            let score = 0;
            score += 15;
            
            // Quote/comment detection
            const hasQuotes = /["'«»“”]/.test(trimmedSegment);
            if (hasQuotes) {
              score -= 30;
            }
            
            // Capitalization check
            const words = trimmedSegment.split(/\s+/).filter(w => w.length > 0);
            if (words.length > 0) {
              const capitalizedWords = words.filter(w => {
                const firstChar = w.charAt(0);
                return firstChar === firstChar.toUpperCase() && /[a-zA-ZàâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/.test(firstChar);
              });
              
              const ALLOWED_LOWER_PARTICLES = new Set(['de', 'du', 'd\'', 'des', 'le', 'la', 'en', 'et', 'and', 'von', 'van', 'of', 'the']);
              const hasInvalidLowercase = words.some(w => {
                const firstChar = w.charAt(0);
                const isFirstCharLower = firstChar === firstChar.toLowerCase() && /[a-zA-Zàâäéèêëîïôöùûüç]/.test(firstChar);
                return isFirstCharLower && !ALLOWED_LOWER_PARTICLES.has(w.toLowerCase());
              });
              
              if (hasInvalidLowercase) {
                score -= 40; // Penalize sentences or fragments with lowercase words
              }
              
              if (capitalizedWords.length === words.length) {
                score += 30; // All words capitalized
              } else if (capitalizedWords.length >= 1) {
                score += 15; // At least one capitalized word
              }
              
              // Word count scoring
              if (words.length === 2 || words.length === 3) {
                score += 25; // Perfect length for Prénom + Nom
              } else if (words.length === 1) {
                score += 5; // Single word name
              } else if (words.length > 4) {
                score -= 20; // Too long, probably a sentence or noise
              }
            }
            
            // Proximity scoring
            if (lineDiff === 0) {
              score += 40; // Same line is extremely likely to be associated
            } else if (lineDiff === -1) {
              score += 30; // Line right above (very common for headers or lists)
            } else if (lineDiff === 1) {
              score += 20; // Line right below (common in signatures or card formats)
            } else if (lineDiff === -2) {
              score += 15;
            } else if (lineDiff === 2) {
              score += 10;
            } else {
              score += 5;
            }
            
            // Name prefix matching: email is j.dupont@... -> Jean Dupont
            const prefix = emailLower.split('@')[0] || '';
            const cleanPrefix = prefix.replace(/[^a-z]/g, '');
            const cleanSegment = trimmedSegment.toLowerCase().replace(/[^a-z]/g, '');
            
            if (cleanPrefix.length > 3 && cleanSegment.length > 3) {
              // check if prefix contains part of the segment or vice versa
              if (cleanPrefix.includes(cleanSegment) || cleanSegment.includes(cleanPrefix)) {
                score += 30;
              } else {
                // Check if any word in the segment matches prefix
                const matchesAnyWord = words.some(w => {
                  const lw = w.toLowerCase().replace(/[^a-z]/g, '');
                  return lw.length > 2 && (prefix.includes(lw) || lw.includes(prefix));
                });
                if (matchesAnyWord) {
                  score += 25;
                }
              }
            }
            
            // Introductory patterns bonus (Nom:, De:, M., Mme etc)
            if (/^(nom|name|de|from|contact|m\.|mme|mr|mrs|dr|dir|directeur|responsable)\s*:/i.test(trimmedSegment)) {
              score += 20;
            }
            
            if (score > bestCandidateScore) {
              bestCandidateScore = score;
              bestCandidateName = trimmedSegment;
              bestCandidateLineDiff = Math.abs(lineDiff);
              isSameLine = lineDiff === 0;
            }
          }
        }
        
        // Determine final name
        let finalName = '';
        if (bestCandidateScore >= 20 && bestCandidateName) {
          finalName = cleanName(bestCandidateName);
        } else {
          // Fallback to prefix extraction
          const prefixName = extractNameFromEmailPrefix(email);
          if (prefixName && !isLikelyNoise(prefixName)) {
            finalName = prefixName;
            bestCandidateLineDiff = 4; // Arbitrary distance
          } else {
            finalName = 'Inconnu';
          }
        }
        
        // Mark name as assigned to prevent stealing by later emails in the same document
        if (finalName && finalName !== 'Inconnu') {
          assignedNames.set(finalName.toLowerCase().replace(/[^a-z]/g, ''), emailLower);
        }
        
        // Calculate scoring using the best metrics
        const { score, level, scores } = computeConfidence(
          finalName,
          email,
          bestCandidateLineDiff,
          rawContext,
          isSameLine
        );
        
        contacts.push({
          id: `${emailLower}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          name: finalName,
          email: emailLower,
          rawContext,
          confidenceScore: score,
          confidenceLevel: level,
          criteriaScores: scores,
          sourceFile: sourceFileName
        });
      }
    }
  }
  
  return contacts;
}

/**
 * Verifies if a given string is high quality and likely to be a real human name.
 * Excludes interface words, addresses, departments, and job functions.
 */
export function verifyNameQuality(name: string): { isValid: boolean; reason?: string } {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  
  if (!trimmed || lower === 'inconnu') {
    return { isValid: false, reason: 'Inconnu' };
  }

  // 1. Interface words
  const interfaceWords = new Set([
    'preview', 'view', 'download', 'note', 'important', 'discussion', 'discussions', 
    'membre', 'membres', 'utilisateur', 'utilisateurs', 'profil', 'connexion', 'deconnexion', 
    'home', 'accueil', 'rubrique', 'catégorie', 'categorie', 'commentaires', 'commentaire', 
    'copyright', 'télécharger', 'téléchargement', 'pièce jointe', 'piece jointe', 'coordonnées', 
    'coordonnees', 'adresse ip', 'navigateur', 'erreur', 'attention', 'rejoindre', 'publié par', 
    'posté par', 'sujet', 'date', 'envoyé', 'cordialement', 'signature', 'page', 'image', 'photo', 
    'newsletter', 'partager', 'répondre', 'transferer', 'modifier', 'supprimer', 'ajouter', 
    'valider', 'annuler', 'suivant', 'précédent', 'inscription', 'recherche', 'forum', 'sujets', 
    'messages', 'groupe', 'statut', 'mot de passe', 'aide', 'faq', 'exemples', 'exemple', 'urgent',
    'info', 'alerte', 'générale', 'général', 'ne pas répondre', 'ne pas repondre', 'reply', 'noreply',
    'no-reply'
  ]);
  
  if (interfaceWords.has(lower)) {
    return { isValid: false, reason: 'Interface word' };
  }

  // Check if any specific substring is an exact interface word
  const words = lower.split(/\s+/).filter(w => w.length > 0);
  if (words.some(w => interfaceWords.has(w))) {
    return { isValid: false, reason: 'Interface word' };
  }

  // 2. Address detection
  const addressIndicators = [
    /\brue\b/, /\bavenue\b/, /\bboulevard\b/, /\ballée\b/, /\bchemin\b/, /\bplace\b/, 
    /\broute\b/, /\bb\.p\./, /\bcedex\b/, /\bbp\b/, /\bzip\b/, /\bcs\b/
  ];
  if (addressIndicators.some(regex => regex.test(lower)) || /[0-9]{5}/.test(lower)) {
    return { isValid: false, reason: 'Address' };
  }

  // 3. Department check
  const departmentWords = [
    'marketing', 'service', 'services', 'département', 'departement', 'entreprise', 
    'société', 'societe', 'support', 'direction', 'logistique', 'comptabilité', 'rh', 
    'ressources humaines', 'compta', 'achats', 'ventes', 'sales', 'engineering', 'finance', 
    'facturation', 'client', 'clients', 'réseau', 'reseau', 'réseaux', 'reseaux', 
    'administrateur', 'administration', 'bureau', 'assistance', 'secrétariat', 'secretariat'
  ];
  for (const dep of departmentWords) {
    if (lower === dep || lower === `service ${dep}` || lower === `département ${dep}` || lower === `direction ${dep}`) {
      return { isValid: false, reason: 'Department' };
    }
  }
  if (words.every(w => departmentWords.includes(w))) {
    return { isValid: false, reason: 'Department' };
  }

  // 4. Job functions check
  const jobFunctions = [
    'directeur', 'responsable', 'président', 'présidente', 'assistant', 'assistante', 
    'manager', 'développeur', 'developpeur', 'ingénieur', 'ingenieur', 'chef', 
    'secrétaire', 'secretaire', 'consultant', 'webmaster', 'postmaster', 'analyste', 
    'coordinateur', 'coordinatrice', 'technicien', 'technicienne', 'stagiaire', 
    'alternant', 'alternante', 'fondateur', 'fondatrice', 'gérant', 'gerant', 'commercial',
    'technique', 'principal', 'intervenant'
  ];
  for (const job of jobFunctions) {
    if (lower === job) {
      return { isValid: false, reason: 'Job function' };
    }
  }
  if (words.every(w => jobFunctions.includes(w))) {
    return { isValid: false, reason: 'Job function' };
  }

  return { isValid: true };
}

/**
 * Runs a single round of Auto-Validation and corrections on extracted contacts.
 * Returns the corrected contacts and a flag indicating if no changes were made (isStable).
 */
export function runAutoValidationRound(
  contacts: ContactRecord[],
  originalText: string
): { contacts: ContactRecord[]; isStable: boolean } {
  const lines = cleanText(originalText).split('\n');
  let isStable = true;
  
  // Track assigned names to detect double associations
  const nameToContacts = new Map<string, ContactRecord[]>();
  
  for (const c of contacts) {
    if (c.name && c.name !== 'Inconnu') {
      const normalized = c.name.toLowerCase().replace(/[^a-z]/g, '');
      if (normalized) {
        if (!nameToContacts.has(normalized)) {
          nameToContacts.set(normalized, []);
        }
        nameToContacts.get(normalized)!.push(c);
      }
    }
  }
  
  const updatedContacts: ContactRecord[] = [];
  
  for (const c of contacts) {
    let needsCorrection = false;
    let correctionReason = '';
    
    // Check 1: Quality check
    const quality = verifyNameQuality(c.name);
    if (!quality.isValid) {
      needsCorrection = true;
      correctionReason = quality.reason || 'Invalid quality';
    }
    
    // Check 2: Same name used for multiple emails (Double association)
    if (!needsCorrection && c.name !== 'Inconnu') {
      const normalizedName = c.name.toLowerCase().replace(/[^a-z]/g, '');
      const shared = nameToContacts.get(normalizedName) || [];
      const distinctEmails = new Set(shared.map(s => s.email.toLowerCase()));
      if (distinctEmails.size > 1) {
        // Find the best contact to keep the name (highest confidence score, then first found)
        const bestContact = [...shared].sort((a, b) => {
          if (b.confidenceScore !== a.confidenceScore) {
            return b.confidenceScore - a.confidenceScore;
          }
          return a.id.localeCompare(b.id);
        })[0];
        
        // Only treat as double association if our email is not the same as the best contact's email
        if (c.email.toLowerCase() !== bestContact.email.toLowerCase()) {
          needsCorrection = true;
          correctionReason = 'Double association';
        }
      }
    }
    
    if (needsCorrection) {
      isStable = false;
      
      // Perform automatic correction
      // 1. Locate email in original document to extract context window
      const emailLineIdx = lines.findIndex(l => l.toLowerCase().includes(c.email.toLowerCase()));
      let correctedName = 'Inconnu';
      let bestCandidateScore = -100;
      let bestCandidateLineDiff = 99;
      let isSameLine = false;
      
      if (emailLineIdx !== -1) {
        const startIdx = Math.max(0, emailLineIdx - 5);
        const endIdx = Math.min(lines.length - 1, emailLineIdx + 3);
        
        for (let j = startIdx; j <= endIdx; j++) {
          const currentLine = lines[j];
          const lineDiff = j - emailLineIdx;
          
          if (lineDiff !== 0 && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}/.test(currentLine)) {
            continue;
          }
          
          let cleanedLine = currentLine;
          if (lineDiff === 0) {
            cleanedLine = currentLine.replace(c.email, '');
          }
          
          let normalizedLine = cleanedLine.replace(/\s+[-–—]\s+/g, ' | ');
          const segments = normalizedLine.split(/[\t,|•\/\(\)\[\]\:\;]/);
          
          for (const segment of segments) {
            const trimmedSegment = segment.trim();
            if (trimmedSegment.length < 2 || trimmedSegment.length > 45) continue;
            if (trimmedSegment.includes('@') || trimmedSegment.toLowerCase().startsWith('http') || trimmedSegment.toLowerCase().startsWith('www.')) {
              continue;
            }
            
            // Check segment quality
            const candidateQuality = verifyNameQuality(trimmedSegment);
            if (!candidateQuality.isValid) {
              continue;
            }
            
            // Check if name already assigned to another contact (unless it's us)
            const normCandidate = trimmedSegment.toLowerCase().replace(/[^a-z]/g, '');
            const otherAssigned = contacts.some(o => 
              o.id !== c.id && 
              o.name && 
              o.name !== 'Inconnu' && 
              o.name.toLowerCase().replace(/[^a-z]/g, '') === normCandidate
            );
            if (otherAssigned) {
              continue;
            }
            
            // Calculate heuristic score for candidate
            let score = 0;
            score += 15;
            
            const hasQuotes = /["'«»“”]/.test(trimmedSegment);
            if (hasQuotes) score -= 30;
            
            const words = trimmedSegment.split(/\s+/).filter(w => w.length > 0);
            if (words.length > 0) {
              const capitalizedWords = words.filter(w => {
                const firstChar = w.charAt(0);
                return firstChar === firstChar.toUpperCase() && /[a-zA-ZàâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/.test(firstChar);
              });
              
              const ALLOWED_LOWER_PARTICLES = new Set(['de', 'du', 'd\'', 'des', 'le', 'la', 'en', 'et', 'and', 'von', 'van', 'of', 'the']);
              const hasInvalidLowercase = words.some(w => {
                const firstChar = w.charAt(0);
                const isFirstCharLower = firstChar === firstChar.toLowerCase() && /[a-zA-Zàâäéèêëîïôöùûüç]/.test(firstChar);
                return isFirstCharLower && !ALLOWED_LOWER_PARTICLES.has(w.toLowerCase());
              });
              
              if (hasInvalidLowercase) score -= 40;
              
              if (capitalizedWords.length === words.length) score += 30;
              else if (capitalizedWords.length >= 1) score += 15;
              
              if (words.length === 2 || words.length === 3) score += 25;
              else if (words.length === 1) score += 5;
              else if (words.length > 4) score -= 20;
            }
            
            if (lineDiff === 0) score += 40;
            else if (lineDiff === -1) score += 30;
            else if (lineDiff === 1) score += 20;
            else if (lineDiff === -2) score += 15;
            else if (lineDiff === 2) score += 10;
            else score += 5;
            
            const prefix = c.email.split('@')[0] || '';
            const cleanPrefix = prefix.replace(/[^a-z]/g, '');
            const cleanSegment = trimmedSegment.toLowerCase().replace(/[^a-z]/g, '');
            
            if (cleanPrefix.length > 3 && cleanSegment.length > 3) {
              if (cleanPrefix.includes(cleanSegment) || cleanSegment.includes(cleanPrefix)) {
                score += 30;
              } else {
                const matchesAnyWord = words.some(w => {
                  const lw = w.toLowerCase().replace(/[^a-z]/g, '');
                  return lw.length > 2 && (prefix.includes(lw) || lw.includes(prefix));
                });
                if (matchesAnyWord) score += 25;
              }
            }
            
            if (/^(nom|name|de|from|contact|m\.|mme|mr|mrs|dr|dir|directeur|responsable)\s*:/i.test(trimmedSegment)) {
              score += 20;
            }
            
            if (score > bestCandidateScore) {
              bestCandidateScore = score;
              correctedName = trimmedSegment;
              bestCandidateLineDiff = Math.abs(lineDiff);
              isSameLine = lineDiff === 0;
            }
          }
        }
      }
      
      let finalName = '';
      if (bestCandidateScore >= 20 && correctedName && correctedName !== 'Inconnu') {
        finalName = cleanName(correctedName);
      } else {
        const prefixName = extractNameFromEmailPrefix(c.email);
        if (prefixName && !isLikelyNoise(prefixName) && verifyNameQuality(prefixName).isValid) {
          finalName = prefixName;
          bestCandidateLineDiff = 4;
        } else {
          finalName = 'Inconnu';
        }
      }
      
      // Compute correct score and confidence level
      const { score, level, scores } = computeConfidence(
        finalName,
        c.email,
        bestCandidateLineDiff,
        c.rawContext,
        isSameLine
      );
      
      updatedContacts.push({
        ...c,
        name: finalName,
        confidenceScore: score,
        confidenceLevel: level,
        criteriaScores: scores,
        rawContext: c.rawContext + `\n[Auto-Validation: Corrected from "${c.name}" because: ${correctionReason}]`
      });
    } else {
      updatedContacts.push(c);
    }
  }
  
  return { contacts: updatedContacts, isStable };
}

/**
 * Deduplicates email addresses by keeping only the single best occurrence
 * based on weighted criteria (confidence score, name quality, proximity, context richness, noise, corrections).
 */
export function deduplicateContacts(contacts: ContactRecord[]): ContactRecord[] {
  // Group contacts by email (lowercase)
  const groups = new Map<string, { contact: ContactRecord; originalIndex: number }[]>();
  
  contacts.forEach((contact, idx) => {
    const emailLower = contact.email.toLowerCase();
    if (!groups.has(emailLower)) {
      groups.set(emailLower, []);
    }
    groups.get(emailLower)!.push({ contact, originalIndex: idx });
  });
  
  const bestContacts: ContactRecord[] = [];
  
  for (const [email, occurrences] of groups.entries()) {
    if (occurrences.length === 1) {
      bestContacts.push(occurrences[0].contact);
      continue;
    }
    
    // Sort occurrences based on weighted criteria
    occurrences.sort((a, b) => {
      const recA = a.contact;
      const recB = b.contact;
      
      // 1. Highest confidence score (primary criterion)
      if (recB.confidenceScore !== recA.confidenceScore) {
        return recB.confidenceScore - recA.confidenceScore;
      }
      
      // 2. Best human name quality
      const getNameRank = (c: ContactRecord) => {
        if (!c.name || c.name === 'Inconnu') return 0;
        const isValid = verifyNameQuality(c.name).isValid;
        if (!isValid) return 1;
        const words = c.name.trim().split(/\s+/).length;
        if (words === 2 || words === 3) return 3;
        return 2;
      };
      
      const rankB = getNameRank(recB);
      const rankA = getNameRank(recA);
      if (rankB !== rankA) {
        return rankB - rankA;
      }
      
      // 3. Best proximity (distance score, higher is closer/better)
      const distB = recB.criteriaScores.distanceScore;
      const distA = recA.criteriaScores.distanceScore;
      if (distB !== distA) {
        return distB - distA;
      }
      
      // 4. Best context richness (signatures, roles, polite expressions)
      const getContextRichnessScore = (c: ContactRecord) => {
        let score = 0;
        if (c.criteriaScores.signaturePresent) score += 5;
        const ctxLower = c.rawContext.toLowerCase();
        const keywords = ['cordialement', 'sincèrement', 'best regards', 'de:', 'from:', 'tél', 'tel', 'phone', 'directeur', 'responsable', 'manager'];
        keywords.forEach(word => {
          if (ctxLower.includes(word)) score += 1;
        });
        return score;
      };
      
      const richnessB = getContextRichnessScore(recB);
      const richnessA = getContextRichnessScore(recA);
      if (richnessB !== richnessA) {
        return richnessB - richnessA;
      }
      
      // 5. Less noise (hasSpamKeywords is false preferred)
      const noiseB = recB.criteriaScores.hasSpamKeywords ? 1 : 0;
      const noiseA = recA.criteriaScores.hasSpamKeywords ? 1 : 0;
      if (noiseB !== noiseA) {
        return noiseA - noiseB;
      }
      
      // 6. Fewer auto-validation corrections needed
      const corrB = recB.rawContext.includes('[Auto-Validation: Corrected') ? 1 : 0;
      const corrA = recA.rawContext.includes('[Auto-Validation: Corrected') ? 1 : 0;
      if (corrB !== corrA) {
        return corrA - corrB;
      }
      
      // 7. Tie-breaker: First Occurrence (lower original index is preferred)
      return a.originalIndex - b.originalIndex;
    });
    
    bestContacts.push(occurrences[0].contact);
  }
  
  // Re-sort the final deduplicated contacts in their original order of appearance
  const orderedResult: { contact: ContactRecord; idx: number }[] = [];
  bestContacts.forEach(contact => {
    const originalIdx = contacts.findIndex(c => c.id === contact.id);
    orderedResult.push({ contact, idx: originalIdx });
  });
  
  orderedResult.sort((a, b) => a.idx - b.idx);
  return orderedResult.map(item => item.contact);
}

/**
 * Main parser module (heuristic-based) - parses text in milliseconds with high efficiency.
 * Employs multi-line window evaluation, candidate segment splitting, and custom heuristic ratings,
 * followed by a multi-pass self-criticism / Auto-Validation pipeline (up to 3 passes).
 */
export function parseTextHeuristically(text: string, sourceFileName: string): ContactRecord[] {
  // Pass 1: Base Extraction
  let contacts = performBaseExtraction(text, sourceFileName);
  
  // Pass 2, 3 & 4: Multi-pass Auto-Validation and correction loop
  let passes = 0;
  let stable = false;
  
  while (passes < 3 && !stable) {
    passes++;
    const result = runAutoValidationRound(contacts, text);
    contacts = result.contacts;
    stable = result.isStable;
  }
  
  // Pass 5: Dedup by selecting only the single best occurrence per unique email address
  contacts = deduplicateContacts(contacts);
  
  return contacts;
}

/**
 * 2. Intelligent AI Refinement Stage (calls Gemini API)
 * Groups contacts with low/medium confidence or all contacts, and asks Gemini to verify
 * their association and correct misspelled or noisy names from the context.
 */
export async function refineContactsWithAI(
  contacts: ContactRecord[],
  filterSystemEmails: boolean
): Promise<ContactRecord[]> {
  const client = getAiClient();
  if (!client) {
    console.log('Skipping Gemini AI enhancement: API client not configured or key is placeholder.');
    return contacts;
  }
  
  // We refine contacts in small batches to save API cost and latency
  // Specifically targeting contacts with Medium or Low confidence, or Inconnu names first!
  const targetContacts = contacts.filter(c => 
    c.confidenceLevel !== 'High' || 
    c.name === 'Inconnu' || 
    c.name.split(' ').length < 2
  );
  
  if (targetContacts.length === 0) {
    return contacts;
  }
  
  // Sort target contacts so that "Inconnu" names or single-word names are prioritized
  const sortedTargets = [...targetContacts].sort((a, b) => {
    const aIsUnknown = a.name === 'Inconnu' ? 1 : 0;
    const bIsUnknown = b.name === 'Inconnu' ? 1 : 0;
    if (aIsUnknown !== bIsUnknown) return bIsUnknown - aIsUnknown;
    
    const aWords = a.name.split(' ').length;
    const bWords = b.name.split(' ').length;
    return aWords - bWords;
  });
  
  // Limit to 6 candidates to ensure extremely fast execution and prevent timeout errors
  const batchToRefine = sortedTargets.slice(0, 6);
  
  const payload = batchToRefine.map(c => ({
    id: c.id,
    currentName: c.name,
    email: c.email,
    context: c.rawContext
  }));
  
  const prompt = `Tu es un moteur d'intelligence artificielle spécialisé dans l'extraction de contacts de haute précision.
Analyse les fiches de contact candidates suivantes. Pour chacune d'elles, tu disposes de l'e-mail détecté, du nom actuellement deviné par nos algorithmes heuristiques, et du contexte textuel exact (les lignes de texte environnantes).

Ton travail consiste à :
1. Lire attentivement le "context".
2. Identifier le véritable nom de la personne associée à l'adresse e-mail "${payload[0]?.email || ''}".
3. Si le nom actuel est "Inconnu", ou s'il s'agit d'un titre ("Directeur", "Commercial"), d'un nom de société, ou de texte parasite ("De :", "Cordialement"), corrige-le en trouvant le VRAI nom et prénom de l'individu dans le contexte.
4. Si l'e-mail correspond à un service ou un système (comme "support@", "admin@") et qu'aucun individu n'est rattachable, indique un nom d'entité/société cohérent ou garde "Inconnu".
5. Si l'association est manifestement fausse ou s'il s'agit d'un faux positif complet, signale-le.

Voici les données au format JSON à analyser :
${JSON.stringify(payload, null, 2)}

Réponds UNIQUEMENT sous la forme d'un objet JSON contenant une liste de corrections pour chaque contact.
Format attendu de la réponse JSON :
{
  "corrections": [
    {
      "id": "identifiant_fourni",
      "refinedName": "Le vrai prénom et nom de famille (ex: Jean Dupont), proprement nettoyé et capitalisé",
      "confidenceAdjustment": 15, // Un bonus ou malus entre -30 et +30 basé sur ta certitude
      "justification": "Brève explication en français de ta correction"
    }
  ]
}
Assure-toi que la réponse soit un JSON valide et strictement rien d'autre.`;
 
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    // 15-second timeout wrapper to prevent slow Gemini calls from hanging the server and triggering reverse proxy timeouts
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timeout de l\'appel de l\'API Gemini (15s).')), 15000);
    });

    const geminiPromise = client.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        temperature: 0.1, // extremely fast and deterministic response
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            corrections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  refinedName: { type: Type.STRING },
                  confidenceAdjustment: { type: Type.INTEGER },
                  justification: { type: Type.STRING }
                },
                required: ['id', 'refinedName', 'confidenceAdjustment']
              }
            }
          },
          required: ['corrections']
        }
      }
    });

    const response = await Promise.race([geminiPromise, timeoutPromise]);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const textResponse = response.text;
    if (!textResponse) return contacts;
    
    const data = JSON.parse(textResponse);
    if (data && Array.isArray(data.corrections)) {
      const correctionsMap = new Map<string, { refinedName: string; confidenceAdjustment: number }>();
      for (const corr of data.corrections) {
        correctionsMap.set(corr.id, corr);
      }
      
      // Update contacts with refined names and adjust scores
      return contacts.map(contact => {
        const corr = correctionsMap.get(contact.id);
        if (corr) {
          const refined = cleanName(corr.refinedName);
          const oldName = contact.name;
          
          if (refined && refined !== 'Inconnu' && refined !== oldName) {
            // Recompute confidence with new name
            const newScore = Math.max(0, Math.min(100, contact.confidenceScore + corr.confidenceAdjustment));
            
            let newLevel: ConfidenceLevel = 'Low';
            if (newScore >= 75) newLevel = 'High';
            else if (newScore >= 45) newLevel = 'Medium';
            
            return {
              ...contact,
              name: refined,
              confidenceScore: newScore,
              confidenceLevel: newLevel,
              rawContext: contact.rawContext + `\n[AI Refinement: Corrected from "${oldName}" because: ${corr.confidenceAdjustment > 0 ? 'Confirmed match' : 'Lower reliability'}]`
            };
          }
        }
        return contact;
      });
    }
  } catch (err) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    console.log('[Extractor] Gemini API enhancement skipped or timed out; using robust heuristics.');
  }
  
  return contacts;
}

/**
 * Computes deep comprehension statistics for the processed file.
 */
export function analyzeFileContent(text: string): {
  totalLines: number;
  nonEmptyLines: number;
  totalEmailsDetected: number;
  domainCounts: { domain: string; count: number }[];
  gmailCount: number;
  yahooCount: number;
  outlookCount: number;
  corporateCount: number;
  otherCount: number;
  averageLineLength: number;
  characterCount: number;
} {
  const lines = text.split('\n');
  const totalLines = lines.length;
  const nonEmptyLines = lines.filter(l => l.trim().length > 0).length;
  const characterCount = text.length;
  const averageLineLength = totalLines > 0 ? Math.round(characterCount / totalLines) : 0;

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12}/g;
  const allEmails = text.match(emailRegex) || [];
  const totalEmailsDetected = allEmails.length;

  const domainMap = new Map<string, number>();
  let gmailCount = 0;
  let yahooCount = 0;
  let outlookCount = 0;
  let corporateCount = 0;
  let otherCount = 0;

  for (const email of allEmails) {
    const parts = email.toLowerCase().split('@');
    if (parts.length === 2) {
      const domain = parts[1].trim();
      domainMap.set(domain, (domainMap.get(domain) || 0) + 1);

      if (domain === 'gmail.com') {
        gmailCount++;
      } else if (domain.startsWith('yahoo.') || domain === 'ymail.com') {
        yahooCount++;
      } else if (domain.startsWith('outlook.') || domain.startsWith('hotmail.') || domain.startsWith('live.')) {
        outlookCount++;
      } else {
        const commonWebmails = ['aol.com', 'icloud.com', 'mail.com', 'protonmail.com', 'proton.me', 'zoho.com', 'gmx.com', 'gmx.fr', 'yandex.ru', 'free.fr', 'orange.fr', 'sfr.fr', 'wanadoo.fr', 'laposte.net'];
        if (commonWebmails.includes(domain)) {
          otherCount++;
        } else {
          corporateCount++;
        }
      }
    }
  }

  const domainCounts = Array.from(domainMap.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalLines,
    nonEmptyLines,
    totalEmailsDetected,
    domainCounts,
    gmailCount,
    yahooCount,
    outlookCount,
    corporateCount,
    otherCount,
    averageLineLength,
    characterCount
  };
}
