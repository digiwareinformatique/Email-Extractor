import { ContactRecord, ExtractionStats, FileAnalysis, WhatsAppContactRecord, WhatsAppExtractionStats, WhatsAppFileAnalysis } from './types';

export interface SavedSession {
  id: string;
  name: string;
  timestamp: number;
  uploadedFiles: { name: string; size: number; content: string; status: 'success' | 'error' }[];
  rawPasteText: string;
  contacts: ContactRecord[];
  stats: ExtractionStats | null;
  fileAnalysis: FileAnalysis | null;
}

export interface SavedWhatsAppSession {
  id: string;
  name: string;
  timestamp: number;
  uploadedFiles: { name: string; size: number; content: string; status: 'success' | 'error' }[];
  rawPasteText: string;
  contacts: WhatsAppContactRecord[];
  stats: WhatsAppExtractionStats | null;
  fileAnalysis: WhatsAppFileAnalysis | null;
}

const LOCAL_STORAGE_KEY_CURRENT = 'email_extractor_current_session';
const LOCAL_STORAGE_KEY_SAVED_SESSIONS = 'email_extractor_saved_sessions';

const LOCAL_STORAGE_KEY_WA_CURRENT = 'whatsapp_extractor_current_session';
const LOCAL_STORAGE_KEY_WA_SAVED_SESSIONS = 'whatsapp_extractor_saved_sessions';

/**
 * Auto-saves the active state to browser localStorage
 */
export function saveCurrentSession(session: {
  uploadedFiles: { name: string; size: number; content: string; status: 'success' | 'error' }[];
  rawPasteText: string;
  contacts: ContactRecord[];
  stats: ExtractionStats | null;
  fileAnalysis: FileAnalysis | null;
}) {
  try {
    const data = JSON.stringify({
      ...session,
      timestamp: Date.now()
    });
    localStorage.setItem(LOCAL_STORAGE_KEY_CURRENT, data);
  } catch (err) {
    console.warn('Unable to auto-save current session:', err);
  }
}

/**
 * Restores the active state from browser localStorage
 */
export function loadCurrentSession(): {
  uploadedFiles: { name: string; size: number; content: string; status: 'success' | 'error' }[];
  rawPasteText: string;
  contacts: ContactRecord[];
  stats: ExtractionStats | null;
  fileAnalysis: FileAnalysis | null;
  timestamp?: number;
} | null {
  try {
    const data = localStorage.getItem(LOCAL_STORAGE_KEY_CURRENT);
    if (!data) return null;
    return JSON.parse(data);
  } catch (err) {
    console.warn('Unable to load current session:', err);
    return null;
  }
}

/**
 * Clears current auto-saved session
 */
export function clearCurrentSession() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY_CURRENT);
  } catch (err) {
    console.warn('Unable to clear current session:', err);
  }
}

/**
 * Fetches all saved memories / project snapshots
 */
export function getSavedSessions(): SavedSession[] {
  try {
    const data = localStorage.getItem(LOCAL_STORAGE_KEY_SAVED_SESSIONS);
    if (!data) return [];
    return JSON.parse(data);
  } catch (err) {
    console.warn('Unable to load saved sessions:', err);
    return [];
  }
}

/**
 * Persists a new named memory snapshot into saved sessions list
 */
