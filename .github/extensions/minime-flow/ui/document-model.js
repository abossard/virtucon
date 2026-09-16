const EDITABLE_SECTIONS = {
    goal: "Goal",
    activeCriteria: "Active criteria",
    planSummary: "Plan summary",
};

function normalizeHeading(value) {
    return String(value ?? "").trim().toLowerCase();
}

function fenceStart(line) {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (!match) return null;
    return { char: match[1][0], length: match[1].length };
}

function fenceEnd(line, fence) {
    if (!fence) return false;
    const endPattern = new RegExp(`^\\s{0,3}${fence.char}{${fence.length},}\\s*$`);
    return endPattern.test(line);
}

function collectHeadings(markdown, level) {
    const marker = "#".repeat(level);
    const headingPattern = new RegExp(`^\\s{0,3}${marker}\\s+(.+?)\\s*#*\\s*$`);
    const headings = [];
    let fence = null;
    let cursor = 0;

    while (cursor < markdown.length) {
        const lineEnd = markdown.indexOf("\n", cursor);
        const end = lineEnd === -1 ? markdown.length : lineEnd + 1;
        const line = markdown.slice(cursor, end).replace(/\n$/, "");

        if (fence) {
            if (fenceEnd(line, fence)) fence = null;
            cursor = end;
            continue;
        }

        const openedFence = fenceStart(line);
        if (openedFence) {
            fence = openedFence;
            cursor = end;
            continue;
        }

        const heading = line.match(headingPattern);
        if (heading) {
            headings.push({
                headingText: heading[1].trim(),
                headingStart: cursor,
                headingEnd: end,
            });
        }

        cursor = end;
    }

    return headings.map((heading, index) => {
        const bodyStart = heading.headingEnd;
        const bodyEnd = headings[index + 1]?.headingStart ?? markdown.length;
        return {
            ...heading,
            bodyStart,
            bodyEnd,
            body: markdown.slice(bodyStart, bodyEnd),
        };
    });
}

export function findLevelTwoSections(markdown) {
    return collectHeadings(String(markdown ?? ""), 2);
}

export function containsDesignHeading(markdown) {
    return collectHeadings(String(markdown ?? ""), 3).some((heading) =>
        normalizeHeading(heading.headingText).startsWith("design"),
    );
}

export function containsMermaidFence(markdown) {
    const source = String(markdown ?? "");
    let fence = null;
    let cursor = 0;
    while (cursor < source.length) {
        const lineEnd = source.indexOf("\n", cursor);
        const end = lineEnd === -1 ? source.length : lineEnd + 1;
        const line = source.slice(cursor, end).replace(/\n$/, "");

        if (!fence) {
            const openedFence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([a-zA-Z0-9_-]+)?\s*$/);
            if (openedFence) {
                fence = { char: openedFence[1][0], length: openedFence[1].length };
                if ((openedFence[2] ?? "").toLowerCase() === "mermaid") return true;
            }
            cursor = end;
            continue;
        }

        if (fenceEnd(line, fence)) fence = null;
        cursor = end;
    }
    return false;
}

export function extractEditableSections(markdown) {
    const source = String(markdown ?? "");
    const sections = findLevelTwoSections(source);
    const sectionMap = new Map(
        sections.map((section) => [normalizeHeading(section.headingText), section]),
    );
    const missing = [];

    const editable = {
        goal: null,
        activeCriteria: null,
        planSummary: null,
    };

    for (const [key, heading] of Object.entries(EDITABLE_SECTIONS)) {
        const section = sectionMap.get(normalizeHeading(heading));
        if (!section) {
            missing.push(key);
            continue;
        }
        editable[key] = section.body;
    }

    return { ...editable, missing };
}

function normalizeSectionBoundaries(originalBody, editedBody) {
    const sourceBody = String(originalBody ?? "");
    let nextBody = String(editedBody ?? "");
    const leadingBoundary = sourceBody.match(/^\n*/)?.[0] ?? "";
    const trailingBoundary = sourceBody.match(/\n*$/)?.[0] ?? "";
    if (leadingBoundary.length > 0 && !nextBody.startsWith("\n")) {
        nextBody = `${leadingBoundary}${nextBody}`;
    }
    if (trailingBoundary.length > 0 && !nextBody.endsWith("\n")) {
        nextBody = `${nextBody}${trailingBoundary}`;
    }
    return nextBody;
}

export function applySectionEdits(markdown, edits) {
    const source = String(markdown ?? "");
    const updates = edits && typeof edits === "object" ? edits : {};
    const sections = findLevelTwoSections(source);
    const sectionMap = new Map(
        sections.map((section) => [normalizeHeading(section.headingText), section]),
    );
    const replacements = [];

    for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) continue;
        if (!(key in EDITABLE_SECTIONS)) {
            throw new Error(`Unsupported editable section "${key}".`);
        }
        if (typeof value !== "string") {
            throw new Error(`Section "${key}" must be a string.`);
        }
        const section = sectionMap.get(normalizeHeading(EDITABLE_SECTIONS[key]));
        if (!section) {
            throw new Error(`Section "${EDITABLE_SECTIONS[key]}" is not provided in this draft.`);
        }
        const normalizedValue = normalizeSectionBoundaries(section.body, value);
        if (normalizedValue === section.body) continue;
        replacements.push({
            start: section.bodyStart,
            end: section.bodyEnd,
            value: normalizedValue,
        });
    }

    replacements.sort((left, right) => right.start - left.start);
    let output = source;
    for (const replacement of replacements) {
        output =
            output.slice(0, replacement.start) +
            replacement.value +
            output.slice(replacement.end);
    }
    return output;
}
