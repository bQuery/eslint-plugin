#!/usr/bin/env bun
/**
 * Generate `src/export-map.json` for the `prefer-subpath-imports` rule: every
 * name exported from the root `@bquery/bquery` entry, mapped to the module
 * subpath (`@bquery/bquery/<subpath>`) that exports the same binding.
 *
 * The map is built from the published package installed in `node_modules`
 * (the `@bquery/bquery` dev dependency): the module subpaths are the keys of
 * its `package.json` `exports`, and each entry's declaration file (the
 * `types` condition, e.g. `dist/reactive/index.d.ts`) is read with the
 * TypeScript compiler API. Exports are matched by binding, not by name, so
 * renamed re-exports (`sanitize` → `sanitizeHtml`) and names that differ
 * between modules (`prefersReducedMotion` in `motion` vs `a11y`) resolve to
 * the module that declares them.
 *
 * Usage:
 *   bun run generate:export-map   # write src/export-map.json
 *   bun run check:export-map      # fail if it is stale
 *
 * To track a new bQuery release, bump the `@bquery/bquery` dev dependency,
 * run `bun install` and then `bun run generate:export-map`.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Path of the generated map. */
export const EXPORT_MAP_PATH = resolve(packageDir, 'src', 'export-map.json');

/** Directory of the installed `@bquery/bquery` package. */
export const BQUERY_DIR = dirname(
  createRequire(resolve(packageDir, 'package.json')).resolve('@bquery/bquery/package.json')
);

/** Export keys that are not module barrels. */
const NON_MODULE_EXPORTS = new Set(['.', './full', './package.json']);

/**
 * Find the declaration file of an `exports` entry: the `types` condition of
 * its `import` branch (or of the entry itself).
 *
 * @param {unknown} entry - Value of an `exports` key
 * @returns {string | null} Path relative to the package, or `null`
 */
const typesOf = (entry) => {
  if (typeof entry === 'string') return entry.endsWith('.d.ts') ? entry : null;
  if (!entry || typeof entry !== 'object') return null;
  const conditions = /** @type {Record<string, unknown>} */ (entry);
  if (typeof conditions.types === 'string') return conditions.types;
  return typesOf(conditions.import) ?? typesOf(conditions.default);
};

/**
 * Read the installed `@bquery/bquery` `package.json`.
 *
 * @returns {Promise<{ version: string, exports: Record<string, unknown> }>} The manifest
 */
const readManifest = async () =>
  JSON.parse(await readFile(resolve(BQUERY_DIR, 'package.json'), 'utf8'));

/**
 * Map each module subpath (`core`, `view/compiler`, …) in the installed
 * package's `exports` to its declaration file, in declaration order.
 *
 * @returns {Promise<Map<string, string>>} Subpath → absolute `.d.ts` path, for
 *   entries whose declaration file exists
 */
const readBarrels = async () => {
  const { exports } = await readManifest();
  const barrels = new Map();
  for (const [key, entry] of Object.entries(exports)) {
    if (NON_MODULE_EXPORTS.has(key) || /\.[a-z]+$/i.test(key)) continue;
    const types = typesOf(entry);
    const file = types && resolve(BQUERY_DIR, types);
    if (file && existsSync(file)) barrels.set(key.slice(2), file);
  }
  return barrels;
};

/**
 * Module subpaths (`core`, `view/compiler`, …) from the installed package's
 * `exports`, in declaration order.
 *
 * @returns {Promise<string[]>} Subpaths with a declaration file
 */
export const readSubpaths = async () => [...(await readBarrels()).keys()];

/**
 * Resolve an export symbol through aliases to the binding it names.
 *
 * @param {ts.TypeChecker} checker - Type checker
 * @param {ts.Symbol} symbol - Exported symbol
 * @returns {ts.Symbol} The original symbol
 */
const original = (checker, symbol) =>
  symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

/** Normalise a path to forward slashes. */
const posix = (path) => path.split(sep).join('/');

/**
 * Build the export → subpath map.
 *
 * @returns {Promise<{ map: Record<string, string>, unmapped: string[], version: string }>}
 *   The sorted map, the root exports no subpath re-exports, and the
 *   `@bquery/bquery` version it was built from
 */
