import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('BGE receipt fixtures pass under each inherited production profile', () => {
	const fixture = fileURLToPath(new URL('./production-sync-state.test.mjs', import.meta.url));
	for (const profile of ['bge', 'both', 'voyage']) {
		const env = { ...process.env, PRODUCTION_SYNC_PROFILE: profile };
		delete env.NODE_TEST_CONTEXT;
		const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', fixture], {
			env,
			encoding: 'utf8',
		});
		assert.match(output, /Production sync receipt/u);
		assert.match(output, /^# fail 0$/mu);
	}
});
