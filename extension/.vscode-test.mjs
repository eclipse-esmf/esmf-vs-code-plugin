import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	launchArgs: [
		'--user-data-dir=/tmp/extension-vscode-test-user-data',
		'--extensions-dir=/tmp/extension-vscode-test-extensions'
	],
});
