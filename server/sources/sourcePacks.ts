/**
 * Sector Source Packs Configuration
 * STE DigiWare SUARL - Lead Intelligence Platform
 */
import { PriorityQueryItem } from '../../src/types/lead';

export interface SourcePackDefinition {
  sectorCode: string;
  label: string;
  primaryDirectories: string[];
  queryTemplates: {
    family: PriorityQueryItem['sourceFamily'];
    template: (context: Record<string, string>) => string;
    reason: string;
    expectedValue: PriorityQueryItem['expectedValue'];
    priorityWeight: number;
  }[];
}

export const SECTOR_SOURCE_PACKS: Record<string, SourcePackDefinition> = {
  AVOCAT: {
    sectorCode: 'AVOCAT',
    label: 'Avocats & Cabinets Juridiques',
    primaryDirectories: ['ordre-avocats.org.tn', 'avocats-tunisie.tn', 'facebook.com'],
    queryTemplates: [
      {
        family: 'FACEBOOK',
        template: (ctx) => `site:facebook.com "${ctx.name || ctx.company}" avocat ${ctx.city || 'Tunisie'}`,
        reason: 'Recherche de la page Facebook officielle du cabinet d\'avocat',
        expectedValue: 'VERY_HIGH',
        priorityWeight: 90
      },
      {
        family: 'EMAIL_SEARCH',
        template: (ctx) => `"${ctx.name || ctx.company}" avocat ${ctx.city || 'Tunis'} (contact OR email OR "@")`,
        reason: 'Recherche d\'empreinte email publique pour le cabinet d\'avocat',
        expectedValue: 'VERY_HIGH',
        priorityWeight: 85
      },
      {
        family: 'LINKEDIN',
        template: (ctx) => `site:tn.linkedin.com/in/ "${ctx.name}" avocat`,
        reason: 'Recherche du profil LinkedIn professionnel de l\'avocat',
        expectedValue: 'HIGH',
        priorityWeight: 75
      },
      {
        family: 'PDF_DISCOVERY',
        template: (ctx) => `filetype:pdf "${ctx.name || ctx.company}" avocat (email OR contact)`,
        reason: 'Extraction de coordonnées dans les mémoires, publications ou listes ordinales PDF',
        expectedValue: 'MEDIUM',
        priorityWeight: 60
      }
    ]
  },

  COMPTABLE: {
    sectorCode: 'COMPTABLE',
    label: 'Experts-Comptables & Commissaires aux Comptes',
    primaryDirectories: ['oect.org.tn', 'cct.org.tn', 'linkedin.com', 'facebook.com'],
    queryTemplates: [
      {
        family: 'LINKEDIN',
        template: (ctx) => `site:tn.linkedin.com/in/ "${ctx.name}" comptable OR audit OR "commissaire aux comptes"`,
        reason: 'Recherche du profil LinkedIn et de la structure d\'expertise comptable',
        expectedValue: 'VERY_HIGH',
        priorityWeight: 90
      },
      {
        family: 'FACEBOOK',
        template: (ctx) => `site:facebook.com "${ctx.name || ctx.company}" comptable ${ctx.city || 'Tunisie'}`,
        reason: 'Recherche de la page Facebook du cabinet d\'expertise comptable',
        expectedValue: 'HIGH',
        priorityWeight: 85
      },
      {
        family: 'EMAIL_SEARCH',
        template: (ctx) => `"${ctx.name || ctx.company}" expert comptable (email OR contact OR "@")`,
        reason: 'Recherche d\'email professionnel pour le cabinet comptable',
        expectedValue: 'VERY_HIGH',
        priorityWeight: 85
      }
    ]
  },

  ECOLE_PRIVEE: {
    sectorCode: 'ECOLE_PRIVEE',
    label: 'Écoles Privées, Lycées & Centres de Formation',
    primaryDirectories: ['facebook.com', 'instagram.com', 'education.gov.tn'],
    queryTemplates: [
      {
        family: 'FACEBOOK',
        template: (ctx) => `site:facebook.com "${ctx.company || ctx.name}" école ${ctx.city || 'Tunisie'}`,
        reason: 'Recherche de la page Facebook officielle de l\'établissement scolaire',
        expectedValue: 'VERY_HIGH',
        priorityWeight: 95
      },
      {
        family: 'DOMAIN_AUDIT',
        template: (ctx) => `site:${ctx.domain || 'tn'} (contact OR inscription OR email OR "@")`,
        reason: 'Recherche de la page d\'inscriptions et contacts de l\'école',
        expectedValue: 'VERY_HIGH',
        priorityWeight: 90
      },
      {
        family: 'EMAIL_SEARCH',
        template: (ctx) => `"${ctx.company || ctx.name}" (email OR inscription OR contact OR "@")`,
        reason: 'Recherche directe de l\'email d\'administration de l\'école',
        expectedValue: 'HIGH',
        priorityWeight: 85
      }
    ]
  },

  BUREAU_ETUDE: {
    sectorCode: 'BUREAU_ETUDE',
    label: 'Bureaux d\'Études, Ingénierie & Architectes',
    primaryDirectories: ['oit.org.tn', 'oat.org.tn', 'linkedin.com'],
    queryTemplates: [
      {
        family: 'LINKEDIN',
        template: (ctx) => `site:tn.linkedin.com/in/ "${ctx.name || ctx.company}" ingénieur OR architecte`,
        reason: 'Recherche du profil professionnel LinkedIn du bureau d\'études',
        expectedValue: 'VERY_HIGH',
        priorityWeight: 90
      },
      {
        family: 'EMAIL_SEARCH',
        template: (ctx) => `"${ctx.company || ctx.name}" "bureau d'études" (email OR contact OR "@")`,
        reason: 'Recherche des coordonnées officielles d\'appels d\'offres',
        expectedValue: 'HIGH',
        priorityWeight: 85
      }
    ]
  },

  ENTREPRISE: {
    sectorCode: 'ENTREPRISE',
    label: 'Entreprises, Sociétés Commerciales & PME',
    primaryDirectories: ['rne.tn', 'registre-commerce.tn', 'linkedin.com', 'facebook.com'],
    queryTemplates: [
      {
        family: 'LINKEDIN',
        template: (ctx) => `site:linkedin.com/company/ "${ctx.company || ctx.name}"`,
        reason: 'Recherche de la page d\'entreprise LinkedIn et du nom de domaine officiel',
        expectedValue: 'VERY_HIGH',
        priorityWeight: 90
      },
      {
        family: 'FACEBOOK',
        template: (ctx) => `site:facebook.com "${ctx.company || ctx.name}" Tunisie`,
        reason: 'Recherche de la vitrine commerciale Facebook de l\'entreprise',
        expectedValue: 'HIGH',
        priorityWeight: 85
      },
      {
        family: 'EMAIL_SEARCH',
        template: (ctx) => `"${ctx.company || ctx.name}" Tunisie (email OR contact OR "@")`,
        reason: 'Extraction de l\'email commercial ou de direction',
        expectedValue: 'VERY_HIGH',
        priorityWeight: 85
      }
    ]
  },

  SANTE: {
    sectorCode: 'SANTE',
    label: 'Médecins, Cliniques & Santé',
    primaryDirectories: ['ordre-medecins.org.tn', 'facebook.com'],
    queryTemplates: [
      {
        family: 'FACEBOOK',
        template: (ctx) => `site:facebook.com "Dr ${ctx.name || ctx.company}" ${ctx.city || 'Tunisie'}`,
        reason: 'Recherche de la page Facebook du cabinet médical ou de la clinique',
        expectedValue: 'VERY_HIGH',
        priorityWeight: 95
      },
      {
        family: 'EMAIL_SEARCH',
        template: (ctx) => `"Dr ${ctx.name || ctx.company}" médecin (email OR contact OR "@")`,
        reason: 'Extraction de l\'email professionnel du médecin',
        expectedValue: 'VERY_HIGH',
        priorityWeight: 90
      }
    ]
  }
};

