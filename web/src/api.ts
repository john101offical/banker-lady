import { useEffect, useState } from 'react';
import type { Snapshot } from '../../shared/types';

/** Live circle state, pushed by the server whenever anything changes. */
export function useSnapshot(): { snap: Snapshot | null; connected: boolean } {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      source = new EventSource('/api/stream');
      source.onopen = () => setConnected(true);
      source.onmessage = (e) => {
        try {
          setSnap(JSON.parse(e.data));
        } catch {
          /* ignore a malformed frame; the next one replaces it */
        }
      };
      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (!closed) retry = setTimeout(open, 1500);
      };
    };
    open();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, []);
  return { snap, connected };
}

type Listener = (text: string) => void;
const errorListeners = new Set<Listener>();
export function onApiError(fn: Listener) {
  errorListeners.add(fn);
  return () => {
    errorListeners.delete(fn);
  };
}

export async function post<T = any>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data as T;
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    errorListeners.forEach((fn) => fn(text));
    return null;
  }
}
