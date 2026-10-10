/**
 * Universal Multi-Provider AI Orchestrator
 * Supports: Gemini (Google AI Studio default or custom key), OpenAI, Groq, DeepSeek, Anthropic, Mistral, Ollama/Local OpenAI Compatible, or 0-Quota Disabled Mode.
 * STE DigiWare SUARL - Lead Intelligence Architecture
 */
import { GoogleGenAI } from '@google/genai';
import { getAppSetting, setAppSetting } from '../database/leadDb';
import { SearchResultItem } from '../search/types';

export type AiProviderType = 
  | 'gemini-default' 
  | 'gemini-custom' 
  | 'openai' 
  | 'groq' 
  | 'deepseek' 
  | 'anthropic' 
  | 'mistral' 
  | 'custom-openai' 
  | 'disabled';

export interface AiConfig {
  provider: AiProviderType;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
}

export interface AiProviderInfo {
  id: AiProviderType;
  name: string;
  defaultModel: string;
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
  description: string;
  isFreeOrGenerous: boolean;
}

export const SUPPORTED_AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: 'gemini-default',
    name: 'Google Gemini (Défaut Google AI Studio)',
    defaultModel: 'gemini-3.8-flash',
    requiresApiKey: false,
    requiresBaseUrl: false,
    description: 'Modèle officiel préconfiguré via la clé de votre projet Google AI Studio. Quota partagé quotidien.',
    isFreeOrGenerous: true
  },
  {
    id: 'groq',
    name: 'Groq (Ultra-rapide - Quota généreux gratuit)',
    defaultModel: 'llama-3.3-70b-versatile',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'Inférence LPU instantanée avec Llama 3.3 70B ou Llama 3.1 8B. Idéal pour économiser votre quota Google sans payer.',
    isFreeOrGenerous: true
  },
  {
    id: 'deepseek',
    name: 'DeepSeek (DeepSeek V3 / R1)',
    defaultModel: 'deepseek-chat',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'Modèle de raisonnement puissant et extrêmement économique.',
    isFreeOrGenerous: false
  },
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT / GPT-4o)',
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'Modèles officiels OpenAI (gpt-4o-mini, gpt-4o, o3-mini).',
    isFreeOrGenerous: false
  },
  {
    id: 'gemini-custom',
    name: 'Google Gemini (Clé Personnalisée / Payante)',
    defaultModel: 'gemini-2.5-flash',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'Utilisez votre propre clé API Gemini externe pour contourner les quotas du compte AI Studio.',
    isFreeOrGenerous: false
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude (Claude 3.5 Haiku / Sonnet)',
    defaultModel: 'claude-3-5-haiku-20241022',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'Modèles Claude d Anthropic reconnus pour leur précision d analyse contextuelle.',
    isFreeOrGenerous: false
  },
  {
    id: 'mistral',
    name: 'Mistral AI (Mistral Small / Large)',
    defaultModel: 'mistral-small-latest',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'Modèles européens souverains et rapides.',
    isFreeOrGenerous: false
  },
  {
    id: 'custom-openai',
    name: 'Serveur Local / Compatible OpenAI (Ollama, LM Studio, vLLM)',
    defaultModel: 'llama3',
    requiresApiKey: false,
    requiresBaseUrl: true,
    description: 'Connectez un serveur local (ex: http://localhost:11434/v1) sans aucun coût ni fuite de données.',
    isFreeOrGenerous: true
  },
  {
    id: 'disabled',
    name: 'Mode 0 Quota (Heuristique & Annuaires Uniquement)',
    defaultModel: 'none',
    requiresApiKey: false,
    requiresBaseUrl: false,
    description: 'Désactive tout appel d IA. Le moteur de prospection utilise 100% les annuaires publics déterministes et Regex.',
    isFreeOrGenerous: true
  }
];

let cachedConfig: AiConfig | null = null;
let lastQuotaCooldownUntil = 0;

