import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('./dist-server/server.js')) {
	const build = spawnSync(process.execPath, ['./node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'], { stdio: 'inherit' });
	if (build.status !== 0) {
		throw new Error('Server build output is missing and could not be generated. Run npm run build:server before starting.');
	}
}

import('./dist-server/server.js').catch((error) => {
	console.error('Unable to start the compiled server:', error);
	process.exitCode = 1;
});
