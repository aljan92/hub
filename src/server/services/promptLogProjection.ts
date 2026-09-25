import type { DesignTaskLog, SessionEvent } from '../../types/tasks';

function previewContent(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 160)}… [Rohdaten laden]` : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 5) return '[Weitere Daten auf Anforderung]';
  if (Array.isArray(value)) return value.slice(0, 40).map(item => previewContent(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(rawRequest|rawResponse|_rawResponse|raw_response|svgContent|systemPrompt|userMessage)$/i.test(key)) continue;
    result[key] = previewContent(child, depth + 1);
  }
  return result;
}

/** Select only the fields used by the Prompt Log; large artifacts stay in storage. */
export function projectPromptLogTask(task: DesignTaskLog): DesignTaskLog {
  const events = task.events.map(event => ({ ...event, content: previewContent(event.content) }));

  return {
    id: task.id, counter: task.counter, source: task.source, suffix: task.suffix,
    status: task.status, checkpoint: task.checkpoint, receivedAt: task.receivedAt,
    updatedAt: task.updatedAt, clientIp: task.clientIp, designId: task.designId,
    quote: task.quote, inQueue: task.inQueue, eventsCount: task.eventsCount,
    payload: {
      designId: task.payload?.designId, title: task.payload?.title,
      masterListing: task.payload?.masterListing, brand: task.payload?.brand,
      bullets: task.payload?.bullets, liveStats: task.payload?.liveStats,
      globalArtworkUrn: task.payload?.globalArtworkUrn,
      productTypes: task.payload?.productTypes, textData: task.payload?.textData,
      editUrl: task.payload?.editUrl, hasRejection: task.payload?.hasRejection
    },
    events, imageUrl: task.imageUrl, localImagePath: task.localImagePath,
    localMbaPngPath: task.localMbaPngPath, mbaPngUrl: task.mbaPngUrl,
    svgUrl: task.svgUrl, hasError: task.hasError, errorDetails: task.errorDetails
  };
}

export function getPromptLogRawEvent(task: DesignTaskLog, index: number, version: string): SessionEvent | 'STALE' | null {
  if (task.updatedAt !== version) return 'STALE';
  if (!Number.isSafeInteger(index) || index < 0) return null;
  return task.events[index] || null;
}
