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
import {PassThrough} from 'node:stream';
import type {RequestClient} from '../aspectValidation';
import {
    DisposableLike,
    LanguageServicesSupervisor,
    ManagedLanguageClient,
    ManagedLanguageServer,
    ServerExitEvent,
    SupervisorClock,
} from '../languageServicesSupervisor';
import type {ExtensionLogger} from '../outputChannel';

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
    private listeners = new Set<() => void>();

    constructor(private readonly connectFailure?: Error) {}

    async connect(): Promise<void> {
        this.connects++;
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

function createHarness(clientFailures: boolean[] = [], embedded = true) {
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
            const client = new FakeClient(clientFailures[clientIndex++] ? new Error('connect failed') : undefined);
            clients.push(client);
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
    return {supervisor, clock, servers, clients, clientServers, bindings, logs, notifications};
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
