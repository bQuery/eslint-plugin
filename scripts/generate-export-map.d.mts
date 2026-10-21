/** Absolute path of `src/export-map.json`. */
export declare const EXPORT_MAP_PATH: string;

/** Directory of the installed `@bquery/bquery` package. */
export declare const BQUERY_DIR: string;

/** Module subpaths (`core`, `view/compiler`, …) from the installed package's `exports`. */
export declare function readSubpaths(): Promise<string[]>;

/** Build the export → subpath map from the published declaration files. */
export declare function buildExportMap(): Promise<{
  map: Record<string, string>;
  unmapped: string[];
  version: string;
}>;

/** Serialise the map as committed (Prettier-formatted JSON). */
export declare function formatExportMap(map: Record<string, string>): Promise<string>;
