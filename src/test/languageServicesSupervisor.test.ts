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
import * as path from 'node:path';
import {PassThrough} from 'node:stream';
import * as vscode from 'vscode';
import type {RequestClient} from '../aspectValidation';
import {TurtleLanguageClient} from '../languageClient';
import type {TurtleLanguageServer} from '../languageServer';
import {
    DisposableLike,
    LanguageServicesSupervisor,
    ManagedLanguageClient,
    ManagedLanguageServer,
    ServerExitEvent,
    SupervisorClock,
} from '../languageServicesSupervisor';
import type {ExtensionLogger} from '../outputChannel';
import {createSammCliServer, EXTENSION_ROOT, openModel, renderWhenLoaded, SAMM_CLI_TIMEOUT_MS, silentLogger} from './sammCliTestHarness';

class FakeClock implements SupervisorClock {
    currentTime = 0;
    scheduledDelays: number[] = [];
    private timers: Array<{at: number; callback: () => void; disposed: boolean}> = [];

    now(): number {
        return this.currentTime;
    }

    setTimeout(callback: () => void, delayMs: number): DisposableLike {
        const timer = {at: this.currentTime + delayMs, callback, disposed: false};
        this.scheduledDelays.push(delayMs);
        this.timers.push(timer);
        return {dispose: () => (timer.disposed = true)};
    }

    advance(delayMs: number): void {
        const target = this.currentTime + delayMs;
        while (true) {
            const next = this.timers.filter(timer => !timer.disposed && timer.at <= target).sort((left, right) => left.at - right.at)[0];
            if (!next) {
                break;
            }
            next.disposed = true;
            this.currentTime = next.at;
            next.callback();
        }
        this.currentTime = target;
    }
}

class FakeServer implements ManagedLanguageServer {
    readonly pid: number;
    starts = 0;
    stops = 0;
    private listeners = new Set<(event: ServerExitEvent) => void>();

    constructor(
        pid: number,
        private readonly startFailure?: Error,
    ) {
        this.pid = pid;
    }

    async start(): Promise<void> {
        this.starts++;
        if (this.startFailure) {
            throw this.startFailure;
        }
    }

    async stop(): Promise<void> {
        this.stops++;
    }

    getStreams(): {reader: NodeJS.ReadableStream; writer: NodeJS.WritableStream} {
        const stream = new PassThrough();
        return {reader: stream, writer: stream};
    }

    onExit(listener: (event: ServerExitEvent) => void): DisposableLike {
        this.listeners.add(listener);
        return {dispose: () => this.listeners.delete(listener)};
    }

    exit(expected = false): void {
        this.listeners.forEach(listener => listener({pid: this.pid, code: 1, signal: null, expected}));
    }
}

class FakeClient implements ManagedLanguageClient {
    connects = 0;
    disconnects = 0;
    duringConnect: (() => void) | undefined;
    private listeners = new Set<() => void>();

    constructor(private readonly connectFailure?: Error) {}

    async connect(): Promise<void> {
        this.connects++;
        this.duringConnect?.();
        if (this.connectFailure) {
            throw this.connectFailure;
        }
    }

    async disconnect(): Promise<void> {
        this.disconnects++;
    }

    onUnexpectedClose(listener: () => void): DisposableLike {
        this.listeners.add(listener);
        return {dispose: () => this.listeners.delete(listener)};
    }

    close(): void {
        this.listeners.forEach(listener => listener());
    }

    async sendRequest<R>(): Promise<R> {
        return {} as R;
    }
}

type Harness = ReturnType<typeof createHarness>;

