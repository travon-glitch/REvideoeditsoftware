/* @lvs/fablecut-core — entry point for the vendored FableCut engine.
 *
 * Upstream: https://github.com/ronak-create/FableCut @ 579b08ec1a789baec5cbf06d7430373460508d09 (MIT).
 * The upstream files under ./upstream are kept byte-for-byte; local changes are
 * tracked as patch files in ./patches (none applied yet — see UPSTREAM.md).
 *
 * Stage 2 only exposes the Node-safe document modules (timeline edit ops and
 * project validation) so the platform can build and check FableCut project
 * documents server-side. The browser editor and render server are NOT served
 * in Stage 2: upstream server.js is single-user and unauthenticated by design.
 *
 * Modules load lazily so importing this package never runs upstream code that
 * is not used.
 */
"use strict";
const path = require("path");

const UPSTREAM = {
  repository: "https://github.com/ronak-create/FableCut",
  commit: "579b08ec1a789baec5cbf06d7430373460508d09",
  version: "1.18.0",
  license: "MIT",
};

const UPSTREAM_DIR = path.join(__dirname, "upstream");

/* Upstream entry points the platform is allowed to load in Node.
   server.js, mcp-server.js, cli.js and export-jobs.js are deliberately absent. */
const MODULES = {
  editOps: "edit-ops.js",
  projectOps: "project-ops.js",
  motion: "motion.js",
  templates: "templates.js",
  delivery: "delivery.js",
  sequences: "sequences.js",
};

/* Static requires (one per module) so bundlers can trace them; each runs only on first use. */
const LOADERS = {
  editOps: () => require("./upstream/edit-ops.js"),
  projectOps: () => require("./upstream/project-ops.js"),
  motion: () => require("./upstream/motion.js"),
  templates: () => require("./upstream/templates.js"),
  delivery: () => require("./upstream/delivery.js"),
  sequences: () => require("./upstream/sequences.js"),
};

const cache = {};
function load(name) {
  if (!Object.prototype.hasOwnProperty.call(LOADERS, name)) {
    throw new Error(`fablecut-core: "${name}" is not an exposed module`);
  }
  if (!cache[name]) cache[name] = LOADERS[name]();
  return cache[name];
}

/* Editor files the platform will later serve from the isolated editor origin. */
const EDITOR_STATIC_FILES = [
  "index.html", "style.css", "app.js", "favicon.svg", "manifest.json",
  "fx-worklet.js", "meter-worklet.js", "ruler-worker.js", "transcribe-worker.js",
];

module.exports = {
  UPSTREAM,
  UPSTREAM_DIR,
  MODULES,
  EDITOR_STATIC_FILES,
  load,
  get EditOps() { return load("editOps"); },
  get ProjectOps() { return load("projectOps"); },
  get Motion() { return load("motion"); },
  get Templates() { return load("templates"); },
  get Delivery() { return load("delivery"); },
  get Sequences() { return load("sequences"); },
};
