import {defineConfig} from '@vscode/test-cli';

const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;
const runId = (process.env.VSCODE_TEST_RUN_ID ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '-');

export default defineConfig({
    files: 'out/test/**/*.test.js',
    ...(vscodeExecutablePath ? {useInstallation: {fromPath: vscodeExecutablePath}} : {}),
    launchArgs: [
        `--user-data-dir=/tmp/extension-vscode-test-user-data-${runId}`,
        `--extensions-dir=/tmp/extension-vscode-test-extensions-${runId}`,
    ],
});
