import { readFileSync } from 'node:fs';

// Drain stdin the way the provider process writes the prompt, then exit.
readFileSync(0);

console.log('Generating circuit draft...');
console.log(JSON.stringify({
  type: 'tool.call',
  payload: {
    id: 'call_disallowed',
    name: 'project.transaction.rollback',
    args: { transactionId: 'should-not-run' }
  }
}));
console.log(JSON.stringify({
  type: 'tool.call',
  payload: {
    id: 'call_unknown',
    name: 'board.autoroute',
    args: {}
  }
}));
