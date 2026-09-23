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

import {Trace} from 'vscode-jsonrpc';
import * as net from 'node:net';
import * as vscode from 'vscode';
import {CloseAction, ErrorAction, ErrorHandler, LanguageClient, LanguageClientOptions, State, StreamInfo} from 'vscode-languageclient/node';
import type {RequestClient} from './aspectValidation';
import type {GraphicalViewRequestTransport} from './graphicalViewClient';
import type {ExtensionLogger} from './outputChannel';
import type {DisposableLike} from './languageServicesSupervisor';

const CLIENT_START_TIMEOUT_MS = 60_000;

export function createDoNotRestartErrorHandler(onUnexpectedClose: () => void): ErrorHandler {
    let closeReported = false;
    return {
        error: () => ({action: ErrorAction.Continue}),
        closed: () => {
            if (!closeReported) {
                closeReported = true;
                onUnexpectedClose();
            }
            return {action: CloseAction.DoNotRestart};
        },
    };
}

export class TurtleLanguageClient implements RequestClient, GraphicalViewRequestTransport {
    private client: LanguageClient;
    private readonly closeListeners = new Set<() => void>();
    private readonly availability = new vscode.EventEmitter<boolean>();
    private disconnecting = false;
    private closeReported = false;
    private lastAvailability = false;

    constructor(
        private outputChannel: ExtensionLogger,
        private readonly serverPort: number,
        private readonly logLevel: vscode.LogLevel
    ) {
        this.client = this.initLanguageClient(this.serverPort);
        this.client.onDidChangeState(event => {
            const available = event.newState === State.Running;
            if (available !== this.lastAvailability) {
                this.lastAvailability = available;
                this.availability.fire(available);
            }
        });
    }

    onUnexpectedClose(listener: () => void): DisposableLike {
        this.closeListeners.add(listener);
        return {dispose: () => this.closeListeners.delete(listener)};
    }

    private toTrace(level: vscode.LogLevel): Trace {
        switch (level) {
            case vscode.LogLevel.Trace: return Trace.Verbose;
            case vscode.LogLevel.Debug: return Trace.Compact;
            case vscode.LogLevel.Info: return Trace.Messages;
            default: return Trace.Off;
        }
    }

    private initLanguageClient(serverPort: number): LanguageClient {
        const serverOptions = async (): Promise<StreamInfo> =>
            new Promise((resolve, reject) => {
                const socket = net.connect({host: '127.0.0.1', port: serverPort}, () => {
                    resolve({reader: socket, writer: socket});
                });

                socket.once('error', error => {
                    socket.destroy();
                    reject(error);
                });
            });

        const clientOptions: LanguageClientOptions = {
            documentSelector: ['turtle'],
            synchronize: {
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ttl'),
                configurationSection: 'semantic-models.modelResolution',
            },
            errorHandler: createDoNotRestartErrorHandler(() => {
                if (!this.disconnecting && !this.closeReported) {
                    this.closeReported = true;
                    this.closeListeners.forEach(listener => listener());
                }
            }),
        };

        const client = new LanguageClient('RDF/Turtle and SAMM Aspect Models Language Client', serverOptions, clientOptions);
        client.setTrace(this.toTrace(this.logLevel));
        return client;
    }

    async connect(): Promise<void> {
        this.disconnecting = false;
        this.closeReported = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        // Hold a reference so we can suppress an unhandled rejection if the
        // race is won by the timeout and start() rejects later.
        const startPromise = this.client.start();
        try {
            const timeout = new Promise<never>((_, reject) => {
                timeoutHandle = setTimeout(
                    () => reject(new Error('Timed out while starting the language client.')),
                    CLIENT_START_TIMEOUT_MS,
                );
            });

            await Promise.race([startPromise, timeout]);
            this.outputChannel.info('Language client started.');
        } catch (error) {
            // Prevent an unhandled-rejection warning if start() rejects after
            // the timeout already won the race.
            startPromise.catch(() => undefined);
            await this.disconnect().catch(() => undefined);
            const message = error instanceof Error ? error.message : 'An unknown error occurred while starting the language client.';
            this.outputChannel.error(`Failed to start language client: ${message}`);
            throw error;
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }

    async disconnect(): Promise<void> {
        this.disconnecting = true;
        try {
            if (this.client.state !== State.Stopped) {
                await this.client.stop();
            }
        } catch (error) {
            if (this.client.state !== State.Stopped) {
                throw error;
            }
        } finally {
            this.client.diagnostics?.dispose();
        }
    }

    sendRequest<R>(method: string, params?: unknown, token?: vscode.CancellationToken): Promise<R> {
        if (this.client.state === State.Stopped) {
            return Promise.reject(new Error('The Turtle language client is not connected.'));
        }

        return this.client.sendRequest<R>(method, params, token) as Promise<R>;
    }

    isAvailable(): boolean {
        return this.client.state === State.Running;
    }

    onDidChangeAvailability(listener: (available: boolean) => void): vscode.Disposable {
        return this.availability.event(listener);
    }
}