export function saveSessionToMemory(
  name: string,
  session: {
    uploadedFiles: { name: string; size: number; content: string; status: 'success' | 'error' }[];
    rawPasteText: string;
    contacts: ContactRecord[];
    stats: ExtractionStats | null;
    fileAnalysis: FileAnalysis | null;
  }
): SavedSession[] {
  try {
    const currentList = getSavedSessions();
    const recordCount = session.contacts.length;
    const filesCount = session.uploadedFiles.length;
    
    let defaultLabel = `Travail du ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    if (recordCount > 0) {
      defaultLabel += ` (${recordCount} contacts)`;
    } else if (filesCount > 0) {
      defaultLabel += ` (${filesCount} fichiers)`;
    }

    const newSession: SavedSession = {
      id: 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: name.trim() || defaultLabel,
      timestamp: Date.now(),
      ...session
    };
    
    // Store at beginning of list (max 20 sessions to preserve browser space)
    const updatedList = [newSession, ...currentList.filter(s => s.id !== newSession.id)].slice(0, 20);
    localStorage.setItem(LOCAL_STORAGE_KEY_SAVED_SESSIONS, JSON.stringify(updatedList));
    return updatedList;
  } catch (err) {
    console.warn('Unable to save session memory:', err);
    return getSavedSessions();
  }
}

/**
 * Removes a saved session by ID
 */
export function deleteSavedSession(id: string): SavedSession[] {
  try {
    const currentList = getSavedSessions();
    const updatedList = currentList.filter(s => s.id !== id);
    localStorage.setItem(LOCAL_STORAGE_KEY_SAVED_SESSIONS, JSON.stringify(updatedList));
    return updatedList;
  } catch (err) {
    console.warn('Unable to delete saved session:', err);
    return getSavedSessions();
  }
}

// ==========================================
// WHATSAPP MEMORY PERSISTENCE HELPERS
// ==========================================

export function saveCurrentWhatsAppSession(session: {
  uploadedFiles: { name: string; size: number; content: string; status: 'success' | 'error' }[];
  rawPasteText: string;
  contacts: WhatsAppContactRecord[];
  stats: WhatsAppExtractionStats | null;
  fileAnalysis: WhatsAppFileAnalysis | null;
}) {
  try {
    const data = JSON.stringify({
      ...session,
      timestamp: Date.now()
    });
    localStorage.setItem(LOCAL_STORAGE_KEY_WA_CURRENT, data);
  } catch (err) {
    console.warn('Unable to auto-save current WhatsApp session:', err);
  }
}

export function loadCurrentWhatsAppSession(): {
  uploadedFiles: { name: string; size: number; content: string; status: 'success' | 'error' }[];
  rawPasteText: string;
  contacts: WhatsAppContactRecord[];
  stats: WhatsAppExtractionStats | null;
  fileAnalysis: WhatsAppFileAnalysis | null;
  timestamp?: number;
} | null {
  try {
    const data = localStorage.getItem(LOCAL_STORAGE_KEY_WA_CURRENT);
    if (!data) return null;
    return JSON.parse(data);
  } catch (err) {
    console.warn('Unable to load current WhatsApp session:', err);
    return null;
  }
}

export function clearCurrentWhatsAppSession() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY_WA_CURRENT);
  } catch (err) {
    console.warn('Unable to clear current WhatsApp session:', err);
  }
}

export function getSavedWhatsAppSessions(): SavedWhatsAppSession[] {
  try {
    const data = localStorage.getItem(LOCAL_STORAGE_KEY_WA_SAVED_SESSIONS);
    if (!data) return [];
    return JSON.parse(data);
  } catch (err) {
    console.warn('Unable to load saved WhatsApp sessions:', err);
    return [];
  }
}

export function saveWhatsAppSessionToMemory(
  name: string,
  session: {
    uploadedFiles: { name: string; size: number; content: string; status: 'success' | 'error' }[];
    rawPasteText: string;
    contacts: WhatsAppContactRecord[];
    stats: WhatsAppExtractionStats | null;
    fileAnalysis: WhatsAppFileAnalysis | null;
  }
): SavedWhatsAppSession[] {
  try {
    const currentList = getSavedWhatsAppSessions();
    const recordCount = session.contacts.length;
    const filesCount = session.uploadedFiles.length;
    
    let defaultLabel = `Session WhatsApp du ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    if (recordCount > 0) {
      defaultLabel += ` (${recordCount} numéros)`;
    } else if (filesCount > 0) {
      defaultLabel += ` (${filesCount} fichiers)`;
    }

    const newSession: SavedWhatsAppSession = {
      id: 'wa_session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: name.trim() || defaultLabel,
      timestamp: Date.now(),
      ...session
    };
    
    const updatedList = [newSession, ...currentList.filter(s => s.id !== newSession.id)].slice(0, 20);
    localStorage.setItem(LOCAL_STORAGE_KEY_WA_SAVED_SESSIONS, JSON.stringify(updatedList));
    return updatedList;
  } catch (err) {
    console.warn('Unable to save WhatsApp session memory:', err);
    return getSavedWhatsAppSessions();
  }
}

export function deleteSavedWhatsAppSession(id: string): SavedWhatsAppSession[] {
  try {
    const currentList = getSavedWhatsAppSessions();
    const updatedList = currentList.filter(s => s.id !== id);
    localStorage.setItem(LOCAL_STORAGE_KEY_WA_SAVED_SESSIONS, JSON.stringify(updatedList));
    return updatedList;
  } catch (err) {
    console.warn('Unable to delete saved WhatsApp session:', err);
    return getSavedWhatsAppSessions();
  }
}
