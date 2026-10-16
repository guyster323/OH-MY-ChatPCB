import { readFileSync } from 'node:fs';

// Drain stdin the way the provider process writes the prompt, then exit.
readFileSync(0);

console.log('Generating circuit draft...');
console.log(JSON.stringify({
  type: 'tool.call',
  payload: {
    id: 'call_fake_1',
    name: 'project.create',
    args: { projectName: 'fake-project' }
  }
}));