function createHarness(
    clientFailures: boolean[] = [],
    embedded = true,
    onClientCreated?: (client: FakeClient, server: FakeServer | undefined, index: number) => void,
) {
    const clock = new FakeClock();
    const servers: FakeServer[] = [];
    const clients: FakeClient[] = [];
    const clientServers: Array<ManagedLanguageServer | undefined> = [];
    const bindings: Array<{client: RequestClient; generation: number}> = [];
    const logs: string[] = [];
    const notifications: string[] = [];
    let serverId = 100;
    let clientIndex = 0;
    const logger: ExtensionLogger = {
        trace: message => logs.push(message),
        debug: message => logs.push(message),
        info: message => logs.push(message),
        warn: message => logs.push(message),
        error: message => logs.push(String(message)),
    };
    const supervisor = new LanguageServicesSupervisor({
        useEmbeddedServer: () => embedded,
        createServer: () => {
            const server = new FakeServer(++serverId);
            servers.push(server);
            return server;
        },
        createClient: server => {
            clientServers.push(server);
            const index = clientIndex++;
            const client = new FakeClient(clientFailures[index] ? new Error('connect failed') : undefined);
            clients.push(client);
            onClientCreated?.(client, server as FakeServer | undefined, index);
            return client;
        },
        setRequestClient: (client, generation) => bindings.push({client, generation}),
        unavailableClient: () => ({sendRequest: async () => Promise.reject(new Error('unavailable'))}),
        notifyTerminal: async () => {
            notifications.push('terminal');
            return undefined;
        },
        showOutput: () => undefined,
        showSettings: () => undefined,
        logger,
        clock,
    });
    const events = (event: string) => logs.filter(line => line.includes(`event=${event} `) || line.endsWith(`event=${event}`));
    return {supervisor, clock, servers, clients, clientServers, bindings, logs, notifications, events};
}

async function settle(): Promise<void> {
    for (let index = 0; index < 8; index++) {
        await Promise.resolve();
    }
}

async function start(harness: Harness): Promise<void> {
    await harness.supervisor.start('test');
    await settle();
}

