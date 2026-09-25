import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';

interface MetricSeries {
  count: number;
  failures: number;
  durationsMs: number[];
  responseBytes: number[];
}

const MAX_SAMPLES = 100;
const series = new Map<string, MetricSeries>();
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

function percentile(values: number[], percent: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(percent * sorted.length) - 1] * 100) / 100;
}

export function recordOperation(name: string, durationMs: number, responseBytes = 0, failed = false): void {
  let metric = series.get(name);
  if (!metric) {
    metric = { count: 0, failures: 0, durationsMs: [], responseBytes: [] };
    series.set(name, metric);
  }
  metric.count += 1;
  if (failed) metric.failures += 1;
  metric.durationsMs.push(durationMs);
  metric.responseBytes.push(responseBytes);
  if (metric.durationsMs.length > MAX_SAMPLES) metric.durationsMs.shift();
  if (metric.responseBytes.length > MAX_SAMPLES) metric.responseBytes.shift();
}

export function measureOperation<T>(name: string, work: () => T): T {
  const started = performance.now();
  try {
    const result = work();
    recordOperation(name, performance.now() - started);
    return result;
  } catch (error) {
    recordOperation(name, performance.now() - started, 0, true);
    throw error;
  }
}

export function recordHttpRequest(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith('/api/')) return next();
  const requestId = randomUUID();
  const started = performance.now();
  res.setHeader('X-Request-Id', requestId);
  res.once('finish', () => {
    const routePath = req.route?.path;
    const route = typeof routePath === 'string' ? routePath : '<unmatched>';
    const name = `http ${req.method} ${route}`;
    const durationMs = performance.now() - started;
    const responseBytes = Number(res.getHeader('Content-Length')) || 0;
    recordOperation(name, durationMs, responseBytes, res.statusCode >= 500);
    if (durationMs >= 1000) {
      console.warn(`[HTTP Slow] ${requestId} ${name} ${res.statusCode} ${Math.round(durationMs)}ms ${responseBytes}B`);
    }
  });
  next();
}

export function getOperationalMetrics() {
  return {
    windowSamples: MAX_SAMPLES,
    eventLoopDelayMs: {
      p95: Math.round(eventLoop.percentile(95) / 1e6 * 100) / 100,
      max: Math.round(eventLoop.max / 1e6 * 100) / 100
    },
    operations: [...series.entries()].map(([name, metric]) => ({
      name,
      count: metric.count,
      failures: metric.failures,
      durationMs: { p50: percentile(metric.durationsMs, 0.5), p95: percentile(metric.durationsMs, 0.95) },
      responseBytes: { p95: percentile(metric.responseBytes, 0.95) }
    }))
  };
}