export interface MetierKeywordsInfo {
  code: string;
  label: string;
  primaryFr: string;
  secondaryFr: string[];
  primaryAr: string;
  secondaryAr: string[];
}

export function getMetierKeywords(sectorCode?: string): MetierKeywordsInfo {
  const code = (sectorCode || 'AVOCAT').toUpperCase();
  switch (code) {
    case 'AVOCAT':
      return {
        code: 'AVOCAT',
        label: 'Avocats & Cabinets Juridiques',
        primaryFr: 'avocat',
        secondaryFr: ['maître', 'cabinet d\'avocat', 'barreau', 'juridique'],
        primaryAr: 'محامي',
        secondaryAr: ['الأستاذ', 'مكتب محاماة', 'هيئة المحامين']
      };
    case 'ECOLE_PRIVEE':
    case 'ECOLE':
      return {
        code: 'ECOLE_PRIVEE',
        label: 'Écoles Privées & Établissements',
        primaryFr: 'école privée',
        secondaryFr: ['collège privé', 'lycée privé', 'institution', 'complexe scolaire'],
        primaryAr: 'مدرسة خاصة',
        secondaryAr: ['معهد خاص', 'مؤسسة تربوية خاصة']
      };
    case 'SANTE':
    case 'MEDECIN':
      return {
        code: 'SANTE',
        label: 'Médecins, Docteurs & Cliniques',
        primaryFr: 'docteur',
        secondaryFr: ['dr', 'médecin', 'cabinet médical', 'clinique'],
        primaryAr: 'طبيب',
        secondaryAr: ['دكتور', 'عيادة', 'مصحة']
      };
    case 'COMPTABLE':
      return {
        code: 'COMPTABLE',
        label: 'Experts-Comptables & Audit',
        primaryFr: 'expert-comptable',
        secondaryFr: ['comptable', 'commissaire aux comptes', 'audit', 'fiduciaire'],
        primaryAr: 'خبير محاسب',
        secondaryAr: ['مكتب محاسبة', 'مراقب حسابات']
      };
    case 'BUREAU_ETUDE':
      return {
        code: 'BUREAU_ETUDE',
        label: 'Bureaux d\'Études & Architectes',
        primaryFr: "bureau d'études",
        secondaryFr: ['architecte', 'ingénieur', 'géomètre', 'topographe'],
        primaryAr: 'مكتب دراسات',
        secondaryAr: ['مهندس معماري', 'مهندس مستشار']
      };
    default:
      return {
        code: 'ENTREPRISE',
        label: 'Entreprises & Sociétés',
        primaryFr: 'société',
        secondaryFr: ['sarl', 'suarl', 'entreprise', 'direction'],
        primaryAr: 'شركة',
        secondaryAr: ['مؤسسة', 'مدير عام']
      };
  }
}

export function getSourcePackForSector(sectorCode: string): SourcePackDefinition {
  return SECTOR_SOURCE_PACKS[sectorCode] || SECTOR_SOURCE_PACKS.ENTREPRISE;
}
