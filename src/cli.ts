#!/usr/bin/env node
import { main } from './cli-main.js';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`deamericanise: ${(error as Error).message}\n`);
    process.exitCode = 2;
  },
);
