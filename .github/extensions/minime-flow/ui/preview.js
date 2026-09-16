function replaceMermaidCodeBlocks(target) {
    const blocks = [
        ...target.querySelectorAll("pre > code.language-mermaid, pre > code.lang-mermaid"),
    ];
    return blocks.map((code, index) => {
        const source = code.textContent ?? "";
        const wrapper = code.parentElement;
        const host = target.ownerDocument.createElement("figure");
        host.className = "diagram";
        host.dataset.diagram = String(index);
        wrapper.replaceWith(host);
        return { host, source, id: `diagram-${index}` };
    });
}

function renderMermaidFailure(host, source, error) {
    const pre = host.ownerDocument.createElement("pre");
    const code = host.ownerDocument.createElement("code");
    code.textContent = source;
    pre.append(code);

    const status = host.ownerDocument.createElement("p");
    status.className = "diagram-error";
    status.setAttribute("role", "status");
    status.textContent = `Diagram preview failed: ${error?.message ?? "Unknown error."}`;
    host.replaceChildren(status, pre);
}

export async function renderPreview({
    target,
    markdown,
    parseMarkdown,
    sanitizeHtml,
    renderMermaid,
}) {
    const html = parseMarkdown(markdown);
    target.innerHTML = sanitizeHtml(html);

    const diagrams = replaceMermaidCodeBlocks(target);
    for (const diagram of diagrams) {
        try {
            const output = await renderMermaid(diagram.source, diagram.id);
            diagram.host.innerHTML = output.svg;
        } catch (error) {
            renderMermaidFailure(diagram.host, diagram.source, error);
        }
    }
}
