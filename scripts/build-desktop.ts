import { cpSync, mkdirSync, writeFileSync } from "node:fs";

if (process.platform !== "darwin")
  throw Error("The packaged desktop demo currently supports macOS.");
const bundle = "dist/Pierre Native.app";
const contents = bundle + "/Contents";
mkdirSync(contents + "/MacOS", { recursive: true });
mkdirSync(contents + "/Resources", { recursive: true });
for (const file of ["LICENSE", "NOTICE", "Cargo.lock"])
  cpSync(file, contents + "/Resources/" + file);
cpSync("vendor/licenses", contents + "/Resources/licenses", {
  recursive: true,
});
for (const [source, destination] of [
  ["assets/fonts/Inter-OFL.txt", "Inter-OFL.txt"],
  ["assets/fonts/JetBrainsMono-OFL.txt", "JetBrainsMono-OFL.txt"],
  ["assets/playground/OFL-Geist.txt", "Geist-OFL.txt"],
  ["assets/playground/LICENSE-icons", "LICENSE-icons"],
  ["node_modules/@gpuix/native/LICENSE", "LICENSE-GPUIX"],
])
  cpSync(source!, contents + "/Resources/licenses/" + destination);
const build = Bun.spawn(
  [
    process.execPath,
    "build",
    "--compile",
    "examples/bootstrap.ts",
    "examples/worker.ts",
    "--outfile",
    contents + "/MacOS/pierre-native",
  ],
  { stdout: "inherit", stderr: "inherit" },
);
if (await build.exited) throw Error("Desktop compilation failed");
writeFileSync(
  contents + "/Info.plist",
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>pierre-native</string>
<key>CFBundleIdentifier</key><string>dev.erwinkn.pierre-native</string>
<key>CFBundleName</key><string>Pierre Native</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSEnvironment</key><dict><key>GPUI_FONT_SMOOTHING</key><string>0</string></dict>
</dict></plist>\n`,
);
const sign = Bun.spawn(
  ["codesign", "--force", "--deep", "--sign", "-", bundle],
  {
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (await sign.exited) throw Error("Desktop signing failed");
console.log("Built " + bundle);
