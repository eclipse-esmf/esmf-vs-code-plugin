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

import type {RequestClient} from './aspectValidation';
import type {ExtensionLogger} from './outputChannel';

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;
const STABLE_WINDOW_MS = 180_000;

export interface DisposableLike {
    dispose(): void;
}

export interface ServerExitEvent {
    pid?: number;
    code: number | null;
    signal: NodeJS.Signals | null;
    expected: boolean;
}

export interface ManagedLanguageServer {
    readonly pid?: number;
    start(): Promise<void>;
    stop(): Promise<void>;
    getStreams(): {reader: NodeJS.ReadableStream; writer: NodeJS.WritableStream};
    onExit(listener: (event: ServerExitEvent) => void): DisposableLike;
}

export interface ManagedLanguageClient extends RequestClient {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    onUnexpectedClose(listener: () => void): DisposableLike;
}

export interface SupervisorClock {
    now(): number;
    setTimeout(callback: () => void, delayMs: number): DisposableLike;
}

export type TerminalAction = 'restart' | 'output' | 'settings' | undefined;

export interface LanguageServicesSupervisorOptions {
    useEmbeddedServer(): boolean;
    createServer(): ManagedLanguageServer;
    createClient(server?: ManagedLanguageServer): ManagedLanguageClient;
    setRequestClient(client: RequestClient, generation: number): void;
    unavailableClient(): RequestClient;
    notifyTerminal(): Promise<TerminalAction>;
    showOutput(): void;
    showSettings(): void;
    logger: ExtensionLogger;
    clock?: SupervisorClock;
}

type Candidate = {
    generation: number;
    server?: ManagedLanguageServer;
    client?: ManagedLanguageClient;
    subscriptions: DisposableLike[];
};

const systemClock: SupervisorClock = {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => {
        const handle = setTimeout(callback, delayMs);
        return {dispose: () => clearTimeout(handle)};
    },
};

export class LanguageServicesSupervisor {
    private readonly clock: SupervisorClock;
    private chain: Promise<void> = Promise.resolve();
    private generation = 0;
    private automaticAttempt = 0;
    private current: Candidate | undefined;
    private retryTimer: DisposableLike | undefined;
    private stableTimer: DisposableLike | undefined;
    private disposed = false;
    private terminalNotified = false;

    constructor(private readonly options: LanguageServicesSupervisorOptions) {
        this.clock = options.clock ?? systemClock;
    }

    start(reason: string): Promise<void> {
        return this.restart(reason);
    }

    restart(reason: string): Promise<void> {
        if (this.disposed) {
            return Promise.resolve();
        }

        this.cancelTimers();
        this.automaticAttempt = 0;
        this.terminalNotified = false;
        const generation = ++this.generation;
        this.publishUnavailable(generation);
        this.log('explicit-restart', {reason: this.reasonCategory(reason), generation});
        return this.enqueue(async () => {
            await this.cleanupCurrent('explicit-restart');
            await this.startCandidate(generation, 'explicit');
        });
    }

    async dispose(): Promise<void> {
        if (this.disposed) {
            return this.chain;
        }
        this.disposed = true;
        this.cancelTimers();
        const generation = ++this.generation;
        this.publishUnavailable(generation);
        await this.enqueue(() => this.cleanupCurrent('dispose'));
    }

    private enqueue(operation: () => Promise<void>): Promise<void> {
        this.chain = this.chain.then(operation, operation).catch(error => {
            this.options.logger.error(`[language-services] operation-failed error=${this.message(error)}`);
        });
        return this.chain;
    }

    private async startCandidate(generation: number, phase: 'explicit' | 'automatic'): Promise<void> {
        if (!this.isCurrent(generation)) {
            this.log('stale-start-rejected', {generation, phase});
            return;
        }

        const candidate: Candidate = {generation, subscriptions: []};
        const startedAt = this.clock.now();
        try {
            if (this.options.useEmbeddedServer()) {
                candidate.server = this.options.createServer();
                candidate.subscriptions.push(candidate.server.onExit(event => this.onServerExit(generation, event)));
                await candidate.server.start();
                if (!this.isCurrent(generation)) {
                    await this.cleanupCandidate(candidate, 'stale-after-server-start');
                    return;
                }
            }

            candidate.client = this.options.createClient(candidate.server);
            candidate.subscriptions.push(candidate.client.onUnexpectedClose(() => this.onClientClose(generation)));
            await candidate.client.connect();
            if (!this.isCurrent(generation)) {
                await this.cleanupCandidate(candidate, 'stale-after-client-connect');
                return;
            }

            this.current = candidate;
            this.options.setRequestClient(candidate.client, generation);
            this.startStableTimer(generation);
            this.log('running', {
                generation,
                phase,
                attempt: this.automaticAttempt,
                pid: candidate.server?.pid,
                recoveryDurationMs: this.clock.now() - startedAt,
            });
        } catch (error) {
            this.log('candidate-failed', {
                generation,
                phase,
                attempt: this.automaticAttempt,
                error: this.message(error),
            });
            await this.cleanupCandidate(candidate, 'candidate-failed');
            if (this.isCurrent(generation)) {
                this.scheduleNextAttempt();
            }
        }
    }

