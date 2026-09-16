import test from "node:test";
import assert from "node:assert/strict";
import { allowsInlineStyle } from "./csp-policy.js";

test("allowsInlineStyle parses style policy directives", () => {
    const cases = [
        ["", true],
        ["default-src 'self'; script-src 'self'; style-src 'self'", false],
        ["default-src 'self'; style-src 'self' 'unsafe-inline'", true],
        ["default-src 'self' 'unsafe-inline'", true],
        ["default-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'", true],
        ["default-src 'self'; style-src-attr 'self'", false],
    ];
    for (const [policy, expected] of cases) {
        assert.equal(allowsInlineStyle(policy), expected);
    }
});
