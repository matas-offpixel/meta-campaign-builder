import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  launchFailureLead,
  resolveLaunchErrorSource,
  stampLaunchErrorSource,
} from "../launch-failure-copy.ts";

const preflight = stampLaunchErrorSource({ error: "stopped" }, 400);
const meta = stampLaunchErrorSource({ error: "from meta" }, 502);
const partial = stampLaunchErrorSource({ error: "after create", source: "partial" }, 400);

process.stdout.write(
  JSON.stringify({
    preflightSource: preflight.source,
    preflightHtml: renderToStaticMarkup(
      createElement("p", null, launchFailureLead(preflight.source)),
    ),
    metaSource: meta.source,
    metaHtml: renderToStaticMarkup(
      createElement("p", null, launchFailureLead(meta.source)),
    ),
    partialSource: partial.source,
    partialResolved: resolveLaunchErrorSource("partial", 400),
    statusFallback: resolveLaunchErrorSource(undefined, 400),
    partialHtml: renderToStaticMarkup(
      createElement("p", null, launchFailureLead(partial.source)),
    ),
  }),
);
