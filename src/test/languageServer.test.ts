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

// The first suite pins exact process handling with a fake child; the second runs the real SAMM CLI language server
// (`samm lsp --stdio`).

import * as assert from 'assert';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {EventEmitter} from 'node:events';
import * as path from 'node:path';
import {Readable, Writable} from 'node:stream';
import * as vscode from 'vscode';
import {JAVA_OPTIONS} from '../constants';
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

class FakeChild extends EventEmitter {
    readonly pid = 4242;
    readonly stdout = new Readable({read: () => undefined});
    readonly stderr = new Readable({read: () => undefined});
    readonly stdin = new Writable({write: (_chunk, _encoding, callback) => callback()});
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    killCount = 0;

    constructor() {
        super();
        // Like a real child process, 'spawn' fires after the caller has attached its listeners.
        queueMicrotask(() => this.emit('spawn'));
    }

    kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
        this.killCount++;
        this.emitExit(null, signal);
        return true;
    }

    emitExit(code: number | null, signal: NodeJS.Signals | null): void {
        this.exitCode = code;
        this.signalCode = signal;
        this.emit('exit', code, signal);
    }
}

class FakeProcessServer extends TurtleLanguageServer {
    readonly spawnCalls: Array<{executable: string; args: string[]}> = [];

    constructor(
        readonly child = new FakeChild(),
        sammCliPath = '/tmp/test-samm-cli',
        logLevel = vscode.LogLevel.Off,
    ) {
        super({extensionPath: '/tmp/test-extension'} as vscode.ExtensionContext, silentLogger, sammCliPath, {}, logLevel);
    }

    protected override createChildProcess(executable: string, args: string[]): ChildProcessWithoutNullStreams {
        this.spawnCalls.push({executable, args});
        return this.child as unknown as ChildProcessWithoutNullStreams;
    }
}

suite('TurtleLanguageServer process handling (fake process)', () => {
    test('spawns the native CLI as `lsp --stdio` and exposes its pipes', async () => {
        const server = new FakeProcessServer();
        await server.start();

        assert.deepStrictEqual(server.spawnCalls, [{executable: '/tmp/test-samm-cli', args: ['lsp', '--stdio']}]);
        assert.strictEqual(server.pid, 4242);
        assert.strictEqual(server.getStreams().reader, server.child.stdout);
        assert.strictEqual(server.getStreams().writer, server.child.stdin);
    });

    test('maps the log level to the CLI verbosity flag', async () => {
        const levels: Array<[vscode.LogLevel, string[]]> = [
            [vscode.LogLevel.Trace, ['-vvv']],
            [vscode.LogLevel.Debug, ['-vv']],
            [vscode.LogLevel.Info, ['-v']],
            [vscode.LogLevel.Warning, []],
        ];
        for (const [level, flags] of levels) {
            const server = new FakeProcessServer(new FakeChild(), '/tmp/test-samm-cli', level);
            await server.start();
            assert.deepStrictEqual(server.spawnCalls[0].args, [...flags, 'lsp', '--stdio'], vscode.LogLevel[level]);
        }
    });

    test('runs a JAR through java with the JVM options', async () => {
        const server = new FakeProcessServer(new FakeChild(), '/tmp/samm-cli.jar', vscode.LogLevel.Info);
        await server.start();

        assert.deepStrictEqual(server.spawnCalls, [
            {executable: 'java', args: [...JAVA_OPTIONS, '-jar', '/tmp/samm-cli.jar', '-v', 'lsp', '--stdio']},
        ]);
    });

    test('reports one immutable unexpected exit with the exact metadata', async () => {
        const server = new FakeProcessServer();
        const events: ServerExitEvent[] = [];
        server.onExit(event => events.push(event));
        await server.start();

        server.child.emitExit(134, 'SIGABRT');
        server.child.emitExit(134, 'SIGABRT');

        assert.deepStrictEqual(events, [{pid: 4242, code: 134, signal: 'SIGABRT', expected: false}]);
        assert.ok(Object.isFrozen(events[0]));
        assert.strictEqual(server.pid, undefined);
    });

    test('coalesces a process error and the later exit into one event', async () => {
        const server = new FakeProcessServer();
        const events: ServerExitEvent[] = [];
        server.onExit(event => events.push(event));
        await server.start();

        server.child.emit('error', new Error('pipe broken'));
        server.child.emitExit(1, null);

        assert.deepStrictEqual(events, [{pid: 4242, code: null, signal: null, expected: false}]);
    });

    test('stop kills the process once and reports the exit as expected', async () => {
        const server = new FakeProcessServer();
        const events: ServerExitEvent[] = [];
        server.onExit(event => events.push(event));
        await server.start();

        await server.stop();
        await server.stop();

        assert.strictEqual(server.child.killCount, 1);
        assert.deepStrictEqual(events, [{pid: 4242, code: null, signal: 'SIGTERM', expected: true}]);
    });
});

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

    test('starts a real CLI process', async () => {
        const server = startable();
        await server.start();

        assert.ok(server.pid, 'expected a running server process');
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

    // Exactly-once reporting is pinned by the fake-process suite; this checks the metadata of a real kill.
    test('reports an unexpected exit of a killed process', async () => {
        const server = startable();
        await server.start();
        const pid = server.pid;
        const exited = waitForExit(server);

        process.kill(pid!);
        const event = await exited;

        assert.strictEqual(event.pid, pid);
        assert.strictEqual(event.expected, false);
        assert.ok(Object.isFrozen(event));
        assert.strictEqual(server.pid, undefined);
    });

    test('rejects start on a spawn failure and reports one unexpected exit', async () => {
        const server = startable(path.join(EXTENSION_ROOT, 'does-not-exist', 'samm'));
        const events: ServerExitEvent[] = [];
        server.onExit(event => events.push(event));
        const exited = waitForExit(server);

        await assert.rejects(server.start(), /ENOENT/);
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
