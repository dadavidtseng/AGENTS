/**
 * ToolForm — Auto-generated form from JSON schema for tool invocation.
 *
 * Supports: string, number, boolean, object (nested), array (of strings).
 * Renders form fields dynamically based on inputSchema properties.
 */

import { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

export interface ToolSchema {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

// ---------------------------------------------------------------------------
// Field renderers
// ---------------------------------------------------------------------------

function StringField({
  name, prop, value, onChange,
}: {
  name: string; prop: SchemaProperty; value: string; onChange: (v: string) => void;
}) {
  if (prop.enum) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg-elevated/40 text-sm text-text-primary focus:outline-none focus:border-blue/40 transition-colors"
      >
        <option value="">— select —</option>
        {prop.enum.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }

  // Multi-line if description hints at it or name suggests content
  const multiline = /description|content|body|text|guide|criteria/i.test(name);

  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={prop.description ?? name}
        className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg-elevated/40 text-sm text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-blue/40 transition-colors resize-y"
      />
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={prop.description ?? name}
      className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg-elevated/40 text-sm text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-blue/40 transition-colors"
    />
  );
}

function NumberField({
  value, onChange, prop,
}: {
  value: string; onChange: (v: string) => void; prop: SchemaProperty;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={prop.description ?? '0'}
      className="w-full px-3 py-1.5 rounded-lg border border-border bg-bg-elevated/40 text-sm text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-blue/40 transition-colors"
    />
  );
}

function BooleanField({
  name, value, onChange,
}: {
  name: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-blue cursor-pointer"
      />
      <span className="text-sm text-text-secondary">{name}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Schema → form values
// ---------------------------------------------------------------------------

function defaultValues(schema: ToolSchema): Record<string, unknown> {
  const vals: Record<string, unknown> = {};
  if (!schema.properties) return vals;

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.default !== undefined) {
      vals[key] = prop.default;
    } else if (prop.type === 'boolean') {
      vals[key] = false;
    } else if (prop.type === 'number' || prop.type === 'integer') {
      vals[key] = '';
    } else if (prop.type === 'array') {
      vals[key] = '';
    } else {
      vals[key] = '';
    }
  }
  return vals;
}

function formToArgs(values: Record<string, unknown>, schema: ToolSchema): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (!schema.properties) return args;

  for (const [key, prop] of Object.entries(schema.properties)) {
    const val = values[key];
    if (val === '' || val === undefined || val === null) continue;

    if (prop.type === 'number' || prop.type === 'integer') {
      const n = Number(val);
      if (!isNaN(n)) args[key] = n;
    } else if (prop.type === 'boolean') {
      args[key] = Boolean(val);
    } else if (prop.type === 'array') {
      // Comma-separated string → array
      const str = String(val).trim();
      if (str) args[key] = str.split(',').map((s) => s.trim());
    } else if (prop.type === 'object') {
      // Try JSON parse
      try { args[key] = JSON.parse(String(val)); } catch { /* skip */ }
    } else {
      args[key] = String(val);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface ToolFormProps {
  schema: ToolSchema;
  onSubmit: (args: Record<string, unknown>) => void;
  loading?: boolean;
  className?: string;
}

export function ToolForm({ schema, onSubmit, loading = false, className = '' }: ToolFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultValues(schema));

  const updateField = useCallback((key: string, val: unknown) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formToArgs(values, schema));
  };

  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  // Reset when schema changes
  const schemaKey = JSON.stringify(Object.keys(properties));

  return (
    <form key={schemaKey} onSubmit={handleSubmit} className={className}>
      <div className="space-y-3">
        {Object.entries(properties).map(([key, prop]) => (
          <div key={key}>
            <label className="flex items-center gap-1.5 text-[0.75rem] font-medium text-text-secondary mb-1">
              {key}
              {required.has(key) && <span className="text-red">*</span>}
              {prop.type && (
                <span className="font-mono text-[0.6rem] text-text-tertiary">({prop.type})</span>
              )}
            </label>

            {prop.description && (
              <p className="text-[0.65rem] text-text-tertiary mb-1">{prop.description}</p>
            )}

            {prop.type === 'boolean' ? (
              <BooleanField
                name={key}
                value={Boolean(values[key])}
                onChange={(v) => updateField(key, v)}
              />
            ) : prop.type === 'number' || prop.type === 'integer' ? (
              <NumberField
                value={String(values[key] ?? '')}
                onChange={(v) => updateField(key, v)}
                prop={prop}
              />
            ) : (
              <StringField
                name={key}
                prop={prop}
                value={String(values[key] ?? '')}
                onChange={(v) => updateField(key, v)}
              />
            )}
          </div>
        ))}
      </div>

      {Object.keys(properties).length === 0 && (
        <p className="text-sm text-text-tertiary py-2">This tool takes no parameters</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-4 px-5 py-2 rounded-lg bg-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity cursor-pointer"
      >
        {loading ? 'Executing…' : 'Execute'}
      </button>
    </form>
  );
}

export { defaultValues, formToArgs };