export class MultiAiClient {
  /**
   * Loads the current AI Configuration from SQLite or defaults to Gemini AI Studio
   */
  public static async getConfig(): Promise<AiConfig> {
    if (cachedConfig) return cachedConfig;

    try {
      const stored = await getAppSetting('ai_config');
      if (stored) {
        cachedConfig = JSON.parse(stored);
        return cachedConfig!;
      }
    } catch (e) {
      console.warn('[MultiAiClient] Error reading ai_config setting:', e);
    }

    // Default configuration: Gemini Default
    cachedConfig = {
      provider: 'gemini-default',
      model: 'gemini-3.8-flash',
      temperature: 0.1
    };
    return cachedConfig;
  }

  /**
   * Saves and activates an AI configuration
   */
  public static async saveConfig(config: AiConfig): Promise<AiConfig> {
    cachedConfig = { ...config };
    await setAppSetting('ai_config', JSON.stringify(cachedConfig));
    console.log(`[MultiAiClient] AI provider switched to: ${config.provider} (model: ${config.model || 'default'})`);
    return cachedConfig;
  }

  /**
   * Tests the connection with a selected AI configuration
   */
  public static async testConnection(config: AiConfig): Promise<{
    success: boolean;
    latencyMs: number;
    message: string;
    model: string;
  }> {
    const start = Date.now();

    if (config.provider === 'disabled') {
      return {
        success: true,
        latencyMs: 0,
        message: 'Mode 0 Quota activé. Aucun appel API ne sera effectué.',
        model: 'Heuristique Locale'
      };
    }

    try {
      const testPrompt = "Tu es un assistant connecté. Réponds uniquement par le mot 'CONNECTE' suivi du nom de ton modèle.";
      const response = await this.callRawProvider(config, testPrompt, {
        systemInstruction: "Réponds très brièvement.",
        maxTokens: 50
      });

      const latencyMs = Date.now() - start;
      if (!response) {
        throw new Error("Réponse vide reçue du fournisseur");
      }

      return {
        success: true,
        latencyMs,
        message: `Connexion réussie ! Réponse : "${response.slice(0, 60).trim()}"`,
        model: config.model || this.getDefaultModel(config.provider)
      };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      return {
        success: false,
        latencyMs,
        message: err?.message || "Erreur de connexion avec ce fournisseur d'IA",
        model: config.model || this.getDefaultModel(config.provider)
      };
    }
  }

