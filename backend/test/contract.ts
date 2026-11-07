import { readFileSync } from 'fs';
import path from 'path';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';

interface OpenApiDocument {
  info: { version: string };
  paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
  components: { schemas: Record<string, unknown> };
}

const spec = yaml.load(readFileSync(path.resolve(__dirname, '../../api/openapi.yaml'), 'utf8')) as OpenApiDocument;

const DROP = new Set([
  'description',
  'example',
  'examples',
  'deprecated',
  'xml',
  'externalDocs',
  'discriminator',
  'readOnly',
  'writeOnly',
  'title',
]);

function deref(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((item) => deref(item));
  if (!schema || typeof schema !== 'object') return schema;
  const record = schema as Record<string, unknown>;
  if (typeof record.$ref === 'string') {
    const parts = record.$ref.replace(/^#\//, '').split('/');
    let cursor: unknown = spec;
    for (const part of parts) {
      if (!cursor || typeof cursor !== 'object') {
        throw new Error(`Unresolvable $ref ${record.$ref}`);
      }
      cursor = (cursor as Record<string, unknown>)[decodeURIComponent(part)];
    }
    return deref(cursor);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = deref(value);
  }
  return out;
}

function normalize(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((item) => normalize(item));
  if (!schema || typeof schema !== 'object') return schema;
  const record = schema as Record<string, unknown>;
  if (record.nullable === true) {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'nullable') rest[key] = value;
    }
    return { anyOf: [normalize(rest), { type: 'null' }] };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'nullable' || DROP.has(key)) continue;
    out[key] = normalize(value);
  }
  return out;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
for (const name of ['password', 'double', 'int32', 'int64', 'byte', 'binary']) {
  ajv.addFormat(name, true);
}

const cache = new Map<string, ValidateFunction>();

function compile(key: string, schema: unknown): ValidateFunction {
  const existing = cache.get(key);
  if (existing) return existing;
  const validate = ajv.compile(schema as object);
  cache.set(key, validate);
  return validate;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = /token|password|secret|payload|authorization/i.test(key) ? '[redacted]' : redact(inner);
    }
    return out;
  }
  return value;
}

export function contractVersion(): string {
  return spec.info.version;
}

export function assertSchema(schemaName: string, body: unknown): void {
  const raw = spec.components.schemas[schemaName];
  if (!raw) throw new Error(`missing schema ${schemaName}`);
  const validate = compile(`schema:${schemaName}`, normalize(deref(raw)));
  if (!validate(body)) {
    throw new Error(`${schemaName} schema mismatch: ${ajv.errorsText(validate.errors)} body=${JSON.stringify(redact(body))}`);
  }
}

export function assertOperationResponse(operationId: string, status: number, body: unknown): void {
  const schema = responseSchema(operationId, status);
  const validate = compile(`${operationId}:${status}`, schema);
  if (!validate(body)) {
    throw new Error(
      `${operationId} ${status} schema mismatch: ${ajv.errorsText(validate.errors)} body=${JSON.stringify(redact(body))}`,
    );
  }
}

function responseSchema(operationId: string, status: number): unknown {
  for (const item of Object.values(spec.paths)) {
    for (const operation of Object.values(item)) {
      if (!operation || typeof operation !== 'object' || operation.operationId !== operationId) continue;
      const raw = operation.responses?.[String(status)];
      if (!raw) throw new Error(`no response ${status} for ${operationId}`);
      const resolved = deref(raw) as { content?: { 'application/json'?: { schema?: unknown } } };
      const schema = resolved.content?.['application/json']?.schema;
      if (!schema) throw new Error(`no json schema for ${operationId} ${status}`);
      return normalize(deref(schema));
    }
  }
  throw new Error(`operation ${operationId} not found`);
}
