import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as net from 'node:net';
import type { ExtensionLogger } from './outputChannel';

const SERVER_READY_TIMEOUT_MS = 10_000;
const SERVER_READY_RETRY_DELAY_MS = 250;
export const JAVA_OPTIONS = ['--enable-native-access=ALL-UNNAMED', '--sun-misc-unsafe-memory-access=allow', '-Dpolyglotimpl.DisableMultiReleaseCheck=true'];

export class TurtleLanguageServer {
    private serverProcess: ChildProcessWithoutNullStreams | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: ExtensionLogger,
        private readonly sammCliExecutablePath: string,
        private readonly serverPort: number
    ) { }

    async start(): Promise<void> {

        const [executable, args] = this.sammCliExecutablePath.endsWith('.jar')
            ? ['java', [...JAVA_OPTIONS, '-jar', this.sammCliExecutablePath, 'lsp', '--port', String(this.serverPort)]]
            : [this.sammCliExecutablePath, ['lsp', '--port', String(this.serverPort)]];

        this.outputChannel.info(`Starting language server: ${executable} ${args.join(' ')}`);

        this.serverProcess = this.spawnProcess(executable, args);

        try {
            await this.waitForServerPort(this.serverPort, this.serverProcess);
        } catch (error) {
            await this.stop();
            throw error;
        }
        this.outputChannel.info('Language server started successfully.');
    }

    async stop(): Promise<void> {
        const process = this.serverProcess;
        this.serverProcess = undefined;

        if (!process) {
            return;
        }

        await new Promise<void>(resolve => {
            const fallback = setTimeout(() => {
                try {
                    process.kill('SIGKILL');
                } catch {
                    // The process may already have exited.
                }
                resolve();
            }, 3000);

            process.once('exit', () => {
                clearTimeout(fallback);
                resolve();
            });

            try {
                process.kill();
            } catch {
                clearTimeout(fallback);
                resolve();
            }
        });
    }

    private spawnProcess(executable: string, args: string[]): ChildProcessWithoutNullStreams {
        const spawnOptions = {
            cwd: this.context.extensionPath,
            env: process.env,
            stdio: 'pipe' as const,
        };

        const child = spawn(executable, args, spawnOptions) as ChildProcessWithoutNullStreams;

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', data => {
            this.outputChannel.trace(String(data).trimEnd());
        });

        child.stderr.on('data', data => {
            this.outputChannel.warn(`[server stderr] ${String(data).trimEnd()}`);
        });

        child.once('error', error => {
            this.outputChannel.error(`Server process error: ${String(error instanceof Error ? error.message : error)}`);
        });

        return child;
    }

    private async waitForServerPort(port: number, process: ChildProcessWithoutNullStreams): Promise<void> {
        const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;

        while (Date.now() < deadline) {
            if (await this.isServerListening(port, process)) {
                return;
            }

            await this.delay(SERVER_READY_RETRY_DELAY_MS);
        }

        throw new Error(`Timed out waiting for the Turtle language server to start on port ${port}.`);
    }

    private async isServerListening(port: number, process: ChildProcessWithoutNullStreams): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            let settled = false;

            const finish = (callback: () => void): void => {
                if (settled) {
                    return;
                }

                settled = true;
                process.removeListener('exit', exitListener);
                callback();
            };

            const exitListener = (): void => {
                finish(() => reject(new Error('The Turtle language server exited before it became ready.')));
            };

            process.once('exit', exitListener);

            const socket = net.connect({ host: '127.0.0.1', port }, () => {
                finish(() => {
                    socket.end();
                    resolve(true);
                });
            });

            socket.once('error', () => {
                finish(() => {
                    socket.destroy();
                    resolve(false);
                });
            });
        });
    }

    private delay(milliseconds: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }
}