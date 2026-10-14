import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

let count = 0;
for (const directory of ['backend', 'frontend', 'scripts', 'tests']) {
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(1);
    count++;
  }
}
console.log(`${count} JavaScript files checked.`);
