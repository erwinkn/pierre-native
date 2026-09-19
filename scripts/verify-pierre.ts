import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import manifest from "../vendor/pierre/manifest.json";
const root = join(import.meta.dir, "../vendor/pierre");
for (const [file, record] of Object.entries(manifest.files)) {
  const actual = createHash("sha256")
    .update(readFileSync(join(root, file)))
    .digest("hex");
  if (actual !== record.sha256)
    throw Error(`Pierre source checksum mismatch: ${file}`);
}
console.log(
  `Verified ${Object.keys(manifest.files).length} Pierre source, test and fixture hashes at ${manifest.commit}.`,
);
const playground = (await import("../vendor/pierre-playground/manifest.json"))
  .default;
for (const [file, record] of Object.entries(playground.files)) {
  if (
    createHash("sha256")
      .update(
        readFileSync(
          join(import.meta.dir, "../vendor/pierre-playground", file),
        ),
      )
      .digest("hex") !== record.sha256
  )
    throw Error(`Playground source checksum mismatch: ${file}`);
}
if (
  createHash("sha256")
    .update(
      readFileSync(join(import.meta.dir, "..", playground.generated.path)),
    )
    .digest("hex") !== playground.generated.sha256
)
  throw Error(
    "Generated playground fixtures differ. Run bun run playground:fixtures.",
  );
const assets = (await import("../assets/playground/manifest.json")).default;
for (const [file, expected] of Object.entries(assets.files)) {
  if (
    createHash("sha256")
      .update(readFileSync(join(import.meta.dir, "../assets/playground", file)))
      .digest("hex") !== expected
  )
    throw Error(`Playground asset checksum mismatch: ${file}`);
}
console.log(
  "Verified playground source, generated fixtures, fonts, icons, and avatars.",
);
