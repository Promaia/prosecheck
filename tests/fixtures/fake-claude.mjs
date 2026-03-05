#!/usr/bin/env node

/**
 * Fake Claude CLI shim for integration tests.
 *
 * Simulates the `claude --print` interface by:
 * 1. Reading the prompt from stdin
 * 2. Extracting the output path(s) and rule name(s) from the prompt
 * 3. Writing JSON result files based on env-var behavior controls
 *
 * Environment variables:
 *   FAKE_CLAUDE_STATUS     - "pass" (default), "warn", or "fail"
 *   FAKE_CLAUDE_MALFORMED  - "1" to write invalid JSON
 *   FAKE_CLAUDE_TIMEOUT_MS - sleep duration before writing (ms)
 *   FAKE_CLAUDE_DROP       - "1" to skip writing output (simulates dropped rule)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Read prompt from stdin
const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const prompt = Buffer.concat(chunks).toString('utf-8');

if (!prompt) {
  console.error('fake-claude: no prompt received on stdin');
  process.exit(1);
}

// Extract all output paths: ``Write your result as JSON to: `<path>` ``
const outputPathRegex = /Write your result as JSON to: `(.+?)`/g;
const ruleNameRegex = /# Rule: (.+)/g;

const outputPaths = [];
let match;
while ((match = outputPathRegex.exec(prompt)) !== null) {
  outputPaths.push(match[1]);
}

const ruleNames = [];
while ((match = ruleNameRegex.exec(prompt)) !== null) {
  ruleNames.push(match[1]);
}

// If no output paths found, try the sequential orchestration format:
// `<name>: `<path>``
if (outputPaths.length === 0) {
  const orchestrationRegex = /`([^`]+\.json)`/g;
  while ((match = orchestrationRegex.exec(prompt)) !== null) {
    const candidate = match[1];
    if (candidate.includes('.prosecheck/working/outputs/')) {
      outputPaths.push(candidate);
    }
  }
}

// If still no output paths found, try agent teams format:
// The prompt lists prompt file paths like "* Rule Name: path/to/prompt.md"
// We read those prompt files to extract the output paths from them.
if (outputPaths.length === 0) {
  const promptFileRegex = /^\* .+?: (.+\.md)$/gm;
  const promptFiles = [];
  while ((match = promptFileRegex.exec(prompt)) !== null) {
    promptFiles.push(match[1]);
  }

  // Resolve prompt files relative to cwd (the project root)
  for (const pf of promptFiles) {
    try {
      const fullPath = path.resolve(pf);
      const content = await readFile(fullPath, 'utf-8');
      const pathMatch = content.match(/Write your result as JSON to: `(.+?)`/);
      if (pathMatch) {
        outputPaths.push(pathMatch[1]);
      }
      const nameMatch = content.match(/# Rule: (.+)/);
      if (nameMatch) {
        ruleNames.push(nameMatch[1]);
      }
    } catch {
      // Skip unreadable prompt files
    }
  }
}

if (outputPaths.length === 0) {
  console.error('fake-claude: could not extract output path from prompt');
  process.exit(1);
}

// Read behavior env vars
const status = process.env.FAKE_CLAUDE_STATUS || 'pass';
const malformed = process.env.FAKE_CLAUDE_MALFORMED === '1';
const timeoutMs = parseInt(process.env.FAKE_CLAUDE_TIMEOUT_MS || '0', 10);
const drop = process.env.FAKE_CLAUDE_DROP === '1';

// Optional sleep
if (timeoutMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

// If drop mode, exit without writing
if (drop) {
  process.exit(0);
}

// Write result for each output path
for (let i = 0; i < outputPaths.length; i++) {
  const outputPath = outputPaths[i];
  const ruleName = ruleNames[i] || path.basename(outputPath, '.json');
  const source = 'RULES.md';

  await mkdir(path.dirname(outputPath), { recursive: true });

  if (malformed) {
    await writeFile(outputPath, 'NOT VALID JSON {{{', 'utf-8');
    continue;
  }

  let result;
  if (status === 'pass') {
    result = { status: 'pass', rule: ruleName, source };
  } else if (status === 'warn') {
    result = {
      status: 'warn',
      rule: ruleName,
      source,
      headline: `Warning for ${ruleName}`,
      comments: [{ message: `Potential issue in ${ruleName}` }],
    };
  } else {
    result = {
      status: 'fail',
      rule: ruleName,
      source,
      headline: `Failure in ${ruleName}`,
      comments: [{ message: `Violation found in ${ruleName}` }],
    };
  }

  await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8');
}

process.exit(0);
