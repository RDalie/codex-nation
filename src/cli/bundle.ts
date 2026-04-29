import { lstat, readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { GitBundleFile } from "../gitforge/GitForge.ts";

const MAX_BUNDLE_FILES = 300;
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
const SKIPPED_DIRS = new Set([
  ".agenthub-postgres",
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules"
]);
const SKIPPED_FILES = new Set([".DS_Store"]);

export type BundleManifest = {
  rootPath: string;
  files: GitBundleFile[];
  totalBytes: number;
};

export async function createBundle(input: { rootPath: string; primerPath: string }): Promise<BundleManifest> {
  const rootPath = resolve(input.rootPath);
  const primerPath = normalizeRelativePath(input.primerPath);
  const files: GitBundleFile[] = [];
  let totalBytes = 0;

  await walk(rootPath, rootPath, async (absolutePath, relativePath) => {
    const content = await readFile(absolutePath);
    totalBytes += content.byteLength;
    if (totalBytes > MAX_BUNDLE_BYTES) {
      throw new Error(`Bundle is too large. Maximum size is ${MAX_BUNDLE_BYTES} bytes.`);
    }

    files.push({ path: relativePath, contentBase64: content.toString("base64") });
    if (files.length > MAX_BUNDLE_FILES) {
      throw new Error(`Bundle has too many files. Maximum file count is ${MAX_BUNDLE_FILES}.`);
    }
  });

  if (!files.some((file) => file.path === primerPath)) {
    throw new Error(`Bundle must include ${primerPath}.`);
  }

  return { rootPath, files, totalBytes };
}

async function walk(
  rootPath: string,
  currentPath: string,
  onFile: (absolutePath: string, relativePath: string) => Promise<void>
): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) {
      continue;
    }

    if (entry.isFile() && shouldSkipFile(entry.name)) {
      continue;
    }

    const absolutePath = resolve(currentPath, entry.name);
    const stat = await lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      continue;
    }

    if (stat.isDirectory()) {
      await walk(rootPath, absolutePath, onFile);
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    await onFile(absolutePath, toBundlePath(relative(rootPath, absolutePath)));
  }
}

function shouldSkipFile(name: string): boolean {
  return SKIPPED_FILES.has(name) || name === ".env" || name.startsWith(".env.");
}

function normalizeRelativePath(path: string): string {
  return toBundlePath(path.replace(/^\/+/, "").replace(/^\.\//, ""));
}

function toBundlePath(path: string): string {
  return path.split(sep).join("/");
}
