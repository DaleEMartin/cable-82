/* CABLE 82 faux CRT: the flat-panel path.
   On a tube the CRT is the filter and this file does nothing. On a flat
   panel there is no filter, so the picture plays inside a drawn wood
   console that fills the screen, and the tells of a tube - the curve of the
   glass, scanlines, noise, a weak-signal wave, bloom, the dark corners - are
   settings in the control room (config fauxCrt). The console's dial is
   live: it shows the channel, its pointer turns on every tune, and a click
   on a number tunes.
   The one rule that keeps it honest: the glass is cut where the picture
   ends. The faceplate polygon is derived from the same mapping the barrel
   filter applies, so the picture's edge and the glass edge are one curve at
   every setting, and at curve 0 the glass is a plain rounded rectangle.
   UMD: the geometry is pure and tested in Node; the DOM half loads as
   window.Cable82Set. */
(function (root, factory) {
  const isNode = typeof module !== "undefined" && module.exports;
  const api = factory();
  if (isNode) module.exports = api;
  else root.Cable82Set = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------- geometry

  // The drawing is 1920x1080, the shape of the panel it covers. The glass is
  // a 4:3 window inside it; the stage is placed at these fractions by
  // style.css, and the dark opening drawn behind it is a hair larger.
  const DRAWING = { w: 1920, h: 1080 };
  const GLASS = { x: 130, y: 70, w: 1200, h: 900 };
  const OPENING = { x: 124, y: 64, w: 1212, h: 912 };
  const PANEL = { x: 1400, y: 38, w: 460, h: 964 };
  const DIAL = { cx: 1630, cy: 330, r: 180, ring: 158 };
  const START_DEG = -150; // the first number, pointer straight up is 0
  const SPAN_DEG = 300;

  // curve 0..10 -> k, the strength of the barrel mapping.
  // Output point c (centered, -0.5..0.5) samples the source at
  //   c * (1 + k * (|c|^2 - 0.25))
  // so the middle of each edge maps 1:1 and the corners reach further out:
  // the source's edge bows outward at the middle of each side, the way a
  // tube's raster does, and its corners land inside the box.
  function curveK(curve) {
    return Math.max(0, Math.min(10, Number(curve) || 0)) * 0.18;
  }

  // The faceplate: the image of the source's rounded edge under the mapping
  // above, as a polygon in percent of the glass box. The mapping is
  // inverted with a few Newton steps per point (it is monotonic in radius
  // for every k in range).
  function faceplate(curve) {
    const k = curveK(curve);
    const R = 0.06; // the source's corner radius, as a fraction of its size
    const pts = [];
    const side = (ax, ay, bx, by, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      }
    };
    const arc = (cx, cy, a0, n) => {
      for (let i = 0; i <= n; i++) {
        const a = a0 + (Math.PI / 2) * (i / n);
        pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
      }
    };
    const h = 0.5;
    const e = h - R;
    side(-e, -h, e, -h, 14); arc(e, -e, -Math.PI / 2, 6);
    side(h, -e, h, e, 14); arc(e, e, 0, 6);
    side(e, h, -e, h, 14); arc(-e, e, Math.PI / 2, 6);
    side(-h, e, -h, -e, 14); arc(-e, -e, Math.PI, 6);
    return pts.map(([sx, sy]) => {
      const sig = Math.hypot(sx, sy);
      let r = sig;
      for (let i = 0; i < 12; i++) {
        const g = r * (1 + k * (r * r - 0.25)) - sig;
        const dg = 1 + k * (3 * r * r - 0.25);
        r -= g / dg;
      }
      const f = sig ? r / sig : 1;
      return [50 + sx * f * 100, 50 + sy * f * 100];
    });
  }

  function polygonCss(pts) {
    return "polygon(" + pts.map(([x, y]) => x.toFixed(2) + "% " + y.toFixed(2) + "%").join(",") + ")";
  }

  function openingPath(pts) {
    return "M" + pts.map(([x, y]) => (OPENING.x + (x / 100) * OPENING.w).toFixed(1) + " " + (OPENING.y + (y / 100) * OPENING.h).toFixed(1)).join(" L ") + " Z";
  }

  // The dial ring: n numbers spread over SPAN_DEG, the first at START_DEG.
  function dialAngle(index, count) {
    if (count <= 1) return 0;
    return START_DEG + (SPAN_DEG * index) / (count - 1);
  }

  // The tells, as the numbers style.css and the filter consume. Each slider
  // is 0..10; these are the gains, in one place.
  function look(F) {
    const n = (v) => Math.max(0, Math.min(10, Number(v) || 0));
    return {
      k: curveK(F.curve),
      scan: n(F.scanlines) * 0.04, // opacity of the line overlay
      noise: n(F.noise) * 0.011, // opacity of the grain canvas
      wave: n(F.wave) * 0.0028, // displacement, fraction of the width
      bloom: n(F.bloom) * 0.0006, // blur radius, fraction of the width
      vig: n(F.vignette) * 0.075, // opacity of the corner shade
      flick: n(F.flicker) * 0.02, // opacity of the mains breathe
      mask: F.mask ? 0.2 : 0,
      refl: F.reflection ? 1 : 0,
    };
  }

  // ---------------------------------------------------------- the maps
  // Two small images the SVG filter reads as displacement fields. The
  // barrel map holds the mapping above for k = 1 (the filter's scale
  // multiplies it by k); the wave map is a stack of sine stripes the filter
  // scrolls. Both are drawn once, on a canvas, when the set mounts.

  function barrelMapURL(doc) {
    const W = 256, H = 192;
    const c = doc.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cx = (x + 0.5) / W - 0.5, cy = (y + 0.5) / H - 0.5;
        const r2 = cx * cx + cy * cy;
        const fx = cx * (r2 - 0.25), fy = cy * (r2 - 0.25); // -0.05 .. 0.125
        const i = (y * W + x) * 4;
        d[i] = Math.round((0.5 + fx / 0.25) * 255);
        d[i + 1] = Math.round((0.5 + fy / 0.25) * 255);
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }

  function waveMapURL(doc) {
    const W = 8, H = 256, CYCLES = 7;
    const c = doc.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      const v = Math.round((0.5 + 0.5 * Math.sin((2 * Math.PI * CYCLES * (y + 0.5)) / H)) * 255);
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        d[i] = v; d[i + 1] = 128; d[i + 2] = 128; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }

  // ---------------------------------------------------------- the console
  // Drawn once as inline SVG. Colors come from style.css (--set-*), so the
  // look of the wood and the brass is a stylesheet decision.

  function consoleSvg(numberText) {
    return [
      '<svg viewBox="0 0 ' + DRAWING.w + ' ' + DRAWING.h + '" preserveAspectRatio="none" aria-hidden="true">',
      "<defs>",
      '<filter id="set-grain" x="0" y="0" width="1" height="1">',
      '<feTurbulence type="fractalNoise" baseFrequency="0.006 0.09" numOctaves="3" seed="7" result="t"/>',
      '<feColorMatrix in="t" type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.22  0 0 0 0 0.12  0 0 0 0.55 0" result="g"/>',
      '<feBlend in="SourceGraphic" in2="g" mode="multiply"/>',
      "</filter>",
      '<pattern id="set-cloth" width="6" height="6" patternUnits="userSpaceOnUse">',
      '<rect width="6" height="6" fill="var(--set-cloth)"/>',
      '<circle cx="1.5" cy="1.5" r="1.1" fill="var(--set-cloth-hi)"/>',
      '<circle cx="4.5" cy="4.5" r="1.1" fill="var(--set-cloth-mid)"/>',
      "</pattern>",
      "</defs>",
      // the cabinet runs to the panel's edge: the television's own frame is the console's frame
      '<rect x="0" y="0" width="1920" height="1080" fill="var(--set-wood)" filter="url(#set-grain)"/>',
      '<rect x="14" y="14" width="1892" height="1052" rx="10" fill="none" stroke="var(--set-wood-dk)" stroke-width="8" opacity="0.8"/>',
      '<rect x="22" y="20" width="1876" height="4" rx="2" fill="var(--set-wood-lt)" opacity="0.7"/>',
      // the bezel and the opening; the opening's path is set from the faceplate
      '<rect x="96" y="38" width="1268" height="964" rx="28" fill="var(--set-bezel)"/>',
      '<rect x="96" y="38" width="1268" height="964" rx="28" fill="none" stroke="var(--set-bezel-lt)" stroke-width="2"/>',
      '<path id="set-opening" fill="var(--set-glass)"/>',
      // the badge: the station's number on the cabinet rail, with its lamp
      '<g id="set-badge" transform="translate(730 1040)">',
      '<rect x="-70" y="-22" width="140" height="44" rx="6" fill="var(--set-badge)" stroke="var(--set-bezel-lt)" stroke-width="2"/>',
      '<text x="0" y="13" text-anchor="middle" font-family="VGA, monospace" font-size="32" fill="var(--set-paper)">' + numberText + "</text>",
      '<circle id="set-lamp" cx="48" cy="0" r="6" fill="var(--set-lamp)" stroke="var(--set-lamp-ring)" stroke-width="2"/>',
      "</g>",
      '<text x="250" y="1052" font-family="VGA, monospace" font-size="18" letter-spacing="4" fill="var(--set-engrave)">SOLID STATE</text>',
      '<text x="1020" y="1052" font-family="VGA, monospace" font-size="18" letter-spacing="4" fill="var(--set-engrave)">CABLE 82</text>',
      // the control panel: the dial, a volume knob, the cloth
      '<rect x="' + PANEL.x + '" y="' + PANEL.y + '" width="' + PANEL.w + '" height="' + PANEL.h + '" rx="18" fill="var(--set-panel)" stroke="var(--set-bezel-lt)" stroke-width="2"/>',
      '<g id="set-dial">',
      '<circle cx="' + DIAL.cx + '" cy="' + DIAL.cy + '" r="' + DIAL.r + '" fill="var(--set-dial)" stroke="var(--set-bezel-lt)" stroke-width="3"/>',
      '<circle cx="' + DIAL.cx + '" cy="' + DIAL.cy + '" r="136" fill="var(--set-dial-in)" stroke="var(--set-dial-rim)" stroke-width="2"/>',
      '<g id="set-numbers"></g>',
      '<g id="set-pointer">',
      '<path d="M' + DIAL.cx + " " + DIAL.cy + " L" + DIAL.cx + " " + (DIAL.cy - 118) + '" stroke="var(--set-brass)" stroke-width="6" stroke-linecap="round"/>',
      '<circle cx="' + DIAL.cx + '" cy="' + DIAL.cy + '" r="30" fill="var(--set-knob)" stroke="var(--set-brass)" stroke-width="3"/>',
      "</g>",
      '<text x="' + DIAL.cx + '" y="548" text-anchor="middle" font-family="VGA, monospace" font-size="18" letter-spacing="4" fill="var(--set-label)">CHANNEL</text>',
      "</g>",
      '<g id="set-volume">',
      '<circle cx="1630" cy="660" r="58" fill="var(--set-dial-in)" stroke="var(--set-bezel-lt)" stroke-width="3"/>',
      '<path d="M1630 660 L1630 616" stroke="var(--set-brass)" stroke-width="5" stroke-linecap="round" transform="rotate(35 1630 660)"/>',
      '<text x="1630" y="752" text-anchor="middle" font-family="VGA, monospace" font-size="18" letter-spacing="4" fill="var(--set-label)">VOLUME</text>',
      "</g>",
      '<rect x="1428" y="790" width="404" height="186" rx="12" fill="url(#set-cloth)" stroke="var(--set-cloth-edge)" stroke-width="3"/>',
      "</svg>",
    ].join("");
  }

  // ---------------------------------------------------------- mount
  // create({ cfg, dial, tune }) -> { on, setChannel(number), setPowered(on) }
  //   dial  the enabled channels, in dial order (the tuner's list)
  //   tune  (number) => void, the tuner's direct dial
  // With fauxCrt off (or crtMode on, which wins) nothing is drawn and the
  // hooks are no-ops, so the tuner never has to ask.
  function create({ cfg, dial, tune }) {
    const F = cfg.fauxCrt;
    const noop = { on: false, setChannel() {}, setPowered() {} };
    if (typeof document === "undefined" || !F || !F.on || cfg.crtMode) return noop;
    const doc = document;
    const letterbox = doc.getElementById("letterbox");
    const stage = doc.getElementById("stage");
    const host = doc.getElementById("set");
    const power = doc.getElementById("power-off");
    if (!letterbox || !stage || !host) return noop;

    // The tells always; the console (and the glass layout) unless the set
    // is "none", which keeps the letterbox and dresses the picture alone.
    const bulletin = dial.find((c) => c.type === "bulletin");
    const furniture = F.set !== "none";
    letterbox.classList.add("tells");
    if (furniture) {
      host.innerHTML = consoleSvg(bulletin ? String(bulletin.number) : "TV");
      host.hidden = false;
      letterbox.classList.add("faux");
      doc.body.classList.add("faux");
    }

    // The glass: the stage and the dark screen behind it take the faceplate.
    const pts = faceplate(F.curve);
    const clip = polygonCss(pts);
    stage.style.clipPath = clip;
    if (power) power.style.clipPath = clip;
    const opening = host.querySelector("#set-opening");
    if (opening) opening.setAttribute("d", openingPath(pts));

    // The tells on the stage: the cheap ones as custom properties the
    // overlays read, the picture ones as the filter's parameters.
    const L = look(F);
    stage.style.setProperty("--tube-scan", String(L.scan));
    stage.style.setProperty("--tube-vig", String(L.vig));
    stage.style.setProperty("--tube-mask", String(L.mask));
    stage.style.setProperty("--tube-refl", String(L.refl));
    stage.style.setProperty("--tube-flick", String(L.flick));
    stage.style.setProperty("--tube-noise", String(L.noise));
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    stage.classList.toggle("flicker", L.flick > 0 && !reduced);

    const useFilter = L.k > 0 || L.bloom > 0 || (L.wave > 0 && !reduced);
    const blur = doc.getElementById("tube-blur");
    const barrel = doc.getElementById("tube-barrel");
    const barrelMap = doc.getElementById("tube-barrel-map");
    const wave = doc.getElementById("tube-wave");
    const waveMap = doc.getElementById("tube-wave-map");
    const waveOff = doc.getElementById("tube-wave-off");
    if (useFilter && blur && barrel && wave) {
      blur.setAttribute("stdDeviation", String(L.bloom));
      barrelMap.setAttribute("href", barrelMapURL(doc));
      barrel.setAttribute("scale", String(0.25 * L.k));
      waveMap.setAttribute("href", waveMapURL(doc));
      wave.setAttribute("scale", String(reduced ? 0 : L.wave));
      stage.style.filter = "url(#tube-filter)";
      if (L.wave > 0 && !reduced) {
        // The stripes scroll: a weak signal drifts, it does not sit still.
        let last = 0;
        const tick = (now) => {
          if (now - last > 40) {
            last = now;
            waveOff.setAttribute("dy", String(((now / 1000) * 0.13) % 1));
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    } else {
      stage.style.filter = "";
    }

    // Grain: the tuner's snow idea at low opacity, a small canvas scaled up,
    // redrawn twelve times a second. Nothing runs when the slider is at 0.
    const grain = doc.getElementById("tube-noise");
    if (grain && L.noise > 0 && !reduced) {
      const g = grain.getContext("2d");
      const img = g.createImageData(grain.width, grain.height);
      const d = img.data;
      setInterval(() => {
        for (let i = 0; i < d.length; i += 4) {
          const v = (Math.random() * 255) | 0;
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
      }, 83);
      grain.hidden = false;
    }

    // The dial: the lineup's numbers around the ring, the pointer on the
    // channel, a click on a number tunes.
    const svgNS = "http://www.w3.org/2000/svg";
    const ring = [...dial].sort((a, b) => a.number - b.number);
    const numbers = furniture ? host.querySelector("#set-numbers") : null;
    const pointer = furniture ? host.querySelector("#set-pointer") : null;
    const lamp = furniture ? host.querySelector("#set-lamp") : null;
    if (numbers) {
      ring.forEach((ch, i) => {
        const a = (dialAngle(i, ring.length) * Math.PI) / 180;
        const g = doc.createElementNS(svgNS, "g");
        g.setAttribute("class", "dn");
        g.setAttribute("tabindex", "0");
        g.setAttribute("role", "button");
        g.setAttribute("aria-label", "Channel " + ch.number + (ch.name ? ", " + ch.name : ""));
        g.dataset.ch = String(ch.number);
        const t = doc.createElementNS(svgNS, "text");
        t.setAttribute("x", String(DIAL.cx + DIAL.ring * Math.sin(a)));
        t.setAttribute("y", String(DIAL.cy - DIAL.ring * Math.cos(a) + 7));
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("font-family", "VGA, monospace");
        t.setAttribute("font-size", ch.type === "bulletin" ? "24" : "20");
        t.textContent = String(ch.number);
        g.appendChild(t);
        numbers.appendChild(g);
        const go = () => tune(ch.number);
        g.addEventListener("click", go);
        g.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
        });
      });
    }
    if (pointer) pointer.style.transformOrigin = DIAL.cx + "px " + DIAL.cy + "px";

    function setChannel(number) {
      const i = ring.findIndex((c) => c.number === number);
      if (i < 0 || !pointer) return;
      pointer.style.transform = "rotate(" + dialAngle(i, ring.length) + "deg)";
      host.querySelectorAll(".dn").forEach((g) => g.classList.toggle("on", Number(g.dataset.ch) === number));
    }
    function setPowered(on) {
      if (lamp) lamp.style.opacity = on ? "1" : "0.25";
    }
    return { on: true, setChannel, setPowered };
  }

  return { DRAWING, GLASS, OPENING, curveK, faceplate, polygonCss, dialAngle, look, create };
});
