// minime-flow canvas: the conductor board inside Copilot.
//
// Wiring only. The canvas opens the same board as `node conductor/minime.mjs`: one conductor per open
// canvas for the session's repository, with the same page and run files. The actions let the agent
// steer the run the way the page does. stdout is reserved for JSON-RPC: never console.log.

import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { startBoard } from "../../../conductor/minime.mjs";

const boards = new Map(); // instanceId -> { url, conductor, close }

function conductorFor(instanceId) {
    const board = boards.get(instanceId);
    if (!board) throw new CanvasError("not_open", "the minime board is not open");
    return board.conductor;
}

function text(input, field) {
    const value = String(input?.[field] ?? "").trim();
    if (!value) throw new CanvasError("bad_input", `${field} is required`);
    return value;
}

// What the agent needs to steer the run, without the page's details.
function summary({ state, scores }) {
    if (!state) return { status: "idle" };
    return {
        status: state.paused ? "paused" : state.status,
        phase: state.stage?.phase ?? null,
        blueprint: state.blueprint,
        ask: state.ask,
        pending: state.pending.length,
        jobs: state.jobs.map((j) => ({ phase: j.phase, group: j.group, status: j.ended ? j.status : "running" })),
        scores,
    };
}

const steer = (name, description, run, inputSchema) => ({
    name,
    description,
    ...(inputSchema ? { inputSchema } : {}),
    handler: ({ instanceId, input }) => {
        run(conductorFor(instanceId), input);
        return summary(conductorFor(instanceId).view());
    },
});

joinSession({
    canvases: [
        createCanvas({
            id: "minime-flow",
            displayName: "Minime board",
            description: "Run a minime task (blueprint, replicate, inspect, extract) with fresh Copilot workers and watch its proof board.",
            inputSchema: {
                type: "object",
                properties: { task: { type: "string", description: "Start this task when the board opens." } },
                additionalProperties: true,
            },
            actions: [
                {
                    name: "state",
                    description: "Read the run: status, phase, open questions, jobs and scores.",
                    handler: ({ instanceId }) => summary(conductorFor(instanceId).view()),
                },
                steer("start", "Start a new task in the user's words.", (c, input) => c.start(text(input, "task")),
                    { type: "object", required: ["task"], properties: { task: { type: "string" } } }),
                steer("feedback", "Send the user's correction or follow-up; it applies after the running worker.", (c, input) => c.feedback(text(input, "text")),
                    { type: "object", required: ["text"], properties: { text: { type: "string" } } }),
                steer("answer", "Answer the open questions: answers by decision ID ({ choice, text }), or text when there are none.", (c, input) => c.answer(input?.answers ?? { text: text(input, "text") }),
                    { type: "object", properties: { answers: { type: "object" }, text: { type: "string" } } }),
                steer("pause", "Pause before the next worker starts.", (c) => c.pause()),
                steer("resume", "Resume a paused run.", (c) => c.resume()),
                steer("stop", "Stop the running workers.", (c) => c.stop()),
            ],
            open: async ({ instanceId, input }) => {
                let board = boards.get(instanceId);
                if (!board) {
                    board = await startBoard({ repo: process.cwd(), task: input?.task });
                    boards.set(instanceId, board);
                } else if (input?.task) {
                    board.conductor.start(input.task);
                }
                return { title: "Minime board", url: board.url, status: "ready" };
            },
            onClose: async ({ instanceId }) => {
                const board = boards.get(instanceId);
                if (!board) return;
                boards.delete(instanceId);
                await board.close();
            },
        }),
    ],
});
