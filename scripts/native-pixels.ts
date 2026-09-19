import assert from "node:assert/strict";

/** Screenshots use device pixels; native element bounds use logical points. */
export function pixelScale(
  image: { width: number; height: number },
  viewport: { width: number; height: number },
): number {
  const scale = image.width / viewport.width;
  assert(Number.isFinite(scale) && scale > 0, "Valid screenshot scale");
  assert.equal(image.height, Math.round(viewport.height * scale));
  return scale;
}
