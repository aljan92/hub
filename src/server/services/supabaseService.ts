import { createClient } from '@supabase/supabase-js';
import { loadSettings } from './settingsService';

export class SupabaseService {
  /**
   * Test Supabase connection: verifies both READ and WRITE (INSERT/DELETE) permissions on mba_designs
   */
  static async testConnection(customUrl?: string, customKey?: string): Promise<{ 
    success: boolean; 
    latencyMs: number; 
    error?: string; 
    rowCount?: number;
    canRead: boolean;
    canWrite: boolean;
    details?: string;
  }> {
    const settings = loadSettings();
    const url = customUrl || settings.supabaseUrl;
    const key = customKey || settings.supabaseServiceRoleKey;

    if (!url || !key) {
      return { 
        success: false, 
        latencyMs: 0, 
        error: 'Supabase URL oder Service Role Key fehlt',
        canRead: false,
        canWrite: false
      };
    }

    const start = Date.now();
    try {
      const supabase = createClient(url.trim(), key.trim(), { auth: { persistSession: false } });
      
      // 1. Test READ permission & Table existence
      const { count, error: readError } = await supabase
        .from('mba_designs')
        .select('*', { count: 'exact', head: true });

      if (readError) {
        return { 
          success: false, 
          latencyMs: Date.now() - start, 
          error: `Lesefehler: ${readError.message}`,
          canRead: false,
          canWrite: false
        };
      }

      // 2. Test WRITE permission (Upsert & immediate Delete of a ping verification row)
      const pingId = `__health_test_ping_${Date.now()}__`;
      const { error: writeError } = await supabase
        .from('mba_designs')
        .upsert({
          design_id: pingId,
          title_us: 'MBA Hub Health Ping Test',
          status: 'HEALTH_CHECK'
        });

      if (writeError) {
        return {
          success: false,
          latencyMs: Date.now() - start,
          error: `Lesen OK (${count || 0} Zeilen), aber Schreiben verweigert (RLS/Key Fehler): ${writeError.message}`,
          canRead: true,
          canWrite: false
        };
      }

      // Cleanup test row
      await supabase.from('mba_designs').delete().eq('design_id', pingId);

      const latencyMs = Date.now() - start;
      return { 
        success: true, 
        latencyMs, 
        rowCount: count || 0,
        canRead: true,
        canWrite: true,
        details: `Vollzugriff (Lesen & Schreiben): ${count || 0} Designs in mba_designs`
      };
    } catch (err: any) {
      return { 
        success: false, 
        latencyMs: Date.now() - start, 
        error: err.message || 'Supabase Timeout',
        canRead: false,
        canWrite: false
      };
    }
  }
}
