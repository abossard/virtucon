function tokenize(policy) {
    if (typeof policy !== "string") return [];
    return policy
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            const [name, ...values] = entry.split(/\s+/);
            return { name: name.toLowerCase(), values };
        });
}

function valuesFor(policy, name) {
    const directive = tokenize(policy).find((entry) => entry.name === name);
    return directive?.values ?? null;
}

export function allowsInlineStyle(policy) {
    if (typeof policy !== "string" || policy.trim().length === 0) return true;
    const styleAttrValues =
        valuesFor(policy, "style-src-attr") ??
        valuesFor(policy, "style-src") ??
        valuesFor(policy, "default-src");
    if (!styleAttrValues) return true;
    return styleAttrValues.some((value) => value.toLowerCase() === "'unsafe-inline'");
}
