import { useEffect, useState } from 'react';
import type { Snapshot } from '../../shared/types';

/** Live circle state for one phone, pushed by the server whenever anything changes. */
export function useSnapshot(viewer: string): { snap: Snapshot | null; connected: boolean } {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      source = new EventSource(`/api/stream?viewer=${encodeURIComponent(viewer)}`);
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
  }, [viewer]);
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

/** Posts and hands any error back to the caller, for places that show it themselves. */
export async function tryPost<T = any>(path: string, body?: unknown): Promise<{ data: T } | { error: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? `Request failed (${res.status})` };
    return { data: data as T };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Posts and shows any error in the app's toast. */
export async function post<T = any>(path: string, body?: unknown): Promise<T | null> {
  const res = await tryPost<T>(path, body);
  if ('error' in res) {
    errorListeners.forEach((fn) => fn(res.error));
    return null;
  }
  return res.data;
}

export async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}
