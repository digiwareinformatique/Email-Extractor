/**
 * Search Results Persistent Cache
 * STE DigiWare SUARL - Lead Intelligence Architecture
 */
import crypto from 'crypto';
import { SearchResultItem } from '../search/types';
import { getDatabase, saveDatabaseToDisk } from '../database/leadDb';

export class SearchCache {
  private static hashQuery(query: string, provider: string): string {
    const normalized = `${provider.toLowerCase().trim()}:${query.toLowerCase().trim()}`;
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  public static async get(query: string, provider: string = 'gemini'): Promise<SearchResultItem[] | null> {
    try {
      const db = await getDatabase();
      const hash = this.hashQuery(query, provider);
      
      const stmt = db.prepare('SELECT results_json, hit_count FROM search_cache WHERE query_hash = ? LIMIT 1');
      stmt.bind([hash]);
      
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        
        // Increment hit count
        const newHits = ((row.hit_count as number) || 0) + 1;
        db.run('UPDATE search_cache SET hit_count = ?, last_hit_at = ? WHERE query_hash = ?', [
          newHits,
          new Date().toISOString(),
          hash
        ]);
        saveDatabaseToDisk();

        const results = JSON.parse(String(row.results_json || '[]')) as SearchResultItem[];
        return results;
      }
      stmt.free();
      return null;
    } catch (err) {
      console.warn('[SearchCache] Cache read error:', err);
      return null;
    }
  }

  public static async set(
    query: string, 
    results: SearchResultItem[], 
    provider: string = 'gemini'
  ): Promise<void> {
    try {
      const db = await getDatabase();
      const hash = this.hashQuery(query, provider);
      const now = new Date().toISOString();

      db.run(`
        INSERT INTO search_cache (query_hash, query_text, provider_name, results_json, results_count, created_at, last_hit_at, hit_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(query_hash) DO UPDATE SET
          results_json = excluded.results_json,
          results_count = excluded.results_count,
          last_hit_at = excluded.last_hit_at,
          hit_count = search_cache.hit_count + 1
      `, [
        hash,
        query.trim(),
        provider,
        JSON.stringify(results),
        results.length,
        now,
        now
      ]);

      saveDatabaseToDisk();
    } catch (err) {
      console.warn('[SearchCache] Cache write error:', err);
    }
  }

  public static async clear(): Promise<void> {
    try {
      const db = await getDatabase();
      db.run('DELETE FROM search_cache');
      saveDatabaseToDisk();
    } catch (err) {
      console.warn('[SearchCache] Cache clear error:', err);
    }
  }
}
