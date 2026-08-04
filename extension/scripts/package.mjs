import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(rootDir, "..");
const distDir = join(extensionDir, "dist");
const outDir = join(extensionDir, "releases");

function collectFiles(dir, base = dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...collectFiles(full, base));
    } else if (!entry.endsWith(".map")) {
      files.push(relative(base, full).replace(/\\/g, "/"));
    }
  }
  return files;
}

function main() {
  if (!existsSync(distDir)) {
    throw new Error("dist/ not found. Run npm run build first.");
  }
  if (!existsSync(join(distDir, "manifest.json"))) {
    throw new Error("dist/manifest.json missing.");
  }

  mkdirSync(outDir, { recursive: true });
  const pkg = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));
  const zipName = `seo-audit-extension-v${pkg.version}.zip`;
  const zipPath = join(outDir, zipName);
  const files = collectFiles(distDir);

  const staging = join(outDir, "_staging");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  for (const file of files) {
    const dest = join(staging, file);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(distDir, file), dest);
  }

  if (existsSync(zipPath)) rmSync(zipPath, { force: true });

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path (Join-Path '${staging.replace(/'/g, "''")}' '*') -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ],
    { encoding: "utf8" },
  );

  rmSync(staging, { recursive: true, force: true });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Compress-Archive failed");
  }

  console.log(`Packaged ${files.length} files → ${zipPath}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
