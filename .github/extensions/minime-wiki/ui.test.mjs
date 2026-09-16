import { test } from "node:test";
import assert from "node:assert/strict";

import { renderHtml } from "./ui.mjs";

test("renderHtml nonces inline style and script", () => {
    const html = renderHtml("inst", {
        root: "/hq",
        nonce: "abc123",
        scope: "all",
        currentRepository: null,
        selectedPath: null,
        draftSessionKey: "wiki:s1",
    });
    assert.match(html, /<style nonce="abc123">/);
    assert.match(html, /<script type="module" nonce="abc123">/);
});