suite('LanguageServicesSupervisor', () => {
    test('suppresses an expected process exit', async () => {
        const harness = createHarness();
        await start(harness);
        harness.servers[0].exit(true);
        await settle();
        harness.clock.advance(10_000);
        await settle();

        assert.strictEqual(harness.servers.length, 1);
        assert.strictEqual(harness.notifications.length, 0);
        await harness.supervisor.dispose();
    });

    test('coalesces process and client failure signals into one replacement', async () => {
        const harness = createHarness();
        await start(harness);

        harness.servers[0].exit();
        harness.clients[0].close();
        await settle();
        harness.clock.advance(999);
        await settle();
        assert.strictEqual(harness.servers.length, 1);

        harness.clock.advance(1);
        await settle();
        assert.strictEqual(harness.servers.length, 2);
        assert.strictEqual(harness.servers[0].stops, 1);
        assert.strictEqual(harness.clients[0].disconnects, 1);
        await harness.supervisor.dispose();
    });

    test('uses exact retry delays and emits one terminal notification', async () => {
        const harness = createHarness([true, true, true, true, true]);
        await start(harness);

        for (const delay of [1_000, 2_000, 4_000, 8_000]) {
            harness.clock.advance(delay);
            await settle();
        }

        assert.deepStrictEqual(harness.clock.scheduledDelays, [1_000, 2_000, 4_000, 8_000]);
        assert.strictEqual(harness.notifications.length, 1);
        assert.strictEqual(harness.clients.length, 5);
        assert.ok(harness.clients.every(client => client.disconnects === 1));
        assert.ok(harness.servers.every(server => server.stops === 1));
        await harness.supervisor.dispose();
    });

    test('resets the retry budget only after three stable minutes', async () => {
        const harness = createHarness();
        await start(harness);
        harness.servers[0].exit();
        await settle();
        harness.clock.advance(1_000);
        await settle();

        harness.clock.advance(179_999);
        harness.servers[1].exit();
        await settle();
        assert.strictEqual(harness.clock.scheduledDelays.at(-1), 2_000);
        harness.clock.advance(2_000);
        await settle();

        harness.clock.advance(180_000);
        harness.servers[2].exit();
        await settle();
        assert.strictEqual(harness.clock.scheduledDelays.at(-1), 1_000);
        await harness.supervisor.dispose();
    });

    for (const source of ['process', 'client'] as const) {
        test(`fails and retries the start attempt when the ${source} fails while the client connects`, async () => {
            // connect() still resolves, so only the startup-failure flag can reject this attempt.
            const harness = createHarness([], true, (client, server, index) => {
                if (index === 0) {
                    client.duringConnect = () => (source === 'process' ? server!.exit() : client.close());
                }
            });
            await start(harness);

            assert.strictEqual(harness.events('startup-failure').length, 1, harness.logs.join('\n'));
            assert.strictEqual(harness.events('candidate-failed').length, 1);
            assert.deepStrictEqual(harness.events('running'), []);
            assert.deepStrictEqual(harness.events('unexpected-failure'), []);
            assert.ok(!harness.bindings.some(binding => binding.client === harness.clients[0]), 'the failed client must not be published');
            assert.strictEqual(harness.servers[0].stops, 1);
            assert.strictEqual(harness.clients[0].disconnects, 1);
            assert.deepStrictEqual(harness.clock.scheduledDelays, [1_000]);

            harness.clock.advance(1_000);
            await settle();
            assert.strictEqual(harness.servers.length, 2);
            assert.strictEqual(harness.bindings.at(-1)?.client, harness.clients[1]);
            await harness.supervisor.dispose();
        });
    }

    test('manual restart cancels a pending automatic retry', async () => {
        const harness = createHarness();
        await start(harness);
        harness.servers[0].exit();
        await settle();
        await harness.supervisor.restart('manual override');
        harness.clock.advance(1_000);
        await settle();
        assert.strictEqual(harness.servers.length, 2);
        await harness.supervisor.dispose();
    });

    test('external mode starts no server and manual restart recreates the client', async () => {
        const harness = createHarness([], false);
        await start(harness);

        assert.strictEqual(harness.servers.length, 0);
        assert.deepStrictEqual(harness.clientServers, [undefined]);

        await harness.supervisor.restart('manual override');
        await settle();

        assert.strictEqual(harness.servers.length, 0);
        assert.strictEqual(harness.clients.length, 2);
        assert.strictEqual(harness.clients[0].disconnects, 1);
        assert.deepStrictEqual(harness.clientServers, [undefined, undefined]);
        await harness.supervisor.dispose();
    });

    test('deactivation during backoff prevents stale resurrection', async () => {
        const harness = createHarness();
        await start(harness);
        harness.servers[0].exit();
        await settle();
        await harness.supervisor.dispose();
        harness.clock.advance(10_000);
        await settle();
        assert.strictEqual(harness.servers.length, 1);
        assert.strictEqual(harness.notifications.length, 0);
    });
});

