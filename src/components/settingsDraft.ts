import type { Settings } from '@lib/storage/settingsStore';

/** Only edited leaf values are sent to storage; other pages own their edits. */
export function changedSettings(base: Settings, draft: Settings) {
  const changed = <T,>(a: T, b: T) => JSON.stringify(a) !== JSON.stringify(b);
  return {
    ...(changed(base.anthropicKey, draft.anthropicKey) ? { anthropicKey: draft.anthropicKey } : {}),
    ...(changed(base.openaiKey, draft.openaiKey) ? { openaiKey: draft.openaiKey } : {}),
    ...(changed(base.openrouterKey, draft.openrouterKey) ? { openrouterKey: draft.openrouterKey } : {}),
    ...(changed(base.ollamaBaseUrl, draft.ollamaBaseUrl) ? { ollamaBaseUrl: draft.ollamaBaseUrl } : {}),
    ...(changed(base.lmstudioBaseUrl, draft.lmstudioBaseUrl) ? { lmstudioBaseUrl: draft.lmstudioBaseUrl } : {}),
    routing: {
      mapping: {
        ...(changed(base.routing.mapping.provider, draft.routing.mapping.provider) ? { provider: draft.routing.mapping.provider } : {}),
        ...(changed(base.routing.mapping.model, draft.routing.mapping.model) ? { model: draft.routing.mapping.model } : {}),
      },
      extraction: {
        ...(changed(base.routing.extraction.provider, draft.routing.extraction.provider) ? { provider: draft.routing.extraction.provider } : {}),
        ...(changed(base.routing.extraction.model, draft.routing.extraction.model) ? { model: draft.routing.extraction.model } : {}),
      },
    },
    dealbreakers: {
      ...(changed(base.dealbreakers.enabled, draft.dealbreakers.enabled) ? { enabled: draft.dealbreakers.enabled } : {}),
      ...(changed(base.dealbreakers.noSponsorship, draft.dealbreakers.noSponsorship) ? { noSponsorship: draft.dealbreakers.noSponsorship } : {}),
      ...(changed(base.dealbreakers.clearance, draft.dealbreakers.clearance) ? { clearance: draft.dealbreakers.clearance } : {}),
      ...(changed(base.dealbreakers.minSalary, draft.dealbreakers.minSalary) ? { minSalary: draft.dealbreakers.minSalary } : {}),
      ...(changed(base.dealbreakers.terms, draft.dealbreakers.terms) ? { terms: draft.dealbreakers.terms } : {}),
    },
  };
}
