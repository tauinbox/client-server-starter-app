import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(rootDir, 'client');
const serverDir = path.join(rootDir, 'server');
const mockServerDir = path.join(rootDir, 'mock-server');
const clientBin = (cmd) => path.join(clientDir, 'node_modules', '.bin', cmd);
const serverBin = (cmd) => path.join(serverDir, 'node_modules', '.bin', cmd);
const mockServerBin = (cmd) =>
  path.join(mockServerDir, 'node_modules', '.bin', cmd);
const clientEslintConfig = path.join(clientDir, 'eslint.config.mjs');
const serverEslintConfig = path.join(serverDir, 'eslint.config.ts');
const mockServerEslintConfig = path.join(mockServerDir, 'eslint.config.ts');
const stylelintConfig = path.join(clientDir, '.stylelintrc.json');

export default {
  'client/{src,e2e}/**/*.ts': (files) => {
    return `${clientBin('eslint')} --fix -c ${clientEslintConfig} ${files.join(' ')}`;
  },
  'client/src/**/*.scss': (files) => {
    return `${clientBin('stylelint')} --fix --config ${stylelintConfig} ${files.join(' ')}`;
  },
  'server/src/**/*.ts': (files) => {
    return [
      `${serverBin('prettier')} --write ${files.join(' ')}`,
      `${serverBin('eslint')} --fix -c ${serverEslintConfig} ${files.join(' ')}`
    ];
  },
  'mock-server/src/**/*.ts': (files) => {
    return [
      `${mockServerBin('prettier')} --write ${files.join(' ')}`,
      `${mockServerBin('eslint')} --fix -c ${mockServerEslintConfig} ${files.join(' ')}`
    ];
  }
};