// Same wiring as extension.ts (real TurtleLanguageServer + TurtleLanguageClient); only time is faked so retry delays are deterministic.
suite('LanguageServicesSupervisor (real SAMM CLI)', function () {
    this.timeout(SAMM_CLI_TIMEOUT_MS);
    let harness: ReturnType<typeof createRealHarness> | undefined;

    teardown(async () => {
        await harness?.supervisor.dispose();
        harness = undefined;
    });

    function createRealHarness(executable?: string) {
        const clock = new FakeClock();
        const servers: TurtleLanguageServer[] = [];
        const bindings: RequestClient[] = [];
        const logs: string[] = [];
        const notifications: string[] = [];
        const supervisor = new LanguageServicesSupervisor({
            useEmbeddedServer: () => true,
            createServer: () => {
                const server = createSammCliServer(executable);
                servers.push(server);
                return server;
            },
            createClient: server => new TurtleLanguageClient(silentLogger, server, vscode.LogLevel.Off),
            setRequestClient: client => bindings.push(client),
            unavailableClient: () => ({sendRequest: async () => Promise.reject(new Error('unavailable'))}),
            notifyTerminal: async () => {
                notifications.push('terminal');
                return undefined;
            },
            showOutput: () => undefined,
            showSettings: () => undefined,
            logger: {...silentLogger, info: message => logs.push(message)},
            clock,
        });
        const events = (event: string) => logs.filter(line => line.includes(`event=${event} `) || line.endsWith(`event=${event}`));
        const activeClient = () => {
            const client = bindings.at(-1);
            return client instanceof TurtleLanguageClient ? client : undefined;
        };
        const retryDelays = () => clock.scheduledDelays.filter(delay => delay !== 180_000);
        return {supervisor, clock, servers, bindings, logs, notifications, events, activeClient, retryDelays};
    }

    test('starts the real server and publishes a working request client', async () => {
        harness = createRealHarness();
        await harness.supervisor.start('test');

        const client = harness.activeClient();
        assert.ok(client, 'expected the real client to be published');
        assert.ok(harness.servers[0].pid);
        const result = await renderWhenLoaded(client, await openModel('Movement.ttl'));
        assert.match(result.svg ?? '', /<svg[\s>]/);
    });

    test('recovers from a killed server with one replacement after the first retry delay', async () => {
        harness = createRealHarness();
        await harness.supervisor.start('test');
        const firstClient = harness.activeClient();
        const firstPid = harness.servers[0].pid!;

        // Killing the process fires both the process-exit and the client-close signal.
        process.kill(firstPid);
        await waitUntil(() => harness!.events('retry-scheduled').length > 0 && harness!.events('cleanup').length > 0);
        await delay(1000);

        assert.strictEqual(harness.events('unexpected-failure').length, 1, harness.logs.join('\n'));
        assert.deepStrictEqual(harness.retryDelays(), [1_000]);
        assert.strictEqual(harness.activeClient(), undefined, 'requests must be unavailable while recovering');
        assert.strictEqual(harness.servers.length, 1, 'no replacement before the retry delay elapses');

        harness.clock.advance(1_000);
        await waitUntil(() => harness!.events('running').length === 2);

        const client = harness.activeClient();
        assert.ok(client && client !== firstClient);
        assert.strictEqual(harness.servers.length, 2);
        assert.notStrictEqual(harness.servers[1].pid, firstPid);
        const result = await renderWhenLoaded(client, await openModel('Movement.ttl'));
        assert.match(result.svg ?? '', /<svg[\s>]/);
    });

    test('an explicit restart replaces the server without scheduling a retry', async () => {
        harness = createRealHarness();
        await harness.supervisor.start('test');
        const firstPid = harness.servers[0].pid;

        await harness.supervisor.restart('Manual restart command');
        await delay(1000);

        assert.ok(harness.activeClient());
        assert.strictEqual(harness.servers.length, 2);
        assert.strictEqual(harness.servers[0].pid, undefined, 'the previous server process must be stopped');
        assert.notStrictEqual(harness.servers[1].pid, firstPid);
        assert.deepStrictEqual(harness.retryDelays(), []);
        assert.deepStrictEqual(harness.events('unexpected-failure'), []);
    });

    test('retries a missing executable with the exact delays and gives up with one terminal notification', async () => {
        harness = createRealHarness(path.join(EXTENSION_ROOT, 'does-not-exist', 'samm'));
        await harness.supervisor.start('test');
        assert.strictEqual(harness.events('candidate-failed').length, 1, harness.logs.join('\n'));

        for (const [index, retryDelay] of [1_000, 2_000, 4_000, 8_000].entries()) {
            harness.clock.advance(retryDelay);
            await waitUntil(() => harness!.events('candidate-failed').length === index + 2);
        }
        await waitUntil(() => harness!.notifications.length > 0);

        assert.deepStrictEqual(harness.retryDelays(), [1_000, 2_000, 4_000, 8_000]);
        assert.strictEqual(harness.servers.length, 5);
        assert.deepStrictEqual(harness.notifications, ['terminal']);
        assert.strictEqual(harness.activeClient(), undefined);
    });
});

async function waitUntil(condition: () => boolean, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        assert.ok(Date.now() < deadline, 'Timed out waiting for the supervisor');
        await delay(100);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
