// node --test test/set.test.mjs
// The faux set's geometry, in Node: the faceplate is the image of the
// picture's edge under the barrel mapping, so the glass is cut exactly
// where the picture ends. set.js is UMD and pure on this side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Set = require("../set.js");

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || "") + " " + a + " vs " + b);

test("curve 0 is a flat glass: a rounded rectangle that touches every edge of the box", () => {
  const pts = Set.faceplate(0);
  assert.ok(pts.length > 60);
  near(Math.min(...pts.map((p) => p[1])), 0, 0.01, "top");
  near(Math.max(...pts.map((p) => p[1])), 100, 0.01, "bottom");
  near(Math.min(...pts.map((p) => p[0])), 0, 0.01, "left");
  near(Math.max(...pts.map((p) => p[0])), 100, 0.01, "right");
  for (const [x, y] of pts) assert.ok(x >= -0.01 && x <= 100.01 && y >= -0.01 && y <= 100.01, "inside the box");
});

test("curve pulls the corners in and leaves the middle of each edge on the box", () => {
  const flat = Set.faceplate(0);
  const bent = Set.faceplate(5);
  // the first point is the top edge's left end (just past the corner radius); the top edge's middle is 7 points on
  const cornerFlat = flat[0], cornerBent = bent[0];
  assert.ok(cornerBent[0] > cornerFlat[0] + 1, "the corner moves inward along x");
  assert.ok(cornerBent[1] > cornerFlat[1] + 1, "and down along y");
  const midTop = bent[7];
  near(midTop[0], 50, 0.5, "the middle of the top edge stays centered");
  near(midTop[1], 0, 0.6, "and on the top of the box");
  // more curve, more pull-in
  assert.ok(Set.faceplate(10)[0][0] > cornerBent[0]);
});

test("the faceplate is symmetric in x and y, and out-of-range curves clamp", () => {
  const pts = Set.faceplate(3);
  for (const [x, y] of pts) {
    const mirrored = pts.some(([mx, my]) => Math.abs(mx - (100 - x)) < 0.05 && Math.abs(my - y) < 0.05);
    assert.ok(mirrored, "mirror in x for " + x + "," + y);
    const flipped = pts.some(([mx, my]) => Math.abs(mx - x) < 0.05 && Math.abs(my - (100 - y)) < 0.05);
    assert.ok(flipped, "mirror in y for " + x + "," + y);
  }
  assert.deepEqual(Set.faceplate(99), Set.faceplate(10));
  assert.deepEqual(Set.faceplate(-4), Set.faceplate(0));
  assert.equal(Set.curveK(0), 0);
  near(Set.curveK(10), 1.8, 1e-9);
});

test("the dial spreads the lineup over the ring, first number left, last right", () => {
  assert.equal(Set.dialAngle(0, 5), -150);
  assert.equal(Set.dialAngle(4, 5), 150);
  assert.equal(Set.dialAngle(2, 5), 0);
  assert.equal(Set.dialAngle(0, 1), 0);
});

test("the look maps sliders to gains, and off is zero", () => {
  const off = Set.look({ curve: 0, scanlines: 0, noise: 0, wave: 0, bloom: 0, vignette: 0, flicker: 0, mask: false, reflection: false });
  for (const v of Object.values(off)) assert.equal(v, 0);
  const on = Set.look({ curve: 10, scanlines: 10, noise: 10, wave: 10, bloom: 10, vignette: 10, flicker: 10, mask: true, reflection: true });
  for (const v of Object.values(on)) assert.ok(v > 0);
  assert.ok(on.scan <= 1 && on.vig <= 1 && on.noise <= 1 && on.flick <= 1, "opacities stay in range");
  assert.equal(Set.polygonCss([[0, 0], [100, 0], [100, 100]]), "polygon(0.00% 0.00%,100.00% 0.00%,100.00% 100.00%)");
});
