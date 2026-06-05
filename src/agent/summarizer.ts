import fs from 'node:fs/promises';
import path from 'node:path';
import type OpenAI from 'openai';

const DEFAULT_MAX_INPUT_CHARS = 24_000;
const DEFAULT_FALLBACK_CHARS = 4_000;

const SUMMARY_SYSTEM_PROMPT = [
  'You are a context compactor for a local coding agent.',
  'Summarize prior conversation state so the agent can continue the task safely.',
  'Preserve concrete facts, file paths, user constraints, tool results, failures, and pending work.',
  'Do not invent completed work. Do not omit user refusals or safety constraints.',
  'Write concise Chinese unless the source text is mostly English.',
].join('\n');

export interface SummarizeConversationInput {
  client: OpenAI;
  model: string;
  text: string;
  signal: AbortSignal;
  focus?: string;
  compactInstructions?: string;
  maxInputChars?: number;
}

function clipInput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...input truncated before summarization...]`;
}

function buildSummaryPrompt(input: {
  text: string;
  focus?: string;
  compactInstructions?: string;
}): string {
  const parts = [
    'Compress the following conversation state for a coding agent.',
    '',
    'Required output sections:',
    '- Current goal',
    '- User constraints and preferences',
    '- Completed work',
    '- Important files and code changes',
    '- Tool results, tests, and errors',
    '- Pending work / next steps',
    '- Safety notes',
  ];

  if (input.focus?.trim()) {
    parts.push('', `User compact focus:\n${input.focus.trim()}`);
  }

  if (input.compactInstructions?.trim()) {
    parts.push('', `Project compact instructions:\n${input.compactInstructions.trim()}`);
  }

  parts.push('', `Conversation state:\n${input.text}`);
  return parts.join('\n');
}

export function fallbackSummary(text: string, maxChars = DEFAULT_FALLBACK_CHARS): string {
  const trimmed = text.trim();
  if (!trimmed) return 'No earlier conversation to summarize.';
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n[...fallback summary truncated...]`;
}

export async function summarizeConversation(input: SummarizeConversationInput): Promise<string> {
  const text = clipInput(input.text, input.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS);
  const response = await input.client.chat.completions.create(
    {
      model: input.model,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildSummaryPrompt({
            text,
            focus: input.focus,
            compactInstructions: input.compactInstructions,
          }),
        },
      ],
      max_tokens: 1200,
      temperature: 0,
    },
    { signal: input.signal },
  );

  const content = response.choices?.[0]?.message?.content?.trim();
  return content || fallbackSummary(text);
}

export async function loadCompactInstructions(cwd: string): Promise<string> {
  const candidates = [
    { label: 'AGENT.md', file: path.join(cwd, 'AGENT.md') },
    { label: '.agent/compact.md', file: path.join(cwd, '.agent', 'compact.md') },
  ];
  const sections: string[] = [];

  for (const candidate of candidates) {
    try {
      const text = (await fs.readFile(candidate.file, 'utf-8')).trim();
      if (text) sections.push(`## ${candidate.label}\n${text}`);
    } catch {
      // Compact instructions are optional; missing or unreadable files should not block work.
    }
  }

  return sections.join('\n\n');
}
