import { useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from '#imports';
import { useBackgroundPort } from '@hooks/useBackgroundPort';
import { FillTab } from '@components/FillTab';
import { GenerateTab } from '@components/GenerateTab';
import { TrackerTab } from '@components/TrackerTab';
import { AnswersTab } from '@components/AnswersTab';
import { SettingsTab } from '@components/SettingsTab';
import { useProfile } from '@hooks/useStores';
import { getDocumentMeta } from '@lib/storage/documents';
import { watchCollections } from '@lib/storage/coordination';

const TABS = ['Fill', 'Generate', 'Tracker', 'Answers', 'Settings'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>('Fill');
  const { state, actions } = useBackgroundPort();
  const { snapshot, profile } = useProfile();
  const [resumeName, setResumeName] = useState('No resume selected');
  const buttons = useRef(new Map<Tab, HTMLButtonElement>());
  useEffect(() => {
    let current = true;
    const refresh = async () => {
      const id = profile?.documents.defaultResumeId;
      if (!id) { setResumeName('No resume selected'); return; }
      try {
        const doc = await getDocumentMeta(id);
        if (current) setResumeName(doc?.name ?? 'Selected resume is missing');
      } catch { if (current) setResumeName('Resume unavailable'); }
    };
    void refresh();
    const stop = watchCollections(() => void refresh());
    return () => { current = false; stop(); };
  }, [profile?.documents.defaultResumeId]);

  // Right-click "fix this field's mapping" lands on the Fill tab's row.
  useEffect(() => {
    if (state.focusField) setTab('Fill');
  }, [state.focusField]);

  // Every tab stays mounted; only the active one is shown. Unmounting threw
  // away the Fill tab's reviewed plan (and re-ran the resolver, model call
  // included) and the Generate tab's pasted draft every time the user glanced
  // at another tab.
  const panels: Record<Tab, ReactNode> = {
    Fill: <FillTab state={state} actions={actions} />,
    Generate: <GenerateTab state={state} actions={actions} />,
    Tracker: <TrackerTab active={tab === 'Tracker'} />,
    Answers: <AnswersTab active={tab === 'Answers'} />,
    Settings: <SettingsTab />,
  };

  return (
    <div className="app">
      <header className="context-panel">
        <div className="context-heading"><span className="brand">JobPilot</span><button onClick={() => void browser.runtime.openOptionsPage()}>Edit profile</button></div>
        <h1>{state.jd?.title || 'Your application workbench'}</h1>
        <p className="context-url" title={state.tabUrl}>{state.tabUrl || 'Open an application to get started'}</p>
        <dl className="application-context"><div><dt>Profile</dt><dd>{snapshot?.name || 'Loading…'}</dd></div><div><dt>Resume</dt><dd title={resumeName}>{resumeName}</dd></div></dl>
      </header>
      <nav className="tabs" role="tablist" aria-label="Application tools">
        {TABS.map((name) => (
          <button key={name} ref={(node) => { if (node) buttons.current.set(name, node); }} id={`tab-${name}`} role="tab" aria-selected={tab === name} aria-controls={`panel-${name}`} tabIndex={tab === name ? 0 : -1} className={tab === name ? 'tab active' : 'tab'} onClick={() => setTab(name)} onKeyDown={(event) => {
            const index = TABS.indexOf(name);
            const next = event.key === 'ArrowRight' ? TABS[(index + 1) % TABS.length] : event.key === 'ArrowLeft' ? TABS[(index + TABS.length - 1) % TABS.length] : event.key === 'Home' ? TABS[0] : event.key === 'End' ? TABS[TABS.length - 1] : null;
            if (next) { event.preventDefault(); setTab(next); buttons.current.get(next)?.focus(); }
          }}>
            {name}
          </button>
        ))}
      </nav>
      <main className="content">
        {TABS.map((name) => (
          <div key={name} id={`panel-${name}`} role="tabpanel" aria-labelledby={`tab-${name}`} hidden={tab !== name}>
            {panels[name]}
          </div>
        ))}
      </main>
    </div>
  );
}
