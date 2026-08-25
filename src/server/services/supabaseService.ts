import fs from 'fs';
import path from 'path';
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
   * Get accurate Live Designs, Total Designs and Sales stats from Supabase (Cached & Persisted)
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

    const statsFile = path.resolve(process.cwd(), 'data', 'supabase_stats.json');
    const loadPersisted = () => {
      try {
        if (fs.existsSync(statsFile)) {
          return JSON.parse(fs.readFileSync(statsFile, 'utf-8'));
        }
      } catch (e) {}
      return { totalDesigns: 0, liveDesigns: 0, unresolvedAsins: 0, sales30d: 0, royalties30dEur: 0, royalties30dUsd: 0 };
    };

    const persisted = loadPersisted();

    const settings = loadSettings();
    if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
      return persisted;
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

      const totalCount = (totalRes.count !== undefined && totalRes.count !== null) ? totalRes.count : persisted.totalDesigns;
      const liveCount = (liveRes.count !== undefined && liveRes.count !== null) ? liveRes.count : persisted.liveDesigns;
      const unresolvedCount = (unresolvedRes.count !== undefined && unresolvedRes.count !== null) ? unresolvedRes.count : persisted.unresolvedAsins;

      const result = {
        totalDesigns: totalCount,
        liveDesigns: liveCount,
        unresolvedAsins: unresolvedCount,
        sales30d: sales30d || persisted.sales30d || 0,
        royalties30dEur: royalties30dEur ? Math.round(royalties30dEur * 100) / 100 : (persisted.royalties30dEur || 0),
        royalties30dUsd: royalties30dUsd ? Math.round(royalties30dUsd * 100) / 100 : (persisted.royalties30dUsd || 0),
      };

      if (result.totalDesigns > 0 || result.liveDesigns > 0) {
        try {
          const dataDir = path.resolve(process.cwd(), 'data');
          if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
          fs.writeFileSync(statsFile, JSON.stringify(result, null, 2), 'utf-8');
        } catch (e) {}
      }

      this.cachedStats = result;
      this.lastStatsFetch = now;
      return result;
    } catch (e) {
      return persisted;
    }
  }
}
