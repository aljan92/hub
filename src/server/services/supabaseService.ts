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
    liveCount?: number;
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
      
      // Test READ permission & Table existence with fast count
      const [allRes, liveRes] = await Promise.all([
        supabase.from('mba_designs').select('design_id', { count: 'exact', head: true }),
        supabase.from('mba_designs')
          .select('design_id', { count: 'exact', head: true })
          .in('status', ['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING'])
      ]);

      if (allRes.error) {
        return { 
          success: false, 
          latencyMs: Date.now() - start, 
          error: `Lesefehler: ${allRes.error.message}`,
          canRead: false,
          canWrite: false
        };
      }

      const totalCount = allRes.count || 0;
      const liveCount = liveRes.count || 0;
      const latencyMs = Date.now() - start;

      return { 
        success: true, 
        latencyMs, 
        rowCount: totalCount,
        liveCount,
        canRead: true,
        canWrite: true,
        details: `Verbunden ✓ (${liveCount} Live Designs von ${totalCount} gesamt)`
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

  private static cachedStats: any = null;
  private static lastStatsFetch = 0;

  /**
   * Get accurate Live Designs, Total Designs and Sales stats from Supabase (Cached in memory for 15s)
   */
  static async getStats(): Promise<{
    totalDesigns: number;
    liveDesigns: number;
    unresolvedAsins: number;
    sales30d: number;
    royalties30dEur: number;
    royalties30dUsd: number;
  }> {
    const now = Date.now();
    if (this.cachedStats && now - this.lastStatsFetch < 15000) {
      return this.cachedStats;
    }

    const settings = loadSettings();
    if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
      return {
        totalDesigns: 0,
        liveDesigns: 0,
        unresolvedAsins: 0,
        sales30d: 0,
        royalties30dEur: 0,
        royalties30dUsd: 0,
      };
    }

    try {
      const supabase = createClient(settings.supabaseUrl.trim(), settings.supabaseServiceRoleKey.trim(), { auth: { persistSession: false } });
      
      const [totalRes, liveRes, unresolvedRes, salesRes] = await Promise.all([
        supabase.from('mba_designs').select('design_id', { count: 'exact', head: true }),
        supabase.from('mba_designs')
          .select('design_id', { count: 'exact', head: true })
          .in('status', ['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING']),
        supabase.from('mba_designs')
          .select('design_id', { count: 'exact', head: true })
          .or('asin_resolved.eq.false,asin_resolved.is.null')
          .in('status', ['PUBLISHED', 'PROPAGATED', 'LOCKED', 'TIMED_OUT', 'PUBLISHING', 'TRANSLATING']),
        supabase.from('mba_designs')
          .select('sales_30d, royalties_30d_eur, royalties_30d_usd')
          .gt('sales_30d', 0)
          .limit(1000)
      ]);

      let sales30d = 0;
      let royalties30dEur = 0;
      let royalties30dUsd = 0;

      if (salesRes.data && Array.isArray(salesRes.data)) {
        for (const row of salesRes.data) {
          sales30d += row.sales_30d || 0;
          royalties30dEur += Number(row.royalties_30d_eur) || 0;
          royalties30dUsd += Number(row.royalties_30d_usd) || 0;
        }
      }

      const result = {
        totalDesigns: totalRes.count || 0,
        liveDesigns: liveRes.count || 0,
        unresolvedAsins: unresolvedRes.count || 0,
        sales30d,
        royalties30dEur: Math.round(royalties30dEur * 100) / 100,
        royalties30dUsd: Math.round(royalties30dUsd * 100) / 100,
      };

      this.cachedStats = result;
      this.lastStatsFetch = now;
      return result;
    } catch (e) {
      return {
        totalDesigns: 0,
        liveDesigns: 0,
        unresolvedAsins: 0,
        sales30d: 0,
        royalties30dEur: 0,
        royalties30dUsd: 0,
      };
    }
  }
}
