const MODES = new Set(["sections", "source", "preview"]);

export function setEditorMode(root, mode) {
    if (!MODES.has(mode)) throw new Error(`Unsupported editor mode: ${mode}`);
    const controls = root.querySelectorAll("[data-mode-control]");
    const panels = root.querySelectorAll("[data-mode-panel]");

    for (const control of controls) {
        const active = control.dataset.modeControl === mode;
        control.setAttribute("aria-selected", String(active));
        control.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) {
        panel.hidden = panel.dataset.modePanel !== mode;
    }
}
