// Driver for the markdown-render-speed-02 entry.
//
// The harness runs `node /bot/main.ts` (Node 22, type stripping). It reads
// every case from the input directory's cases.json — a JSON array of
// {"id", "markdown"} objects — renders each case on its own with parse()
// from parse.js, and writes the input directory's html.json: a JSON array
// of the HTML strings, one per case and in the cases' order.
//
// Outside a container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in
// for /input and /output.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

interface Case {
  id: string;
  markdown: string;
}

function readCases(inputDir: string): Case[] {
  const raw = readFileSync(join(inputDir, 'cases.json'), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('cases.json is not an array');
  return parsed as Case[];
}

function renderAll(cases: Case[]): string[] {
  const html = new Array<string>(cases.length);
  for (let i = 0; i < cases.length; i++) html[i] = parse(cases[i].markdown);
  return html;
}

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  if (!existsSync(inputDir)) throw new Error(`input directory not found: ${inputDir}`);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const html = renderAll(readCases(inputDir));
  writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
}

main();
