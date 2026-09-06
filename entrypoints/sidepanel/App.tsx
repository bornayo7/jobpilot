import { useEffect, useState } from 'react';
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

  // Right-click "fix this field's mapping" lands on the Fill tab's row.
  useEffect(() => {
    if (state.focusField) setTab('Fill');
  }, [state.focusField]);

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
      {/* Every tab stays mounted; only the active one is shown. Unmounting
          threw away the Fill tab's reviewed plan (and re-ran the resolver,
          model call included) and the Generate tab's pasted draft every time
          the user glanced at another tab. */}
      <main className="content">
        <div hidden={tab !== 'Fill'}>
          <FillTab state={state} actions={actions} />
        </div>
        <div hidden={tab !== 'Generate'}>
          <GenerateTab state={state} actions={actions} />
        </div>
        <div hidden={tab !== 'Tracker'}>
          <TrackerTab active={tab === 'Tracker'} />
        </div>
        <div hidden={tab !== 'Answers'}>
          <AnswersTab active={tab === 'Answers'} />
        </div>
        <div hidden={tab !== 'Settings'}>
          <SettingsTab />
        </div>
      </main>
    </div>
  );
}
