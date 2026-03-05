import { scenarios } from '../tests/helpers/scenarios.js';

const name = process.argv[2];

if (!name || !scenarios[name]) {
  console.log('Available scenarios:');
  for (const key of Object.keys(scenarios)) {
    console.log(`  ${key}`);
  }
  if (name && !scenarios[name]) {
    console.error(`\nUnknown scenario: "${name}"`);
    process.exitCode = 1;
  }
} else {
  const repo = await scenarios[name]();
  // Print the temp dir so the user can cd into it. Do NOT clean up.
  console.log(repo.dir);
}