    private onServerExit(generation: number, event: ServerExitEvent): void {
        if (event.expected) {
            this.log('expected-process-exit', {generation, pid: event.pid, code: event.code, signal: event.signal});
            return;
        }
        this.handleUnexpectedFailure(generation, 'process', {
            pid: event.pid,
            code: event.code,
            signal: event.signal,
        });
    }

    private onClientClose(generation: number): void {
        this.handleUnexpectedFailure(generation, 'client', {});
    }

    private handleUnexpectedFailure(generation: number, source: 'process' | 'client', details: Record<string, unknown>): void {
        if (!this.isCurrent(generation) || this.current?.generation !== generation) {
            this.log('stale-failure-rejected', {generation, source, ...details});
            return;
        }

        this.cancelStableTimer();
        const failed = this.current;
        this.current = undefined;
        const recoveryGeneration = ++this.generation;
        this.publishUnavailable(recoveryGeneration);
        this.log('unexpected-failure', {generation, recoveryGeneration, source, ...details});
        void this.enqueue(async () => {
            await this.cleanupCandidate(failed, `unexpected-${source}`);
            if (this.isCurrent(recoveryGeneration)) {
                this.scheduleNextAttempt(recoveryGeneration);
            }
        });
    }

    private scheduleNextAttempt(existingGeneration?: number): void {
        if (this.disposed) {
            return;
        }
        if (this.automaticAttempt >= RETRY_DELAYS_MS.length) {
            void this.terminalize();
            return;
        }

        const attempt = ++this.automaticAttempt;
        const delayMs = RETRY_DELAYS_MS[attempt - 1];
        const generation = existingGeneration ?? ++this.generation;
        if (existingGeneration === undefined) {
            this.publishUnavailable(generation);
        }
        this.cancelRetryTimer();
        this.log('retry-scheduled', {generation, attempt, delayMs});
        this.retryTimer = this.clock.setTimeout(() => {
            this.retryTimer = undefined;
            if (!this.isCurrent(generation)) {
                this.log('stale-retry-rejected', {generation, attempt});
                return;
            }
            void this.enqueue(() => this.startCandidate(generation, 'automatic'));
        }, delayMs);
    }

    private startStableTimer(generation: number): void {
        this.cancelStableTimer();
        this.stableTimer = this.clock.setTimeout(() => {
            this.stableTimer = undefined;
            if (!this.isCurrent(generation) || this.current?.generation !== generation) {
                this.log('stale-stability-reset-rejected', {generation});
                return;
            }
            this.automaticAttempt = 0;
            this.terminalNotified = false;
            this.log('stability-budget-reset', {generation, stableMs: STABLE_WINDOW_MS});
        }, STABLE_WINDOW_MS);
    }

    private async terminalize(): Promise<void> {
        if (this.disposed || this.terminalNotified) {
            return;
        }
        this.terminalNotified = true;
        this.cancelTimers();
        this.log('terminal-exhaustion', {generation: this.generation, attempts: this.automaticAttempt});
        const action = await this.options.notifyTerminal();
        if (action === 'restart') {
            await this.restart('terminal notification: Restart Now');
        } else if (action === 'output') {
            this.options.showOutput();
        } else if (action === 'settings') {
            this.options.showSettings();
        }
    }

    private async cleanupCurrent(reason: string): Promise<void> {
        const current = this.current;
        this.current = undefined;
        await this.cleanupCandidate(current, reason);
    }

    private async cleanupCandidate(candidate: Candidate | undefined, reason: string): Promise<void> {
        if (!candidate) {
            return;
        }
        const results = await Promise.allSettled([
            candidate.client?.disconnect() ?? Promise.resolve(),
            candidate.server?.stop() ?? Promise.resolve(),
        ]);
        candidate.subscriptions.forEach(subscription => subscription.dispose());
        this.log('cleanup', {
            generation: candidate.generation,
            reason,
            client: results[0].status,
            server: results[1].status,
        });
    }

    private publishUnavailable(generation: number): void {
        this.options.setRequestClient(this.options.unavailableClient(), generation);
    }

    private isCurrent(generation: number): boolean {
        return !this.disposed && this.generation === generation;
    }

    private cancelTimers(): void {
        this.cancelRetryTimer();
        this.cancelStableTimer();
    }

    private cancelRetryTimer(): void {
        this.retryTimer?.dispose();
        this.retryTimer = undefined;
    }

    private cancelStableTimer(): void {
        this.stableTimer?.dispose();
        this.stableTimer = undefined;
    }

    private log(event: string, fields: Record<string, unknown>): void {
        const values = Object.entries(fields)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(' ');
        this.options.logger.info(`[language-services] event=${event}${values ? ` ${values}` : ''}`);
    }

    private message(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private reasonCategory(reason: string): string {
        if (reason === 'extension activation') {
            return 'activation';
        }
        if (reason === 'Manual restart command') {
            return 'manual';
        }
        if (reason === 'Configuration change detected') {
            return 'configuration';
        }
        if (reason.startsWith('terminal notification:')) {
            return 'terminal-action';
        }
        return 'executable-change';
    }
}

export const languageServicesRetryDelays = RETRY_DELAYS_MS;
export const languageServicesStableWindowMs = STABLE_WINDOW_MS;
