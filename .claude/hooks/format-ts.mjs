#!/usr/bin/env node
// PostToolUse hook: format + lint-fix a TypeScript/JS file after Claude writes or edits it.
// Reads the hook payload as JSON on stdin, extracts the file path, and runs the project's
// local prettier + eslint on just that file. Silent + non-blocking (always exits 0).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input || '{}');
  } catch {
    process.exit(0);
  }

  const file = data?.tool_input?.file_path || data?.tool_response?.filePath || '';
  const norm = file.replace(/\\/g, '/');

  // Only touch source files; skip generated / vendored dirs.
  if (!/\.(ts|tsx|js|mjs|cjs)$/.test(norm)) process.exit(0);
  if (/(^|\/)(prisma|node_modules|dist)\//.test(norm)) process.exit(0);
  if (!existsSync(file)) process.exit(0);

  const bin = (name) =>
    process.platform === 'win32'
      ? `node_modules/.bin/${name}.exe`
      : `node_modules/.bin/${name}`;

  // Prettier first (fast), then eslint --fix. Ignore all output/errors — never block an edit.
  spawnSync(bin('prettier'), ['--write', '--ignore-unknown', file], { stdio: 'ignore' });
  spawnSync(bin('eslint'), ['--fix', '--no-error-on-unmatched-pattern', file], {
    stdio: 'ignore',
  });

  process.exit(0);
});
