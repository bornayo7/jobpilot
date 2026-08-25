import { useState } from 'react';
import { useBackgroundPort } from '@hooks/useBackgroundPort';
import { FillTab } from '@components/FillTab';
import { GenerateTab } from '@components/GenerateTab';
import { TrackerTab } from '@components/TrackerTab';
import { AnswersTab } from '@components/AnswersTab';
import { SettingsTab } from '@components/SettingsTab';

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
        {tab === 'Tracker' && <TrackerTab />}
        {tab === 'Answers' && <AnswersTab />}
        {tab === 'Settings' && <SettingsTab />}
      </main>
    </div>
  );
}
