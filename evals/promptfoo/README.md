# Promptfoo minime evaluation harness

Compare the default coding agent with minime on sequential tasks. Phase execution and knowledge reuse are measured, not assumed.

## Configuration

- [Commands, dependencies and Node requirement](package.json)
- [Execution profiles, limits and CLI options](cli.mjs)
- [Runtime arms and images](runtime/launch.mjs)
- [Versioned suites](scenarios/) and [promptfoo wiring](promptfooconfig.yaml)

## Prerequisites

Use a running local Docker daemon and credentials accepted by the [runner's authentication lookup](episode.mjs).

## Quick start

From `evals/promptfoo/`:

```bash
npm ci
npm run setup
npm run preflight
npm run validate
npm test
```

Run the configured smoke suite:

```bash
npm run smoke
```

Run the configured hard comparison:

```bash
npm run eval
```

Evaluation uses paid model calls. Preserve unsuccessful attempts rather than rerunning until they pass.

Follow the artifact paths printed by the CLI. The run manifest records the inputs and execution profile; validation records calibration evidence. The harness generates bounded reports from raw promptfoo results.

## Saved runs

Offline replay of the bounded writer (no coding-agent/model calls):

```bash
node cli.mjs replay-export --results-json <saved-results> --out-dir <new-output-dir>
```

Offline verifier regrade from saved runtime source trees (no coding-agent/model calls) with linked artifacts:

```bash
node cli.mjs regrade-results --results-json <saved-results> --out-dir <new-output-dir>
```

Regrading preserves raw results and links the derived outputs to their source. See the [CLI handlers](cli.mjs) for additional options and output definitions.

## Candidate payloads and qualification

A candidate combines the pinned plugin with a reviewed delta. The [candidate implementation](runtime/candidate.mjs) owns the path policy and integrity checks. Preparation is not approval: review the printed identity and record approval separately.

```bash
node cli.mjs prepare-candidate --baseline <source-baseline> --paths <reviewed-paths>
```

Pass the selected manifest and its approved hash to the evaluation command; otherwise the pinned-commit mode applies. Candidate options and environment-variable mappings are defined in the [CLI](cli.mjs).

```bash
node cli.mjs qualify --suite <suite> --task <task> --arm MINIME \
  --candidate-manifest <absolute-manifest> --approved-candidate-manifest-sha256 <approved-hash>
# add --direct-phase blueprint for the direct-blueprint control (no custom agent)
```

Qualification records observations rather than orchestrating or retrying phases. A successful command exit is not phase acceptance: inspect the phase audit and, for full-flow qualification, the independent verifier result.

### Observed knowledge state

Field definitions and evidence rules live in the [measurement implementation](runtime/qualification.mjs); the [shared runner](episode.mjs) owns inventory capture and receipt wiring.

Snapshot promotion is not a retained lesson. A confirmed read does not prove relevance, decision use or learning benefit. Missing observations remain unknown; historical runs are not backfilled.

## Add or replace tasks

1. Add a new immutable task version in the [suite definitions](scenarios/).
2. Add its independent checks in the [verifier](verify.mjs) and [container probe](probe.mjs).
3. Calibrate baseline-green, task-red, and reference-green during `npm run validate -- --suite <id@version>`.
4. Re-run both DEFAULT and MINIME on the selected suite before comparing.
