import { createClient } from '@supabase/supabase-js';
import { loadSettings } from './settingsService';

export class SupabaseService {
  /**
   * Test Supabase connection & schema verification
   */
  static async testConnection(customUrl?: string, customKey?: string): Promise<{ success: boolean; latencyMs: number; error?: string; rowCount?: number }> {
    const settings = loadSettings();
    const url = customUrl || settings.supabaseUrl;
    const key = customKey || settings.supabaseServiceRoleKey;

    if (!url || !key) {
      return { success: false, latencyMs: 0, error: 'Supabase URL oder Service Role Key fehlt' };
    }

    const start = Date.now();
    try {
      const supabase = createClient(url, key, { auth: { persistSession: false } });
      const { count, error } = await supabase
        .from('mba_designs')
        .select('*', { count: 'exact', head: true });

      const latencyMs = Date.now() - start;
      if (error) {
        return { success: false, latencyMs, error: error.message };
      }

      return { success: true, latencyMs, rowCount: count || 0 };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message || 'Supabase timeout' };
    }
  }
}
