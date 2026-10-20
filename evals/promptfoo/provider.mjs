import { runEpisode } from './episode.mjs';
import { loadSuiteManifest, resolveRuntimeProfile } from './cli.mjs';

export default class MinimePromptfooProvider {
  constructor({ id, config }) {
    this._id = id ?? 'minime-eval';
    this._config = config ?? {};
    this.handlesOwnRetries = true;
    this._activeAbortController = null;
  }

  id() {
    return this._id;
  }

  async callApi(prompt, context, options) {
    const configuredSuite = this._config.suite;
    const suiteId = configuredSuite && !configuredSuite.startsWith("${")
      ? configuredSuite
      : (process.env.PROMPTFOO_SUITE || configuredSuite);
    const configuredModel = this._config.model;
    const configuredReasoning = this._config.reasoningEffort;
    const configuredCredits = this._config.maxAiCredits;
    if (!suiteId) {
      return {
        error: 'Missing suite in provider config'
      };
    }

    const suite = await loadSuiteManifest(suiteId);
    const runtimeProfile = resolveRuntimeProfile({
      suite,
      model: configuredModel && !String(configuredModel).startsWith("${") ? configuredModel : process.env.PROMPTFOO_MODEL,
      reasoningEffort: configuredReasoning && !String(configuredReasoning).startsWith("${")
        ? configuredReasoning
        : process.env.PROMPTFOO_REASONING,
      maxAiCredits: configuredCredits && !String(configuredCredits).startsWith("${")
        ? configuredCredits
        : process.env.PROMPTFOO_MAX_AI_CREDITS
    });

    const controller = new AbortController();
    this._activeAbortController = controller;
    const onAbort = () => controller.abort();
    options?.abortSignal?.addEventListener?.("abort", onAbort, { once: true });
    if (options?.abortSignal?.aborted) controller.abort();
    const result = await runEpisode({
      suite,
      prompt,
      context,
      abortSignal: controller.signal,
      runtimeProfile,
      candidate: {
        candidateManifestPath: process.env.PROMPTFOO_CANDIDATE_MANIFEST || null,
        approvedCandidateManifestSha256: process.env.PROMPTFOO_APPROVED_CANDIDATE_MANIFEST_SHA256 || null
      }
    });
    options?.abortSignal?.removeEventListener?.("abort", onAbort);
    this._activeAbortController = null;

    return {
      output: result.output,
      metadata: result.metadata,
      error: result.error ?? undefined
    };
  }

  async cleanup() {
    this._activeAbortController?.abort();
    return;
  }
}
