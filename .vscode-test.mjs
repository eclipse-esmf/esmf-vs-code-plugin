import {defineConfig} from '@vscode/test-cli';
import {resolveSammCli} from './scripts/fetch-samm-cli.mjs';

const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;
const runId = (process.env.VSCODE_TEST_RUN_ID ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '-');
// Tests talk to the real SAMM CLI language server: the latest release is downloaded (and cached) unless SAMM_CLI_PATH is set.
const samm = await resolveSammCli();
console.log(`Using SAMM CLI ${samm.version} (${samm.source}): ${samm.path}`);

export default defineConfig({
    files: 'out/test/**/*.test.js',
    env: {SAMM_CLI_PATH: samm.path},
    ...(vscodeExecutablePath ? {useInstallation: {fromPath: vscodeExecutablePath}} : {}),
    launchArgs: [
        `--user-data-dir=/tmp/extension-vscode-test-user-data-${runId}`,
        `--extensions-dir=/tmp/extension-vscode-test-extensions-${runId}`,
    ],
});
