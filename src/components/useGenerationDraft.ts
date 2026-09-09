import { useEffect, useRef, useState } from 'react';
import { loadGenerationDraft, saveGenerationDraft, type DraftKey } from '@lib/generation/draftStore';

export type GenerationDraft = { promptType: 'resume' | 'coverLetter' | 'answer'; question: string; pasted: string };
const blank = (): GenerationDraft => ({ promptType: 'resume', question: '', pasted: '' });
type Slot = { key: DraftKey; value: GenerationDraft; revision: number; loaded: boolean; pending: number; error: string; queue: Promise<void> };

/** Draft persistence is scoped to application + profile, including queued writes. */
export function useGenerationDraft(applicationUrl: string, profileId: string | null) {
  const id = applicationUrl && profileId ? JSON.stringify([applicationUrl, profileId]) : '';
  const active = useRef(id); active.current = id;
  const mounted = useRef(true);
  const slots = useRef(new Map<string, Slot>());
  const [view, setView] = useState({ id: '', value: blank(), loading: true, saving: false, error: '' });
  const [reloadIndex, setReloadIndex] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const publish = (key: string, slot: Slot) => {
    if (mounted.current && active.current === key) setView({ id: key, value: slot.value, loading: !slot.loaded, saving: slot.pending > 0, error: slot.error });
  };
  useEffect(() => {
    if (!id || !profileId) return;
    let slot = slots.current.get(id);
    if (slot) { publish(id, slot); return; }
    slot = { key: { applicationUrl, profileId }, value: blank(), revision: 0, loaded: false, pending: 0, error: '', queue: Promise.resolve() };
    slots.current.set(id, slot);
    const current = slot;
    publish(id, current);
    void loadGenerationDraft(current.key).then((stored) => {
      if (stored) { current.value = { promptType: stored.promptType, question: stored.question, pasted: stored.pasted }; current.revision = stored.revision; }
      current.loaded = true;
      publish(id, current);
    }).catch((err) => { current.error = `Draft could not be loaded. ${String(err)}`; publish(id, current); });
  }, [id, applicationUrl, profileId, reloadIndex]);
  const change = (patch: Partial<GenerationDraft>) => {
    const slot = slots.current.get(id);
    if (!slot?.loaded) return;
    slot.value = { ...slot.value, ...patch };
    const next = slot.value;
    slot.pending++;
    publish(id, slot);
    slot.queue = slot.queue.then(async () => {
      if (slot.error) return;
      const saved = await saveGenerationDraft(slot.key, next, slot.revision);
      slot.revision = saved.revision;
    }).catch((err) => { slot.error = `Draft was not saved. Keep a copy of your text before reloading. ${String(err)}`; })
      .finally(() => { slot.pending--; publish(id, slot); });
  };
  const reload = async () => {
    const slot = slots.current.get(id);
    await slot?.queue;
    slots.current.delete(id);
    setReloadIndex((value) => value + 1);
  };
  return { ...(view.id === id ? view : { id, value: blank(), loading: true, saving: false, error: '' }), change, reload };
}
