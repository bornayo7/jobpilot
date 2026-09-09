import { useEffect, useRef, useState } from 'react';
import { browser } from '#imports';
import {
  patchSettings,
  type SettingsSnapshot,
  type ModelRef,
  type Settings,
} from '@lib/storage/settingsStore';
import { providerFor, routeTask } from '@lib/providers/router';
import type { ProviderHealth } from '@lib/providers/types';
import { CommaListInput } from './CommaListInput';
import { useSettings } from '@hooks/useStores';
import { changedSettings } from './settingsDraft';

const PROVIDER_CHOICES: { value: ModelRef['provider']; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'lmstudio', label: 'LM Studio (local)' },
];

export function SettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const { snapshot, error: loadError, reload } = useSettings();
  const [base, setBase] = useState<SettingsSnapshot | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({});
  const [testOutput, setTestOutput] = useState('');
  const [testing, setTesting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (snapshot && !dirty) { setSettings(snapshot.settings); setBase(snapshot); }
  }, [snapshot, dirty]);
  useEffect(() => () => abortRef.current?.abort(), []);

  if (!settings || !base) return <div className="placeholder"><p role="status">{loadError || 'Loading settings…'}</p>{loadError && <><button onClick={() => void reload()}>Retry</button><button onClick={() => void browser.runtime.openOptionsPage()}>Open backup recovery</button></>}</div>;

  const update = (patch: Partial<Settings>) => {
    setSettings({ ...settings, ...patch });
    setDirty(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const saved = await patchSettings(changedSettings(base.settings, settings), base);
      setSettings(saved.settings); setBase(saved); setDirty(false);
    } catch (err) { setError(`Settings were not saved. Your draft is preserved. ${err instanceof Error ? err.message : String(err)}`); }
    finally { setSaving(false); }
  };

  const checkHealth = async (provider: ModelRef['provider']) => {
    const instance = providerFor(settings, { provider, model: '' });
    const result = (await instance.health?.().catch((err) => ({ ok: false, hint: String(err) }))) ?? {
      ok: false,
      hint: 'No health check available',
    };
    setHealth((prev) => ({ ...prev, [provider]: result }));
  };

  const runTest = async () => {
    setTesting(true);
    setTestOutput('');
    abortRef.current = new AbortController();
    try {
      const { provider, model } = routeTask(settings, 'mapping');
      await provider.chat(
        {
          model,
          messages: [{ role: 'user', content: 'Reply with one short sentence confirming you are reachable.' }],
          maxTokens: 60,
        },
        {
          signal: abortRef.current.signal,
          onToken: (token) => setTestOutput((prev) => prev + token),
        },
      ).then((res) => {
        // Non-streaming providers resolve with the full text at once.
        setTestOutput((prev) => (prev.length > 0 ? prev : res.text));
      });
    } catch (err) {
      setTestOutput(`Error: ${String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <fieldset className="settings" disabled={saving}>
      {(error || loadError) && <div className="warn-box" role="alert">{error || loadError}<button onClick={() => { setDirty(false); setError(''); void reload(); }}>Reload saved settings</button></div>}
      <section>
        <h2>API keys</h2>
        <p className="hint">
          Used only for cheap classification (field mapping). Long-form writing goes through the
          Prompt Studio to your own claude.ai / ChatGPT — never through these keys.
        </p>
        <label>
          Anthropic key
          <input
            type="password"
            value={settings.anthropicKey}
            onChange={(e) => update({ anthropicKey: e.target.value })}
            placeholder="sk-ant-…"
          />
        </label>
        <label>
          OpenAI key
          <input
            type="password"
            value={settings.openaiKey}
            onChange={(e) => update({ openaiKey: e.target.value })}
            placeholder="sk-…"
          />
        </label>
        <label>
          OpenRouter key
          <input
            type="password"
            value={settings.openrouterKey}
            onChange={(e) => update({ openrouterKey: e.target.value })}
            placeholder="sk-or-…"
          />
        </label>
      </section>

      <section>
        <h2>Local models</h2>
        <label>
          Ollama URL
          <input
            value={settings.ollamaBaseUrl}
            onChange={(e) => update({ ollamaBaseUrl: e.target.value })}
          />
        </label>
        <label>
          LM Studio URL
          <input
            value={settings.lmstudioBaseUrl}
            onChange={(e) => update({ lmstudioBaseUrl: e.target.value })}
          />
        </label>
      </section>

      <section>
        <h2>Models</h2>
        <TaskRouting
          label="Field mapping"
          value={settings.routing.mapping}
          onChange={(mapping) => update({ routing: { ...settings.routing, mapping } })}
        />
      </section>

      <section>
        <h2>Dealbreakers</h2>
        <p className="hint">
          Checked locally against every scanned posting — you get warned before spending time on an
          application you'd regret.
        </p>
        <label className="field checkbox-line">
          <input
            type="checkbox"
            checked={settings.dealbreakers.noSponsorship}
            onChange={(e) =>
              update({ dealbreakers: { ...settings.dealbreakers, noSponsorship: e.target.checked } })
            }
          />
          Warn when the posting says it can't sponsor a visa
        </label>
        <label className="field checkbox-line">
          <input
            type="checkbox"
            checked={settings.dealbreakers.clearance}
            onChange={(e) =>
              update({ dealbreakers: { ...settings.dealbreakers, clearance: e.target.checked } })
            }
          />
          Warn on citizenship / security-clearance requirements
        </label>
        <label>
          Minimum salary (blank = off)
          <input
            type="number"
            value={settings.dealbreakers.minSalary ?? ''}
            placeholder="e.g. 85000"
            onChange={(e) =>
              update({
                dealbreakers: {
                  ...settings.dealbreakers,
                  minSalary: e.target.value ? Number(e.target.value) : null,
                },
              })
            }
          />
        </label>
        <label>
          Custom warn-if-mentioned terms (comma-separated)
          <CommaListInput
            value={settings.dealbreakers.terms}
            placeholder="on-site only, unpaid, commission"
            onChange={(terms) => update({ dealbreakers: { ...settings.dealbreakers, terms } })}
          />
        </label>
      </section>

      <section>
        <h2>Connection checks</h2>
        <div className="health-grid">
          {PROVIDER_CHOICES.map(({ value, label }) => (
            <div key={value} className="health-row">
              <button onClick={() => checkHealth(value)}>Check {label}</button>
              {health[value] && (
                <span role={health[value].ok ? 'status' : 'alert'} className={health[value].ok ? 'chip ok' : 'chip fail'}>
                  {health[value].ok ? 'OK' : health[value].hint ?? 'Failed'}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Test the mapping model</h2>
        <button className="primary" onClick={runTest} disabled={testing}>
          {testing ? 'Running…' : 'Send test prompt'}
        </button>
        {testOutput && <pre className="test-output">{testOutput}</pre>}
      </section>

      <div className="save-bar">
        <button className="primary" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}
        </button>
        <button onClick={() => browser.runtime.openOptionsPage()}>Open profile editor</button>
      </div>
    </fieldset>
  );
}

function TaskRouting({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ModelRef;
  onChange: (ref: ModelRef) => void;
}) {
  return (
    <div className="routing-row">
      <span className="routing-label">{label}</span>
      <select
        aria-label={`${label} provider`}
        value={value.provider}
        onChange={(e) => onChange({ ...value, provider: e.target.value as ModelRef['provider'] })}
      >
        {PROVIDER_CHOICES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <input
        aria-label={`${label} model`}
        value={value.model}
        onChange={(e) => onChange({ ...value, model: e.target.value })}
        placeholder="model id"
      />
    </div>
  );
}
