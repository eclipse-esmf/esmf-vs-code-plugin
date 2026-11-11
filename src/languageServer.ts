/*
 * Copyright (c) 2026 Robert Bosch Manufacturing Solutions GmbH
 *
 * See the AUTHORS file(s) distributed with this work for additional
 * information regarding authorship.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * SPDX-License-Identifier: MPL-2.0
 */

import * as vscode from 'vscode';
import {ChildProcessWithoutNullStreams, spawn} from 'node:child_process';
import type {ExtensionLogger} from './outputChannel';
import {JAVA_OPTIONS} from './constants';
import type {DisposableLike, ServerExitEvent} from './languageServicesSupervisor';
import type {StreamInfo} from 'vscode-languageclient/node';

export class TurtleLanguageServer {
    private serverProcess: ChildProcessWithoutNullStreams | undefined;
    private serverStreams: StreamInfo | undefined;
    private readonly exitListeners = new Set<(event: ServerExitEvent) => void>();
    private readonly expectedProcesses = new WeakSet<ChildProcessWithoutNullStreams>();
    private readonly reportedProcesses = new WeakSet<ChildProcessWithoutNullStreams>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: ExtensionLogger,
        private readonly sammCliExecutablePath: string,
        private readonly environmentVariables: Record<string, string>,
        private readonly logLevel: vscode.LogLevel,
    ) {}

    get pid(): number | undefined {
        return this.serverProcess?.pid;
    }

    onExit(listener: (event: ServerExitEvent) => void): DisposableLike {
        this.exitListeners.add(listener);
        return {dispose: () => this.exitListeners.delete(listener)};
    }

    async start(): Promise<void> {
        const traceArgs = this.toTraceArgs(this.logLevel);
        const [executable, args] = this.sammCliExecutablePath.endsWith('.jar')
            ? ['java', [...JAVA_OPTIONS, '-jar', this.sammCliExecutablePath, ...traceArgs, 'lsp', '--stdio']]
            : [this.sammCliExecutablePath, [...traceArgs, 'lsp', '--stdio']];

        this.serverProcess = this.spawnProcess(executable, args);
        this.serverStreams = {reader: this.serverProcess.stdout, writer: this.serverProcess.stdin};
        this.outputChannel.info(
            `[language-server] event=spawned mode=${this.sammCliExecutablePath.endsWith('.jar') ? 'jar' : 'native'} transport=stdio pid=${String(this.serverProcess.pid)}`,
        );
    }

    getStreams(): StreamInfo {
        if (!this.serverStreams) {
            throw new Error('The Turtle language server has not been started.');
        }
        return this.serverStreams;
    }

    private toTraceArgs(level: vscode.LogLevel): string[] {
        switch (level) {
            case vscode.LogLevel.Trace: return ['-vvv'];
            case vscode.LogLevel.Debug: return ['-vv'];
            case vscode.LogLevel.Info: return ['-v'];
            default: return [];
        }
    }

    async stop(): Promise<void> {
        const process = this.serverProcess;
        if (!process) {
            return;
        }
        this.expectedProcesses.add(process);
        this.serverProcess = undefined;

        if (process.exitCode !== null || process.signalCode !== null) {
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
        const child = this.createChildProcess(executable, args);

        child.stderr.setEncoding('utf8');

        child.stderr.on('data', data => {
            this.handleLogOutput(String(data).trimEnd());
        });

        child.once('error', error => {
            this.outputChannel.error(`Server process error: ${String(error instanceof Error ? error.message : error)}`);
            this.reportExit(child, null, null);
        });
        child.once('exit', (code, signal) => this.reportExit(child, code, signal));

        return child;
    }

    protected createChildProcess(executable: string, args: string[]): ChildProcessWithoutNullStreams {
        const spawnOptions = {
            cwd: this.context.extensionPath,
            env: {...process.env, ...this.environmentVariables},
            stdio: 'pipe' as const,
        };

        return spawn(executable, args, spawnOptions) as ChildProcessWithoutNullStreams;
    }

    private handleLogOutput(logMessage: string): void {
        const level = /\b(INFO|WARN|DEBUG|TRACE|ERROR)\b/.exec(logMessage)?.[1];

        switch (level) {
            case 'WARN':
                this.outputChannel.warn(logMessage);
                break;
            case 'DEBUG':
                this.outputChannel.debug(logMessage);
                break;
            case 'TRACE':
                this.outputChannel.trace(logMessage);
                break;
            case 'ERROR':
                this.outputChannel.error(logMessage);
                break;
            default:
                this.outputChannel.info(logMessage);
        }
    }

    private reportExit(process: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
        if (this.reportedProcesses.has(process)) {
            return;
        }
        this.reportedProcesses.add(process);
        if (this.serverProcess === process) {
            this.serverProcess = undefined;
        }
        const event: ServerExitEvent = Object.freeze({
            pid: process.pid,
            code,
            signal,
            expected: this.expectedProcesses.has(process),
        });
        this.exitListeners.forEach(listener => listener(event));
    }
}
