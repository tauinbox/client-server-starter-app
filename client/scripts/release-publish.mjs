import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
const version = pkg.version;
const tag = `v${version}`;

// Extract changelog notes for this version
const changelogPath = resolve(__dirname, '..', '..', 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf-8');

const sectionStart = changelog.indexOf(`## [${version}]`);
if (sectionStart === -1) {
  console.error(`Error: section for version ${version} not found in CHANGELOG.md`);
  process.exit(1);
}

const nextSection = changelog.indexOf('## [', sectionStart + 1);
const sectionEnd = nextSection === -1 ? changelog.length : nextSection;
const notes = changelog.slice(sectionStart, sectionEnd).trim();

const notesFile = resolve(tmpdir(), `release-notes-${version}.md`);
writeFileSync(notesFile, notes, 'utf-8');

// Verify tag exists locally
try {
  execFileSync('git', ['rev-parse', tag], { stdio: 'pipe' });
} catch {
  console.error(`Error: tag ${tag} does not exist locally. Run "npm run release" first.`);
  process.exit(1);
}

// Push branch + tag
console.log(`Pushing ${tag} to origin...`);
execFileSync('git', ['push', '--follow-tags'], { stdio: 'inherit' });

// Create GitHub Release
console.log(`Creating GitHub Release ${tag}...`);
execFileSync('gh', ['release', 'create', tag, '--title', tag, '--notes-file', notesFile], {
  stdio: 'inherit',
});

console.log(`\nRelease ${tag} published.`);
