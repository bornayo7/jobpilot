import { defineConfig } from 'wxt';

// JobPilot manifest. Host permissions cover LLM providers, the Greenhouse Job Board
// API (field-schema prefetch), and localhost model servers (Ollama / LM Studio) —
// match patterns cannot carry ports, so http://localhost/* covers :11434 and :1234.
// ATS sites themselves are matched by the content script's own `matches` list;
// arbitrary company career sites are covered by optional_host_permissions and a
// per-site enable flow (chrome.scripting.registerContentScripts at runtime).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  alias: {
    '@lib': 'src/lib',
    '@components': 'src/components',
    '@hooks': 'src/hooks',
  },
  manifest: {
    name: 'JobPilot',
    description:
      'Personal job-application copilot: autofill applications, tailor resumes via prompt studio, remember answers.',
    permissions: [
      'sidePanel',
      'storage',
      'unlimitedStorage',
      'activeTab',
      'scripting',
      'webNavigation',
      'identity',
    ],
    host_permissions: [
      'https://api.anthropic.com/*',
      'https://api.openai.com/*',
      'https://openrouter.ai/*',
      'https://boards-api.greenhouse.io/*',
      'http://127.0.0.1/*',
      'http://localhost/*',
    ],
    optional_host_permissions: ['<all_urls>'],
    action: {
      default_title: 'JobPilot',
    },
  },
});
