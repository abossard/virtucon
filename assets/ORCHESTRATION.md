# Orchestration

The owner runs the flow. Phase workers do the work in fresh contexts and return evidence; the blueprint carries state between them. The conductor (`conductor/minime.mjs`) runs this flow as code with a board to watch and steer it; Dr. Evil follows the same flow inside a chat session. The conductor reads the dispatch template below, so this file stays the one description of the flow.

## Flow

1. A question gets a short answer from what the owner can read. A request for a single phase gets only that phase.
2. For a new task, dispatch **blueprint** with the user's message verbatim, the repo's wiki index and the last lines of its run receipts (`raw/<org>/<repo>/runs.md`) pasted into the prompt, so the plan starts from what earlier runs on this repo proved. A chat dispatcher pastes the same two files.
3. If blueprint returns `blocked` with open decisions, ask the user (see Ask), then dispatch **blueprint** again with the answers in `User message:` as `Q: <question> A: <answer>` pairs, without form field names or option tags. Mark an answer that keeps the recommendation unchanged as `A (default):`, so blueprint cites it as `default:`. The blueprint already holds the earlier message, so don't send it again. Repeat until it returns `done`.
4. A blueprint that returns `done` is built at once; its text gets no review. Dispatch **replicate** once with the criterion IDs blueprint added or changed: one build per blueprint, whatever its size. If replicate returns `blocked`, dispatch **blueprint** once with its blocking issue as input, then replicate again; a second block ends the run.
5. Dispatch **inspect** to `minime:frau` with all changed files and replicate's preflight line (the project's tests on untouched HEAD) as `Baseline:`. After a feedback round, add the criterion IDs that round touched.

   Existing tests are the contract. When the change removes or rewrites lines of existing tests and inspect is otherwise clean, the user decides once per blueprint whether to keep them (recommended) or confirm the removal (see Ask). The conductor counts the lines with the blueprint tool's `diff` (`testLinesRemoved`); a chat dispatcher, which has no diff tool, takes `ratchet.test_lines_removed` from inspect's result. The answer goes to **blueprint** as the user's answer, then to **replicate** as a fix round (restoring the tests on `keep`), and **inspect** runs again.
6. If inspect reports proposed criteria, dispatch **blueprint** with the proposals and their evidence first. Then dispatch **replicate** with the findings file and **inspect** again. After two rounds without fewer findings, show the user the evidence and ask how to proceed; if the next round still shows no fewer findings, stop and report the findings file.
7. When inspect reports no findings, dispatch **extract** once.
8. Report one line each: the verdict, the absolute blueprint path, the test counts, the changed files, what extract captured.

Every run ends with one receipt line in `raw/<org>/<repo>/runs.md`, written by the conductor from the run state: the verdict, the jobs per phase with blocks and findings, the cost, the preflight test command and what stopped the run. It is the evidence of what worked on this repo, read by the next blueprint; extract may cite it like any raw source.

The verdict is computed, never reported: proven when every criterion names a test file and has no finding, inspect ran on the tree as it is now and found nothing, and the ratchet is clean; otherwise the gaps, one per line. A worker's `status` only says what happens next.

## Fuel

A run stops with what it has, and the board keeps the proof so far, when it passes a cap: premium requests (`--requests`), worker minutes (`--minutes`), or the same blocking issue returned twice (`--repeats`, default 2): the identical issue text, or the same open decisions by criterion ID however the question is worded; an ask answered with the same decision returning counts. A file named `PAUSED` in `VIRTUCON_HQ` holds every run before its next dispatch until the file is removed; the guard hook reads the same file. A chat dispatcher stops at the same repeat.

## Feedback

When the user sends feedback mid-flow, let the running workers finish. Then dispatch **blueprint** once with every message that arrived since the last blueprint dispatch, each verbatim, and continue from step 4. Feedback after the report starts at the same place, with the same blueprint path.

A reviewer's diff or CI result after the report, given as a lesson and not as a request, goes to **extract** alone, with its saved files as input.

A review the user asks for without naming when (another model, a rubber duck) runs on the blueprint before step 4. Like inspect, it reports only failing tests, failing inputs at a boundary and deviations from the blueprint text; its proposals go to **blueprint**.

## Dispatch

- Name each task after its phase: `blueprint`, `replicate`, `inspect`, `extract`, so progress reads the same in every client.
- Every dispatch starts a new worker. Run workers synchronously and wait for each result. Don't start background workers or poll them, and don't send a worker more messages after it returns: the next round is a new dispatch that names the findings file.
- Workers don't see the conversation, so every prompt stands alone. Send only these fields; the blueprint holds the context, so don't restate it. `Blueprint:` is the file the task works on:

  ```text
  Use the minime <phase> skill.
  Blueprint: <absolute path, or "new">
  Repo: <absolute path>
  <phase input: criterion IDs, boundary IDs, the findings file or the changed files>
  User message:
  <the user's text verbatim; only blueprint dispatches carry it>
  End of user message.
  Reply with one JSON object in a json code block and nothing else: status (done | blocked | failed), blueprint_path, changed_files[], blocking_issue, evidence_excerpts[], and the fields the skill's Return section adds.
  Open decisions go in blocking_issue with status blocked. evidence_excerpts are the commands you ran with their pass and fail counts.
  ```

- Use the general-purpose agent for blueprint, replicate and extract, and `minime:frau` for inspect.
- Accept a result only with its evidence (check output, test counts, findings file). A claim without evidence is not a result; dispatch the phase again and name what was missing.
- A worker that fails on a model or network error without a result gets the same prompt once more.
- Keep the user's model and reasoning settings. Set a per-task model only when the user chose one.

## Ask

Ask only for the open questions the blueprint returns and for removed lines of existing tests (step 5). The test question is the conductor's own, not a blueprint question: its options are fixed, `keep` and `remove`, and it recommends `keep`. Use the native question tool (`ask_user` in Copilot, `AskUserQuestion` in Claude Code, the board in the conductor); without one, stop and put the questions in your reply. Ask one question per decision with the evidence, the worker's options, its recommendation with a confidence and the reason, and a free-text answer. When no input is needed, keep working.
