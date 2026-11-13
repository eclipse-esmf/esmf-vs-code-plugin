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

import * as assert from 'assert';
import * as vscode from 'vscode';
import {CloseAction, State} from 'vscode-languageclient/node';
import {createDoNotRestartErrorHandler, TURTLE_DOCUMENT_SELECTOR, TurtleLanguageClient} from '../languageClient';

suite('TurtleLanguageClient document selector', () => {
    test('document selector only matches editable turtle documents', () => {
        const matches = (scheme: string) =>
            TURTLE_DOCUMENT_SELECTOR.some(
                filter => typeof filter === 'object' && 'scheme' in filter && filter.language === 'turtle' && filter.scheme === scheme,
            );

        assert.ok(matches('file'));
        assert.ok(matches('untitled'));
        assert.ok(!matches('chat-editing-text-model'));
        assert.ok(!matches('git'));
    });

    test('vscode matching rejects virtual turtle documents', () => {
        const virtualDoc = {languageId: 'turtle', uri: vscode.Uri.parse('chat-editing-text-model:/tmp/Model.ttl?x=1')};
        assert.strictEqual(
            vscode.languages.match(TURTLE_DOCUMENT_SELECTOR as vscode.DocumentSelector, virtualDoc as vscode.TextDocument),
            0,
        );
    });

    test('vscode matching accepts file and untitled turtle documents', () => {
        const fileDoc = {languageId: 'turtle', uri: vscode.Uri.file('/tmp/Model.ttl')};
        assert.ok(
            vscode.languages.match(TURTLE_DOCUMENT_SELECTOR as vscode.DocumentSelector, fileDoc as vscode.TextDocument) > 0,
        );

        const untitledDoc = {languageId: 'turtle', uri: vscode.Uri.parse('untitled:Untitled-1')};
        assert.ok(
            vscode.languages.match(TURTLE_DOCUMENT_SELECTOR as vscode.DocumentSelector, untitledDoc as vscode.TextDocument) > 0,
        );
    });
});

suite('TurtleLanguageClient lifecycle', () => {
    test('omits an undefined cancellation token from requests', async () => {
        let requestArgs: unknown[] = [];
        const client = {
            state: State.Running,
            sendRequest: (...args: unknown[]) => {
                requestArgs = args;
                return Promise.resolve(undefined);
            },
        };
        const wrapper = Object.create(TurtleLanguageClient.prototype) as unknown as {
            client: typeof client;
            sendRequest<R>(method: string, params?: unknown): Promise<R>;
        };
        wrapper.client = client;

        const params = {uri: 'file:///model.ttl'};
        await wrapper.sendRequest('validateDocumentNow', params);

        assert.deepStrictEqual(requestArgs, ['validateDocumentNow', params]);
    });

    test('uses DoNotRestart and reports a duplicate close only once', async () => {
        let closeCount = 0;
        const handler = createDoNotRestartErrorHandler(() => closeCount++);

        const first = await handler.closed();
        const second = await handler.closed();

        assert.strictEqual(first.action, CloseAction.DoNotRestart);
        assert.strictEqual(second.action, CloseAction.DoNotRestart);
        assert.strictEqual(closeCount, 1);
    });

    test('disconnect is idempotent after the client reaches Stopped', async () => {
        let stopCount = 0;
        const client = {
            state: State.Running,
            stop: async () => {
                stopCount++;
                client.state = State.Stopped;
            },
        };
        const wrapper = Object.create(TurtleLanguageClient.prototype) as unknown as {
            client: typeof client;
            disconnecting: boolean;
            disconnect(): Promise<void>;
        };
        wrapper.client = client;
        wrapper.disconnecting = false;

        await wrapper.disconnect();
        await wrapper.disconnect();

        assert.strictEqual(stopCount, 1);
    });
});
