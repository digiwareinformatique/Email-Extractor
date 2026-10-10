/**
 * AI Provider Configuration & Testing Routes
 * Supports: Gemini (Default/Custom), OpenAI, Groq, DeepSeek, Anthropic, Mistral, Ollama/Local, or 0-Quota Mode
 * STE DigiWare SUARL - Lead Intelligence Platform
 */
import { Router, Request, Response } from 'express';
import { MultiAiClient, SUPPORTED_AI_PROVIDERS, AiConfig } from '../ai/multiAiClient';

export const aiRouter = Router();

// Helper to safely mask API keys in UI responses
function maskApiKey(key?: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

// 1. Get current AI configuration and list of supported providers
aiRouter.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await MultiAiClient.getConfig();
    const defaultGeminiKey = process.env.GEMINI_API_KEY;
    const hasDefaultGemini = Boolean(defaultGeminiKey && defaultGeminiKey !== 'MY_GEMINI_API_KEY');

    res.json({
      current: {
        provider: config.provider,
        model: config.model || MultiAiClient.getDefaultModel(config.provider),
        baseUrl: config.baseUrl || '',
        apiKeyMasked: maskApiKey(config.apiKey),
        hasApiKeySet: Boolean(config.apiKey && config.apiKey.length > 0),
        temperature: config.temperature ?? 0.1
      },
      hasDefaultGemini,
      defaultGeminiModel: 'gemini-3.8-flash',
      providers: SUPPORTED_AI_PROVIDERS
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read AI configuration', details: err?.message });
  }
});

// 2. Save and activate AI configuration
aiRouter.post('/config', async (req: Request, res: Response) => {
  try {
    const { provider, apiKey, model, baseUrl, temperature } = req.body;
    const currentConfig = await MultiAiClient.getConfig();

    // If apiKey is not provided or is just a mask '••••••••', keep existing stored key
    let finalApiKey = apiKey;
    if ((!finalApiKey || finalApiKey.includes('••••')) && currentConfig.provider === provider) {
      finalApiKey = currentConfig.apiKey;
    }

    const newConfig: AiConfig = {
      provider: provider || 'gemini-default',
      apiKey: finalApiKey ? String(finalApiKey).trim() : undefined,
      model: model ? String(model).trim() : undefined,
      baseUrl: baseUrl ? String(baseUrl).trim() : undefined,
      temperature: typeof temperature === 'number' ? temperature : 0.1
    };

    const saved = await MultiAiClient.saveConfig(newConfig);

    res.json({
      success: true,
      message: `Fournisseur IA mis à jour avec succès : ${saved.provider}`,
      current: {
        provider: saved.provider,
        model: saved.model || MultiAiClient.getDefaultModel(saved.provider),
        baseUrl: saved.baseUrl || '',
        apiKeyMasked: maskApiKey(saved.apiKey),
        hasApiKeySet: Boolean(saved.apiKey && saved.apiKey.length > 0)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update AI configuration', details: err?.message });
  }
});

// 3. Test AI connection with given or stored settings
aiRouter.post('/test', async (req: Request, res: Response) => {
  try {
    const { provider, apiKey, model, baseUrl } = req.body;
    const currentConfig = await MultiAiClient.getConfig();

    let keyToUse = apiKey;
    if ((!keyToUse || keyToUse.includes('••••')) && currentConfig.provider === provider) {
      keyToUse = currentConfig.apiKey;
    }

    const configToTest: AiConfig = {
      provider: provider || currentConfig.provider,
      apiKey: keyToUse,
      model: model || currentConfig.model,
      baseUrl: baseUrl || currentConfig.baseUrl,
      temperature: 0.1
    };

    const result = await MultiAiClient.testConnection(configToTest);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      latencyMs: 0,
      message: err?.message || 'Erreur lors du test de connexion',
      model: 'Inconnu'
    });
  }
});
