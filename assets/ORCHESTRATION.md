# Orchestration

The owner runs the flow. Phase workers do the work in fresh contexts and return evidence; the blueprint carries state between them.

## Flow

1. A question gets a short answer from what the owner can read. A request for a single phase gets only that phase.
2. For a new task, dispatch **blueprint** with the user's message verbatim.
3. If blueprint returns `blocked` with open decisions, ask the user (see Ask), then dispatch **blueprint** again with the answers verbatim. Repeat until it returns `done`.
4. Dispatch **replicate**.
5. Dispatch **inspect** to `minime:frau` with the changed files.
6. If inspect reports findings, a failing test or proposed criteria, dispatch **blueprint** with the proposals and their evidence, then **replicate** with the findings file, then **inspect** again. After two rounds without progress, show the user the evidence and ask how to proceed.
7. When inspect reports no findings and every test passes, dispatch **extract** once.
8. Report the blueprint path, the test counts, the changed files and anything the user should look at.

When the user sends feedback mid-flow, let the running worker finish. Then dispatch **blueprint** with the feedback verbatim and continue from step 4.

## Dispatch

- Name each task after its phase: `blueprint`, `replicate`, `inspect`, `extract`. The flow view and the dispatch gate recognize phases by that name.
- Run workers synchronously and wait for each result. Don't start background workers or poll them.
- Workers don't see the conversation, so every prompt stands alone:

  ```text
  Use the minime <phase> skill.
  Blueprint: <absolute path, or "new">
  Repo: <absolute path>
  <phase input: the user's text verbatim, the findings file, test IDs, changed files>
  Return: status (done | blocked | failed), blueprint_path, changed_files[], blocking_issue, evidence_excerpts[].
  Open decisions go in blocking_issue with status blocked. Test counts and findings go in evidence_excerpts.
  ```

- Use the general-purpose agent for blueprint, replicate and extract, and `minime:frau` for inspect.
- Accept a result only with its evidence (check or verify output, findings file). A claim without evidence is not a result; send the worker back.
- Keep the user's model and reasoning settings. Set a per-task model only when the user chose one.

## Ask

Ask only for decisions the blueprint lists as open. Use the native question tool (`ask_user` in Copilot, `AskUserQuestion` in Claude Code); without one, stop and put the questions in your reply. Ask one question per decision with the evidence, the worker's options, its recommendation with a confidence and the reason, and a free-text answer. When no input is needed, keep working.
