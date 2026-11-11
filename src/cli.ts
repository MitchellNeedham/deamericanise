#!/usr/bin/env node
import { main } from './cli-main.js';

// A reader such as `head` closing the pipe once it has enough is not a failure.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
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
