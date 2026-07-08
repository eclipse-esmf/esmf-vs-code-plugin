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

import { Trace } from 'vscode-jsonrpc';
import * as net from 'node:net';
import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, State, StreamInfo } from 'vscode-languageclient/node';
import type { RequestClient } from './aspectValidation';
import type { ExtensionLogger } from './outputChannel';

const CLIENT_START_TIMEOUT_MS = 20_000;

export class TurtleLanguageClient implements RequestClient {
    private client: LanguageClient;

    constructor(
        private outputChannel: ExtensionLogger,
        private readonly serverPort: number,
        private readonly traceLevel: 'off' | 'messages' | 'verbose' = 'off'
    ) {
        this.client = this.initLanguageClient(this.serverPort);
    }

    private toTrace(level: 'off' | 'messages' | 'verbose'): Trace {
        switch (level) {
            case 'messages': return Trace.Messages;
            case 'verbose': return Trace.Verbose;
            default: return Trace.Off;
        }
    }

    private initLanguageClient(serverPort: number): LanguageClient {
        const serverOptions = async (): Promise<StreamInfo> => new Promise((resolve, reject) => {
            const socket = net.connect({ host: '127.0.0.1', port: serverPort }, () => {
                resolve({ reader: socket, writer: socket });
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
            },
        };

        const client = new LanguageClient('RDF/Turtle and SAMM Aspect Models Language Client', serverOptions, clientOptions);
        client.setTrace(this.toTrace(this.traceLevel));
        return client;
    }

    async connect(): Promise<void> {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        // Hold a reference so we can suppress an unhandled rejection if the
        // race is won by the timeout and start() rejects later.
        const startPromise = this.client.start();
        try {
            const timeout = new Promise<never>((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error('Timed out while starting the language client.')), CLIENT_START_TIMEOUT_MS);
            });

            await Promise.race([startPromise, timeout]);
            this.outputChannel.info('Language client started.');
        }
        catch (error) {
            // Prevent an unhandled-rejection warning if start() rejects after
            // the timeout already won the race.
            startPromise.catch(() => undefined);
            await this.client.stop().catch(() => undefined);
            const message = error instanceof Error ? error.message : 'An unknown error occurred while starting the language client.';
            this.outputChannel.error(`Failed to start language client: ${message}`);
            throw error;
        }
        finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }

    async disconnect(): Promise<void> {
        if (this.client.state === State.Stopped) {
            return;
        }

        await this.client.stop();
    }

    sendRequest<R>(method: string, params?: unknown): Promise<R> {
        if (this.client.state === State.Stopped) {
            return Promise.reject(new Error('The Turtle language client is not connected.'));
        }

        return this.client.sendRequest<R>(method, params) as Promise<R>;
    }

}
