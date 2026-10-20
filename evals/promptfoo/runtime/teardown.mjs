import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

function sleep(ms) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function signalProcessGroup(pid, signal) {
    try {
        process.kill(-pid, signal);
        return true;
    } catch (error) {
        if (error?.code !== "ESRCH") throw error;
    }
    try {
        process.kill(pid, signal);
        return true;
    } catch (error) {
        if (error?.code !== "ESRCH") throw error;
    }
    return false;
}

export function processExists(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error?.code === "ESRCH") return false;
        if (error?.code === "EPERM") return true;
        throw error;
    }
}

export async function terminateProcessTree(pid, { graceMs = 400, pollMs = 25 } = {}) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return { pid, requested: false, escalated: false, stillRunning: false };
    }

    const requested = signalProcessGroup(pid, "SIGTERM");
    const deadline = Date.now() + Math.max(0, Number(graceMs));

    while (Date.now() < deadline) {
        if (!processExists(pid)) {
            return { pid, requested, escalated: false, stillRunning: false };
        }
        await sleep(Math.max(1, Number(pollMs)));
    }

    let escalated = false;
    if (processExists(pid)) {
        escalated = signalProcessGroup(pid, "SIGKILL") || escalated;
        await sleep(Math.max(1, Number(pollMs)));
    }

    return {
        pid,
        requested,
        escalated,
        stillRunning: processExists(pid),
    };
}

export async function writeHostReceipt(pathLike, payload) {
    const path = resolve(pathLike);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return path;
}

