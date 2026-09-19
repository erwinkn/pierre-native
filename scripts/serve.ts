import { resolve } from "node:path";
const root = resolve("dist/site");
const server = Bun.serve({
  port: Number(process.env.PORT ?? 4175),
  async fetch(request) {
    const url = new URL(request.url);
    const path = resolve(
      root,
      "." +
        decodeURIComponent(url.pathname) +
        (url.pathname.endsWith("/") ? "index.html" : ""),
    );
    if (!path.startsWith(root + "/"))
      return new Response("Not found", { status: 404 });
    const file = Bun.file(path);
    if (!(await file.exists()))
      return new Response("Not found", { status: 404 });
    return new Response(file, {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cache-Control": "no-store",
      },
    });
  },
});
console.log(server.url.href);
