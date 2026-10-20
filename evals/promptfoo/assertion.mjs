export default async function evaluate(output, context) {
  const metadata = context?.providerResponse?.metadata ?? {};
  const components = metadata.componentResults ?? [];

  const primary = components.find((item) => item.id === 'code-correctness');
  const codePass = primary?.pass === true;

  return {
    pass: codePass,
    score: codePass ? 1 : 0,
    reason: primary?.reason ?? metadata.summary ?? 'No correctness component reported',
    componentResults: components
  };
}
