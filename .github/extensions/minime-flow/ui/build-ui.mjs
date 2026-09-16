import { build } from "esbuild";
import { resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname);
const entry = resolve(root, "src/app-entry.js");
const output = resolve(root, "../ui/app.js");

await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "linked",
});
