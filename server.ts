import express from 'express';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { parseTextHeuristically, refineContactsWithAI, analyzeFileContent } from './server/extractor';
import { parseWhatsAppTextHeuristically, refineWhatsAppWithAI, analyzeWhatsAppFileContent } from './server/whatsappExtractor';
import { ExtractionRequest, ExtractionResult, WhatsAppExtractionRequest, WhatsAppExtractionResult } from './src/types';
import { leadRouter } from './server/routes/leadRoutes';
import { aiRouter } from './server/routes/aiRoutes';
import { senderRouter } from './server/routes/senderRoutes';
import { businessCenterRouter } from './server/routes/businessCenterRoutes';
import { mcpRouter } from './server/routes/mcpRoutes';
import { MultiAiClient } from './server/ai/multiAiClient';

dotenv.config();

const app = express();
const PORT = 3000;

// CORS Support for Chrome Extension, External Webhooks & Cross-Workspace Communication
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Set body limit to 50MB to support parsing extremely large text files safely
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Mount Routers
app.use('/api', leadRouter);
app.use('/api/ai', aiRouter);
app.use('/api', senderRouter);
app.use('/api/business-center', businessCenterRouter);
app.use('/api/mcp', mcpRouter);

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 1. bis Download Complete WhatsApp Sender Project Zip
app.get(['/api/download-project-zip', '/whatsapp-sender-project.zip', '/whatsapp-sender.zip'], (req, res) => {
  const zipPath = path.join(process.cwd(), 'whatsapp-sender-project.zip');
  try {
    if (!fs.existsSync(zipPath) || req.query.force === 'true') {
      console.log('[Server] Generating fresh WhatsApp Sender Project ZIP archive...');
      execSync('python3 scripts/create_zip.py whatsapp-sender-project.zip', { cwd: process.cwd() });
    }
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="whatsapp-sender-project.zip"');
    res.download(zipPath, 'whatsapp-sender-project.zip', (err) => {
      if (err && !res.headersSent) {
        console.error('[Server] Error streaming zip download:', err);
        res.status(500).json({ error: 'Erreur lors du téléchargement du fichier ZIP.' });
      }
    });
  } catch (err: any) {
    console.error('[Server] Failed to prepare project zip archive:', err);
    res.status(500).json({ error: 'Échec de la génération du fichier ZIP', details: err.message });
  }
});

// 2. Environment & AI Provider config check
app.get('/api/config', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const isDefaultGeminiConfigured = !!apiKey && apiKey !== 'MY_GEMINI_API_KEY';
  const aiConfig = await MultiAiClient.getConfig();

  const isAiActive = aiConfig.provider === 'disabled' 
    ? false 
    : (aiConfig.provider === 'gemini-default' 
      ? isDefaultGeminiConfigured 
      : Boolean(aiConfig.apiKey || aiConfig.baseUrl));

  res.json({
    hasApiKey: isAiActive,
    activeProvider: aiConfig.provider,
    activeModel: aiConfig.model || MultiAiClient.getDefaultModel(aiConfig.provider),
    modelName: aiConfig.model || 'gemini-flash-latest',
    isDefaultGemini: aiConfig.provider === 'gemini-default'
  });
});

// 3. Main Extraction Endpoint
app.post('/api/extract', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { 
      text, 
      fileName = 'fichier.txt', 
      fileSize = 0, 
      aiEnhancement = false, 
      filterSystemEmails = false 
    } = req.body as ExtractionRequest;
    
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Le champ texte est obligatoire et doit être une chaîne.' });
      return;
    }
    
    console.log(`[Extractor] Starting extraction for ${fileName} (${(fileSize / 1024).toFixed(1)} KB)...`);
    
    // Step 1 & 2: Clean & Parse Heuristically
    let contacts = parseTextHeuristically(text, fileName);
    
    console.log(`[Extractor] Heuristic step completed. Found ${contacts.length} candidate contacts.`);
    
    // Step 3: Optional System Emails Filtering
    if (filterSystemEmails) {
      // Completely filter out contacts that have low scores AND have system prefixes
      contacts = contacts.filter(contact => {
        const isSystem = contact.criteriaScores.hasSpamKeywords;
        return !isSystem;
      });
      console.log(`[Extractor] Filtered system emails. Remaining contacts: ${contacts.length}`);
    }
    
    // Step 4: Optional Intelligent AI Refinement using Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    const hasApiKey = !!apiKey && apiKey !== 'MY_GEMINI_API_KEY';
    
    if (aiEnhancement && hasApiKey && contacts.length > 0) {
      console.log(`[Extractor] Running Gemini AI Enhancement step for ambiguous blocks...`);
      try {
        contacts = await refineContactsWithAI(contacts, filterSystemEmails);
        console.log(`[Extractor] AI enhancement step completed.`);
      } catch (aiErr) {
        console.log('[Extractor] AI enhancement fallback activated (heuristics used instead).');
      }
    }
    
    // Step 5: Compute updated statistics
    const highConfidence = contacts.filter(c => c.confidenceLevel === 'High');
    const mediumConfidence = contacts.filter(c => c.confidenceLevel === 'Medium');
    const lowConfidence = contacts.filter(c => c.confidenceLevel === 'Low');
    
    const sumScores = contacts.reduce((sum, c) => sum + c.confidenceScore, 0);
    const averageScore = contacts.length > 0 ? Math.round(sumScores / contacts.length) : 0;
    const timeElapsedMs = Date.now() - startTime;
    
    const stats = {
      totalRecordsFound: contacts.length,
      highConfidenceCount: highConfidence.length,
      mediumConfidenceCount: mediumConfidence.length,
      lowConfidenceCount: lowConfidence.length,
      averageScore,
      timeElapsedMs,
      fileSize,
      fileName
    };
    
    // Provide a small snippet of cleaned text (first 500 chars) for UI preview
    const cleanedSample = text.slice(0, 1000) + (text.length > 1000 ? '...' : '');
    
    const fileAnalysis = analyzeFileContent(text);

    res.json({
      contacts,
      stats,
      cleanedTextSample: cleanedSample,
      fileAnalysis
    } as ExtractionResult);
    
  } catch (err: any) {
    console.error('[Extractor] Critical processing error:', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de l\'extraction.', details: err.message });
  }
});

