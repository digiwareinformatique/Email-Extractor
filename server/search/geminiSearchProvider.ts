/**
 * Multi-AI Grounded Search Provider
 * Supports: Gemini (AI Studio default or custom key), OpenAI, Groq, DeepSeek, Anthropic, Mistral, Ollama/Local
 * STE DigiWare SUARL - Lead Intelligence Platform
 */
import { ISearchProvider, SearchResultItem, SearchOptions } from './types';
import { MultiAiClient } from '../ai/multiAiClient';

export class GeminiSearchProvider implements ISearchProvider {
  public name = 'ai-grounded';

  public async search(query: string, options: SearchOptions = {}): Promise<SearchResultItem[]> {
    try {
      const results = await MultiAiClient.searchSerpWithAi(query, options.maxResults || 6);
      return results;
    } catch (err) {
      console.warn('[AiSearchProvider] Error searching with active AI:', err);
      return [];
    }
  }
}
