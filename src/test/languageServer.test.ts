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

// Runs against the real SAMM CLI language server (`samm lsp --stdio`).

import * as assert from 'assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {TurtleLanguageClient} from '../languageClient';
import {TurtleLanguageServer} from '../languageServer';
import type {ServerExitEvent} from '../languageServicesSupervisor';
import {
    createSammCliServer,
    EXTENSION_ROOT,
    modelUri,
    renderWhenLoaded,
    SAMM_CLI_TIMEOUT_MS,
    silentLogger,
    TEST_NAMESPACE,
} from './sammCliTestHarness';

const MOVEMENT = modelUri('Movement.ttl');

function waitForExit(server: TurtleLanguageServer): Promise<ServerExitEvent> {
    return new Promise(resolve => {
        const subscription = server.onExit(event => {
            subscription.dispose();
            resolve(event);
        });
    });
}

suite('TurtleLanguageServer lifecycle (real SAMM CLI)', function () {
    this.timeout(SAMM_CLI_TIMEOUT_MS);

    const servers: TurtleLanguageServer[] = [];
    const clients: TurtleLanguageClient[] = [];

    function startable(executable?: string): TurtleLanguageServer {
        const server = createSammCliServer(executable);
        servers.push(server);
        return server;
    }

    teardown(async () => {
        await Promise.all(clients.splice(0).map(client => client.disconnect().catch(() => undefined)));
        await Promise.all(servers.splice(0).map(server => server.stop()));
    });

    test('starts the CLI over stdio without a TCP port', async () => {
        const server = startable();
        await server.start();

        assert.ok(server.pid, 'expected a running server process');
        const {reader, writer} = server.getStreams();
        assert.ok(reader && writer);
    });

    test('serves language server requests over stdio', async () => {
        const server = startable();
        await server.start();
        const client = new TurtleLanguageClient(silentLogger, server, vscode.LogLevel.Off);
        clients.push(client);
        await client.connect();
        await vscode.window.showTextDocument(MOVEMENT);

        const result = await renderWhenLoaded(client, MOVEMENT);

        assert.match(result.svg ?? '', /<svg[\s>]/);
        assert.ok(
            result.targets.some(target => target.kind === 'elementHeader' && target.elementUrn === `${TEST_NAMESPACE}Movement`),
        );
    });

    test('reports one immutable unexpected process exit with metadata', async () => {
        const server = startable();
        await server.start();
        const pid = server.pid;
        const events: ServerExitEvent[] = [];
        server.onExit(event => events.push(event));
        const exited = waitForExit(server);

        process.kill(pid!);
        const event = await exited;

        assert.strictEqual(events.length, 1);
        assert.strictEqual(event.pid, pid);
        assert.strictEqual(event.expected, false);
        assert.ok(Object.isFrozen(event));
        assert.strictEqual(server.pid, undefined);
    });

    test('reports a spawn failure as one unexpected exit', async () => {
        const server = startable(path.join(EXTENSION_ROOT, 'does-not-exist', 'samm'));
        const events: ServerExitEvent[] = [];
        server.onExit(event => events.push(event));
        const exited = waitForExit(server);

        await server.start();
        await exited;

        assert.deepStrictEqual(events, [{pid: undefined, code: null, signal: null, expected: false}]);
    });

    test('marks explicit cleanup expected and stop remains idempotent', async () => {
        const server = startable();
        const events: ServerExitEvent[] = [];
        server.onExit(event => events.push(event));

        await server.start();
        const pid = server.pid;
        await server.stop();
        await server.stop();

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].pid, pid);
        assert.strictEqual(events[0].expected, true);
    });
});
