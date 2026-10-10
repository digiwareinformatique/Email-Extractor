/**
 * Search Provider Types & Interfaces
 * STE DigiWare SUARL - Lead Extractor
 */

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string;
  rank: number;
  publishedDate?: string;
}

export interface SearchOptions {
  maxResults?: number;
  language?: 'fr' | 'ar' | 'en' | 'all';
  country?: string; // 'tn'
  skipCache?: boolean;
}

export interface ISearchProvider {
  name: string;
  search(query: string, options?: SearchOptions): Promise<SearchResultItem[]>;
}
