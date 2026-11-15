import { Config } from "@remotion/cli/config";

// Lambda's Chrome did not finish fetching the root-relative .ttf within
// delayRender's 28s. Inlining the face removes that request.
Config.overrideWebpackConfig((current) => {
  const rules = (current.module?.rules ?? []).map((rule) => {
    if (!rule || typeof rule !== "object" || !("test" in rule)) return rule;
    const test = rule.test;
    if (test instanceof RegExp && test.source.includes("ttf")) {
      return { ...rule, type: "asset/inline" };
    }
    return rule;
  });
  return { ...current, module: { ...current.module, rules } };
});
