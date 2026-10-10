/**
 * Adaptive Entity Extractor
 * STE DigiWare SUARL - Lead Intelligence Architecture
 * 
 * Extracts structured entities and discoveries from search result snippets and URLs
 */
import { 
  DiscoveryItem, 
  DiscoveredIdentity, 
  DiscoveredProfession, 
  DiscoveredLocation, 
  DiscoveredOrganization, 
  DiscoveredDigitalAsset, 
  CandidateEmail, 
  EmailType, 
  LeadSourceType 
} from '../../src/types/lead';
import { SearchResultItem } from '../search/types';
import { detectSectorFromText } from '../services/segmentation/sectorClassifier';

// Common titles in Tunisia
const TITLE_PATTERNS = [
  /\b(Maître|Me|Mtre)\b/i,
  /\b(Docteur|Dr|Professeur|Prof)\b/i,
  /\b(Ingénieur|Ing|Architecte|Arch)\b/i,
  /\b(Expert-Comptable|Expert Comptable)\b/i,
  /\b(Gérant|Directeur Général|DG|PDG|Fondateur)\b/i,
  /\b(Notaire|Huissier|Avocat à la Cour)\b/i
];

// Tunisian Governorates and major cities
const TUNISIA_CITIES = [
  { city: 'Tunis', gov: 'Tunis' },
  { city: 'Ariana', gov: 'Ariana' },
  { city: 'Ben Arous', gov: 'Ben Arous' },
  { city: 'Manouba', gov: 'Manouba' },
  { city: 'La Marsa', gov: 'Tunis' },
  { city: 'Carthage', gov: 'Tunis' },
  { city: 'Les Berges du Lac', gov: 'Tunis' },
  { city: 'Centre Urbain Nord', gov: 'Tunis' },
  { city: 'Menzah', gov: 'Tunis' },
  { city: 'Ennasr', gov: 'Ariana' },
  { city: 'Sousse', gov: 'Sousse' },
  { city: 'Sfax', gov: 'Sfax' },
  { city: 'Nabeul', gov: 'Nabeul' },
  { city: 'Hammamet', gov: 'Nabeul' },
  { city: 'Bizerte', gov: 'Bizerte' },
  { city: 'Monastir', gov: 'Monastir' },
  { city: 'Mahdia', gov: 'Mahdia' },
  { city: 'Kairouan', gov: 'Kairouan' },
  { city: 'Gabès', gov: 'Gabès' },
  { city: 'Médenine', gov: 'Médenine' },
  { city: 'Djerba', gov: 'Médenine' },
  { city: 'Zarzis', gov: 'Médenine' },
  { city: 'Gafsa', gov: 'Gafsa' },
  { city: 'Béja', gov: 'Béja' },
  { city: 'Jendouba', gov: 'Jendouba' },
  { city: 'Kasserine', gov: 'Kasserine' },
  { city: 'Sidi Bouzid', gov: 'Sidi Bouzid' },
  { city: 'Kébili', gov: 'Kébili' },
  { city: 'Tozeur', gov: 'Tozeur' },
  { city: 'Tataouine', gov: 'Tataouine' },
  { city: 'Zaghouan', gov: 'Zaghouan' },
  { city: 'Siliana', gov: 'Siliana' },
  { city: 'Le Kef', gov: 'Le Kef' }
];

