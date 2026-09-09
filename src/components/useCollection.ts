import { useCallback, useEffect, useRef, useState } from 'react';
import { watchCollections } from '@lib/storage/coordination';

/** One live collection snapshot; stale reads never replace a newer refresh. */
export function useCollection<T>(load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await load();
      if (current === sequence.current) { setItems(next); setError(''); }
    } catch (err) { if (current === sequence.current) setError(String(err)); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [load]);
  useEffect(() => {
    void refresh();
    const stop = watchCollections(() => void refresh());
    return () => { sequence.current++; stop(); };
  }, [refresh]);
  return { items, loading, error, refresh };
}
