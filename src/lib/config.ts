import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ConfigSchema, type Config, type PartialConfig } from './config-schema.js';

/**
 * Deep merge two objects. Arrays are replaced, not concatenated.
 * Only plain objects are recursively merged.
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  overlay: Partial<T>,
): T {
  const result = { ...base };

  for (const key of Object.keys(overlay) as Array<keyof T>) {
    const baseVal = base[key];
    const overlayVal = overlay[key];

    if (overlayVal === undefined) continue;

    if (isPlainObject(baseVal) && isPlainObject(overlayVal)) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overlayVal as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      result[key] = overlayVal as T[keyof T];
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolve which environment is active.
 */
export function resolveEnvironment(cliEnv?: string): string {
  if (cliEnv) return cliEnv;
  if (process.env['CI']) return 'ci';
  return 'interactive';
}

/**
 * Try to read and parse a JSON file. Returns undefined if the file doesn't exist.
 */
async function tryReadJsonFile(filePath: string): Promise<unknown> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as unknown;
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export interface LoadConfigOptions {
  /** Project root directory (where .prosecheck/ lives) */
  projectRoot: string;
  /** Environment name override (from --env flag) */
  env?: string;
  /** CLI flag overrides to apply on top of everything */
  cliOverrides?: PartialConfig;
}

export interface LoadConfigResult {
  config: Config;
  environment: string;
}

/**
 * Load configuration with full layering:
 *   1. config.json (base defaults)
 *   2. config.local.json (personal overrides)
 *   3. Environment overrides (from environments[env])
 *   4. CLI flags (highest priority)
 *
 * Throws ConfigError for validation failures.
 */
export async function loadConfig(
  options: LoadConfigOptions,
): Promise<LoadConfigResult> {
  const configDir = path.join(options.projectRoot, '.prosecheck');
  const configPath = path.join(configDir, 'config.json');
  const localConfigPath = path.join(configDir, 'config.local.json');

  // 1. Load base config
  const rawBase = await tryReadJsonFile(configPath);
  const baseResult = ConfigSchema.safeParse(rawBase ?? {});
  if (!baseResult.success) {
    throw ConfigError.fromZodIssues(
      `Invalid config in ${configPath}`,
      baseResult.error.issues,
    );
  }
  let config: Config = baseResult.data;

  // 2. Merge local config if present
  const rawLocal = await tryReadJsonFile(localConfigPath);
  if (rawLocal !== undefined) {
    // Local config is a partial overlay — validate structure loosely,
    // then deep merge onto the validated base
    if (!isPlainObject(rawLocal)) {
      throw new ConfigError(`${localConfigPath} must be a JSON object`, []);
    }
    config = deepMerge(config, rawLocal as Partial<Config>);
  }

  // 3. Apply environment overrides
  const environment = resolveEnvironment(options.env);
  const envOverride = config.environments[environment];
  if (envOverride) {
    config = deepMerge(config, envOverride as Partial<Config>);
  }

  // 4. Apply CLI flag overrides
  if (options.cliOverrides) {
    config = deepMerge(config, options.cliOverrides as Partial<Config>);
  }

  // Final validation of the fully merged config
  const finalResult = ConfigSchema.safeParse(config);
  if (!finalResult.success) {
    throw ConfigError.fromZodIssues(
      'Invalid configuration after merging all layers',
      finalResult.error.issues,
    );
  }

  return { config: finalResult.data, environment };
}

export interface ConfigIssue {
  path: PropertyKey[];
  message: string;
}

/**
 * Configuration error with structured issue details.
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly issues: ConfigIssue[],
  ) {
    const details =
      issues.length > 0
        ? '\n' +
          issues
            .map((i) => `  ${i.path.map(String).join('.')}: ${i.message}`)
            .join('\n')
        : '';
    super(`${message}${details}`);
    this.name = 'ConfigError';
  }

  static fromZodIssues(
    message: string,
    zodIssues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
  ): ConfigError {
    return new ConfigError(
      message,
      zodIssues.map((i) => ({ path: [...i.path], message: i.message })),
    );
  }
}
