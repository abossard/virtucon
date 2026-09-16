// ui.mjs — the canvas iframe SPA: an Obsidian / code-editor-style wiki console.
//
// renderHtml() returns one self-contained document. The interactive client lives
// in clientMain() below and is serialized with .toString() into the page, so it
// can use template literals freely (the outer literal only interpolates the small
// JSON config + the function source). No external assets, no bridge — everything
// talks to the per-instance loopback server over same-origin fetch + SSE.

function escAttr(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[c]));
}

export function renderHtml(instanceId, {
    root,
    nonce,
    scope,
    currentRepository,
    selectedPath,
    draftSessionKey,
}) {
    const cfg = {
        instanceId,
        root,
        nonce,
        scope,
        currentRepository,
        selectedPath,
        draftSessionKey,
    };
    const safeNonce = escAttr(nonce);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" href="data:," />
<title>Minime Wiki</title>
<style nonce="${safeNonce}">
${CSS}
</style>
</head>
<body>
${SHELL}
<script type="module" nonce="${safeNonce}">
window.__CFG__ = ${JSON.stringify(cfg)};
(${clientMain.toString()})();
</script>
</body>
</html>`;
}

/* ───────────────────────────────── CSS ─────────────────────────────── */

const CSS = `
:root{
  color-scheme: light dark;
  /* layered neutrals: content surface + recessed panel + hairlines */
  --bg: var(--background-color-default, #191a1d);
  --panel: color-mix(in oklab, var(--bg) 92%, #000 8%);
  --panel-2: color-mix(in oklab, var(--bg) 86%, #000 14%);
  --hover: color-mix(in oklab, var(--bg) 88%, var(--ink) 12%);
  --border: var(--border-color-default, color-mix(in oklab, var(--bg) 78%, #888 22%));
  --ink: var(--text-color-default, #e7e9ee);
  --muted: var(--text-color-muted, color-mix(in oklab, var(--ink) 62%, var(--bg) 38%));
  --faint: color-mix(in oklab, var(--ink) 40%, var(--bg) 60%);
  --accent: var(--true-color-blue, #6aa3ff);
  --accent-ink: color-mix(in oklab, var(--accent) 88%, var(--ink));
  --accent-soft: color-mix(in oklab, var(--accent) 18%, transparent);
  --accent-line: color-mix(in oklab, var(--accent) 70%, transparent);
  --good: var(--true-color-green, #5bd07f);
  --warn: var(--true-color-yellow, #e7b24a);
  --danger: var(--true-color-red, #f1707a);
  --area-wiki: var(--accent);
  --area-pattern: var(--true-color-purple, #b08bf0);
  --area-raw: var(--muted);
  --area-blueprint: var(--true-color-orange, #e0883a);
  --font: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  --mono: var(--font-mono, "SFMono-Regular", "JetBrains Mono", Consolas, monospace);
  --t-xs: 11px; --t-sm: 12px; --t-base: 13px; --t-md: 15px; --t-lg: 19px; --t-xl: 22px;
  --r: 6px; --r-sm: 4px;
  --ease: cubic-bezier(.22,.61,.36,1);
  --z-rail: 20; --z-backdrop: 30; --z-dialog: 40; --z-toast: 50;
}
*{ box-sizing: border-box; }
html,body{ height:100%; }
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:var(--font); font-size:var(--t-base); line-height:1.5;
  display:flex; flex-direction:column; overflow:hidden;
  -webkit-font-smoothing:antialiased;
}
button{ font:inherit; color:inherit; background:none; border:none; cursor:pointer; }
input,textarea,select{ font:inherit; color:inherit; }
kbd{
  font-family:var(--mono); font-size:.85em; padding:1px 5px; border-radius:var(--r-sm);
  background:var(--panel-2); border:1px solid var(--border); color:var(--muted);
  box-shadow:0 1px 0 var(--border);
}
:focus-visible{ outline:2px solid var(--accent); outline-offset:2px; border-radius:var(--r-sm); }
:focus:not(:focus-visible){ outline:none; }
.muted{ color:var(--muted); }
.faint{ color:var(--faint); }
.row{ display:flex; align-items:center; gap:8px; }
.pad0{ padding:0 !important; }
.m0{ margin:0 !important; }
.blockpad{ padding:8px; display:block; }
.glyphmark{ font-size:30px; opacity:.5; }
.w50{ width:50%; } .w60{ width:60%; } .w70{ width:70%; } .w72{ width:72%; }
.w80{ width:80%; } .w86{ width:86%; } .w90{ width:90%; } .h22{ height:22px; }

/* ── top bar ── */
.topbar{
  display:flex; align-items:center; gap:10px; height:38px; padding:0 10px; flex:0 0 auto;
  background:var(--panel); border-bottom:1px solid var(--border);
}
.topbar .brand{ font-size:var(--t-sm); font-weight:600; letter-spacing:.01em; }
.topbar .brand .glyph{ color:var(--accent); }
.topbar .vault{ font-family:var(--mono); font-size:var(--t-xs); color:var(--muted); }
.topbar .scope{ font-size:var(--t-xs); color:var(--muted); padding:2px 8px; border-radius:999px; border:1px solid var(--border); background:var(--panel-2); }
.topbar .scopebtn{ height:24px; padding:0 8px; border-radius:var(--r-sm); border:1px solid var(--border); background:var(--panel-2); color:var(--muted); font-size:var(--t-xs); }
.topbar .scopebtn:hover{ border-color:var(--accent-line); color:var(--ink); }
.topbar .grow{ flex:1; }
.iconbtn{
  width:28px; height:28px; display:grid; place-items:center; border-radius:var(--r-sm);
  color:var(--muted); transition:background .12s var(--ease), color .12s var(--ease);
}
.iconbtn:hover{ background:var(--hover); color:var(--ink); }
.iconbtn[aria-pressed="true"]{ color:var(--accent); background:var(--accent-soft); }
.cmdk{
  display:flex; align-items:center; gap:8px; height:26px; padding:0 8px; border-radius:var(--r);
  background:var(--panel-2); border:1px solid var(--border); color:var(--muted);
  font-size:var(--t-sm); transition:border-color .12s var(--ease);
}
.cmdk:hover{ border-color:var(--accent-line); color:var(--ink); }

/* ── shell grid ── */
.shell{ flex:1; display:grid; grid-template-columns:var(--lw,250px) 1fr var(--rw,300px); min-height:0; }
.shell[data-left="0"]{ --lw:0px; }
.shell[data-right="0"]{ --rw:0px; }
.pane{ min-height:0; min-width:0; display:flex; flex-direction:column; overflow:hidden; }
.left{ background:var(--panel); border-right:1px solid var(--border); }
.right{ background:var(--panel); border-left:1px solid var(--border); }
.shell[data-left="0"] .left, .shell[data-right="0"] .right{ display:none; }

/* ── search + tree ── */
.searchwrap{ padding:8px; flex:0 0 auto; }
.search{
  width:100%; height:30px; padding:0 9px; border-radius:var(--r);
  background:var(--bg); border:1px solid var(--border); color:var(--ink);
  transition:border-color .12s var(--ease);
}
.search::placeholder{ color:var(--muted); }
.search:focus{ outline:none; border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft); }
.scroll{ overflow:auto; flex:1; padding:2px 6px 14px; scrollbar-width:thin; }
.tree{ font-size:var(--t-sm); }
.tree[hidden]{ display:none; }
.trow{
  display:flex; align-items:center; gap:5px; height:24px; padding:0 6px; border-radius:var(--r-sm);
  white-space:nowrap; cursor:pointer; color:var(--ink); user-select:none;
  transition:background .1s var(--ease);
}
.trow:hover{ background:var(--hover); }
.trow[aria-selected="true"]{ background:var(--accent-soft); color:var(--accent-ink); }
.trow .chev{ width:12px; height:12px; flex:0 0 auto; color:var(--muted); transition:transform .14s var(--ease); }
.trow[aria-expanded="true"] .chev{ transform:rotate(90deg); }
.trow .lbl{ overflow:hidden; text-overflow:ellipsis; }
.trow.file .dot{ width:6px; height:6px; border-radius:50%; flex:0 0 auto; background:var(--area-raw); }
.trow.file .dot.wiki{ background:var(--area-wiki); }
.trow.file .dot.pattern{ background:var(--area-pattern); }
.trow.file .dot.blueprint{ background:var(--area-blueprint); }
.trow.dir .lbl{ font-weight:550; }
.trow .spacer{ flex:0 0 auto; }
.trow .bpmeta{ margin-left:auto; display:flex; gap:6px; align-items:center; flex:0 0 auto; padding-left:8px; }
.bpstatus{ font-size:9px; line-height:14px; padding:0 5px; border-radius:999px; border:1px solid var(--border); color:var(--muted); text-transform:uppercase; letter-spacing:.03em; white-space:nowrap; }
.bpstatus.done, .bpstatus.merged, .bpstatus.complete, .bpstatus.completed, .bpstatus.shipped{ color:var(--good); border-color:color-mix(in oklab,var(--good) 40%,var(--border)); }
.bpstatus.planning, .bpstatus.active, .bpstatus.replicate, .bpstatus.replicating{ color:var(--accent-ink); border-color:var(--accent-line); }
.bpdate{ font-family:var(--mono); font-size:9px; color:var(--faint); }

/* left-rail view toggle */
.leftnav{ display:flex; gap:4px; padding:8px 8px 0; }
.navtab{ flex:1; height:26px; border-radius:var(--r); font-size:var(--t-sm); color:var(--muted); border:1px solid transparent; transition:background .12s var(--ease), color .12s var(--ease); }
.navtab:hover{ background:var(--hover); color:var(--ink); }
.navtab[aria-pressed="true"]{ background:var(--accent-soft); color:var(--accent-ink); border-color:var(--accent-line); }

/* search results */
.results{ font-size:var(--t-sm); }
.results[hidden]{ display:none; }
.hit{ padding:7px 8px; border-radius:var(--r); cursor:pointer; transition:background .1s var(--ease); }
.hit:hover, .hit[aria-selected="true"]{ background:var(--hover); }
.hit .t{ display:flex; align-items:center; gap:6px; }
.hit .t b{ font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hit .p{ font-family:var(--mono); font-size:var(--t-xs); color:var(--faint); margin-top:1px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hit .s{ color:var(--muted); font-size:var(--t-xs); margin-top:3px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.badge{
  font-size:10px; line-height:16px; padding:0 6px; border-radius:999px; flex:0 0 auto;
  border:1px solid var(--border); color:var(--muted); background:var(--panel-2);
}
.badge.wiki{ color:var(--area-wiki); border-color:color-mix(in oklab,var(--area-wiki) 40%,var(--border)); }
.badge.pattern{ color:var(--area-pattern); border-color:color-mix(in oklab,var(--area-pattern) 40%,var(--border)); }

/* ── center: tabs / breadcrumb / note / status ── */
.tabs{ display:flex; align-items:stretch; height:34px; flex:0 0 auto; background:var(--panel-2);
  border-bottom:1px solid var(--border); overflow-x:auto; scrollbar-width:none; }
.tabs::-webkit-scrollbar{ display:none; }
.tab{
  display:flex; align-items:center; gap:7px; padding:0 10px; max-width:200px;
  border-right:1px solid var(--border); color:var(--muted); cursor:pointer;
  white-space:nowrap; transition:background .1s var(--ease), color .1s var(--ease);
}
.tab:hover{ background:var(--hover); color:var(--ink); }
.tab[aria-selected="true"]{ background:var(--bg); color:var(--ink); box-shadow:inset 0 2px 0 var(--accent); }
.tab .name{ overflow:hidden; text-overflow:ellipsis; font-size:var(--t-sm); }
.tab .x{ width:16px; height:16px; display:grid; place-items:center; border-radius:var(--r-sm); color:var(--faint); }
.tab .x:hover{ background:var(--panel-2); color:var(--ink); }
.tab .dirty{ width:7px; height:7px; border-radius:50%; background:var(--accent); }
.tab .dirty[hidden]{ display:none; }

.cbar{ display:flex; align-items:center; gap:8px; height:30px; flex:0 0 auto; padding:0 14px;
  border-bottom:1px solid var(--border); color:var(--muted); font-size:var(--t-sm); }
.crumb{ font-family:var(--mono); font-size:var(--t-xs); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cbar .grow{ flex:1; }
.modebtn{ display:flex; gap:2px; background:var(--panel-2); border:1px solid var(--border); border-radius:var(--r); padding:2px; }
.modebtn button{ padding:2px 10px; border-radius:var(--r-sm); font-size:var(--t-xs); color:var(--muted); }
.modebtn button[aria-pressed="true"]{ background:var(--bg); color:var(--ink); }

.note{ flex:1; overflow:auto; }
.reading{ max-width:74ch; margin:0 auto; padding:26px 40px 80px; }
.props{ border:1px solid var(--border); border-radius:var(--r); margin-bottom:22px; overflow:hidden; }
.props .prow{ display:grid; grid-template-columns:120px 1fr; gap:10px; padding:6px 12px; font-size:var(--t-sm); }
.props .prow + .prow{ border-top:1px solid var(--border); }
.props .k{ color:var(--muted); }
.props .v{ color:var(--ink); }
.props .v code{ font-family:var(--mono); font-size:var(--t-xs); }
.editor{ width:100%; height:100%; border:none; background:var(--bg); color:var(--ink);
  font-family:var(--mono); font-size:var(--t-base); line-height:1.7; padding:24px 40px 80px; resize:none; }
.editor:focus{ outline:none; }

/* rendered markdown */
.doc h1{ font-size:var(--t-xl); font-weight:650; line-height:1.25; margin:.2em 0 .5em; text-wrap:balance; letter-spacing:-.01em; }
.doc h2{ font-size:var(--t-md); font-weight:600; margin:1.5em 0 .4em; padding-bottom:.25em; border-bottom:1px solid var(--border); }
.doc h3{ font-size:var(--t-base); font-weight:650; margin:1.2em 0 .3em; }
.doc p{ margin:.6em 0; text-wrap:pretty; }
.doc ul,.doc ol{ margin:.5em 0; padding-left:1.4em; }
.doc li{ margin:.18em 0; }
.doc code{ font-family:var(--mono); font-size:.92em; background:var(--panel-2); padding:.08em .35em; border-radius:var(--r-sm); }
.doc pre{ background:var(--panel-2); border:1px solid var(--border); border-radius:var(--r); padding:12px 14px; overflow:auto; }
.doc pre code{ background:none; padding:0; }
.doc a{ color:var(--accent-ink); text-underline-offset:2px; }
.doc h1:target,.doc h2:target,.doc h3:target{ scroll-margin-top:14px; }
.doc table{ border-collapse:collapse; width:100%; margin:.9em 0; font-size:var(--t-sm); display:block; overflow-x:auto; }
.doc th,.doc td{ border:1px solid var(--border); padding:5px 9px; text-align:left; vertical-align:top; }
.doc thead th{ background:var(--panel-2); font-weight:600; white-space:nowrap; }
.doc tbody tr:nth-child(even){ background:color-mix(in oklab, var(--panel) 45%, transparent); }
.doc hr{ border:none; border-top:1px solid var(--border); margin:1.2em 0; }
.doc ul.tasklist{ list-style:none; padding-left:.1em; }
.doc li.task{ display:flex; gap:8px; align-items:flex-start; }
.doc li.task .cb{ flex:0 0 auto; width:15px; height:15px; margin-top:2px; border:1px solid var(--border); border-radius:3px; display:grid; place-items:center; font-size:10px; color:var(--good); }
.doc li.task.done .cb{ background:color-mix(in oklab, var(--good) 22%, transparent); border-color:var(--good); }
.doc li.task.done > span:last-child{ color:var(--muted); }

.status{ display:flex; align-items:center; gap:14px; height:24px; flex:0 0 auto; padding:0 12px;
  background:var(--panel); border-top:1px solid var(--border); color:var(--muted);
  font-size:var(--t-xs); font-family:var(--mono); overflow:hidden; }
.status > span{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:0 0 auto; }
.status .grow{ flex:1 1 auto; min-width:0; }
.status .dirty-on{ color:var(--warn); }
.status .saved{ color:var(--good); }

/* ── right rail sections ── */
.sect{ border-bottom:1px solid var(--border); }
.sect > summary{ display:flex; align-items:center; gap:7px; height:32px; padding:0 12px; cursor:pointer;
  font-size:var(--t-xs); text-transform:uppercase; letter-spacing:.05em; color:var(--muted); list-style:none; user-select:none; }
.sect > summary::-webkit-details-marker{ display:none; }
.sect > summary .chev{ width:11px; height:11px; transition:transform .14s var(--ease); }
.sect[open] > summary .chev{ transform:rotate(90deg); }
.sect > summary .count{ margin-left:auto; font-family:var(--mono); }
.sect .body{ padding:6px 12px 14px; font-size:var(--t-sm); }
.outline a{ display:block; padding:3px 6px; border-radius:var(--r-sm); color:var(--muted); text-decoration:none;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.outline a:hover{ background:var(--hover); color:var(--ink); }
.outline a.h3{ padding-left:18px; font-size:var(--t-xs); }

.field{ display:flex; flex-direction:column; gap:4px; margin-bottom:8px; }
.field label{ font-size:var(--t-xs); color:var(--muted); }
.ctl{ height:28px; padding:0 8px; border-radius:var(--r); background:var(--bg); border:1px solid var(--border); color:var(--ink); width:100%; }
.ctl:focus{ outline:none; border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft); }
.btn{ height:30px; padding:0 12px; border-radius:var(--r); border:1px solid var(--border); background:var(--panel-2);
  color:var(--ink); transition:background .12s var(--ease), border-color .12s var(--ease); }
.btn:hover{ background:var(--hover); border-color:var(--accent-line); }
.btn.primary{ background:var(--accent-soft); border-color:var(--accent-line); color:var(--accent-ink); font-weight:550; }
.btn.primary:hover{ background:color-mix(in oklab,var(--accent) 26%, transparent); }
.btn.block{ width:100%; }
.btn[disabled]{ opacity:.55; cursor:not-allowed; }
.toolbtn{ display:flex; align-items:center; gap:8px; width:100%; height:32px; padding:0 10px; border-radius:var(--r);
  color:var(--ink); text-align:left; transition:background .12s var(--ease); }
.toolbtn:hover{ background:var(--hover); }
.toolbtn .k{ margin-left:auto; }
.statline{ display:flex; justify-content:space-between; padding:3px 0; }
.statline b{ font-variant-numeric:tabular-nums; }
.linkrow{ display:block; padding:3px 6px; border-radius:var(--r-sm); color:var(--muted); cursor:pointer;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--mono); font-size:var(--t-xs); }
.linkrow:hover{ background:var(--hover); color:var(--ink); }
.dup{ display:flex; align-items:center; gap:6px; padding:3px 0; font-size:var(--t-xs); }
.dup code{ font-family:var(--mono); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
.acwrap{ margin:6px 0 10px; }
.acwrap .lab{ display:flex; justify-content:space-between; font-size:var(--t-xs); color:var(--muted); margin-bottom:4px; }
.acbar{ height:6px; border-radius:999px; background:var(--panel-2); overflow:hidden; }
.acbar > i{ display:block; height:100%; background:var(--good); transition:width .3s var(--ease); }
.bpgoal{ font-size:var(--t-sm); color:var(--muted); margin:2px 0 10px; }

/* ── empty / skeleton ── */
.empty{ display:flex; flex-direction:column; gap:14px; align-items:center; justify-content:center; height:100%;
  color:var(--muted); padding:40px; text-align:center; }
.empty h2{ font-size:var(--t-md); color:var(--ink); font-weight:600; margin:0; }
.empty .keys{ display:grid; gap:6px; font-size:var(--t-sm); }
.empty .keys div{ display:flex; gap:10px; justify-content:space-between; min-width:240px; }
.skel{ background:linear-gradient(90deg,var(--panel) 25%,var(--hover) 37%,var(--panel) 63%);
  background-size:400% 100%; animation:shimmer 1.3s linear infinite; border-radius:var(--r-sm); }
.skel.line{ height:11px; margin:7px 6px; }
@keyframes shimmer{ from{ background-position:100% 0; } to{ background-position:0 0; } }

/* ── command palette (native dialog) ── */
dialog{ border:none; padding:0; background:transparent; color:inherit; }
dialog::backdrop{ background:color-mix(in oklab, #000 52%, transparent); backdrop-filter:blur(2px); }
.palette{ width:min(560px,92vw); margin:9vh auto 0; background:var(--panel); border:1px solid var(--border);
  border-radius:10px; box-shadow:0 16px 50px -12px rgba(0,0,0,.6); overflow:hidden;
  animation:rise .16s var(--ease); }
@keyframes rise{ from{ opacity:0; transform:translateY(8px); } to{ opacity:1; transform:none; } }
.palette .pin{ width:100%; height:46px; padding:0 16px; background:transparent; border:none;
  border-bottom:1px solid var(--border); color:var(--ink); font-size:var(--t-md); }
.palette .pin:focus{ outline:none; }
.palette .plist{ max-height:48vh; overflow:auto; padding:6px; scrollbar-width:thin; }
.pitem{ display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:var(--r); cursor:pointer; }
.pitem[aria-selected="true"]{ background:var(--accent-soft); }
.pitem .ico{ width:16px; text-align:center; color:var(--muted); flex:0 0 auto; }
.pitem .ptxt{ overflow:hidden; }
.pitem .ptitle{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pitem .psub{ font-size:var(--t-xs); color:var(--faint); font-family:var(--mono); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pitem .k{ margin-left:auto; }
.pempty{ padding:18px; text-align:center; color:var(--muted); }

.modal{ width:min(640px,94vw); margin:8vh auto 0; background:var(--panel); border:1px solid var(--border);
  border-radius:10px; box-shadow:0 16px 50px -12px rgba(0,0,0,.6); animation:rise .16s var(--ease); overflow:hidden; }
.modal header{ display:flex; align-items:center; gap:8px; padding:12px 16px; border-bottom:1px solid var(--border); }
.modal header h3{ margin:0; font-size:var(--t-md); font-weight:600; }
.modal .mbody{ padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
.modal textarea{ width:100%; min-height:230px; max-height:48vh; border:1px solid var(--border); border-radius:var(--r);
  background:var(--bg); color:var(--ink); font-family:var(--mono); font-size:var(--t-sm); line-height:1.6; padding:10px 12px; resize:vertical; }
.modal .mfoot{ display:flex; gap:8px; justify-content:flex-end; padding:0 16px 14px; }
.modal .msg{ font-size:var(--t-xs); }
.doc.preview{ max-height:40vh; overflow:auto; }

/* ── toast ── */
.toasts{ position:fixed; left:50%; bottom:34px; transform:translateX(-50%); z-index:var(--z-toast);
  display:flex; flex-direction:column; gap:8px; align-items:center; pointer-events:none; }
.toast{ display:flex; align-items:center; gap:10px; padding:9px 14px; border-radius:var(--r);
  background:var(--panel-2); border:1px solid var(--border); box-shadow:0 8px 24px -8px rgba(0,0,0,.5);
  font-size:var(--t-sm); pointer-events:auto; animation:rise .18s var(--ease); }
.toast .accent{ color:var(--accent); }
.toast.good{ border-color:color-mix(in oklab,var(--good) 45%,var(--border)); }
.toast.bad{ border-color:color-mix(in oklab,var(--danger) 50%,var(--border)); }
.toast button{ color:var(--accent-ink); font-weight:600; }

.spin{ width:13px; height:13px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%;
  display:inline-block; animation:rot .7s linear infinite; }
@keyframes rot{ to{ transform:rotate(360deg); } }

/* responsive: collapse rails */
@media (max-width: 860px){ .shell{ grid-template-columns: var(--lw,230px) 1fr; } .right{ display:none !important; } }
@media (max-width: 620px){ .shell{ grid-template-columns: 1fr; } .left{ display:none !important; }
  .cmdk span{ display:none; } .topbar .vault, .topbar .scope{ display:none; } }

@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{ animation-duration:.001ms !important; transition-duration:.001ms !important; }
  .skel{ animation:none; background:var(--hover); }
}
`;

/* ─────────────────────────── HTML skeleton ──────────────────────────── */

const ICON_CHEV = '<svg class="chev" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const SHELL = `
<div class="topbar">
  <span class="brand"><span class="glyph">◆</span> Minime Wiki</span>
  <span class="vault" id="vault"></span>
  <span class="scope" id="scope">all repositories</span>
  <button class="scopebtn" id="scope-toggle" title="Toggle scope">Use current repo</button>
  <span class="grow"></span>
  <button class="cmdk" id="open-palette" title="Command palette"><span>Search & commands</span><kbd>⌘K</kbd></button>
  <button class="iconbtn" id="t-left" title="Toggle file explorer (⌘B)" aria-pressed="true" aria-label="Toggle file explorer">▥</button>
  <button class="iconbtn" id="t-right" title="Toggle right sidebar (⌘\\)" aria-pressed="true" aria-label="Toggle right sidebar">▤</button>
  <button class="iconbtn" id="t-help" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
</div>

<div class="shell" id="shell" data-left="1" data-right="1">
  <aside class="pane left" aria-label="Files">
    <div class="leftnav" role="tablist" aria-label="Explorer view">
      <button class="navtab" id="nav-vault" role="tab" aria-pressed="true">Vault</button>
      <button class="navtab" id="nav-bp" role="tab" aria-pressed="false">Blueprints</button>
    </div>
    <div class="searchwrap">
      <input class="search" id="search" type="search" placeholder="Search the vault…  (/)" autocomplete="off"
             role="searchbox" aria-label="Search the wiki" />
    </div>
    <div class="scroll">
      <div class="results" id="results" hidden role="listbox" aria-label="Search results"></div>
      <div class="tree" id="tree" role="tree" aria-label="Vault files" tabindex="0">
        <div class="skel line w60"></div><div class="skel line w80"></div>
        <div class="skel line w50"></div><div class="skel line w72"></div>
      </div>
    </div>
  </aside>

  <main class="pane center" aria-label="Note">
    <div class="tabs" id="tabs" role="tablist" aria-label="Open notes"></div>
    <div class="cbar">
      <span class="crumb" id="crumb">No note open</span>
      <span class="grow"></span>
      <div class="modebtn" role="group" aria-label="View mode">
        <button id="m-read" aria-pressed="true">Read</button>
        <button id="m-edit" aria-pressed="false">Edit</button>
      </div>
    </div>
    <div class="note" id="note"></div>
    <div class="status">
      <span id="st-path" class="grow">Ready</span>
      <span id="st-mode"></span>
      <span id="st-dirty"></span>
      <span id="st-words"></span>
      <span id="st-docs"></span>
    </div>
  </main>

  <aside class="pane right" aria-label="Details">
    <div class="scroll pad0">
      <details class="sect" id="s-outline" open><summary>${ICON_CHEV}Outline</summary><div class="body outline" id="outline"><span class="muted">—</span></div></details>
      <details class="sect" id="s-props" open><summary>${ICON_CHEV}Properties</summary><div class="body" id="props-panel"><span class="muted">Open a note to edit its properties.</span></div></details>
      <details class="sect" id="s-tools" open><summary>${ICON_CHEV}AI tools</summary><div class="body" id="tools">
        <button class="toolbtn" id="ai-derive">⊹ Derive rules from repo <kbd class="k">⌘⏎</kbd></button>
        <button class="toolbtn" id="ai-rate">★ Suggest rating</button>
        <button class="toolbtn" id="ai-ask">? Ask the wiki…</button>
      </div></details>
      <details class="sect" id="s-maint"><summary>${ICON_CHEV}Maintenance<span class="count" id="maint-count"></span></summary><div class="body" id="maint"><span class="muted">—</span></div></details>
      <details class="sect" id="s-dups"><summary>${ICON_CHEV}Duplicates<span class="count" id="dups-count"></span></summary><div class="body" id="dups"><span class="muted">—</span></div></details>
    </div>
  </aside>
</div>

<dialog id="palette"></dialog>
<dialog id="modal"></dialog>
<dialog id="help"></dialog>
<div class="toasts" id="toasts" aria-live="polite"></div>
`;

/* ─────────────────────────── client runtime ─────────────────────────── */
// Serialized via .toString() into the page. Browser-only; no Node imports.

function clientMain() {
    const CFG = window.__CFG__;
    const $ = (id) => document.getElementById(id);
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);
    const CHEV = '<svg class="chev" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const addNonce = (p) => p + (p.includes("?") ? "&" : "?") + "nonce=" + encodeURIComponent(CFG.nonce);
    function errFromResponse(response, body) {
        const error = new Error(body?.error || response.statusText);
        error.status = response.status;
        error.code = body?.code;
        error.payload = body;
        return error;
    }
    const api = {
        async get(p) {
            const r = await fetch(addNonce(p), {
                headers: { "x-minime-nonce": CFG.nonce },
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw errFromResponse(r, j);
            return j;
        },
        async post(p, b) {
            const payload = { ...(b || {}), nonce: CFG.nonce };
            const r = await fetch(addNonce(p), {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-minime-nonce": CFG.nonce,
                },
                body: JSON.stringify(payload),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw errFromResponse(r, j);
            return j;
        },
    };

    const S = {
        root: CFG.root, files: [], flat: [], docCount: 0,
        expanded: new Set(["wiki", "wiki/orgs"]),
        tabs: [], active: null, mode: "read",
        articles: new Map(), buffers: new Map(),
        treeFocus: null, visibleRows: [],
        stats: null, headings: [],
        view: "vault", blueprints: [], bpFiles: [], bpByPath: new Map(), bpLoaded: false,
        scope: CFG.scope || "all",
        currentRepository: CFG.currentRepository || null,
        selectedPath: CFG.selectedPath || null,
        draftSessionKey: CFG.draftSessionKey || "",
        draftTimers: new Map(),
        openedInitial: false,
    };
    const isBlueprint = (p) => /(^|\/)_[^/]+\/blueprints\//.test(String(p || ""));
    function currentNodes() { return S.view === "blueprints" ? S.bpFiles : S.files; }

    /* ── toast ── */
    function toast(msg, { kind = "", action, timeout = 3200 } = {}) {
        const t = el("div", "toast " + kind);
        t.innerHTML = '<span class="accent">●</span><span>' + esc(msg) + "</span>";
        if (action) { const b = el("button", null, action.label); b.onclick = () => { action.fn(); t.remove(); }; t.appendChild(b); }
        $("toasts").appendChild(t);
        const kill = () => t.remove();
        if (timeout) setTimeout(kill, timeout);
        return kill;
    }

    /* ── status bar ── */
    function setStatus() {
        $("st-docs").textContent = S.docCount ? S.docCount + " notes" : "";
        $("st-mode").textContent = S.active ? S.mode.toUpperCase() : "";
        const buf = S.active && S.buffers.get(S.active);
        const dirty = Boolean(buf && buf.dirty);
        if (!S.active) {
            $("st-dirty").textContent = "";
        } else if (buf?.readOnly) {
            $("st-dirty").textContent = "read-only";
        } else if (dirty && buf?.draftSavedAt) {
            $("st-dirty").textContent = "● draft saved";
        } else if (dirty) {
            $("st-dirty").textContent = "● unsaved";
        } else {
            $("st-dirty").textContent = "saved";
        }
        $("st-dirty").className = dirty ? "dirty-on" : "saved";
        $("st-path").textContent = S.active || "Ready";
        if (S.active && buf) {
            const words = buf.markdown.trim().split(/\s+/).filter(Boolean).length;
            $("st-words").textContent = words + " words";
        } else $("st-words").textContent = "";
    }

    function renderScope() {
        const hasPreset = Boolean(S.currentRepository?.org && S.currentRepository?.repo);
        const scope = $("scope");
        const button = $("scope-toggle");
        if (!hasPreset) {
            scope.textContent = "all repositories";
            button.disabled = true;
            button.textContent = "No repo preset";
            return;
        }
        if (S.scope === "current") {
            scope.textContent = `${S.currentRepository.org}/${S.currentRepository.repo} + patterns`;
            button.disabled = false;
            button.textContent = "Show all";
        } else {
            scope.textContent = "all repositories";
            button.disabled = false;
            button.textContent = "Use current repo";
        }
    }

    /* ── tree ── */
    function walkFlat(nodes, acc) { for (const n of nodes) { if (n.type === "file") acc.push(n); else walkFlat(n.children, acc); } return acc; }

    async function loadTree() {
        const data = await api.get("/api/tree");
        S.root = data.root; S.files = data.files; S.flat = walkFlat(data.files, []);
        S.docCount = data.counts ? data.counts.total : S.flat.length;
        S.scope = data.scope || S.scope;
        S.currentRepository = data.currentRepository || null;
        if (data.selectedPath) S.selectedPath = data.selectedPath;
        $("vault").textContent = data.root;
        renderScope();
        renderTree();
        setStatus();
        if (!S.openedInitial) {
            S.openedInitial = true;
            if (S.selectedPath) void openFile(S.selectedPath);
        }
    }

    async function loadBlueprints() {
        const data = await api.get("/api/blueprints");
        S.blueprints = data.items || [];
        S.bpFiles = data.files || [];
        S.bpByPath = new Map(S.blueprints.map((b) => [b.relPath, b]));
        S.bpLoaded = true;
    }

    function setView(v) {
        if (S.view === v) return;
        S.view = v;
        $("nav-vault").setAttribute("aria-pressed", v === "vault" ? "true" : "false");
        $("nav-bp").setAttribute("aria-pressed", v === "blueprints" ? "true" : "false");
        $("search").placeholder = v === "blueprints" ? "Search blueprints…  (/)" : "Search the vault…  (/)";
        $("search").value = ""; $("results").hidden = true; $("tree").hidden = false;
        S.treeFocus = null;
        const go = () => renderTree();
        if (v === "blueprints" && !S.bpLoaded) loadBlueprints().then(go).catch((e) => toast(e.message, { kind: "bad" }));
        else go();
    }

    async function toggleScope() {
        try {
            const mode = S.scope === "current" ? "all" : "current";
            const data = await api.post("/api/scope", { mode });
            S.scope = data.scope || mode;
            S.currentRepository = data.currentRepository || S.currentRepository;
            S.files = data.files || S.files;
            S.flat = walkFlat(S.files, []);
            S.docCount = data.counts ? data.counts.total : S.flat.length;
            renderScope();
            renderTree();
            setStatus();
            loadStats();
            toast(S.scope === "current" ? "Current repo scope enabled" : "Showing all repositories", { kind: "good" });
        } catch (error) {
            toast(error.message, { kind: "bad" });
        }
    }

    function renderTree() {
        const host = $("tree"); host.innerHTML = ""; S.visibleRows = [];
        const build = (nodes, depth, container) => {
            for (const n of nodes) {
                const row = el("div", "trow " + (n.type === "dir" ? "dir" : "file"));
                row.style.paddingLeft = (6 + depth * 13) + "px";
                row.setAttribute("role", "treeitem");
                row.dataset.path = n.path; row.dataset.type = n.type;
                row.tabIndex = -1;
                if (n.type === "dir") {
                    const open = S.expanded.has(n.path);
                    row.setAttribute("aria-expanded", open ? "true" : "false");
                    row.innerHTML = CHEV;
                    row.appendChild(el("span", "lbl", n.name));
                    row.onclick = () => { toggleDir(n.path); focusRow(n.path); };
                    host.appendChild(row); S.visibleRows.push(row);
                    if (open) { const kids = el("div"); kids.setAttribute("role", "group"); build(n.children, depth + 1, kids); host.appendChild(kids); }
                } else {
                    row.setAttribute("aria-selected", S.active === n.path ? "true" : "false");
                    row.appendChild(el("span", "spacer")).style.width = "12px";
                    row.appendChild(el("span", "dot " + (n.area || "")));
                    row.appendChild(el("span", "lbl", n.name.replace(/\.(blueprint\.)?md$/, "")));
                    const bp = S.bpByPath.get(n.path);
                    if (bp) {
                        const meta = el("span", "bpmeta");
                        if (bp.created) meta.appendChild(el("span", "bpdate", bp.created.slice(5)));
                        if (bp.status) meta.appendChild(el("span", "bpstatus " + bp.status.toLowerCase().replace(/[^a-z]/g, ""), bp.status));
                        row.appendChild(meta);
                    }
                    row.onclick = () => { focusRow(n.path); openFile(n.path); };
                    host.appendChild(row); S.visibleRows.push(row);
                }
            }
        };
        build(currentNodes(), 0, host);
        setRovingTab();
    }
    function setRovingTab() {
        const focusPath = S.treeFocus || (S.visibleRows[0] && S.visibleRows[0].dataset.path);
        S.treeFocus = focusPath;
        for (const r of S.visibleRows) r.tabIndex = (r.dataset.path === focusPath ? 0 : -1);
    }
    function focusRow(path, doFocus) {
        S.treeFocus = path; setRovingTab();
        const r = S.visibleRows.find((x) => x.dataset.path === path);
        if (r && doFocus) r.focus();
        if (r) r.scrollIntoView({ block: "nearest" });
    }
    function toggleDir(path) { if (S.expanded.has(path)) S.expanded.delete(path); else S.expanded.add(path); renderTree(); }
    function expandAncestors(path) { const segs = path.split("/"); let acc = ""; for (let i = 0; i < segs.length - 1; i++) { acc = acc ? acc + "/" + segs[i] : segs[i]; S.expanded.add(acc); } }

    function treeKey(e) {
        const rows = S.visibleRows; if (!rows.length) return;
        const activeRow = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".trow") : null;
        let i = activeRow ? rows.indexOf(activeRow) : rows.findIndex((r) => r.dataset.path === S.treeFocus);
        if (i < 0) i = 0;
        const cur = rows[i]; const path = cur.dataset.path; const type = cur.dataset.type;
        S.treeFocus = path;
        const move = (j) => { j = Math.max(0, Math.min(rows.length - 1, j)); focusRow(rows[j].dataset.path, true); };
        switch (e.key) {
            case "ArrowDown": e.preventDefault(); move(i + 1); break;
            case "ArrowUp": e.preventDefault(); move(i - 1); break;
            case "Home": e.preventDefault(); move(0); break;
            case "End": e.preventDefault(); move(rows.length - 1); break;
            case "ArrowRight": e.preventDefault();
                if (type === "dir") { if (!S.expanded.has(path)) { toggleDir(path); focusRow(path, true); } else move(i + 1); }
                break;
            case "ArrowLeft": e.preventDefault();
                if (type === "dir" && S.expanded.has(path)) { toggleDir(path); focusRow(path, true); }
                else { const parent = path.split("/").slice(0, -1).join("/"); if (parent) focusRow(parent, true); }
                break;
            case "Enter": case " ": e.preventDefault();
                if (type === "dir") { toggleDir(path); focusRow(path, true); } else openFile(path);
                break;
        }
    }

    /* ── search ── */
    let searchT = null;
    function onSearch(v) {
        clearTimeout(searchT); const q = v.trim();
        if (!q) { $("results").hidden = true; $("tree").hidden = false; return; }
        searchT = setTimeout(() => runSearch(q), 160);
    }
    async function runSearch(q) {
        const box = $("results"), tree = $("tree");
        tree.hidden = true; box.hidden = false;
        const render = (items) => {
            box.innerHTML = "";
            if (!items.length) { box.innerHTML = '<div class="pempty">No matches for “' + esc(q) + '”.</div>'; return; }
            items.forEach((h, idx) => {
                const hit = el("div", "hit"); hit.setAttribute("role", "option"); hit.tabIndex = -1;
                hit.setAttribute("aria-selected", idx === 0 ? "true" : "false");
                hit.innerHTML = '<div class="t"><span class="badge ' + esc(h.area) + '">' + esc(h.area) + '</span><b>' + esc(h.title) + "</b></div>" +
                    '<div class="p">' + esc(h.relPath) + '</div>' + (h.snippet ? '<div class="s">' + esc(h.snippet) + "</div>" : "");
                hit.onclick = () => openFile(h.relPath);
                box.appendChild(hit);
            });
        };
        if (S.view === "blueprints") {
            const ql = q.toLowerCase();
            const items = S.blueprints
                .filter((b) => (b.name + " " + (b.title || "") + " " + (b.status || "") + " " + b.org + " " + b.repo).toLowerCase().includes(ql))
                .sort((a, b) => (b.created || "").localeCompare(a.created || ""))
                .slice(0, 40)
                .map((b) => ({ relPath: b.relPath, area: "blueprint", title: b.title || b.name, snippet: [b.org + "/" + b.repo, b.status, b.created].filter(Boolean).join(" · ") }));
            render(items);
            return;
        }
        box.innerHTML = '<div class="skel line w90"></div><div class="skel line w70"></div>';
        try { render(await api.get("/api/search?q=" + encodeURIComponent(q))); }
        catch (e) { box.innerHTML = '<div class="pempty">' + esc(e.message) + "</div>"; }
    }

    /* ── tabs + open ── */
    const baseName = (p) => p.split("/").pop().replace(/\.(blueprint\.)?md$/, "");
    function isWritableArticle(article) {
        return Boolean(article && article.writable && !article.readOnly);
    }
    function articleBaseRevision(article) {
        if (article?.draft && Object.prototype.hasOwnProperty.call(article.draft, "baseRevision")) {
            return article.draft.baseRevision;
        }
        return article?.revision ?? null;
    }
    function bufferBaseRevision(buf) {
        if (!buf) return null;
        if (Object.prototype.hasOwnProperty.call(buf, "baseRevision")) return buf.baseRevision;
        return buf.revision ?? null;
    }
    function syncBufferFromArticle(path, article) {
        const existing = S.buffers.get(path);
        const applied = article.appliedMarkdown ?? article.markdown;
        const markdown = article.markdown;
        const readOnly = !isWritableArticle(article);
        const incomingBaseRevision = articleBaseRevision(article);
        const incomingDraftRevision = article.draft?.revision ?? null;
        const next = existing ? { ...existing } : {};
        next.readOnly = readOnly;
        next.appliedRevision = article.revision ?? next.appliedRevision ?? null;
        if (!existing || !existing.dirty || existing.markdown === existing.original) {
            next.markdown = markdown;
            next.baseRevision = incomingBaseRevision;
            next.revision = incomingBaseRevision;
            next.original = applied;
            next.dirty = markdown !== applied;
            next.draftRevision = incomingDraftRevision;
            next.draftSavedAt = article.draft?.updatedAt || null;
            next.generation = existing?.generation || 0;
        } else {
            next.markdown = existing.markdown;
            next.baseRevision = existing.baseRevision ?? existing.revision ?? incomingBaseRevision;
            next.revision = next.baseRevision;
            next.original = existing.original ?? applied;
            next.dirty = existing.dirty;
            next.draftRevision = existing.draftRevision ?? incomingDraftRevision;
            next.draftSavedAt = existing.draftSavedAt ?? (article.draft?.updatedAt ?? null);
            next.generation = existing.generation || 0;
        }
        S.buffers.set(path, next);
    }
    function clearDraftTimer(path) {
        const timer = S.draftTimers.get(path);
        if (timer) clearTimeout(timer);
        S.draftTimers.delete(path);
    }
    function scheduleDraftSave(path) {
        const buf = S.buffers.get(path);
        if (!buf || !buf.dirty || buf.readOnly) return;
        clearDraftTimer(path);
        const timer = setTimeout(async () => {
            const live = S.buffers.get(path);
            if (!live || !live.dirty || live.readOnly) return;
            const submittedContent = live.markdown;
            const submittedBaseRevision = bufferBaseRevision(live);
            const submittedDraftRevision = live.draftRevision;
            const submittedGeneration = live.generation || 0;
            try {
                const out = await api.post("/api/draft", {
                    path,
                    content: submittedContent,
                    baseRevision: submittedBaseRevision,
                    expectedDraftRevision: submittedDraftRevision,
                    draftSessionKey: S.draftSessionKey,
                });
                const latest = S.buffers.get(path);
                if (!latest) return;
                latest.draftRevision = out?.draft?.revision || latest.draftRevision || null;
                if ((latest.generation || 0) !== submittedGeneration || latest.markdown !== submittedContent) {
                    if (latest.dirty) scheduleDraftSave(path);
                    return;
                }
                latest.draftSavedAt = out?.draft?.updatedAt || new Date().toISOString();
                setStatus();
            } catch (error) {
                const latest = S.buffers.get(path);
                if (!latest?.dirty) return;
                latest.draftSavedAt = null;
                setStatus();
                toast("Draft save failed: " + (error?.message || String(error)), { kind: "bad" });
            }
        }, 300);
        S.draftTimers.set(path, timer);
    }

    async function openFile(path) {
        if (isBlueprint(path)) {
            if (!S.bpLoaded) { try { await loadBlueprints(); } catch { /* ignore */ } }
            if (S.view !== "blueprints") { S.view = "blueprints"; $("nav-vault").setAttribute("aria-pressed", "false"); $("nav-bp").setAttribute("aria-pressed", "true"); $("search").placeholder = "Search blueprints…  (/)"; }
        }
        if (!S.tabs.includes(path)) S.tabs.push(path);
        S.active = path; S.mode = "read";
        S.selectedPath = path;
        expandAncestors(path);
        renderTabs(); renderTree();
        $("crumb").textContent = path;
        $("note").innerHTML = '<div class="reading"><div class="skel line w50 h22"></div><div class="skel line w90"></div><div class="skel line w80"></div><div class="skel line w86"></div></div>';
        try {
            const art = await api.get("/api/article?path=" + encodeURIComponent(path));
            S.articles.set(path, art);
            if (!S.tabs.includes(path)) return;
            syncBufferFromArticle(path, art);
            if (S.active !== path) return;
            renderNote(); renderRight(art); setMode("read", true);
        } catch (e) { if (S.active === path) $("note").innerHTML = '<div class="empty"><h2>Could not open</h2><p>' + esc(e.message) + "</p></div>"; }
        setStatus();
    }
    async function refreshArticle(path) {
        const art = await api.get("/api/article?path=" + encodeURIComponent(path));
        S.articles.set(path, art);
        if (!S.buffers.has(path)) return;
        syncBufferFromArticle(path, art);
        renderTabs();
        if (S.active === path) {
            renderRight(art);
            if (S.mode === "edit") {
                const editor = $("note").querySelector("textarea.editor");
                const value = S.buffers.get(path).markdown;
                if (editor && editor.value !== value) {
                    const start = editor.selectionStart;
                    const end = editor.selectionEnd;
                    editor.value = value;
                    editor.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
                }
            } else renderNote();
        }
        setStatus();
    }
    function renderTabs() {
        const host = $("tabs"); host.innerHTML = "";
        if (!S.tabs.length) return;
        for (const path of S.tabs) {
            const buf = S.buffers.get(path);
            const tab = el("div", "tab"); tab.setAttribute("role", "tab"); tab.tabIndex = -1;
            tab.setAttribute("aria-selected", S.active === path ? "true" : "false");
            const dirty = el("span", "dirty"); dirty.hidden = !(buf && buf.dirty);
            tab.appendChild(dirty);
            tab.appendChild(el("span", "name", baseName(path)));
            const x = el("span", "x", "×"); x.title = "Close (⌘W)";
            x.onclick = (e) => { e.stopPropagation(); closeTab(path); };
            tab.appendChild(x);
            tab.onclick = () => { if (S.active !== path) { S.active = path; S.mode = "read"; openActive(); } };
            host.appendChild(tab);
        }
    }
    function openActive() { const p = S.active; if (p) { S.articles.has(p) ? (renderTabs(), renderTree(), $("crumb").textContent = p, renderNote(), renderRight(S.articles.get(p)), setMode("read", true), setStatus()) : openFile(p); } }

    async function closeTab(path) {
        const buf = S.buffers.get(path);
        if (buf && buf.dirty) {
            const ok = await confirmDialog("Discard unsaved changes?", esc(path) + " has unsaved edits.", "Discard");
            if (!ok) return;
        }
        clearDraftTimer(path);
        const idx = S.tabs.indexOf(path);
        S.tabs = S.tabs.filter((p) => p !== path);
        S.buffers.delete(path); S.articles.delete(path);
        if (S.active === path) {
            S.active = S.tabs[Math.max(0, idx - 1)] || null;
            if (S.active) { S.mode = "read"; openActive(); }
            else { $("note").innerHTML = ""; renderEmpty(); $("crumb").textContent = "No note open"; renderTabs(); renderTree(); }
        } else renderTabs();
        setStatus();
    }

    /* ── note pane ── */
    function setMode(m, force) {
        if (!S.active) return;
        const buf = S.buffers.get(S.active);
        if (m === "edit" && buf?.readOnly) {
            toast("This note is read-only in wiki canvas", { kind: "bad" });
            return;
        }
        if (!force && S.mode === m) return;
        S.mode = m;
        $("m-read").setAttribute("aria-pressed", m === "read" ? "true" : "false");
        $("m-edit").setAttribute("aria-pressed", m === "edit" ? "true" : "false");
        renderNote(); setStatus();
    }
    function renderNote() {
        if (!S.active) { renderEmpty(); return; }
        const note = $("note");
        const art = S.articles.get(S.active);
        const buf = S.buffers.get(S.active);
        if (S.mode === "edit") {
            note.innerHTML = "";
            const activePath = S.active;
            const ta = el("textarea", "editor"); ta.value = buf.markdown; ta.spellcheck = false;
            ta.setAttribute("aria-label", "Edit " + activePath);
            ta.addEventListener("input", () => {
                const current = S.buffers.get(activePath);
                if (!current) {
                    toast("This note is no longer open.", { kind: "bad" });
                    return;
                }
                current.markdown = ta.value;
                current.dirty = (current.markdown !== current.original);
                current.draftSavedAt = null;
                current.generation = (current.generation || 0) + 1;
                renderTabs();
                setStatus();
                scheduleDraftSave(activePath);
            });
            note.appendChild(ta); ta.focus();
        } else {
            const wrap = el("div", "reading");
            wrap.appendChild(art.blueprint ? buildBlueprintProps(art.blueprint) : buildProps(art.meta));
            const doc = el("div", "doc"); doc.innerHTML = art.html; wrap.appendChild(doc);
            note.innerHTML = ""; note.appendChild(wrap);
            assignHeadingIds(doc); buildOutline(doc);
        }
    }
    function buildProps(meta) {
        const rows = [["Path", S.active, true], ["Scope", meta.scope], ["Status", meta.status], ["Confidence", meta.confidence], ["ValueScore", meta.valueScore], ["LastVerified", meta.lastVerified]];
        return propsBox(rows);
    }
    function buildBlueprintProps(bp) {
        const rows = [["Path", S.active, true], ["Repo", bp.repo], ["Created", bp.created], ["Status", bp.status]];
        if (bp.acTotal) rows.push(["Criteria", bp.acDone + " / " + bp.acTotal + " met"]);
        return propsBox(rows);
    }
    function propsBox(rows) {
        const box = el("div", "props");
        for (const [k, v, mono] of rows) {
            if (!v) continue;
            const r = el("div", "prow");
            r.appendChild(el("div", "k", k));
            const vd = el("div", "v"); if (mono) { vd.appendChild(el("code", null, v)); } else vd.textContent = v;
            r.appendChild(vd); box.appendChild(r);
        }
        return box;
    }
    function assignHeadingIds(doc) {
        const seen = {};
        doc.querySelectorAll("h1,h2,h3").forEach((h) => {
            let slug = (h.textContent || "h").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "h";
            if (seen[slug]) slug += "-" + (++seen[slug]); else seen[slug] = 1;
            h.id = slug;
        });
    }
    function buildOutline(doc) {
        const out = $("outline"); out.innerHTML = ""; S.headings = [];
        const hs = doc.querySelectorAll("h1,h2,h3");
        if (!hs.length) { out.innerHTML = '<span class="muted">No headings</span>'; return; }
        hs.forEach((h) => {
            S.headings.push({ id: h.id, text: h.textContent, level: h.tagName });
            const a = el("a", h.tagName === "H3" ? "h3" : "", h.textContent);
            a.href = "#" + h.id;
            a.onclick = (e) => { e.preventDefault(); h.scrollIntoView({ behavior: "smooth", block: "start" }); };
            out.appendChild(a);
        });
    }
    function renderEmpty() {
        $("note").innerHTML =
            '<div class="empty"><div class="glyphmark">◆</div>' +
            '<h2>Open a note to begin</h2>' +
            '<div class="keys">' +
            '<div><span>Command palette</span><kbd>⌘K</kbd></div>' +
            '<div><span>Quick switch file</span><kbd>⌘O</kbd></div>' +
            '<div><span>Search the vault</span><kbd>/</kbd></div>' +
            '<div><span>Toggle read / edit</span><kbd>⌘E</kbd></div>' +
            "</div></div>";
        $("outline").innerHTML = '<span class="muted">—</span>';
        $("props-panel").innerHTML = '<span class="muted">Open a note to edit its properties.</span>';
    }

    async function saveActive() {
        const path = S.active;
        if (!path) return;
        const buf = S.buffers.get(path);
        if (!buf || !buf.dirty) { toast("Nothing to save"); return; }
        if (buf.readOnly) { toast("This note is read-only", { kind: "bad" }); return; }
        const submitted = {
            path,
            content: buf.markdown,
            expectedRevision: bufferBaseRevision(buf),
            draftRevision: buf.draftRevision,
            generation: buf.generation || 0,
        };
        try {
            const out = await api.post("/api/apply", {
                path: submitted.path,
                content: submitted.content,
                expectedRevision: submitted.expectedRevision,
                draftSessionKey: S.draftSessionKey,
                draft: {
                    content: submitted.content,
                    baseRevision: submitted.expectedRevision,
                    revision: submitted.draftRevision,
                    updatedAt: new Date().toISOString(),
                },
            });
            const live = S.buffers.get(submitted.path);
            if (!live) return;
            if (out.revision) {
                live.baseRevision = out.revision;
                live.revision = out.revision;
            }
            live.original = submitted.content;
            live.draftSavedAt = null;
            live.draftRevision = null;
            const changedAfterSubmit = (live.generation || 0) !== submitted.generation || live.markdown !== submitted.content;
            if (!changedAfterSubmit) {
                live.markdown = submitted.content;
                live.dirty = false;
            } else {
                live.dirty = live.markdown !== live.original;
            }
            await refreshArticle(submitted.path);
            toast("Saved " + submitted.path.split("/").pop(), { kind: "good" });
        } catch (e) {
            const conflict = e.status === 409 || e.code === "conflict";
            if (conflict) {
                toast("Save conflict. Your draft was kept.", { kind: "bad", timeout: 6000 });
            } else {
                toast(e.message, { kind: "bad", timeout: 5000 });
            }
        }
    }

    /* ── right rail: properties(rate) + stats + dups ── */
    function renderRight(art) {
        const host = $("props-panel"); host.innerHTML = "";
        if (art.blueprint) { renderBlueprintRail(host, art.blueprint); return; }
        if (!isWritableArticle(art)) {
            host.innerHTML = '<span class="muted">This note is read-only.</span>';
            return;
        }
        const m = art.meta;
        const sel = (id, label, opts, val) => {
            const f = el("div", "field"); f.appendChild(el("label", null, label));
            const s = el("select", "ctl"); s.id = id;
            s.appendChild(new Option("—", ""));
            for (const o of opts) { const op = new Option(o, o); if (o === val) op.selected = true; s.appendChild(op); }
            f.appendChild(s); return f;
        };
        const inp = (id, label, val, ph) => {
            const f = el("div", "field"); f.appendChild(el("label", null, label));
            const i = el("input", "ctl"); i.id = id; i.value = val || ""; if (ph) i.placeholder = ph;
            f.appendChild(i); return f;
        };
        host.appendChild(inp("r-score", "ValueScore", m.valueScore, "0–8"));
        host.appendChild(sel("r-conf", "Confidence", ["high", "medium", "low"], m.confidence));
        host.appendChild(sel("r-status", "Status", ["active", "stale", "superseded"], m.status));
        host.appendChild(inp("r-date", "LastVerified", m.lastVerified, "YYYY-MM-DD"));
        const b = el("button", "btn primary block", "Apply properties"); b.onclick = applyRate;
        host.appendChild(b);
    }
    function renderBlueprintRail(host, bp) {
        if (bp.acTotal) {
            const w = el("div", "acwrap");
            const lab = el("div", "lab"); lab.appendChild(el("span", null, "Acceptance criteria")); lab.appendChild(el("span", null, bp.acDone + " / " + bp.acTotal));
            w.appendChild(lab);
            const bar = el("div", "acbar"); const i = el("i"); i.style.width = Math.round(100 * bp.acDone / bp.acTotal) + "%"; bar.appendChild(i);
            w.appendChild(bar); host.appendChild(w);
        }
        const meta = [["Repo", bp.repo], ["Created", bp.created], ["Status", bp.status]];
        const box = el("div", "props"); box.style.marginBottom = "10px";
        for (const [k, v] of meta) { if (!v) continue; const r = el("div", "prow"); r.appendChild(el("div", "k", k)); r.appendChild(el("div", "v", v)); box.appendChild(r); }
        host.appendChild(box);
        if (bp.goal) { const g = el("div", "bpgoal", bp.goal); host.appendChild(g); }
        const open = el("button", "btn primary block", "Open in blueprint canvas");
        open.onclick = openBlueprintCanvas;
        host.appendChild(open);
    }
    async function openBlueprintCanvas() {
        if (!S.active || !isBlueprint(S.active)) return;
        try {
            const out = await api.post("/api/open-blueprint", { path: S.active });
            if (out.opened) toast("Opened blueprint canvas", { kind: "good" });
            else if (out.delegated) toast(out.message || "Requested blueprint open in chat", { kind: "good", timeout: 5000 });
            else toast("Blueprint canvas unavailable", { kind: "bad", timeout: 5000 });
        } catch (error) {
            toast(error.message, { kind: "bad", timeout: 5000 });
        }
    }
    async function applyRate() {
        const path = S.active;
        if (!path) return;
        const buf = S.buffers.get(path);
        if (!buf || buf.readOnly) { toast("This note is read-only", { kind: "bad" }); return; }
        const fields = { valueScore: $("r-score").value.trim(), confidence: $("r-conf").value, status: $("r-status").value, lastVerified: $("r-date").value.trim() };
        const baseRevision = bufferBaseRevision(buf);
        try {
            await api.post("/api/rate", {
                path,
                fields,
                expectedRevision: baseRevision,
                draftSessionKey: S.draftSessionKey,
                draft: buf.dirty ? {
                    content: buf.markdown,
                    baseRevision,
                    revision: buf.draftRevision,
                    updatedAt: new Date().toISOString(),
                } : null,
            });
            const art = await api.get("/api/article?path=" + encodeURIComponent(path));
            S.articles.set(path, art);
            syncBufferFromArticle(path, art);
            if (S.active === path) {
                renderNote();
                renderRight(art);
            }
            setStatus();
            toast("Properties applied", { kind: "good" });
        } catch (e) {
            if (e.status === 409 || e.code === "conflict") toast("Properties conflict. Draft kept.", { kind: "bad", timeout: 6000 });
            else toast(e.message, { kind: "bad" });
        }
    }

    async function loadStats() {
        try {
            const s = await api.get("/api/stats"); S.stats = s;
            $("maint-count").textContent = (s.stale.length + s.lowConfidence.length) || "";
            $("dups-count").textContent = s.duplicates.length || "";
            const m = $("maint"); m.innerHTML = "";
            const line = (k, v) => { const r = el("div", "statline"); r.appendChild(el("span", "muted", k)); r.appendChild(el("b", null, String(v))); return r; };
            m.appendChild(line("Total notes", s.total));
            m.appendChild(line("Wiki", s.byArea.wiki || 0));
            m.appendChild(line("Patterns", s.byArea.pattern || 0));
            m.appendChild(line("Raw sources", s.byArea.raw || 0));
            m.appendChild(line("Stale (>120d)", s.stale.length));
            m.appendChild(line("Low confidence", s.lowConfidence.length));
            const links = s.stale.slice(0, 6).concat(s.lowConfidence.slice(0, 6));
            if (links.length) { const h = el("div"); h.style.marginTop = "8px"; for (const it of links) { const a = el("div", "linkrow", it.relPath.replace(/^wiki\//, "")); a.title = it.relPath; a.onclick = () => openFile(it.relPath); h.appendChild(a); } m.appendChild(h); }
            const d = $("dups"); d.innerHTML = "";
            if (!s.duplicates.length) d.innerHTML = '<span class="muted">None detected</span>';
            else for (const dup of s.duplicates.slice(0, 12)) {
                const row = el("div", "dup");
                row.appendChild(el("span", "badge", String(dup.score)));
                const c = el("code", null, dup.a.replace(/^wiki\/orgs\//, "").replace(/\.md$/, "")); c.title = dup.a + "  ⇄  " + dup.b; row.appendChild(c);
                const b = el("button", "btn", "merge"); b.style.cssText = "height:22px;padding:0 8px;font-size:11px"; b.onclick = () => llmMerge(dup.a, dup.b);
                row.appendChild(b); d.appendChild(row);
            }
        } catch (e) { $("maint").innerHTML = '<span class="muted">' + esc(e.message) + "</span>"; }
    }

    /* ── LLM tools: hand off to the assistant in the chat ── */
    // The canvas has no out-of-band model; the assistant in the conversation IS
    // the model. These shortcuts post a focused request into the chat (shown with
    // a clean displayPrompt) and surface a toast. The assistant answers there and
    // writes via the canvas actions — the canvas auto-refreshes over SSE.
    async function handOff(op, body, label) {
        try { await api.post("/api/llm", { op, ...body }); toast(label, { kind: "good", timeout: 4500 }); }
        catch (e) { toast(e.message, { kind: "bad", timeout: 6000 }); }
    }
    function llmDerive() {
        if (!S.active) return toast("Open a repo note first");
        const segs = S.active.split("/");
        if (segs[0] !== "wiki" || segs[1] !== "orgs") return toast("Derive needs a wiki/orgs/<org>/<repo> note");
        handOff("derive", { org: segs[2], repo: segs[3] }, "Asked the assistant to derive rules — see the chat ↩");
    }
    function llmMerge(a, b) { handOff("merge", { paths: [a, b] }, "Asked the assistant to merge — see the chat ↩"); }
    function llmRate() {
        if (!S.active) return toast("Open a note first");
        handOff("rate", { path: S.active }, "Asked the assistant for a rating — see the chat ↩");
    }
    async function llmAsk() {
        const q = await promptDialog("Ask the wiki", "What do my notes say about…?");
        if (!q) return;
        handOff("ask", { question: q }, "Asked the assistant — see the chat ↩");
    }


    /* ── dialogs: palette / modal / prompt / confirm ── */
    function trapAndShow(dlg) { dlg.showModal(); }

    function promptDialog(title, ph) {
        return new Promise((resolve) => {
            const dlg = $("modal");
            dlg.innerHTML = '<div class="modal"><header><h3>' + esc(title) + '</h3></header><div class="mbody"><input class="ctl" id="pq" placeholder="' + esc(ph) + '" /></div>' +
                '<div class="mfoot"><button class="btn" id="pq-cancel">Cancel</button><button class="btn primary" id="pq-ok">Ask</button></div></div>';
            const done = (v) => { dlg.close(); resolve(v); };
            $("pq-cancel").onclick = () => done(null);
            $("pq-ok").onclick = () => done($("pq").value.trim());
            $("pq").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done($("pq").value.trim()); } });
            trapAndShow(dlg); $("pq").focus();
        });
    }
    function confirmDialog(title, body, okLabel) {
        return new Promise((resolve) => {
            const dlg = $("modal");
            dlg.innerHTML = '<div class="modal"><header><h3>' + esc(title) + '</h3></header><div class="mbody"><span class="muted">' + body + '</span></div>' +
                '<div class="mfoot"><button class="btn" id="cf-no">Cancel</button><button class="btn primary" id="cf-yes">' + esc(okLabel || "OK") + "</button></div></div>";
            const done = (v) => { dlg.close(); resolve(v); };
            $("cf-no").onclick = () => done(false);
            $("cf-yes").onclick = () => done(true);
            trapAndShow(dlg); $("cf-yes").focus();
        });
    }

    /* ── command palette ── */
    let palItems = [], palSel = 0, palMode = "all";
    function commands() {
        return [
            { id: "edit", title: S.mode === "edit" ? "Switch to Reading view" : "Switch to Editing view", ico: "✎", kbd: "⌘E", run: () => setMode(S.mode === "edit" ? "read" : "edit") },
            { id: "save", title: "Save note", ico: "⤓", kbd: "⌘S", run: saveActive },
            { id: "close", title: "Close current tab", ico: "×", kbd: "⌘W", run: () => S.active && closeTab(S.active) },
            { id: "derive", title: "Derive general rules from repo", ico: "⊹", kbd: "⌘⏎", run: llmDerive },
            { id: "rate", title: "Suggest rating for this note", ico: "★", run: llmRate },
            { id: "ask", title: "Ask the wiki…", ico: "?", run: llmAsk },
            { id: "scope", title: S.scope === "current" ? "Show all repositories" : "Use current repository preset", ico: "◎", run: toggleScope },
            { id: "open-bp", title: "Open current blueprint in flow canvas", ico: "↗", run: openBlueprintCanvas },
            { id: "blueprints", title: "Browse blueprints", ico: "⊟", run: () => setView("blueprints") },
            { id: "vault", title: "Browse vault files", ico: "▤", run: () => setView("vault") },
            { id: "dups", title: "Show duplicate candidates", ico: "⇄", run: () => { $("s-dups").open = true; $("s-dups").scrollIntoView(); } },
            { id: "reload", title: "Reload from disk", ico: "↻", run: () => { S.articles.clear(); S.bpLoaded = false; loadTree(); loadStats(); if (S.view === "blueprints") loadBlueprints().then(renderTree); if (S.active) { S.articles.delete(S.active); openFile(S.active); } toast("Reloaded"); } },
            { id: "left", title: "Toggle file explorer", ico: "▥", kbd: "⌘B", run: () => toggleRail("left") },
            { id: "right", title: "Toggle right sidebar", ico: "▤", kbd: "⌘\\", run: () => toggleRail("right") },
            { id: "help", title: "Keyboard shortcuts", ico: "?", kbd: "?", run: openHelp },
        ];
    }
    function openPalette(mode) {
        palMode = mode || "all"; palSel = 0;
        const dlg = $("palette");
        dlg.innerHTML = '<div class="palette"><input class="pin" id="pin" placeholder="' + (palMode === "files" ? "Jump to a note or blueprint…" : "Type a command or search files…") + '" aria-label="Command palette" /><div class="plist" id="plist" role="listbox"></div></div>';
        const input = $("pin");
        input.addEventListener("input", () => filterPalette(input.value));
        input.addEventListener("keydown", palKey);
        trapAndShow(dlg); filterPalette(""); input.focus();
        if (!S.bpLoaded) loadBlueprints().then(() => { if (dlg.open) filterPalette(input.value); }).catch(() => {});
    }
    function filterPalette(q) {
        const ql = q.toLowerCase().trim();
        const fileItems = S.flat.map((f) => ({ id: "f:" + f.path, title: f.name.replace(/\.md$/, ""), sub: f.path, ico: "◦", run: () => openFile(f.path) }));
        const bpItems = S.blueprints.map((b) => ({ id: "b:" + b.relPath, title: b.title || b.name, sub: b.relPath, ico: "⊟", run: () => openFile(b.relPath) }));
        const files = fileItems.concat(bpItems);
        let pool = palMode === "files" ? files : commands().concat(files);
        if (ql) {
            pool = pool.filter((it) => fuzzy(ql, (it.title + " " + (it.sub || "")).toLowerCase()))
                .sort((a, b) => score(ql, a) - score(ql, b));
        } else if (palMode !== "files") {
            pool = commands().concat(files.slice(0, 6));
        } else pool = files.slice(0, 50);
        palItems = pool.slice(0, 50); palSel = 0; renderPalette();
    }
    function fuzzy(q, t) { let i = 0; for (const c of t) { if (c === q[i]) i++; if (i === q.length) return true; } return q.split(" ").every((w) => t.includes(w)); }
    function score(q, it) { const t = it.title.toLowerCase(); if (t.startsWith(q)) return 0; if (t.includes(q)) return 1; return 2; }
    function renderPalette() {
        const list = $("plist"); if (!list) return; list.innerHTML = "";
        if (!palItems.length) { list.innerHTML = '<div class="pempty">No results</div>'; return; }
        palItems.forEach((it, idx) => {
            const row = el("div", "pitem"); row.setAttribute("role", "option"); row.setAttribute("aria-selected", idx === palSel ? "true" : "false");
            row.innerHTML = '<span class="ico">' + (it.ico || "›") + '</span><span class="ptxt"><div class="ptitle">' + esc(it.title) + "</div>" + (it.sub ? '<div class="psub">' + esc(it.sub) + "</div>" : "") + "</span>" + (it.kbd ? '<kbd class="k">' + it.kbd + "</kbd>" : "");
            row.onmousemove = () => { if (palSel !== idx) { palSel = idx; renderPalette(); } };
            row.onclick = () => runPal(idx);
            list.appendChild(row);
        });
        const sel = list.children[palSel]; if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });
    }
    function palKey(e) {
        if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); renderPalette(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(0, palSel - 1); renderPalette(); }
        else if (e.key === "Enter") { e.preventDefault(); runPal(palSel); }
    }
    function runPal(idx) { const it = palItems[idx]; if (!it) return; $("palette").close(); setTimeout(() => it.run(), 0); }

    /* ── rails + help ── */
    function toggleRail(side) {
        const shell = $("shell"); const cur = shell.dataset[side];
        shell.dataset[side] = cur === "0" ? "1" : "0";
        $(side === "left" ? "t-left" : "t-right").setAttribute("aria-pressed", shell.dataset[side] === "1" ? "true" : "false");
    }
    function openHelp() {
        const dlg = $("help");
        const rows = [
            ["⌘K / ⌘P", "Command palette"], ["⌘O", "Quick-switch file"], ["/", "Focus search"],
            ["⌘E", "Toggle read / edit"], ["⌘S", "Save note"], ["⌘W", "Close tab"],
            ["⌘B", "Toggle file explorer"], ["⌘\\", "Toggle right sidebar"], ["⌘⏎", "Derive rules from repo"],
            ["↑ ↓ ← →", "Navigate the file tree"], ["Enter", "Open file / toggle folder"], ["Esc", "Close overlay"], ["?", "This help"],
        ];
        dlg.innerHTML = '<div class="modal"><header><h3>Keyboard shortcuts</h3></header><div class="mbody"><div class="props m0">' +
            rows.map((r) => '<div class="prow"><div class="k"><kbd>' + r[0] + "</kbd></div><div class=\"v\">" + r[1] + "</div></div>").join("") +
            '</div></div><div class="mfoot"><button class="btn primary" id="h-ok">Close</button></div></div>';
        $("h-ok").onclick = () => dlg.close();
        trapAndShow(dlg); $("h-ok").focus();
    }

    /* ── global keys ── */
    function globalKey(e) {
        if (e.key === "Escape") return; // dialogs handle their own
        const tag = (e.target.tagName || "").toLowerCase();
        const typing = tag === "input" || tag === "textarea" || tag === "select";
        if (mod(e) && (e.key === "k" || e.key === "p")) { e.preventDefault(); openPalette("all"); return; }
        if (mod(e) && e.key === "o") { e.preventDefault(); openPalette("files"); return; }
        if (mod(e) && e.key === "s") { e.preventDefault(); saveActive(); return; }
        if (mod(e) && e.key === "e") { e.preventDefault(); if (S.active) setMode(S.mode === "edit" ? "read" : "edit"); return; }
        if (mod(e) && e.key === "b") { e.preventDefault(); toggleRail("left"); return; }
        if (mod(e) && e.key === "\\") { e.preventDefault(); toggleRail("right"); return; }
        if (mod(e) && e.key === "Enter") { e.preventDefault(); llmDerive(); return; }
        if (mod(e) && (e.key === "w")) { e.preventDefault(); if (S.active) closeTab(S.active); return; }
        if (typing) return;
        if (e.key === "/") { e.preventDefault(); $("search").focus(); $("search").select(); return; }
        if (e.key === "?") { e.preventDefault(); openHelp(); return; }
    }

    /* ── boot ── */
    function bind() {
        $("search").addEventListener("input", (e) => onSearch(e.target.value));
        $("search").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; onSearch(""); e.target.blur(); } if (e.key === "ArrowDown") { e.preventDefault(); const f = $("results").querySelector(".hit"); if (f) f.click(); } });
        $("tree").addEventListener("keydown", treeKey);
        $("open-palette").onclick = () => openPalette("all");
        $("scope-toggle").onclick = toggleScope;
        $("nav-vault").onclick = () => setView("vault");
        $("nav-bp").onclick = () => setView("blueprints");
        $("t-left").onclick = () => toggleRail("left");
        $("t-right").onclick = () => toggleRail("right");
        $("t-help").onclick = openHelp;
        $("m-read").onclick = () => setMode("read");
        $("m-edit").onclick = () => setMode("edit");
        $("ai-derive").onclick = llmDerive;
        $("ai-rate").onclick = llmRate;
        $("ai-ask").onclick = llmAsk;
        document.addEventListener("keydown", globalKey);
        try {
            const ev = new EventSource("/events?nonce=" + encodeURIComponent(CFG.nonce));
            ev.onmessage = () => {
                void loadTree().catch((error) => toast("Wiki refresh failed: " + error.message, { kind: "bad" }));
                loadStats();
                if (S.bpLoaded) loadBlueprints().then(() => { if (S.view === "blueprints") renderTree(); });
                const path = S.active;
                if (path) void refreshArticle(path).catch((error) => toast("Note refresh failed: " + error.message, { kind: "bad" }));
            };
        } catch (e) { toast("Live updates unavailable: " + e.message, { kind: "bad" }); }
    }

    renderEmpty();
    bind();
    loadTree().catch((e) => { $("tree").innerHTML = '<span class="muted blockpad">' + esc(e.message) + "</span>"; });
    loadStats();
}
