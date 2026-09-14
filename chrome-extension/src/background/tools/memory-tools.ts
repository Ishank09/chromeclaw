import { getActiveAgentId, getWorkspaceFile } from './tool-utils';
import { hybridSearch } from '../memory/hybrid-search';
import { invalidateMemoryIndex, syncMemoryIndex } from '../memory/memory-sync';
import { createWorkspaceFile, listWorkspaceFiles, updateWorkspaceFile } from '@extension/storage';
import { nanoid } from 'nanoid';
import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

// ── memory_search ───────────────────────────────

const memorySearchSchema = Type.Object({
  query: Type.String({ description: 'Search query for keyword matching over memory files' }),
  maxResults: Type.Optional(Type.Number({ description: 'Max results (default: 10, max: 30)' })),
  minScore: Type.Optional(Type.Number({ description: 'Min relevance score (default: 0.0)' })),
});

type MemorySearchArgs = Static<typeof memorySearchSchema>;

const executeMemorySearch = async (args: MemorySearchArgs): Promise<string> => {
  const { query, maxResults, minScore } = args;

  if (!query.trim()) {
    return 'Error: query must not be empty.';
  }

  const agentId = await getActiveAgentId();
  const { index, chunks } = await syncMemoryIndex(agentId);
  const results = await hybridSearch(index, query, chunks, {
    maxResults: Math.min(maxResults ?? 10, 30),
    minScore: minScore ?? 0.0,
  });

  if (results.length === 0) {
    return 'No matching memory found.';
  }

  const lines = results.map(
    (r, i) => `[${i + 1}] ${r.citation} (score: ${r.score.toFixed(2)})\n${r.snippet}`,
  );
  return lines.join('\n\n');
};

// ── memory_get ──────────────────────────────────

const memoryGetSchema = Type.Object({
  path: Type.String({ description: 'File path (e.g. "memory/2026-02-15.md" or "MEMORY.md")' }),
  from: Type.Optional(Type.Number({ description: 'Start line (1-based, default: 1)' })),
  lines: Type.Optional(
    Type.Number({ description: 'Number of lines to return (default: all, max: 200)' }),
  ),
});

type MemoryGetArgs = Static<typeof memoryGetSchema>;

const executeMemoryGet = async (args: MemoryGetArgs): Promise<string> => {
  const { path, from, lines: lineCount } = args;

  const agentId = await getActiveAgentId();
  const file = await getWorkspaceFile(path, agentId);

  if (!file) {
    return `File not found: ${path}`;
  }

  if (!file.content) {
    return '(empty file)';
  }

  const allLines = file.content.split('\n');
  const startLine = Math.max((from ?? 1) - 1, 0);

  if (startLine >= allLines.length) {
    return `Line ${from} is beyond the end of the file (${allLines.length} lines total).`;
  }

  const count = Math.min(lineCount ?? allLines.length, 200);
  const selected = allLines.slice(startLine, startLine + count);

  return selected.map((line, i) => `${startLine + i + 1}: ${line}`).join('\n');
};

// ── memory_save ─────────────────────────────────

const memorySaveSchema = Type.Object({
  content: Type.String({ description: 'Text content to save into memory' }),
  title: Type.Optional(Type.String({ description: 'Optional heading/title for this memory entry' })),
});

type MemorySaveArgs = Static<typeof memorySaveSchema>;

const executeMemorySave = async (args: MemorySaveArgs): Promise<string> => {
  const { content, title } = args;
  if (!content.trim()) return 'Error: content must not be empty.';

  const agentId = await getActiveAgentId();
  const today = new Date().toISOString().split('T')[0]!;
  const path = `memory/${today}.md`;

  const timestamp = new Date().toLocaleTimeString();
  const heading = title ? `\n## ${title} — ${timestamp}\n` : `\n## Saved at ${timestamp}\n`;
  const entry = `${heading}\n${content.trim()}\n`;

  const allFiles = await listWorkspaceFiles(agentId);
  const existing = allFiles.find(f => f.name === path);

  if (existing) {
    await updateWorkspaceFile(existing.id, { content: (existing.content ?? '') + entry });
  } else {
    await createWorkspaceFile({
      id: nanoid(),
      name: path,
      content: `# Memory — ${today}\n${entry}`,
      enabled: true,
      owner: 'agent',
      predefined: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentId,
    });
  }

  invalidateMemoryIndex(agentId);
  return `Saved to ${path}.`;
};

export { memorySearchSchema, memoryGetSchema, memorySaveSchema, executeMemorySearch, executeMemoryGet, executeMemorySave };

// ── Tool registration ──
import type { ToolRegistration } from './tool-registration';

const memoryToolDefs: ToolRegistration[] = [
  {
    name: 'memory_search',
    label: 'Memory Search',
    description:
      'Search memory files using keyword matching (BM25). Returns ranked results with file paths, line ranges, and snippets. Use this to recall prior work, decisions, preferences, or stored knowledge.',
    schema: memorySearchSchema,
    execute: args => executeMemorySearch(args as any),
  },
  {
    name: 'memory_get',
    label: 'Memory Get',
    description:
      'Read specific lines from a memory or workspace file. Use this after memory_search to get full context around a search result.',
    schema: memoryGetSchema,
    execute: args => executeMemoryGet(args as any),
  },
  {
    name: 'memory_save',
    label: 'Memory Save',
    description:
      'Save text into memory. Use this whenever the user says "save this to memory", "remember this", "store this", or similar. Appends the content to today\'s memory file so it can be retrieved in future sessions.',
    schema: memorySaveSchema,
    execute: args => executeMemorySave(args as any),
  },
];

export { memoryToolDefs };
