/**
 * Unified Hybrid Search Provider with Integrated Cache
 * STE DigiWare SUARL - Lead Intelligence Architecture
 */
import { ISearchProvider, SearchResultItem, SearchOptions } from './types';
import { GeminiSearchProvider } from './geminiSearchProvider';
import { PublicWebSearchProvider } from './publicWebSearchProvider';
import { SearchCache } from '../cache/searchCache';

export class HybridSearchProvider implements ISearchProvider {
  public name = 'hybrid-search';
  private geminiProvider: GeminiSearchProvider;
  private fallbackProvider: PublicWebSearchProvider;

  constructor() {
    this.geminiProvider = new GeminiSearchProvider();
    this.fallbackProvider = new PublicWebSearchProvider();
  }

  public async search(query: string, options: SearchOptions = {}): Promise<SearchResultItem[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    // 1. Check persistent SQLite cache unless explicitly bypassed
    if (!options.skipCache) {
      const cached = await SearchCache.get(cleanQuery, this.name);
      if (cached && cached.length > 0) {
        return cached;
      }
    }

    let results: SearchResultItem[] = [];

    // 2. Try Gemini Grounded Search Provider
    try {
      results = await this.geminiProvider.search(cleanQuery, options);
    } catch (err) {
      console.warn('[HybridSearch] Gemini provider error:', err);
    }

    // 3. Fallback to deterministic local directory index if 0 results
    if (!results || results.length === 0) {
      results = await this.fallbackProvider.search(cleanQuery, options);
    }

    // 4. Save to persistent cache if results found
    if (results.length > 0) {
      await SearchCache.set(cleanQuery, results, this.name);
    }

    return results;
  }
}

export const defaultSearchProvider = new HybridSearchProvider();
