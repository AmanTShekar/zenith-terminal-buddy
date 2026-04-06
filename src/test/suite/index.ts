import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		color: true
	});

	const testsRoot = path.resolve(__dirname, '..');

	return new Promise(async (c, e) => {
		try {
			const files = await glob('**/*.test.js', { cwd: testsRoot });
			console.log(`[Test Loader] Found ${files.length} test files in ${testsRoot}`);

			// Add files to the test suite
			files.forEach(f => {
				const fullPath = path.resolve(testsRoot, f);
				console.log(`[Test Loader] Adding test: ${fullPath}`);
				mocha.addFile(fullPath);
			});

			// Run the mocha test
			mocha.run((failures: number) => {
				if (failures > 0) {
					e(new Error(`${failures} tests failed.`));
				} else {
					c();
				}
			});
		} catch (err) {
			console.error(err);
			e(err);
		}
	});
}
