import { execFileSync } from 'node:child_process';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf-8' }).trim();

if (branch !== 'master') {
  console.error(`Error: releases must be cut from master, but current branch is "${branch}".`);
  console.error('Run: git checkout master && git pull');
  process.exit(1);
}

const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf-8' }).trim();

if (status) {
  console.error('Error: working tree has uncommitted changes. Commit or stash them first.');
  process.exit(1);
}
