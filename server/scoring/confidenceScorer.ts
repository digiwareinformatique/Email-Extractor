/**
 * Dual Confidence Scoring Engine & Corroboration Matrix
 * STE DigiWare SUARL - Lead Intelligence Platform
 * 
 * Separates Identity Confidence from Email Confidence
 */
import { LeadRecord, LeadConfidenceLevel, LeadStatus } from '../../src/types/lead';

export function calculateLeadConfidenceScores(lead: LeadRecord): {
  identityConfidence: number;
  emailConfidence: number;
  confidenceScore: number;
  confidenceLevel: LeadConfidenceLevel;
  status: LeadStatus;
} {
  // 1. Calculate IDENTITY CONFIDENCE (0 - 100)
  let idScore = 0;
  if (lead.normalizedPhone) idScore += 15; // Valid Tunisian phone
  if (lead.fullName) idScore += 25;       // Full name discovered
  if (lead.title) idScore += 10;          // Title (Maître, Dr, etc.)
  if (lead.profession) idScore += 20;     // Profession / métier
  if (lead.companyName) idScore += 15;    // Cabinet / Société
  if (lead.city) idScore += 15;           // Localisation

  // Multipliers for identity corroboration
  if (lead.identities.length >= 2) {
    idScore = Math.min(100, Math.round(idScore * 1.15));
  }
  const identityConfidence = Math.min(100, idScore);

  // 2. Calculate EMAIL CONFIDENCE (0 - 100)
  let emailConfidence = 0;
  let topEmail = lead.candidateEmails[0];

  if (topEmail) {
    let baseScore = topEmail.score || 50;

    // Email Type Bonus
    if (topEmail.emailType === 'company_domain') baseScore += 15;
    else if (topEmail.emailType === 'generic_org') baseScore += 10;
    else if (topEmail.emailType === 'personal_public') baseScore += 5;

    // Cross-Correlation: Check if email local part matches lead name
    if (lead.fullName) {
      const cleanName = lead.fullName.toLowerCase().replace(/[^a-z]/g, '');
      const cleanEmail = topEmail.email.toLowerCase().split('@')[0].replace(/[^a-z]/g, '');
      if (cleanEmail.includes(cleanName) || (lead.lastName && cleanEmail.includes(lead.lastName.toLowerCase()))) {
        baseScore += 15; // Direct nominal correlation
      }
    }

    // Corroboration across multiple sources
    if (topEmail.corroborationCount >= 2 || topEmail.sources.length >= 2) {
      baseScore += 15;
    }

    emailConfidence = Math.min(100, baseScore);
  }

  // Composite Legacy Score
  const confidenceScore = Math.round((identityConfidence * 0.4) + (emailConfidence * 0.6));

  // Determine Level
  let confidenceLevel: LeadConfidenceLevel = 'LOW';
  if (emailConfidence >= 80 || (identityConfidence >= 85 && emailConfidence >= 60)) {
    confidenceLevel = 'HIGH';
  } else if (emailConfidence >= 50 || identityConfidence >= 60) {
    confidenceLevel = 'MEDIUM';
  }

  // Determine Lead Status
  let status: LeadStatus = lead.status;
  if (emailConfidence >= 85) {
    status = 'EMAIL_CONFIRMED';
  } else if (emailConfidence >= 60) {
    status = 'EMAIL_FOUND';
  } else if (lead.candidateEmails.length > 0) {
    status = 'EMAIL_CANDIDATE';
  } else if (identityConfidence >= 40 || lead.fullName) {
    status = 'IDENTITY_FOUND';
  } else if (lead.discoveries.length > 0) {
    status = 'NEEDS_VERIFICATION';
  } else {
    status = 'NO_RESULT';
  }

  return {
    identityConfidence,
    emailConfidence,
    confidenceScore,
    confidenceLevel,
    status
  };
}
