/* Smoke tests for the vendored FableCut engine wrapper (our code, not upstream's suite). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("..");

test("records the exact upstream revision and license", () => {
  assert.equal(core.UPSTREAM.commit, "579b08ec1a789baec5cbf06d7430373460508d09");
  assert.equal(core.UPSTREAM.license, "MIT");
  const license = fs.readFileSync(path.join(__dirname, "..", "LICENSE"), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /ronak-create/);
});

test("upstream files are present and unmodified entry points exist", () => {
  for (const file of Object.values(core.MODULES)) {
    assert.ok(fs.existsSync(path.join(core.UPSTREAM_DIR, file)), `${file} missing`);
  }
  for (const file of core.EDITOR_STATIC_FILES) {
    assert.ok(fs.existsSync(path.join(core.UPSTREAM_DIR, file)), `${file} missing`);
  }
});

test("refuses to load modules that are not exposed (e.g. the unauthenticated server)", () => {
  assert.throws(() => core.load("server"), /not an exposed module/);
});

test("project validation accepts a minimal listing slideshow and rejects a broken clip", () => {
  const ops = core.ProjectOps;
  assert.equal(typeof ops.checkProject, "function");
  const doc = {
    name: "Listing", width: 1920, height: 1080, fps: 30, revision: 1, panSchema: 1,
    media: [{ id: "m_1", name: "front.jpg", kind: "image", src: "/media/front.jpg", width: 4000, height: 3000 }],
    clips: [{
      id: "c_1", mediaId: "m_1", kind: "image", track: "V1", start: 0, in: 0, duration: 4,
      keyframes: { scale: [{ t: 0, v: 1 }, { t: 4, v: 1.15 }] },
    }],
  };
  ops.checkProject(doc);
  const bad = structuredClone(doc);
  bad.clips[0].mediaId = "m_missing";
  assert.throws(() => ops.checkProject(bad), /unknown mediaId/);
});
