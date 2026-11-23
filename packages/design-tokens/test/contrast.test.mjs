import assert from "node:assert/strict";
import { test } from "node:test";
import { colors } from "../src/index.ts";

// WCAG relative luminance in linear sRGB.
function luminance(hex) {
  const [red, green, blue] = hex
    .slice(1)
    .match(/../g)
    .map((channel) => {
      const value = Number.parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

for (const [scheme, palette] of Object.entries(colors)) {
  test(scheme + " theme keeps text, actions, and focus indicators legible", () => {
    function check(foreground, background, minimum) {
      const a = luminance(palette[foreground]);
      const b = luminance(palette[background]);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(
        ratio >= minimum,
        foreground + " on " + background + " has contrast " + ratio.toFixed(2),
      );
    }

    for (const surface of ["canvas", "paper", "control"]) {
      for (const text of ["ink", "muted", "warning", "error", "positive"])
        check(text, surface, 4.5);
      check("focus", surface, 3);
    }
    check("actionInk", "action", 4.5);
    check("actionInk", "actionHover", 4.5);
    check("folioLine", "folio", 3);
    check("folioInk", "folio", 3);
  });
}