// 3. bis WhatsApp Extractor Endpoint (Tunisian Numbers & Arabic/Latin Names)
app.post('/api/extract-whatsapp', async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      text,
      fileName = 'fichier.txt',
      fileSize = 0,
      aiEnhancement = false,
      filterLandlines = false,
      targetOperator = 'all'
    } = req.body as WhatsAppExtractionRequest;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Le champ texte est obligatoire et doit être une chaîne.' });
      return;
    }

    console.log(`[WhatsApp Extractor] Starting extraction for ${fileName} (${(fileSize / 1024).toFixed(1)} KB)...`);

    // Step 1: Clean & Parse Heuristically
    let contacts = parseWhatsAppTextHeuristically(text, fileName);
    console.log(`[WhatsApp Extractor] Heuristic step completed. Found ${contacts.length} candidate contacts.`);

    // Step 2: Optional Operator Filtering
    if (filterLandlines) {
      contacts = contacts.filter(c => c.operator !== 'Fixe/VoIP');
      console.log(`[WhatsApp Extractor] Filtered landlines. Remaining: ${contacts.length}`);
    }

    if (targetOperator && targetOperator !== 'all') {
      if (targetOperator === 'mobile_only') {
        contacts = contacts.filter(c => ['Ooredoo', 'Orange', 'Tunisie Telecom', 'Lycamobile'].includes(c.operator));
      } else if (targetOperator === 'ooredoo') {
        contacts = contacts.filter(c => c.operator === 'Ooredoo');
      } else if (targetOperator === 'orange') {
        contacts = contacts.filter(c => c.operator === 'Orange');
      } else if (targetOperator === 'tt') {
        contacts = contacts.filter(c => c.operator === 'Tunisie Telecom');
      } else if (targetOperator === 'lyca') {
        contacts = contacts.filter(c => c.operator === 'Lycamobile');
      }
    }

    // Step 3: Optional AI Enhancement with Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    const hasApiKey = !!apiKey && apiKey !== 'MY_GEMINI_API_KEY';

    if (aiEnhancement && hasApiKey && contacts.length > 0) {
      console.log(`[WhatsApp Extractor] Running Gemini AI Enhancement for ambiguous contacts...`);
      try {
        contacts = await refineWhatsAppWithAI(contacts);
        console.log(`[WhatsApp Extractor] AI enhancement completed.`);
      } catch (aiErr) {
        console.log('[WhatsApp Extractor] AI enhancement fallback activated (heuristics used).');
      }
    }

    // Step 4: Compute updated stats
    const highConfidence = contacts.filter(c => c.confidenceLevel === 'High');
    const mediumConfidence = contacts.filter(c => c.confidenceLevel === 'Medium');
    const lowConfidence = contacts.filter(c => c.confidenceLevel === 'Low');

    const sumScores = contacts.reduce((sum, c) => sum + c.confidenceScore, 0);
    const averageScore = contacts.length > 0 ? Math.round(sumScores / contacts.length) : 0;
    const timeElapsedMs = Date.now() - startTime;

    const arabicNamesCount = contacts.filter(c => c.scriptType === 'arabic').length;
    const latinNamesCount = contacts.filter(c => c.scriptType === 'latin').length;

    const stats = {
      totalRecordsFound: contacts.length,
      highConfidenceCount: highConfidence.length,
      mediumConfidenceCount: mediumConfidence.length,
      lowConfidenceCount: lowConfidence.length,
      averageScore,
      timeElapsedMs,
      fileSize,
      fileName,
      arabicNamesCount,
      latinNamesCount
    };

    const cleanedSample = text.slice(0, 1000) + (text.length > 1000 ? '...' : '');
    const fileAnalysis = analyzeWhatsAppFileContent(text, contacts);

    res.json({
      contacts,
      stats,
      cleanedTextSample: cleanedSample,
      fileAnalysis
    } as WhatsAppExtractionResult);

  } catch (err: any) {
    console.error('[WhatsApp Extractor] Critical processing error:', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de l\'extraction WhatsApp.', details: err.message });
  }
});

// 4. Vite middleware for development vs static build files serving for production
async function setupVite() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[Vite] Mounted Vite middleware successfully in Dev Mode.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('[Vite] Mounted static assets from /dist in Production Mode.');
  }
}

setupVite().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Email Extractor running successfully on http://0.0.0.0:${PORT}`);
  });
});
