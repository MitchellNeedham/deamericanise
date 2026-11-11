#!/usr/bin/env node
import { main } from './cli-main.js';

// A reader such as `head` leaving early is not a failure: the run finishes with its own status.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error;
});

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`deamericanise: ${(error as Error).message}\n`);
    process.exitCode = 2;
  },
);
