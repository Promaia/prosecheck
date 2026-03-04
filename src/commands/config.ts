import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { ConfigSchema } from '../lib/config-schema.js';
import { loadConfig } from '../lib/config.js';
import type { z } from 'zod';

export interface ConfigOptions {
  projectRoot: string;
  action: 'list' | 'set';
  /** For set: "key=value" pairs */
  args: string[];
}

/**
 * Entry point for the `prosecheck config` command.
 */
export async function config(options: ConfigOptions): Promise<void> {
  if (options.action === 'list') {
    await configList(options.projectRoot);
  } else {
    await configSet(options.projectRoot, options.args);
  }
}

// --- config list ---

interface FieldInfo {
  path: string;
  description: string;
  defaultValue: unknown;
  currentValue: unknown;
}

// Internal representation of a Zod schema's _def for introspection.
// Zod v4 uses `_def.type` (string) and top-level `.description`.
interface ZodDef {
  type?: string;
  innerType?: z.ZodType;
  shape?: Record<string, z.ZodType>;
}

function getDef(zodType: z.ZodType): ZodDef {
  return (zodType as unknown as { _def: ZodDef })._def;
}

function getTypeString(zodType: z.ZodType): string | undefined {
  const def = getDef(zodType);
  if (def.type) return def.type;
  // Fallback: check top-level .type property (Zod v4 leaf types)
  return (zodType as unknown as { type?: string }).type;
}

function getDescription(zodType: z.ZodType): string | undefined {
  return (zodType as unknown as { description?: string }).description;
}

/**
 * Unwrap ZodDefault, ZodOptional, etc. to get the inner type.
 */
function unwrap(zodType: z.ZodType): z.ZodType {
  const typeName = getTypeString(zodType);
  if (
    typeName === 'default' ||
    typeName === 'optional' ||
    typeName === 'nullable'
  ) {
    const inner = getDef(zodType).innerType;
    if (inner) return unwrap(inner);
  }
  return zodType;
}

function isZodObject(zodType: z.ZodType): boolean {
  return getTypeString(zodType) === 'object';
}

function getShape(zodType: z.ZodType): Record<string, z.ZodType> | undefined {
  return getDef(zodType).shape;
}

/**
 * Walk the Zod schema and current config to produce a flat list of fields.
 */
export function extractFields(
  schema: z.ZodObject<z.ZodRawShape>,
  current: Record<string, unknown>,
  defaults: Record<string, unknown>,
  prefix = '',
): FieldInfo[] {
  const fields: FieldInfo[] = [];
  const shape = schema.shape as Record<string, z.ZodType>;

  for (const [key, zodType] of Object.entries(shape)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    const inner = unwrap(zodType);
    const description = getDescription(zodType) ?? '';
    const defaultVal = defaults[key];
    const currentVal = current[key];

    // For nested plain objects with a known Zod object shape, recurse
    if (
      isZodObject(inner) &&
      isPlainObject(currentVal) &&
      isPlainObject(defaultVal)
    ) {
      fields.push(
        ...extractFields(
          inner as z.ZodObject<z.ZodRawShape>,
          currentVal,
          defaultVal,
          fieldPath,
        ),
      );
    } else {
      fields.push({
        path: fieldPath,
        description,
        defaultValue: defaultVal,
        currentValue: currentVal,
      });
    }
  }

  return fields;
}

