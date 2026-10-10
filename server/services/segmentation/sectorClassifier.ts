/**
 * Dynamic Sector Classifier & Segmentation Engine
 * STE DigiWare SUARL
 */
import { DEFAULT_SEGMENTS, getSegments } from '../../database/leadDb';
import { SegmentDefinition } from '../../../src/types/lead';

export interface ClassificationResult {
  primarySector: string;
  segments: string[];
  confidence: number;
}

/**
 * Synchronous sector detector using DEFAULT_SEGMENTS
 */
export function detectSectorFromText(text: string): string {
  if (!text || !text.trim()) return 'AUTRE';
  const normalized = text.toLowerCase();

  for (const seg of DEFAULT_SEGMENTS) {
    if (seg.code === 'INCONNU') continue;
    for (const kw of seg.keywords) {
      const kwLower = kw.toLowerCase().trim();
      if (!kwLower) continue;
      if (normalized.includes(kwLower)) {
        return seg.code;
      }
    }
  }
  return 'AUTRE';
}

/**
 * Classifies text content into industry sectors based on dynamic keyword matching
 */
export async function classifySector(
  contextText: string, 
  existingSegments?: SegmentDefinition[]
): Promise<ClassificationResult> {
  const segments = existingSegments && existingSegments.length > 0 ? existingSegments : await getSegments();
  if (!contextText || !contextText.trim()) {
    return { primarySector: 'INCONNU', segments: ['INCONNU'], confidence: 0 };
  }

  const normalized = contextText.toLowerCase();
  const matchedSectors: { code: string; score: number }[] = [];

  for (const seg of segments) {
    if (seg.code === 'INCONNU') continue;
    let score = 0;

    for (const kw of seg.keywords) {
      const kwLower = kw.toLowerCase().trim();
      if (!kwLower) continue;

      // Exact word boundary or substring match
      const regex = new RegExp(`\\b${escapeRegExp(kwLower)}\\b`, 'iu');
      if (regex.test(normalized)) {
        score += 15;
      } else if (normalized.includes(kwLower)) {
        score += 8;
      }
    }

    if (score > 0) {
      matchedSectors.push({ code: seg.code, score });
    }
  }

  if (matchedSectors.length === 0) {
    return { primarySector: 'INCONNU', segments: ['INCONNU'], confidence: 0 };
  }

  // Sort by highest score descending
  matchedSectors.sort((a, b) => b.score - a.score);

  const primarySector = matchedSectors[0].code;
  const allMatchedCodes = matchedSectors.map(s => s.code);

  return {
    primarySector,
    segments: allMatchedCodes,
    confidence: Math.min(100, matchedSectors[0].score)
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
