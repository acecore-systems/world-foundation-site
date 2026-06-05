import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const siteRoot = process.cwd();
const target = path.join(siteRoot, 'content-source');
const sourceRepoUrl = 'https://github.com/acecore-systems/world-foundation';

await rm(target, { recursive: true, force: true });
await run('git', ['clone', '--depth', '1', sourceRepoUrl, target]);

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: 'inherit' });
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${command} exited with code ${code}`));
		});
	});
}
