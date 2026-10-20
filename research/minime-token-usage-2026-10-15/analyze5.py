import re, os

files = [
  "/Users/abossard/.minime/abossard/_ahm-diagrammo/blueprints/2026-07-26-native-drawio-canvas-rebuild.blueprint.md",
  "/Users/abossard/.minime/abossard/_rgds-rocknix-setup/blueprints/2026-07-26-xcom2-switch-console.blueprint.md",
  "/Users/abossard/.minime/abossard/_ahm-model-demo/blueprints/2026-09-08-topology-node-edge-redesign.blueprint.md",
  "/Users/abossard/.minime/RocheIConnect/_infraautomation/blueprints/2026-08-25-iedge-architecture.blueprint.md",
  "/Users/abossard/.minime/abossard/_can-i-haz-houze/blueprints/2026-09-16-aspire-health-model.blueprint.md",
]

def section_bytes(text, heading_regex):
    """Sum bytes of all top-level (##) sections whose heading matches heading_regex, until next ## heading."""
    total = 0
    matches = list(re.finditer(r'^##\s+(.*)$', text, re.M))
    for i, m in enumerate(matches):
        title = m.group(1)
        if re.search(heading_regex, title, re.I):
            start = m.end()
            end = matches[i+1].start() if i+1 < len(matches) else len(text)
            total += len(text[start:end].encode('utf-8'))
    return total

def kept_verbatim_bytes(text):
    """Bytes inside ### sections whose heading contains 'kept verbatim' or 'SUPERSEDED' or 'Superseded'."""
    total = 0
    matches = list(re.finditer(r'^(#{2,3})\s+(.*)$', text, re.M))
    for i, m in enumerate(matches):
        level, title = m.group(1), m.group(2)
        if re.search(r'kept verbatim|SUPERSEDED|Superseded', title):
            start = m.end()
            # find next heading of same or higher level
            end = len(text)
            for j in range(i+1, len(matches)):
                if len(matches[j].group(1)) <= len(level):
                    end = matches[j].start()
                    break
            total += len(text[start:end].encode('utf-8'))
    return total

def findings_log_bytes(text):
    total = 0
    matches = list(re.finditer(r'^(#{2,3})\s+(.*)$', text, re.M))
    for i, m in enumerate(matches):
        level, title = m.group(1), m.group(2)
        if re.search(r'[Ff]resh-inspection findings|inspection findings', title):
            start = m.end()
            end = len(text)
            for j in range(i+1, len(matches)):
                if len(matches[j].group(1)) <= len(level):
                    end = matches[j].start()
                    break
            total += len(text[start:end].encode('utf-8'))
    return total

for p in files:
    with open(p, errors='replace') as f:
        text = f.read()
    total = len(text.encode('utf-8'))
    ev = section_bytes(text, r'^Evidence collected$')
    kept = kept_verbatim_bytes(text)
    findings = findings_log_bytes(text)
    plan = section_bytes(text, r'^Plan summary$')
    archive = section_bytes(text, r'^Criteria archive$')
    print(f"\n{os.path.basename(p)}  total={total}B")
    print(f"  Evidence collected:      {ev:>8}B ({ev/total*100:5.1f}%)")
    print(f"  Kept-verbatim/superseded:{kept:>8}B ({kept/total*100:5.1f}%)")
    print(f"  Fresh-inspection findings:{findings:>7}B ({findings/total*100:5.1f}%)")
    print(f"  Plan summary:            {plan:>8}B ({plan/total*100:5.1f}%)")
    print(f"  Criteria archive:        {archive:>8}B ({archive/total*100:5.1f}%)")
    accounted = ev+kept+findings
    print(f"  SUBTOTAL log/dup/retained: {accounted:>8}B ({accounted/total*100:5.1f}%)")