export const buildExportMap = async () => {
  const manifest = await readManifest();
  const rootTypes = typesOf(manifest.exports['.']);
  if (!rootTypes) throw new Error('@bquery/bquery has no root declaration file');
  const rootFile = resolve(BQUERY_DIR, rootTypes);
  const barrelMap = await readBarrels();
  const subpaths = [...barrelMap.keys()];
  const barrels = [...barrelMap.values()];
  const program = ts.createProgram([rootFile, ...barrels], {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [],
    noEmit: true,
    skipLibCheck: true,
    strict: true,
  });
  const checker = program.getTypeChecker();
  /** @param {string} file */
  const exportsOf = (file) => {
    const source = program.getSourceFile(file);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!moduleSymbol) throw new Error(`Cannot resolve module ${relative(BQUERY_DIR, file)}`);
    return checker.getExportsOfModule(moduleSymbol);
  };

  /** name → [{ subpath, symbol }] for every barrel export. */
  const candidates = new Map();
  subpaths.forEach((subpath, index) => {
    for (const symbol of exportsOf(barrels[index])) {
      const list = candidates.get(symbol.name) ?? [];
      list.push({ subpath, symbol: original(checker, symbol) });
      candidates.set(symbol.name, list);
    }
  });

  /** Directory of each barrel, relative to the package (`dist/reactive/`). */
  const barrelDirs = new Map(
    subpaths.map((subpath, index) => [
      subpath,
      `${posix(relative(BQUERY_DIR, dirname(barrels[index])))}/`,
    ])
  );

  /**
   * Pick the subpath whose barrel directory holds the declaration (longest
   * match), falling back to the first barrel in `package.json` order.
   */
  const pick = (matches, symbol) => {
    const declarationFile = symbol.declarations?.[0]?.getSourceFile().fileName ?? '';
    const relativeFile = posix(relative(BQUERY_DIR, declarationFile));
    const owning = matches
      .filter(({ subpath }) => relativeFile.startsWith(barrelDirs.get(subpath)))
      .sort((a, b) => b.subpath.length - a.subpath.length);
    return (owning[0] ?? matches[0]).subpath;
  };

  /** @type {Record<string, string>} */
  const map = {};
  const unmapped = [];
  const rootExports = exportsOf(rootFile)
    .filter((symbol) => symbol.name !== 'default')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const rootSymbol of rootExports) {
    const name = rootSymbol.name;
    const target = original(checker, rootSymbol);
    const matches = (candidates.get(name) ?? []).filter(({ symbol }) => symbol === target);
    if (matches.length === 0) {
      unmapped.push(name);
      continue;
    }
    map[name] = pick(matches, target);
  }
  return { map, unmapped, version: manifest.version };
};

/**
 * Serialise the map with the repository's Prettier config.
 *
 * @param {Record<string, string>} map - Export → subpath map
 * @returns {Promise<string>} Formatted JSON
 */
export const formatExportMap = async (map) => {
  const prettier = await import('prettier');
  const options = (await prettier.resolveConfig(EXPORT_MAP_PATH)) ?? {};
  const value = {
    $comment:
      'Generated by scripts/generate-export-map.mjs from the published @bquery/bquery declaration files — do not edit by hand.',
    exports: map,
  };
  return prettier.format(JSON.stringify(value), { ...options, filepath: EXPORT_MAP_PATH });
};

const main = async () => {
  const check = process.argv.includes('--check');
  const { map, unmapped, version } = await buildExportMap();
  const content = await formatExportMap(map);
  const current = existsSync(EXPORT_MAP_PATH) ? await readFile(EXPORT_MAP_PATH, 'utf8') : '';
  const label = relative(packageDir, EXPORT_MAP_PATH);
  const summary = `${Object.keys(map).length} exports from @bquery/bquery@${version}`;
  if (unmapped.length > 0) {
    console.warn(`Root exports without a subpath: ${unmapped.join(', ')}`);
  }
  if (check) {
    if (current !== content) {
      console.error(`${label} is stale (${summary}). Run: bun run generate:export-map`);
      process.exit(1);
    }
    console.log(`${label} is up to date (${summary}).`);
    return;
  }
  if (current !== content) await writeFile(EXPORT_MAP_PATH, content);
  console.log(`Wrote ${label} (${summary}).`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