async function configList(projectRoot: string): Promise<void> {
  const { config: current } = await loadConfig({ projectRoot });
  const defaults = ConfigSchema.parse({});

  const fields = extractFields(
    ConfigSchema,
    current as unknown as Record<string, unknown>,
    defaults as unknown as Record<string, unknown>,
  );

  for (const field of fields) {
    const isDefault =
      JSON.stringify(field.currentValue) === JSON.stringify(field.defaultValue);
    const valueStr = formatValue(field.currentValue);
    const marker = isDefault ? pc.dim('(default)') : pc.yellow('(modified)');

    process.stdout.write(`${pc.bold(field.path)} = ${valueStr} ${marker}\n`);
    if (field.description) {
      process.stdout.write(`  ${pc.dim(field.description)}\n`);
    }
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return pc.green(`"${value}"`);
  if (typeof value === 'boolean') return pc.cyan(String(value));
  if (typeof value === 'number') return pc.cyan(String(value));
  if (Array.isArray(value)) {
    if (value.length === 0) return pc.dim('[]');
    return pc.green(JSON.stringify(value));
  }
  return pc.dim(JSON.stringify(value));
}

// --- config set ---

async function configSet(projectRoot: string, args: string[]): Promise<void> {
  if (args.length === 0) {
    process.stderr.write('Usage: prosecheck config set <key>=<value> [...]\n');
    process.exitCode = 2;
    return;
  }

  const configDir = path.join(projectRoot, '.prosecheck');
  const configPath = path.join(configDir, 'config.json');

  // Load existing on-disk config (raw, not layered)
  let rawConfig: Record<string, unknown> = {};
  try {
    const content = await readFile(configPath, 'utf-8');
    rawConfig = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // No existing config file — start from empty
  }

  const defaults = ConfigSchema.parse({}) as unknown as Record<string, unknown>;

  for (const arg of args) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx === -1) {
      process.stderr.write(
        `Invalid argument: ${arg}. Expected key=value format.\n`,
      );
      process.exitCode = 2;
      return;
    }

    const key = arg.slice(0, eqIdx);
    const rawValue = arg.slice(eqIdx + 1);

    // Validate key exists in schema
    const schemaType = resolveSchemaType(ConfigSchema, key);
    if (!schemaType) {
      process.stderr.write(`Unknown config key: ${key}\n`);
      process.stderr.write(
        `Run "prosecheck config list" to see available keys.\n`,
      );
      process.exitCode = 2;
      return;
    }

    const coerced = coerceValue(rawValue, unwrap(schemaType));
    if (coerced.error) {
      process.stderr.write(`Invalid value for ${key}: ${coerced.error}\n`);
      process.exitCode = 2;
      return;
    }

    // If the value matches the default, remove it from raw config (keep config minimal)
    const defaultVal = getNestedValue(defaults, key);
    if (JSON.stringify(coerced.value) === JSON.stringify(defaultVal)) {
      deleteNestedKey(rawConfig, key);
    } else {
      setNestedValue(rawConfig, key, coerced.value);
    }
  }

  // Clean up empty parent objects
  cleanEmptyObjects(rawConfig);

  // Validate the full config would be valid
  const merged = { ...rawConfig };
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    process.stderr.write('Configuration would be invalid after this change:\n');
    for (const issue of result.error.issues) {
      process.stderr.write(`  ${issue.path.join('.')}: ${issue.message}\n`);
    }
    process.exitCode = 2;
    return;
  }

  // Write
  await mkdir(configDir, { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(rawConfig, null, 2) + '\n',
    'utf-8',
  );

  for (const arg of args) {
    const eqIdx = arg.indexOf('=');
    const key = arg.slice(0, eqIdx);
    const rawValue = arg.slice(eqIdx + 1);
    process.stdout.write(`Set ${key} = ${rawValue}\n`);
  }
}

// --- Zod schema resolution ---

/**
 * Resolve a dot-path key to the Zod schema type at that path.
 */
export function resolveSchemaType(
  schema: z.ZodObject<z.ZodRawShape>,
  dotPath: string,
): z.ZodType | undefined {
  const parts = dotPath.split('.');
  let current: z.ZodType = schema;

  for (const part of parts) {
    const inner = unwrap(current);
    if (!isZodObject(inner)) return undefined;

    const shape = getShape(inner);
    if (!shape) return undefined;
    const field = shape[part];
    if (!field) return undefined;
    current = field;
  }

  return current;
}

type CoerceResult =
  | { value: unknown; error?: never }
  | { value?: never; error: string };

/**
 * Coerce a string value to the expected type based on Zod schema type.
 */
export function coerceValue(raw: string, zodType: z.ZodType): CoerceResult {
  const typeName = getTypeString(zodType);

  switch (typeName) {
    case 'string':
      return { value: raw };

    case 'boolean':
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: `expected "true" or "false", got "${raw}"` };

    case 'number': {
      const num = Number(raw);
      if (Number.isNaN(num))
        return { error: `expected a number, got "${raw}"` };
      return { value: num };
    }

    case 'array': {
      // Accept JSON array or comma-separated values
      if (raw.startsWith('[')) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!Array.isArray(parsed)) return { error: 'expected an array' };
          return { value: parsed };
        } catch {
          return { error: 'invalid JSON array' };
        }
      }
      // Empty string → empty array
      if (raw === '') return { value: [] };
      // Comma-separated
      return { value: raw.split(',').map((s) => s.trim()) };
    }

    case 'record': {
      // Records must be JSON
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          return { error: 'expected a JSON object' };
        }
        return { value: parsed };
      } catch {
        return { error: 'expected a JSON object' };
      }
    }

    default:
      // Try JSON parse as fallback
      try {
        return { value: JSON.parse(raw) as unknown };
      } catch {
        return { value: raw };
      }
  }
}

// --- Object path helpers ---

function getNestedValue(
  obj: Record<string, unknown>,
  dotPath: string,
): unknown {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function setNestedValue(
  obj: Record<string, unknown>,
  dotPath: string,
  value: unknown,
): void {
  const parts = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1] as string;
  current[lastKey] = value;
}

function deleteNestedKey(obj: Record<string, unknown>, dotPath: string): void {
  const parts = dotPath.split('.');
  const ancestors: Array<{ obj: Record<string, unknown>; key: string }> = [];
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    if (!isPlainObject(current[part])) return;
    ancestors.push({ obj: current, key: part });
    current = current[part];
  }

  const lastKey = parts[parts.length - 1] as string;
  Reflect.deleteProperty(current, lastKey);
}

function cleanEmptyObjects(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (isPlainObject(val)) {
      cleanEmptyObjects(val);
      if (Object.keys(val).length === 0) {
        Reflect.deleteProperty(obj, key);
      }
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
