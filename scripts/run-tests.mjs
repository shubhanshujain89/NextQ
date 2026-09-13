import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const roots = ['server', 'src'];

const findTests = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findTests(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(entryPath);
    }
  }
  return files;
};

const testFiles = (await Promise.all(roots.map(findTests)))
  .flat()
  .sort();

if (!testFiles.length) {
  console.error('No TypeScript test files were found.');
  process.exit(1);
}

const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...testFiles], {
  stdio: 'inherit',
  shell: false,
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Test runner terminated by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
