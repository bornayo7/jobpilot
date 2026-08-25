import { useState } from 'react';
import { useBackgroundPort } from '@hooks/useBackgroundPort';
import { FillTab } from '@components/FillTab';
import { GenerateTab } from '@components/GenerateTab';
import { SettingsTab } from '@components/SettingsTab';
import { PlaceholderTab } from '@components/PlaceholderTab';

const TABS = ['Fill', 'Generate', 'Tracker', 'Answers', 'Settings'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>('Fill');
  const { state, actions } = useBackgroundPort();

  return (
    <div className="app">
      <nav className="tabs">
        {TABS.map((name) => (
          <button
            key={name}
            className={tab === name ? 'tab active' : 'tab'}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      <main className="content">
        {tab === 'Fill' && <FillTab state={state} actions={actions} />}
        {tab === 'Generate' && <GenerateTab state={state} actions={actions} />}
        {tab === 'Tracker' && (
          <PlaceholderTab
            title="Job Tracker"
            body="Auto-captured applications with status board, notes, and follow-ups. Lands in milestone M3."
          />
        )}
        {tab === 'Answers' && (
          <PlaceholderTab
            title="Answers Bank"
            body="Every custom question you answer, reusable with fuzzy matching — scoped per job so answers never bleed across companies. Lands in milestone M3."
          />
        )}
        {tab === 'Settings' && <SettingsTab />}
      </main>
    </div>
  );
}