  /**
   * Searches and synthesizes SERP results using the currently configured AI
   */
  public static async searchSerpWithAi(query: string, maxResults: number = 6): Promise<SearchResultItem[]> {
    const config = await this.getConfig();

    // If AI is disabled or in quota cooldown, return empty array to let deterministic engine work
    if (config.provider === 'disabled') {
      return [];
    }

    if (config.provider === 'gemini-default' && Date.now() < lastQuotaCooldownUntil) {
      console.log(`[MultiAiClient] Cooldown active for Gemini AI Studio. Skipping to preserve quota.`);
      return [];
    }

    const systemInstruction = `Tu es un moteur de recherche et d'indexation web public expert pour la Tunisie (+216).
Ta mission est d'effectuer ou simuler une recherche web exacte et de retourner des résultats réalistes et vérifiables (titre, URL, snippet/texte descriptif, domaine).
Tu dois fidèlement reproduire les extraits indexés pour le web tunisien (Pages Jaunes TN, Réseau Telecom, Pages Facebook publiques, Annuaires professionnels, RNE, Ordre des Avocats, Ordre des Médecins, sites .tn et .com).

RÈGLES STRICTES :
1. Ne jamais inventer de fausse adresse email aléatoire.
2. Si un email ou un contact apparaît explicitement dans l'extrait public, inclus-le fidèlement dans le snippet.
3. Retourne TOUJOURS un tableau JSON valide avec des objets: [{"title": "...", "url": "...", "snippet": "...", "sourceDomain": "..."}]. Ne retourne AUCUN texte avant ou après le JSON.`;

    const prompt = `Effectue la recherche web suivante pour la Tunisie :
Query: ${query}

Retourne au maximum ${maxResults} résultats pertinents au format JSON strict.`;

    try {
      const rawText = await this.callRawProvider(config, prompt, { systemInstruction, maxTokens: 1200 });
      if (!rawText) return [];

      const cleanJson = this.extractJsonArray(rawText);
      if (!cleanJson || !Array.isArray(cleanJson)) return [];

      return cleanJson.map((item: any, idx: number) => {
        let domain = item.sourceDomain || '';
        try {
          if (!domain && item.url) {
            domain = new URL(item.url).hostname;
          }
        } catch (e) {
          domain = 'web.tn';
        }

        return {
          title: String(item.title || ''),
          url: String(item.url || `https://${domain}`),
          snippet: String(item.snippet || ''),
          sourceDomain: domain.replace(/^www\./, ''),
          rank: idx + 1
        };
      });

    } catch (err: any) {
      const errMsg = err?.message || String(err);
      if (config.provider === 'gemini-default' && (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED'))) {
        lastQuotaCooldownUntil = Date.now() + 30000;
        console.warn('[MultiAiClient] Quota Google AI Studio atteint. Pause 30s.');
      } else {
        console.warn(`[MultiAiClient] Error with provider ${config.provider}:`, errMsg.slice(0, 150));
      }
      return [];
    }
  }

  /**
   * Generates a structured JSON object or array from any configured AI
   */
  public static async generateJson<T>(
    prompt: string, 
    options?: { systemInstruction?: string; maxTokens?: number }
  ): Promise<T | null> {
    const config = await this.getConfig();
    if (config.provider === 'disabled') return null;

    try {
      const rawText = await this.callRawProvider(config, prompt, options);
      if (!rawText) return null;
      return this.parseFlexibleJson<T>(rawText);
    } catch (err) {
      console.warn(`[MultiAiClient] generateJson error:`, err);
      return null;
    }
  }

  /**
   * Core dispatcher that talks to the specific API
   */
  private static async callRawProvider(
    config: AiConfig, 
    prompt: string, 
    options?: { systemInstruction?: string; maxTokens?: number }
  ): Promise<string | null> {
    const provider = config.provider;

    switch (provider) {
      case 'gemini-default': {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
          throw new Error("Clé GEMINI_API_KEY par défaut introuvable dans l'environnement");
        }
        const client = new GoogleGenAI({ apiKey });
        const model = config.model || 'gemini-3.8-flash';
        const res = await client.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: options?.systemInstruction,
            temperature: config.temperature ?? 0.1
          }
        });
        return res.text || null;
      }

      case 'gemini-custom': {
        if (!config.apiKey) throw new Error("Clé API Gemini personnalisée manquante");
        const client = new GoogleGenAI({ apiKey: config.apiKey });
        const model = config.model || 'gemini-2.5-flash';
        const res = await client.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: options?.systemInstruction,
            temperature: config.temperature ?? 0.1
          }
        });
        return res.text || null;
      }

      case 'openai': {
        if (!config.apiKey) throw new Error("Clé API OpenAI manquante");
        const model = config.model || 'gpt-4o-mini';
        return await this.callOpenAiCompatibleApi({
          url: 'https://api.openai.com/v1/chat/completions',
          apiKey: config.apiKey,
          model,
          prompt,
          systemInstruction: options?.systemInstruction,
          maxTokens: options?.maxTokens,
          temperature: config.temperature
        });
      }

      case 'groq': {
        if (!config.apiKey) throw new Error("Clé API Groq manquante (obtenez-en une gratuitement sur console.groq.com)");
        const model = config.model || 'llama-3.3-70b-versatile';
        return await this.callOpenAiCompatibleApi({
          url: 'https://api.groq.com/openai/v1/chat/completions',
          apiKey: config.apiKey,
          model,
          prompt,
          systemInstruction: options?.systemInstruction,
          maxTokens: options?.maxTokens,
          temperature: config.temperature
        });
      }

      case 'deepseek': {
        if (!config.apiKey) throw new Error("Clé API DeepSeek manquante");
        const model = config.model || 'deepseek-chat';
        return await this.callOpenAiCompatibleApi({
          url: 'https://api.deepseek.com/chat/completions',
          apiKey: config.apiKey,
          model,
          prompt,
          systemInstruction: options?.systemInstruction,
          maxTokens: options?.maxTokens,
          temperature: config.temperature
        });
      }

      case 'mistral': {
        if (!config.apiKey) throw new Error("Clé API Mistral manquante");
        const model = config.model || 'mistral-small-latest';
        return await this.callOpenAiCompatibleApi({
          url: 'https://api.mistral.ai/v1/chat/completions',
          apiKey: config.apiKey,
          model,
          prompt,
          systemInstruction: options?.systemInstruction,
          maxTokens: options?.maxTokens,
          temperature: config.temperature
        });
      }

      case 'anthropic': {
        if (!config.apiKey) throw new Error("Clé API Anthropic manquante");
        const model = config.model || 'claude-3-5-haiku-20241022';
        const messages = [{ role: 'user', content: prompt }];
        const body: any = {
          model,
          messages,
          max_tokens: options?.maxTokens || 1024,
          temperature: config.temperature ?? 0.1
        };
        if (options?.systemInstruction) {
          body.system = options.systemInstruction;
        }

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Erreur Anthropic (${res.status}): ${errText}`);
        }

        const json = await res.json();
        const textBlock = json.content?.find((c: any) => c.type === 'text');
        return textBlock ? textBlock.text : null;
      }

      case 'custom-openai': {
        const rawUrl = config.baseUrl || 'http://localhost:11434/v1';
        const url = rawUrl.endsWith('/chat/completions') 
          ? rawUrl 
          : `${rawUrl.replace(/\/$/, '')}/chat/completions`;
        const model = config.model || 'llama3';
        return await this.callOpenAiCompatibleApi({
          url,
          apiKey: config.apiKey || 'none',
          model,
          prompt,
          systemInstruction: options?.systemInstruction,
          maxTokens: options?.maxTokens,
          temperature: config.temperature
        });
      }

      case 'disabled':
        return null;

      default:
        throw new Error(`Fournisseur d'IA inconnu: ${provider}`);
    }
  }

  /**
   * Helper for all standard OpenAI-compatible endpoints (OpenAI, Groq, DeepSeek, Mistral, Ollama, vLLM)
   */
  private static async callOpenAiCompatibleApi(params: {
    url: string;
    apiKey: string;
    model: string;
    prompt: string;
    systemInstruction?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string | null> {
    const messages: { role: string; content: string }[] = [];
    if (params.systemInstruction) {
      messages.push({ role: 'system', content: params.systemInstruction });
    }
    messages.push({ role: 'user', content: params.prompt });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (params.apiKey && params.apiKey !== 'none') {
      headers['Authorization'] = `Bearer ${params.apiKey}`;
    }

    const res = await fetch(params.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: params.model,
        messages,
        temperature: params.temperature ?? 0.1,
        max_tokens: params.maxTokens || 1200
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erreur API (${res.status}): ${errText.slice(0, 200)}`);
    }

    const json = await res.json();
    return json?.choices?.[0]?.message?.content || null;
  }

  /**
   * Extracts JSON array from markdown or surrounding text
   */
  private static extractJsonArray(text: string): any[] | null {
    try {
      // 1. Direct parse
      const direct = JSON.parse(text);
      if (Array.isArray(direct)) return direct;
    } catch (e) {}

    try {
      // 2. Extract from markdown ```json [ ... ] ```
      const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        return JSON.parse(match[0]);
      }
    } catch (e) {}

    return null;
  }

  /**
   * Parses flexible JSON object or array
   */
  private static parseFlexibleJson<T>(text: string): T | null {
    try {
      return JSON.parse(text);
    } catch (e) {}

    try {
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        return JSON.parse(codeBlockMatch[1]);
      }
    } catch (e) {}

    try {
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) return JSON.parse(objectMatch[0]);
    } catch (e) {}

    try {
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) return JSON.parse(arrayMatch[0]);
    } catch (e) {}

    return null;
  }

  public static getDefaultModel(provider: AiProviderType): string {
    const found = SUPPORTED_AI_PROVIDERS.find(p => p.id === provider);
    return found ? found.defaultModel : 'gemini-3.8-flash';
  }
}