export function classifyEmailType(email: string, companyDomain?: string): EmailType {
  const lower = email.toLowerCase();
  const parts = lower.split('@');
  if (parts.length !== 2) return 'generic_org';
  const local = parts[0];
  const domain = parts[1];

  // ISP legacy
  if (['topnet.tn', 'gnet.tn', 'hexabyte.tn', 'planet.tn'].includes(domain)) {
    return 'isp_legacy';
  }

  // Generic org
  if (['contact', 'info', 'support', 'direction', 'admin', 'commercial', 'secretariat', 'bureau', 'cabinet', 'accueil'].includes(local)) {
    return 'generic_org';
  }

  // Personal public
  if (['gmail.com', 'yahoo.fr', 'yahoo.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'icloud.com'].includes(domain)) {
    return 'personal_public';
  }

  // Company domain
  return 'company_domain';
}

export function extractEntitiesFromSearchResults(
  results: SearchResultItem[],
  contextPhone: string
): {
  candidateEmails: CandidateEmail[];
  identities: DiscoveredIdentity[];
  professions: DiscoveredProfession[];
  locations: DiscoveredLocation[];
  organizations: DiscoveredOrganization[];
  digitalAssets: DiscoveredDigitalAsset[];
  discoveries: DiscoveryItem[];
} {
  const candidateEmails: CandidateEmail[] = [];
  const identities: DiscoveredIdentity[] = [];
  const professions: DiscoveredProfession[] = [];
  const locations: DiscoveredLocation[] = [];
  const organizations: DiscoveredOrganization[] = [];
  const digitalAssets: DiscoveredDigitalAsset[] = [];
  const discoveries: DiscoveryItem[] = [];

  const seenEmails = new Set<string>();
  const seenIdentities = new Set<string>();
  const seenOrgs = new Set<string>();

  for (const item of results) {
    const textToScan = `${item.title} ${item.snippet}`;
    const now = new Date().toISOString();

    // 1. Digital Assets Extraction from URLs
    if (item.url.includes('facebook.com')) {
      digitalAssets.push({
        type: 'facebook',
        url: item.url,
        title: item.title,
        source: item.url
      });
      discoveries.push({
        id: `disc-fb-${Date.now()}-${discoveries.length}`,
        type: 'DIGITAL_ASSET',
        field: 'facebook',
        value: item.url,
        sourceUrl: item.url,
        sourceType: 'facebook_page',
        snippet: item.snippet,
        confidence: 85,
        timestamp: now
      });
    } else if (item.url.includes('linkedin.com')) {
      digitalAssets.push({
        type: 'linkedin',
        url: item.url,
        title: item.title,
        source: item.url
      });
      discoveries.push({
        id: `disc-li-${Date.now()}-${discoveries.length}`,
        type: 'DIGITAL_ASSET',
        field: 'linkedin',
        value: item.url,
        sourceUrl: item.url,
        sourceType: 'linkedin_profile',
        snippet: item.snippet,
        confidence: 85,
        timestamp: now
      });
    } else if (item.url.includes('instagram.com')) {
      digitalAssets.push({
        type: 'instagram',
        url: item.url,
        title: item.title,
        source: item.url
      });
      discoveries.push({
        id: `disc-ig-${Date.now()}-${discoveries.length}`,
        type: 'DIGITAL_ASSET',
        field: 'instagram',
        value: item.url,
        sourceUrl: item.url,
        sourceType: 'instagram_profile',
        snippet: item.snippet,
        confidence: 85,
        timestamp: now
      });
    } else if (item.url.endsWith('.pdf') || textToScan.includes('.pdf')) {
      digitalAssets.push({
        type: 'pdf',
        url: item.url,
        title: item.title,
        source: item.url
      });
    } else if (item.sourceDomain && !item.sourceDomain.includes('google') && !item.sourceDomain.includes('telecom')) {
      digitalAssets.push({
        type: 'website',
        url: item.url,
        title: item.title,
        source: item.sourceDomain
      });
    }

    // 2. Email Address Extraction (Strict Regex)
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    let emailMatch: RegExpExecArray | null;
    while ((emailMatch = emailRegex.exec(textToScan)) !== null) {
      const rawEmail = emailMatch[1].toLowerCase();
      // Ignore system/image junk
      if (rawEmail.endsWith('.png') || rawEmail.endsWith('.jpg') || rawEmail.includes('example.com') || rawEmail.includes('sentry.io')) {
        continue;
      }

      if (!seenEmails.has(rawEmail)) {
        seenEmails.add(rawEmail);
        const emailType = classifyEmailType(rawEmail);
        
        // Initial score calculation
        let score = 70;
        if (emailType === 'company_domain') score = 90;
        else if (emailType === 'generic_org') score = 80;
        else if (emailType === 'personal_public') score = 75;

        candidateEmails.push({
          email: rawEmail,
          emailType,
          score,
          sources: [item.url],
          verificationStatus: score >= 85 ? 'VERIFIED' : 'CANDIDATE',
          corroborationCount: 1,
          discoveredAt: now,
          reason: `Trouvé dans ${item.sourceDomain || 'résultat web'}`
        });

        discoveries.push({
          id: `disc-em-${Date.now()}-${discoveries.length}`,
          type: 'EMAIL',
          field: 'email',
          value: rawEmail,
          sourceUrl: item.url,
          sourceType: item.url.includes('facebook') ? 'facebook_page' : 'contact_page',
          snippet: item.snippet,
          confidence: score,
          timestamp: now
        });
      } else {
        // Corroborate existing email
        const existing = candidateEmails.find(e => e.email === rawEmail);
        if (existing) {
          existing.corroborationCount += 1;
          existing.score = Math.min(100, existing.score + 10);
          if (!existing.sources.includes(item.url)) {
            existing.sources.push(item.url);
          }
          if (existing.score >= 85) {
            existing.verificationStatus = 'VERIFIED';
          }
        }
      }
    }

    // 3. Organization / Cabinet Extraction
    const orgPatterns = [
      /\b(Cabinet\s+[A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ]+)?(?:\s+&\s+[A-ZÀ-Ÿ][a-zà-ÿ]+)?)/,
      /\b(Société\s+[A-ZÀ-Ÿ][a-zà-ÿ0-9\s-]+(?:\s+SARL|\s+SUARL|\s+SA)?)/i,
      /\b(École\s+[A-ZÀ-Ÿ][a-zà-ÿ\s-]+)/i,
      /\b(Clinique\s+[A-ZÀ-Ÿ][a-zà-ÿ\s-]+)/i,
      /\b(Bureau\s+d['’]études\s+[A-ZÀ-Ÿ][a-zà-ÿ\s-]+)/i,
      /\b(Groupe\s+[A-ZÀ-Ÿ][a-zà-ÿ\s-]+)/i,
      /\b([A-ZÀ-Ÿ][a-zà-ÿ0-9-]+\s+(?:SARL|SUARL|SA|Consulting|International|Tunisie))\b/
    ];

    for (const pattern of orgPatterns) {
      const match = textToScan.match(pattern);
      if (match && match[1]) {
        const orgName = match[1].trim();
        if (orgName.length > 3 && !seenOrgs.has(orgName.toLowerCase())) {
          seenOrgs.add(orgName.toLowerCase());
          organizations.push({
            name: orgName,
            type: orgName.toLowerCase().includes('cabinet') ? 'Cabinet' : 'Entreprise',
            source: item.url
          });
          discoveries.push({
            id: `disc-org-${Date.now()}-${discoveries.length}`,
            type: 'ORGANIZATION',
            field: 'companyName',
            value: orgName,
            sourceUrl: item.url,
            sourceType: 'directory',
            snippet: item.snippet,
            confidence: 80,
            timestamp: now
          });
        }
      }
    }

    // 4. Person Name & Title Extraction
    const nameWithTitlePattern = /\b(Maître|Me|Dr|Docteur|Prof|Ing|Architecte|M\.|Mme)\s+([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ]+){1,2})/i;
    const nameMatch = textToScan.match(nameWithTitlePattern);
    if (nameMatch && nameMatch[2]) {
      const title = nameMatch[1];
      const fullName = nameMatch[2].trim();
      const parts = fullName.split(/\s+/);
      const firstName = parts[0];
      const lastName = parts.slice(1).join(' ');

      if (!seenIdentities.has(fullName.toLowerCase())) {
        seenIdentities.add(fullName.toLowerCase());
        identities.push({
          fullName,
          firstName,
          lastName,
          title,
          confidence: 85,
          source: item.url
        });
        discoveries.push({
          id: `disc-id-${Date.now()}-${discoveries.length}`,
          type: 'IDENTITY',
          field: 'fullName',
          value: `${title} ${fullName}`,
          sourceUrl: item.url,
          sourceType: 'directory',
          snippet: item.snippet,
          confidence: 85,
          timestamp: now
        });
      }
    }

    // 4b. Social Profile Name Extraction (Facebook, LinkedIn, Instagram title parsing)
    if (item.url.includes('facebook.com') || item.url.includes('linkedin.com') || item.url.includes('instagram.com')) {
      const socialTitleMatch = item.title.match(/^([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ]+){1,3})\s*(?:\([^)]+\))?\s*(?:\||•|-|–|@|\/)/i);
      if (socialTitleMatch && socialTitleMatch[1]) {
        const candidateFullName = socialTitleMatch[1].trim();
        // Ignore generic labels
        if (!candidateFullName.toLowerCase().includes('page') && !candidateFullName.toLowerCase().includes('annuaire') && !candidateFullName.toLowerCase().includes('profil')) {
          const parts = candidateFullName.split(/\s+/);
          const firstName = parts[0];
          const lastName = parts.slice(1).join(' ');

          if (!seenIdentities.has(candidateFullName.toLowerCase())) {
            seenIdentities.add(candidateFullName.toLowerCase());
            identities.push({
              fullName: candidateFullName,
              firstName,
              lastName,
              confidence: 85,
              source: item.url
            });
            discoveries.push({
              id: `disc-id-${Date.now()}-${discoveries.length}`,
              type: 'IDENTITY',
              field: 'fullName',
              value: candidateFullName,
              sourceUrl: item.url,
              sourceType: item.url.includes('facebook') ? 'facebook_page' : (item.url.includes('linkedin') ? 'linkedin_profile' : 'instagram_profile'),
              snippet: item.snippet,
              confidence: 85,
              timestamp: now
            });
          }
        }
      }
    }

    // 5. Profession & Sector Classification
    const detectedSector = detectSectorFromText(textToScan);
    if (detectedSector !== 'AUTRE') {
      const profPattern = /\b(Avocat(?:e)?|Comptable|Expert-Comptable|Médecin|Dentiste|Architecte|Ingénieur|Notaire|Enseignant|Directeur|Gérant)\b/i;
      const profMatch = textToScan.match(profPattern);
      const professionName = profMatch ? profMatch[1] : detectedSector;

      professions.push({
        profession: professionName,
        sector: detectedSector,
        confidence: 80,
        source: item.url
      });
      discoveries.push({
        id: `disc-prof-${Date.now()}-${discoveries.length}`,
        type: 'PROFESSION',
        field: 'profession',
        value: professionName,
        sourceUrl: item.url,
        sourceType: 'directory',
        snippet: item.snippet,
        confidence: 80,
        timestamp: now
      });
    }

    // 6. Location / City Detection
    for (const cityEntry of TUNISIA_CITIES) {
      if (textToScan.toLowerCase().includes(cityEntry.city.toLowerCase())) {
        locations.push({
          city: cityEntry.city,
          regionGovernorate: cityEntry.gov,
          source: item.url
        });
        discoveries.push({
          id: `disc-loc-${Date.now()}-${discoveries.length}`,
          type: 'LOCATION',
          field: 'city',
          value: `${cityEntry.city}, ${cityEntry.gov}`,
          sourceUrl: item.url,
          sourceType: 'directory',
          confidence: 85,
          timestamp: now
        });
        break; // Keep the primary city
      }
    }
  }

  return {
    candidateEmails,
    identities,
    professions,
    locations,
    organizations,
    digitalAssets,
    discoveries
  };
}
