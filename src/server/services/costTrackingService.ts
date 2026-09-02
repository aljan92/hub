import fs from 'fs';
import path from 'path';
import { loadSettings, saveSettings } from './settingsService';
import { QueueService } from './queueService';
import { TaskRepository } from '../storage/taskRepository';

export interface CostStatsBreakdown {
  openRouterUsageTotal: number;
  openRouterCost: number;
  imageGenerationsCount: number;
  costPerImage: number;
  imagesCost: number;
  vectorizationsCount: number;
  costPerVectorization: number;
  vectorizationsCost: number;
  totalCosts: number;
  waitingDesignsCount: number;
  completedDesignsCount: number;
  activeDesignsCount: number;
  costPerDesign: number;
  lastResetAt?: string;
}

export class CostTrackingService {
  private static cachedOpenRouterTotal: number = 0;
  private static lastOpenRouterFetch: number = 0;

  /**
   * Fetch current total account usage from OpenRouter API key
   */
  public static async fetchOpenRouterUsage(): Promise<number> {
    const settings = loadSettings();
    const apiKey = (settings.openRouterApiKey || '').trim();
    if (!apiKey) return 0;

    const now = Date.now();
    if (now - this.lastOpenRouterFetch < 15000 && this.cachedOpenRouterTotal > 0) {
      return this.cachedOpenRouterTotal;
    }

    try {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://mba-hub.local',
          'X-Title': 'MBA HUB'
        },
        signal: AbortSignal.timeout(5000)
      });

      if (res.ok) {
        const data = await res.json();
        const usage = Number(data?.data?.usage) || 0;
        this.cachedOpenRouterTotal = usage;
        this.lastOpenRouterFetch = now;
        return usage;
      }
    } catch (err: any) {
      // Silently use cached or fallback
    }

    return this.cachedOpenRouterTotal;
  }

  /**
   * Calculate full costs breakdown
   */
  public static async getCostStats(): Promise<CostStatsBreakdown> {
    const settings = loadSettings();
    const costPerImage = settings.costPerImage !== undefined ? Number(settings.costPerImage) : 0.08;
    const costPerVectorization = settings.costPerVectorization !== undefined ? Number(settings.costPerVectorization) : 0.05;
    const resetTimestamp = settings.costStatsResetTimestamp ? new Date(settings.costStatsResetTimestamp).getTime() : 0;
    const baselineUsage = settings.costStatsBaselineOpenRouterUsage || 0;

    // 1. OpenRouter Costs
    const currentTotalUsage = await this.fetchOpenRouterUsage();
    let openRouterCost = Math.max(0, currentTotalUsage - baselineUsage);

    // 2. Count image generations & vectorizations directly from TaskRepository SQLite metrics
    const metrics = TaskRepository.getTaskUsageMetrics(resetTimestamp);
    const imageGenerationsCount = metrics.imageGenerationsCount;
    const vectorizationsCount = metrics.vectorizationsCount;
    let taskEventOpenRouterCost = metrics.taskEventOpenRouterCost;

    // If OpenRouter live key is unavailable, use accumulated token cost from task events
    if (openRouterCost === 0 && taskEventOpenRouterCost > 0) {
      openRouterCost = taskEventOpenRouterCost;
    }

    const imagesCost = Number((imageGenerationsCount * costPerImage).toFixed(4));
    const vectorizationsCost = Number((vectorizationsCount * costPerVectorization).toFixed(4));
    const totalCosts = Number((openRouterCost + imagesCost + vectorizationsCost).toFixed(2));

    // 3. Count designs in Warteschlange (WAITING + UPLOADING) and Hochgeladen (COMPLETED)
    const queueState = QueueService.getState();
    const items = queueState.items || [];
    const waitingDesignsCount = items.filter(i => i.status === 'WAITING' || i.status === 'UPLOADING').length;
    const completedDesignsCount = items.filter(i => i.status === 'COMPLETED').length;
    const activeDesignsCount = waitingDesignsCount + completedDesignsCount;

    const costPerDesign = activeDesignsCount > 0 
      ? Number((totalCosts / activeDesignsCount).toFixed(2)) 
      : 0;

    return {
      openRouterUsageTotal: currentTotalUsage,
      openRouterCost: Number(openRouterCost.toFixed(2)),
      imageGenerationsCount,
      costPerImage,
      imagesCost,
      vectorizationsCount,
      costPerVectorization,
      vectorizationsCost,
      totalCosts,
      waitingDesignsCount,
      completedDesignsCount,
      activeDesignsCount,
      costPerDesign,
      lastResetAt: settings.costStatsResetTimestamp
    };
  }

  /**
   * Reset cost statistics baseline
   */
  public static async resetCostStats(): Promise<CostStatsBreakdown> {
    const currentUsage = await this.fetchOpenRouterUsage();
    const currentSettings = loadSettings();
    
    saveSettings({
      ...currentSettings,
      costStatsResetTimestamp: new Date().toISOString(),
      costStatsBaselineOpenRouterUsage: currentUsage
    });

    return this.getCostStats();
  }
}
