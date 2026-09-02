import { useEffect, useRef, useState, useCallback } from 'react';
import { TaskSummary } from '../../types/tasks';

export interface TaskWebSocketHandlers {
  onTaskUpdated?: (task: TaskSummary) => void;
  onTaskCreated?: (task: TaskSummary) => void;
  onTasksCleared?: () => void;
  onReconnect?: () => void;
}

export function useTaskWebSocket(handlers: TaskWebSocketHandlers) {
  const [isConnected, setIsConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const wasConnectedRef = useRef(false);

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        if (wasConnectedRef.current) {
          // Trigger onReconnect callback to refresh the latest 20 items after reconnecting
          handlersRef.current.onReconnect?.();
        }
        wasConnectedRef.current = true;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (!data || !data.type) return;

          switch (data.type) {
            case 'TASK_UPDATED':
              if (data.payload) {
                handlersRef.current.onTaskUpdated?.(data.payload as TaskSummary);
              }
              break;
            case 'TASK_LOG_CREATED':
              if (data.payload) {
                handlersRef.current.onTaskCreated?.(data.payload as TaskSummary);
              }
              break;
            case 'TASK_LOGS_CLEARED':
              handlersRef.current.onTasksCleared?.();
              break;
            default:
              break;
          }
        } catch (err) {
          console.warn('[useTaskWebSocket] Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        // Schedule auto-reconnect in 3 seconds
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (err) => {
        setIsConnected(false);
        ws.close();
      };
    } catch (err) {
      console.warn('[useTaskWebSocket] Error establishing connection:', err);
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(connect, 4000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { isConnected };
}
