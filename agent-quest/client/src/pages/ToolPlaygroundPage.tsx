/**
 * ToolPlaygroundPage — Interactive tool invocation interface.
 *
 * Features:
 *  - Tool selector dropdown with search
 *  - Auto-generated input form from JSON schema
 *  - Execute tool via backend proxy
 *  - JSON result display with syntax highlighting
 *  - Save/load invocation presets (localStorage)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiClient } from '../api/client';
import { ToolForm, type ToolSchema } from '../components/ToolForm';
import { useObserverTools } from '../contexts/ObserverContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: ToolSchema;
}

interface Preset {
  name: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface ExecutionResult {
  data: unknown;
  duration: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Presets (localStorage)
// ---------------------------------------------------------------------------

const PRESETS_KEY = 'tool-playground-presets';

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePresets(presets: Preset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

// ---------------------------------------------------------------------------
// JSON syntax highlighter (minimal, dark theme)
// ---------------------------------------------------------------------------

function highlightJson(json: string): string {
  let result = '';
  let i = 0;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  while (i < json.length) {
    const ch = json[i];

    if (ch === '"') {
      // Parse the full string token (handles escapes correctly)
      let str = '"';
      i++;
      while (i < json.length && json[i] !== '"') {
        if (json[i] === '\\' && i + 1 < json.length) {
          str += json[i] + json[i + 1];
          i += 2;
        } else {
          str += json[i];
          i++;
        }
      }
      str += '"';
      i++; // skip closing quote

      // Look ahead: key if followed by ':', value otherwise
      let j = i;
      while (j < json.length && json[j] === ' ') j++;
      const cls = json[j] === ':' ? 'text-blue' : 'text-green';
      result += `<span class="${cls}">${esc(str)}</span>`;
    } else if (ch === 't' && json.slice(i, i + 4) === 'true') {
      result += '<span class="text-yellow">true</span>';
      i += 4;
    } else if (ch === 'f' && json.slice(i, i + 5) === 'false') {
      result += '<span class="text-yellow">false</span>';
      i += 5;
    } else if (ch === 'n' && json.slice(i, i + 4) === 'null') {
      result += '<span class="text-red">null</span>';
      i += 4;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let num = '';
      while (i < json.length && /[\d.eE+\-]/.test(json[i])) {
        num += json[i];
        i++;
      }
      result += `<span class="text-[#c084fc]">${num}</span>`;
    } else {
      result += esc(ch);
      i++;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fallback: Raw JSON form for tools without inputSchema
// ---------------------------------------------------------------------------

type ToolSource = 'api' | 'observer';

function RawJsonForm({
  onSubmit,
  loading = false,
  className = '',
}: {
  onSubmit: (args: Record<string, unknown>) => void;
  loading?: boolean;
  className?: string;
}) {
  const [raw, setRaw] = useState('{}');
  const [parseError, setParseError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsed = JSON.parse(raw);
      setParseError(null);
      onSubmit(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  return (
    <form onSubmit={handleSubmit} className={className}>
      <p className="text-[0.7rem] text-text-tertiary mb-2">
        No schema available — enter raw JSON arguments.
      </p>
      <textarea
        value={raw}
        onChange={(e) => { setRaw(e.target.value); setParseError(null); }}
        rows={8}
        spellCheck={false}
        className="w-full rounded-lg border border-border bg-bg-elevated/40 p-3 font-mono text-[0.8rem] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-blue/40 transition-colors resize-y"
        placeholder='{ "key": "value" }'
      />
      {parseError && (
        <p className="text-[0.65rem] text-red mt-1">{parseError}</p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="mt-3 px-4 py-2 rounded-lg text-sm font-medium bg-blue text-white hover:bg-blue/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
      >
        {loading ? 'Executing…' : 'Execute'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ToolPlaygroundPage() {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [toolSource, setToolSource] = useState<ToolSource>('api');
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [lastArgs, setLastArgs] = useState<Record<string, unknown>>({});

  // Observer tools as fallback
  const observerTools = useObserverTools();
  const triedApi = useRef(false);

  // Fetch tools — try API first, fall back to observer tool inventory
  useEffect(() => {
    if (triedApi.current) return;
    triedApi.current = true;

    (async () => {
      try {
        const data = await apiClient.listTools();
        if (data.length > 0) {
          setTools(data as ToolDef[]);
          setToolSource('api');
          setLoading(false);
          return;
        }
      } catch (err) {
        console.error('[playground] Failed to load tools from API:', err);
      }
      // API returned empty or failed — fall back to observer
      if (observerTools.length > 0) {
        setTools(observerTools.map((t) => ({ name: t.name })));
        setToolSource('observer');
        console.info(`[playground] Fell back to observer tool inventory (${observerTools.length} tools)`);
      }
      setLoading(false);
    })();
  }, [observerTools]);

  // Keep observer fallback in sync if tools arrive later (SSE may be slow)
  useEffect(() => {
    if (toolSource === 'api' || loading) return;
    if (tools.length === 0 && observerTools.length > 0) {
      setTools(observerTools.map((t) => ({ name: t.name })));
      setToolSource('observer');
    }
  }, [observerTools, toolSource, loading, tools.length]);

  const activeTool = useMemo(
    () => tools.find((t) => t.name === selectedTool),
    [tools, selectedTool],
  );

  const filteredTools = useMemo(() => {
    if (!searchQuery) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
    );
  }, [tools, searchQuery]);

  // Execute tool
  const handleExecute = useCallback(async (args: Record<string, unknown>) => {
    if (!selectedTool) return;
    setLastArgs(args);
    setExecuting(true);
    setResult(null);

    const start = performance.now();
    try {
      const data = await apiClient.executeTool(selectedTool, args);
      setResult({ data, duration: performance.now() - start });
    } catch (err) {
      setResult({
        data: null,
        duration: performance.now() - start,
        error: err instanceof Error ? err.message : 'Execution failed',
      });
    } finally {
      setExecuting(false);
    }
  }, [selectedTool]);

  // Presets
  const handleSavePreset = () => {
    const name = prompt('Preset name:');
    if (!name?.trim()) return;
    const next = [
      ...presets.filter((p) => p.name !== name.trim()),
      { name: name.trim(), toolName: selectedTool, args: lastArgs },
    ];
    setPresets(next);
    savePresets(next);
  };

  const handleLoadPreset = (preset: Preset) => {
    setSelectedTool(preset.toolName);
    setLastArgs(preset.args);
  };

  const handleDeletePreset = (name: string) => {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    savePresets(next);
  };

  const toolPresets = presets.filter((p) => p.toolName === selectedTool);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">Tool Playground</h1>
          <p className="text-sm text-text-tertiary mt-0.5">
            Interactive tool testing and debugging
          </p>
        </div>
        <span className="font-mono text-sm text-text-tertiary">
          {tools.length} tool{tools.length !== 1 ? 's' : ''}
          {toolSource === 'observer' && (
            <span className="ml-2 text-[0.65rem] text-yellow" title="Broker admin API unreachable — showing tools from observer SSE (no schema available)">
              (observer fallback)
            </span>
          )}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-text-tertiary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* Left panel: tool selector */}
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search tools..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-bg-elevated/40 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-blue/40 transition-colors"
              />
            </div>

            {/* Tool list */}
            <div className="rounded-xl border border-border bg-bg-card overflow-hidden max-h-[60vh] overflow-y-auto">
              {filteredTools.length === 0 ? (
                <div className="px-4 py-8 text-center text-text-tertiary text-sm">
                  No tools found
                </div>
              ) : (
                filteredTools.map((tool) => (
                  <button
                    key={tool.name}
                    onClick={() => { setSelectedTool(tool.name); setResult(null); }}
                    className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors cursor-pointer ${
                      selectedTool === tool.name
                        ? 'bg-blue/10 border-l-2 border-l-blue'
                        : 'hover:bg-bg-elevated/40'
                    }`}
                  >
                    <div className="font-mono text-[0.75rem] text-text-primary truncate">
                      {tool.name}
                    </div>
                    {tool.description && (
                      <div className="text-[0.65rem] text-text-tertiary mt-0.5 line-clamp-2">
                        {tool.description}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right panel: form + result */}
          <div className="space-y-4">
            {!activeTool ? (
              <div className="rounded-xl border border-border bg-bg-card p-8 text-center text-text-tertiary text-sm">
                Select a tool from the list to get started
              </div>
            ) : (
              <>
                {/* Tool header */}
                <div className="rounded-xl border border-border bg-bg-card p-6">
                  <h2 className="font-mono text-base font-medium text-text-primary mb-1">
                    {activeTool.name}
                  </h2>
                  {activeTool.description && (
                    <p className="text-sm text-text-tertiary">{activeTool.description}</p>
                  )}

                  {/* Presets for this tool */}
                  {toolPresets.length > 0 && (
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <span className="text-[0.65rem] text-text-tertiary uppercase tracking-wider">Presets:</span>
                      {toolPresets.map((p) => (
                        <span key={p.name} className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleLoadPreset(p)}
                            className="text-[0.7rem] px-2 py-0.5 rounded-md border border-border text-text-secondary hover:bg-bg-elevated transition-colors cursor-pointer"
                          >
                            {p.name}
                          </button>
                          <button
                            onClick={() => handleDeletePreset(p.name)}
                            className="text-text-tertiary hover:text-red text-[0.7rem] cursor-pointer"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Input form */}
                <div className="rounded-xl border border-border bg-bg-card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-text-primary">Parameters</h3>
                    {Object.keys(lastArgs).length > 0 && (
                      <button
                        onClick={handleSavePreset}
                        className="text-[0.7rem] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
                      >
                        Save as preset…
                      </button>
                    )}
                  </div>
                  {activeTool.inputSchema && Object.keys(activeTool.inputSchema.properties ?? {}).length > 0 ? (
                    <ToolForm
                      schema={activeTool.inputSchema}
                      onSubmit={handleExecute}
                      loading={executing}
                    />
                  ) : (
                    <RawJsonForm
                      onSubmit={handleExecute}
                      loading={executing}
                    />
                  )}
                </div>

                {/* Result */}
                {result && (
                  <div className="rounded-xl border border-border bg-bg-card p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-text-primary">
                        {result.error ? 'Error' : 'Result'}
                      </h3>
                      <span className="font-mono text-[0.65rem] text-text-tertiary">
                        {Math.round(result.duration)}ms
                      </span>
                    </div>

                    {result.error ? (
                      <div className="p-3 rounded-lg bg-red/10 border border-red/20 text-sm text-red">
                        {result.error}
                      </div>
                    ) : (
                      <pre
                        className="p-4 rounded-lg bg-bg-elevated/60 border border-border/30 text-[0.8rem] leading-relaxed overflow-x-auto max-h-[50vh] overflow-y-auto"
                        style={{ fontFamily: "'JetBrains Mono', monospace" }}
                        dangerouslySetInnerHTML={{
                          __html: highlightJson(JSON.stringify(result.data, null, 2)),
                        }}
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
