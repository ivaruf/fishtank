// Assemble the static site GitHub Pages publishes. There is still no build
// step for the game itself - nothing is compiled or bundled - this only
// gathers files that the Node server would otherwise serve from three
// different places, plus the two things a static host cannot provide.
//
//   node tools/build-static.mjs [outDir]
//
// Layout matters: the client's modules import "../shared/x.js", so `shared`
// has to sit beside `js` at the site root rather than above it.
import { cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.resolve(root, process.argv[2] ?? "_site");

const version = (() => {
  const given = process.env.APP_VERSION || process.env.GITHUB_SHA;
  if (given) return given.trim().slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
})();

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
// Mirror the repository: client/ and shared/ as siblings. That is the whole
// trick for a project Pages site - the client's "../../shared/x.js" then
// resolves the same on disk and under /<repo>/, with no reliance on browsers
// clamping ".." at the origin root.
await cp(path.join(root, "client"), path.join(out, "client"), {
  recursive: true,
});
await cp(path.join(root, "shared"), path.join(out, "shared"), {
  recursive: true,
});
// A tidy entry point, since the app itself lives one level down.
await writeFile(
  path.join(out, "index.html"),
  `<!doctype html><meta charset="utf-8">
<title>Fishtank</title>
<meta http-equiv="refresh" content="0; url=client/">
<link rel="canonical" href="client/">
<p><a href="client/">Enter the fishtank</a></p>
`,
);
// The Babylon fallback has no node_modules to read on a static host, so the
// two files the page falls back to are copied in. Without this the CDN stops
// being a fallback and becomes a hard dependency.
await mkdir(path.join(out, "client/vendor"), { recursive: true });
for (const [name, from] of [
  ["babylon.js", "node_modules/babylonjs/babylon.js"],
  ["loaders.js", "node_modules/babylonjs-loaders/babylonjs.loaders.min.js"],
])
  await cp(path.join(root, from), path.join(out, "client/vendor", name));

// Stamp the build into the code itself, so the page can tell which build it is
// *running* rather than only which one is deployed. Both stamps are exact
// string swaps against a committed placeholder: no templating, and the files
// stay valid and runnable straight out of the repo.
for (const [file, from, to] of [
  [
    "client/js/build.js",
    `export const BUILD = "dev";`,
    `export const BUILD = "${version}";`,
  ],
  // The cache name is what retires old entries, so tying it to the build means
  // a deploy invalidates the precache instead of outliving it.
  [
    "client/sw.js",
    `const CACHE = "fishtank-dev";`,
    `const CACHE = "fishtank-${version}";`,
  ],
]) {
  const target = path.join(out, file);
  const source = await readFile(target, "utf8");
  if (!source.includes(from))
    throw new Error(
      `${file} no longer contains ${from} to stamp the build into`,
    );
  await writeFile(target, source.replace(from, to));
}
// Stands in for /healthz, which a static host cannot answer, so the menu can
// still show which build it is running.
await writeFile(
  path.join(out, "client/version.json"),
  JSON.stringify(
    {
      ok: true,
      version,
      started: new Date().toISOString(),
      // Read the number out of the source rather than importing it, so this
      // script stays free of the client's browser-only imports.
      protocol: Number(
        (await readFile(path.join(root, "shared/config.js"), "utf8")).match(
          /export const PROTOCOL = (\d+)/,
        )[1],
      ),
      static: true,
    },
    null,
    2,
  ) + "\n",
);
// Pages runs content through Jekyll by default, which drops files starting
// with an underscore and can rewrite things unexpectedly.
await writeFile(path.join(out, ".nojekyll"), "");

console.log(`Built ${path.relative(root, out)} at build ${version}`);
