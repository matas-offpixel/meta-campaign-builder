/**
 * One timing sample of the face detector on another tfjs backend, in its own
 * process (face-detect-bench.ts). tfjs-core keeps its engine and kernel
 * registry on globalThis, so loading a second tfjs in the render tick's
 * process would share one engine with face-api's bundled cpu tfjs, and
 * switching it to wasm would switch the real detection too. Here it can't.
 *
 *   node face-bench-child.cjs <wasm|tfjs-node> <raw RGB file> <width> <height> <model dir>
 *
 * Prints one JSON line: { candidate, loaded, backend, simd, threads, loadS,
 * warmS, detectS, faces, error }. Times in seconds: loadS is the require,
 * backend and weights; warmS the first detection (wasm compiles its kernels
 * then); detectS the second, on the same frame, which is the number to read.
 * Plain CommonJS so Node runs it as it is, here and in the Vercel function.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: Node runs this file as it is. */
"use strict";

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const [candidate, rawPath, width, height, modelDir] = process.argv.slice(2);
const out = { candidate, loaded: false };
const seconds = (from) => Math.round((performance.now() - from) / 10) / 100;

async function main() {
  const t0 = performance.now();
  let api;
  if (candidate === "wasm") {
    api = require("@vladmandic/face-api/dist/face-api.node-wasm.js");
    await api.tf.setBackend("wasm");
    await api.tf.ready();
    out.simd = await api.tf.env().getAsync("WASM_HAS_SIMD_SUPPORT");
    out.threads = await api.tf.env().getAsync("WASM_HAS_MULTITHREAD_SUPPORT");
  } else if (candidate === "tfjs-node") {
    api = require("@vladmandic/face-api/dist/face-api.node.js");
    await api.tf.ready();
  } else {
    throw new Error(`unknown candidate ${candidate}`);
  }
  out.backend = api.tf.getBackend();
  const manifest = JSON.parse(readFileSync(join(modelDir, "ssd_mobilenetv1_model-weights_manifest.json"), "utf8"));
  const bytes = readFileSync(join(modelDir, "ssd_mobilenetv1_model.bin"));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await api.nets.ssdMobilenetv1.loadFromWeightMap(api.tf.io.decodeWeights(buffer, manifest[0].weights));
  out.loaded = true;
  out.loadS = seconds(t0);
  const w = Number(width);
  const h = Number(height);
  const rgb = new Uint8Array(readFileSync(rawPath));
  const options = new api.SsdMobilenetv1Options({ minConfidence: 0.3 });
  const detect = async () => {
    const tensor = api.tf.tensor3d(rgb, [h, w, 3]);
    try {
      return await api.detectAllFaces(tensor, options);
    } finally {
      tensor.dispose();
    }
  };
  const t1 = performance.now();
  await detect();
  out.warmS = seconds(t1);
  const t2 = performance.now();
  const found = await detect();
  out.detectS = seconds(t2);
  out.faces = found.map((d) => ({ x: d.box.x, y: d.box.y, width: d.box.width, height: d.box.height, score: d.score }));
}

main()
  .catch((err) => {
    out.error = String((err && err.message) || err).split("\n")[0].slice(0, 200);
  })
  .finally(() => {
    process.stdout.write(`${JSON.stringify(out)}\n`);
  });
