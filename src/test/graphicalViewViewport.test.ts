/*
 * Copyright (c) 2026 Robert Bosch Manufacturing Solutions GmbH
 * SPDX-License-Identifier: MPL-2.0
 */

import * as assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';

const source = readFileSync(join(__dirname, '..', '..', 'src', 'webview', 'webview.js'), 'utf8');

suite('Graphical View viewport', () => {
    test('first valid render fits, centers, persists initialization, and only then acknowledges', () => {
        const harness = new WebviewHarness();
        harness.render(1, 2200, 1600);

        assert.equal(harness.hasPosted('rendered', 1), false);
        assert.equal(harness.svg?.width, 976);
        harness.flushFrame();

        assert.equal(harness.hasPosted('rendered', 1), true);
        assert.deepEqual(harness.savedState, {
            schemaVersion: 1,
            zoom: 976 / 2200,
            scrollLeft: 0,
            scrollTop: 0,
            viewportInitialized: true,
        });
        const bounds = harness.svgBounds();
        assert.equal(bounds.left, 112);
        assert.equal(bounds.top, 50 + 12 + (776 - 1600 * (976 / 2200)) / 2);
    });

    test('first Fit is recomputed after transient scrollbar geometry settles', () => {
        const harness = new WebviewHarness();
        harness.viewport.clientWidth = 985;
        harness.viewport.clientHeight = 785;
        harness.render(1, 2200, 1600);

        assert.equal(harness.svg?.width, 961);
        harness.viewport.clientWidth = 1000;
        harness.viewport.clientHeight = 800;
        harness.flushFrame();

        assert.equal(harness.hasPosted('rendered', 1), false);
        assert.equal(harness.svg?.width, 976);
        harness.flushFrame();
        assert.equal(harness.hasPosted('rendered', 1), true);
        assert.equal(harness.savedState.zoom, 976 / 2200);
    });

    test('first Fit retains the geometry used by its formula when applying zoom synchronously removes scrollbars', () => {
        const harness = new WebviewHarness();
        harness.viewport.clientWidth = 985;
        harness.viewport.clientHeight = 785;
        harness.viewport.onSvgResize = () => {
            harness.viewport.onSvgResize = undefined;
            harness.viewport.clientWidth = 1000;
            harness.viewport.clientHeight = 800;
        };

        harness.render(1, 2200, 1600);
        assert.equal(harness.svg?.width, 961);
        harness.flushFrame();

        assert.equal(harness.hasPosted('rendered', 1), false);
        assert.equal(harness.svg?.width, 976);
        harness.flushFrame();
        assert.equal(harness.hasPosted('rendered', 1), true);
        assert.equal(harness.savedState.zoom, 976 / 2200);
    });

    test('rejected first SVG leaves Fit pending for the next valid render', () => {
        const harness = new WebviewHarness();
        harness.message({type: 'render', version: 1, svg: '<parsererror'});
        assert.equal(harness.hasPosted('renderError', 1), true);
        assert.equal(harness.savedState.viewportInitialized, false);

        harness.render(2, 2000, 1000);
        harness.flushFrame();
        assert.equal(harness.savedState.zoom, 976 / 2000);
        assert.equal(harness.savedState.viewportInitialized, true);
        assert.equal(harness.hasPosted('rendered', 2), true);
    });

    test('migrates valid schema-1 state as initialized and strips non-passive data', () => {
        const harness = new WebviewHarness({
            schemaVersion: 1,
            zoom: 2,
            scrollLeft: 240,
            scrollTop: 160,
            svg: '<svg/>',
            uri: 'file:///secret',
            command: 'workbench.action.closeWindow',
            pointer: {x: 1},
        });
        harness.render(1, 900, 700);
        harness.flushFrame();

        assert.deepEqual(harness.savedState, {
            schemaVersion: 1,
            zoom: 2,
            scrollLeft: 240,
            scrollTop: 160,
            viewportInitialized: true,
        });
        assert.equal(harness.svg?.width, 1800);
    });

    test('normalizes malformed persisted values without treating them as a valid legacy viewport', () => {
        const harness = new WebviewHarness({
            schemaVersion: 1,
            zoom: Number.POSITIVE_INFINITY,
            scrollLeft: -20,
            scrollTop: Number.NaN,
        });
        assert.deepEqual(harness.savedState, {
            schemaVersion: 1,
            zoom: 1,
            scrollLeft: 0,
            scrollTop: 0,
            viewportInitialized: false,
        });
        harness.render(1, 100, 100);
        harness.flushFrame();
        assert.equal(harness.savedState.zoom, 4);
        assert.equal(harness.savedState.viewportInitialized, true);
    });

    test('subsequent renders preserve zoom and clamp only unreachable scroll positions', () => {
        const harness = new WebviewHarness(initializedState(2, 1000, 800));
        harness.render(1, 1000, 800);
        harness.flushFrame();
        assert.equal(harness.savedState.scrollLeft, 1000);
        assert.equal(harness.savedState.scrollTop, 800);

        harness.render(2, 600, 400);
        harness.flushFrame();
        assert.deepEqual(harness.savedState, initializedState(2, 224, 24));
        assert.equal(harness.hasPosted('rendered', 2), true);
    });

    test('Fit obeys both bounds, centers free axes, and leaves oversized edges reachable', () => {
        const large = new WebviewHarness(initializedState(1, 0, 0));
        large.render(1, 10_000, 1000);
        large.flushFrame();
        large.click('#zoom-fit');
        large.flushFrame();
        assert.equal(large.savedState.zoom, 0.25);
        assert.equal(large.svgBounds().left, 112);
        large.viewport.scrollLeft = large.viewport.maximumLeft;
        assert.equal(large.svgBounds().right, 100 + 1000 - 12);

        const small = new WebviewHarness(initializedState(1, 0, 0));
        small.render(1, 100, 100);
        small.flushFrame();
        small.click('#zoom-fit');
        small.flushFrame();
        assert.equal(small.savedState.zoom, 4);
        const bounds = small.svgBounds();
        assert.equal(bounds.left, 100 + 12 + (976 - 400) / 2);
        assert.equal(bounds.top, 50 + 12 + (776 - 400) / 2);
    });

    test('modifier wheel is coalesced and pointer anchored while ordinary input remains native', () => {
        const harness = new WebviewHarness(initializedState(1, 500, 300));
        let prevented = 0;
        harness.render(1, 2000, 1400);
        harness.flushFrame();
        const anchor = {clientX: 420, clientY: 310};
        const before = harness.contentPoint(anchor);

        harness.wheel({...anchor, deltaY: 40, deltaMode: 0, ctrlKey: false, metaKey: false, preventDefault: () => prevented++});
        assert.equal(prevented, 0);
        assert.equal(harness.frameCount, 0);

        for (let index = 0; index < 3; index++) {
            harness.wheel({...anchor, deltaY: -20, deltaMode: 0, ctrlKey: true, metaKey: false, preventDefault: () => prevented++});
        }
        assert.equal(prevented, 3);
        assert.equal(harness.frameCount, 1);
        harness.flushFrame();
        harness.flushFrame();

        assert.ok(Number(harness.savedState.zoom) > 1);
        const after = harness.contentPoint(anchor);
        assert.ok(Math.abs(before.x - after.x) < 0.001);
        assert.ok(Math.abs(before.y - after.y) < 0.001);
        assert.equal(harness.wheelOptions?.passive, false);
    });

    test('unavailable and bound-blocked modifier wheel avoid layout and state changes', () => {
        const empty = new WebviewHarness();
        let emptyPrevented = 0;
        empty.wheel(wheelEvent(-100, () => emptyPrevented++));
        assert.equal(emptyPrevented, 0);
        assert.equal(empty.frameCount, 0);

        const bounded = new WebviewHarness(initializedState(4, 10, 10));
        bounded.render(1, 1000, 1000);
        bounded.flushFrame();
        const callsBefore = bounded.setStateCalls;
        let prevented = 0;
        bounded.wheel(wheelEvent(-100, () => prevented++));
        assert.equal(prevented, 1);
        assert.equal(bounded.frameCount, 0);
        assert.equal(bounded.setStateCalls, callsBefore);
        assert.deepEqual(bounded.savedState, initializedState(4, 10, 10));
    });

    test('line and page wheel deltas are bounded and rapid events schedule one frame', () => {
        const line = new WebviewHarness(initializedState(1, 300, 200));
        line.render(1, 2000, 1200);
        line.flushFrame();
        line.wheel(wheelEvent(-10, () => undefined, 1));
        line.wheel(wheelEvent(-1, () => undefined, 2));
        assert.equal(line.frameCount, 1);
        line.flushFrame();
        line.flushFrame();
        assert.ok(Math.abs(Number(line.savedState.zoom) - Math.exp(0.2)) < 0.000001);
    });

    test('modifier wheel completes through the timeout fallback when an animation frame is throttled', () => {
        const harness = new WebviewHarness(initializedState(1, 300, 200));
        harness.render(1, 2000, 1200);
        harness.flushFrame();

        harness.wheel(wheelEvent(-100, () => undefined));
        assert.equal(harness.savedState.zoom, 1);
        harness.flushTimeout();

        assert.ok(Number(harness.savedState.zoom) > 1);
        harness.flushFrame();
        assert.equal(harness.savedState.zoom, Math.exp(0.2));
    });

    test('toolbar zoom and Reset preserve the viewport-center content point; Fit is distinct', () => {
        const harness = new WebviewHarness(initializedState(1, 500, 300));
        harness.render(1, 2000, 1400);
        harness.flushFrame();
        const center = {clientX: 600, clientY: 450};
        const before = harness.contentPoint(center);
        harness.click('#zoom-in');
        harness.flushFrame();
        assert.equal(harness.savedState.zoom, 1.2);
        assertContentPointClose(before, harness.contentPoint(center));

        harness.click('#zoom-reset');
        harness.flushFrame();
        assert.equal(harness.savedState.zoom, 1);
        assertContentPointClose(before, harness.contentPoint(center));

        harness.click('#zoom-fit');
        harness.flushFrame();
        assert.equal(harness.savedState.zoom, 976 / 2000);
        assert.equal(harness.savedState.scrollLeft, 0);
        assert.equal(harness.savedState.scrollTop, 0);
    });

    test('a stale queued layout callback cannot reposition or acknowledge a newer render', () => {
        const harness = new WebviewHarness();
        harness.render(1, 2200, 1600);
        harness.render(2, 1000, 500);
        harness.flushFrame();

        assert.equal(harness.hasPosted('rendered', 1), false);
        assert.equal(harness.hasPosted('rendered', 2), true);
        assert.equal(harness.savedState.zoom, 0.976);
        assert.equal(harness.savedState.viewportInitialized, true);
    });

    test('a queued wheel frame cannot zoom a newer render', () => {
        const harness = new WebviewHarness(initializedState(1, 100, 100));
        harness.render(1, 2000, 1200);
        harness.flushFrame();
        harness.wheel(wheelEvent(-100, () => undefined));
        assert.equal(harness.frameCount, 1);

        harness.render(2, 1000, 600);
        harness.flushFrame();

        assert.equal(harness.savedState.zoom, 1);
        assert.equal(harness.hasPosted('rendered', 2), true);
    });

    test('toolbar layout supersedes a pending restore without losing initialization or acknowledgement', () => {
        const harness = new WebviewHarness();
        harness.render(1, 2200, 1600);
        harness.click('#zoom-in');
        harness.flushFrame();

        assert.equal(harness.savedState.viewportInitialized, true);
        assert.equal(harness.savedState.zoom, (976 / 2200) * 1.2);
        assert.equal(harness.hasPosted('rendered', 1), true);
    });

    test('a render arriving during anchor correction preserves the corrected viewport', () => {
        const harness = new WebviewHarness(initializedState(1, 500, 300));
        harness.render(1, 2000, 1400);
        harness.flushFrame();
        harness.click('#zoom-in');

        harness.render(2, 2000, 1400);
        harness.flushFrame();

        assert.equal(harness.savedState.zoom, 1.2);
        assert.ok(Math.abs(Number(harness.savedState.scrollLeft) - 697.6) < 0.001);
        assert.ok(Math.abs(Number(harness.savedState.scrollTop) - 437.6) < 0.001);
        assert.equal(harness.hasPosted('rendered', 2), true);
    });
});

function initializedState(zoom: number, scrollLeft: number, scrollTop: number): Record<string, number | boolean> {
    return {schemaVersion: 1, zoom, scrollLeft, scrollTop, viewportInitialized: true};
}

function wheelEvent(deltaY: number, preventDefault: () => void, deltaMode = 0): Record<string, unknown> {
    return {clientX: 420, clientY: 310, deltaY, deltaMode, ctrlKey: true, metaKey: false, preventDefault};
}

function assertContentPointClose(expected: Point, actual: Point): void {
    assert.ok(Math.abs(expected.x - actual.x) < 0.001);
    assert.ok(Math.abs(expected.y - actual.y) < 0.001);
}

interface Point {
    x: number;
    y: number;
}

class WebviewHarness {
    readonly viewport = new FakeViewport();
    readonly diagram = new FakeElement();
    readonly window = new FakeElement();
    readonly posted: unknown[] = [];
    readonly frames: Array<() => void> = [];
    readonly timeouts: Array<() => void> = [];
    savedState: Record<string, unknown> = {};
    setStateCalls = 0;
    svg?: FakeSvg;
    wheelOptions?: {passive?: boolean};
    private readonly elements: Map<string, FakeElement>;

    constructor(savedState?: unknown) {
        this.viewport.onWheelOptions = options => {
            this.wheelOptions = options;
        };
        this.diagram.replaceChildren = child => {
            this.svg = child as FakeSvg;
            this.svg.viewport = this.viewport;
        };
        this.viewport.currentSvg = () => this.svg;
        this.elements = new Map([
            ['#diagram', this.diagram],
            ['#viewport', this.viewport],
            ['#status', new FakeElement()],
            ['#status-text', new FakeElement()],
            ['#zoom-value', new FakeElement()],
            ['#refresh', new FakeElement()],
            ['#zoom-in', new FakeElement()],
            ['#zoom-out', new FakeElement()],
            ['#zoom-reset', new FakeElement()],
            ['#zoom-fit', new FakeElement()],
        ]);
        runInNewContext(source, {
            acquireVsCodeApi: () => ({
                getState: () => savedState,
                setState: (value: Record<string, unknown>) => {
                    this.savedState = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
                    this.setStateCalls++;
                },
                postMessage: (message: unknown) => this.posted.push(message),
            }),
            document: {
                querySelector: (selector: string) => this.elements.get(selector),
                importNode: (node: FakeSvg) => node,
            },
            window: this.window,
            Element: FakeElement,
            DOMParser: FakeDomParser,
            requestAnimationFrame: (callback: () => void) => {
                this.frames.push(callback);
                return this.frames.length;
            },
            setTimeout: (callback: () => void) => {
                this.timeouts.push(callback);
                return this.timeouts.length;
            },
            clearTimeout: () => undefined,
            Number,
            Object,
            Math,
            Error,
        });
    }

    get frameCount(): number {
        return this.frames.length;
    }

    render(version: number, width: number, height: number): void {
        this.message({
            type: 'render',
            version,
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`,
        });
    }

    message(data: unknown): void {
        this.window.fire('message', {data});
    }

    click(selector: string): void {
        this.elements.get(selector)?.fire('click', {});
    }

    wheel(event: Record<string, unknown>): void {
        this.viewport.fire('wheel', event);
    }

    flushFrame(): void {
        const callbacks = this.frames.splice(0);
        for (const callback of callbacks) {
            callback();
        }
    }

    flushTimeout(): void {
        const callbacks = this.timeouts.splice(0);
        for (const callback of callbacks) {
            callback();
        }
    }

    hasPosted(type: string, version: number): boolean {
        return this.posted.some(message => isRecord(message) && message.type === type && message.version === version);
    }

    svgBounds(): Bounds {
        assert.ok(this.svg);
        return this.svg.getBoundingClientRect();
    }

    contentPoint(anchor: {clientX: number; clientY: number}): Point {
        const bounds = this.svgBounds();
        return {x: (anchor.clientX - bounds.left) / (this.svg?.zoom ?? 1), y: (anchor.clientY - bounds.top) / (this.svg?.zoom ?? 1)};
    }
}

class FakeElement {
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, (event: never) => void>();
    textContent = '';
    replaceChildren: (child: unknown) => void = () => undefined;

    addEventListener(type: string, listener: (event: never) => void, options?: {passive?: boolean}): void {
        this.listeners.set(type, listener);
        this.onWheelOptions?.(options);
    }

    onWheelOptions?: (options?: {passive?: boolean}) => void;

    fire(type: string, event: unknown): void {
        this.listeners.get(type)?.(event as never);
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }
}

class FakeViewport extends FakeElement {
    clientWidth = 1000;
    clientHeight = 800;
    currentSvg: () => FakeSvg | undefined = () => undefined;
    onSvgResize?: () => void;
    private left = 0;
    private top = 0;

    get maximumLeft(): number {
        return Math.max(0, this.scrollWidth - this.clientWidth);
    }

    get maximumTop(): number {
        return Math.max(0, this.scrollHeight - this.clientHeight);
    }

    get scrollWidth(): number {
        return Math.max(this.clientWidth, (this.currentSvg()?.width ?? 0) + 24);
    }

    get scrollHeight(): number {
        return Math.max(this.clientHeight, (this.currentSvg()?.height ?? 0) + 24);
    }

    get scrollLeft(): number {
        return this.left;
    }

    set scrollLeft(value: number) {
        this.left = Math.min(this.maximumLeft, Math.max(0, value));
    }

    get scrollTop(): number {
        return this.top;
    }

    set scrollTop(value: number) {
        this.top = Math.min(this.maximumTop, Math.max(0, value));
    }

    getBoundingClientRect(): Bounds {
        return {left: 100, top: 50, width: this.clientWidth, height: this.clientHeight, right: 1100, bottom: 850};
    }
}

class FakeSvg extends FakeElement {
    viewport?: FakeViewport;
    width: number;
    height: number;
    readonly baseWidth: number;
    readonly baseHeight: number;
    readonly localName = 'svg';
    readonly namespaceURI = 'http://www.w3.org/2000/svg';

    constructor(width: number, height: number) {
        super();
        this.width = this.baseWidth = width;
        this.height = this.baseHeight = height;
    }

    get zoom(): number {
        return this.width / this.baseWidth;
    }

    getAttribute(name: string): string | null {
        return name === 'width' ? String(this.width) : name === 'height' ? String(this.height) : null;
    }

    override setAttribute(name: string, value: string): void {
        super.setAttribute(name, value);
        if (name === 'width') {
            this.width = Number(value);
        } else if (name === 'height') {
            this.height = Number(value);
        }
        this.viewport?.onSvgResize?.();
    }

    querySelectorAll(): FakeElement[] {
        return [];
    }

    getBoundingClientRect(): Bounds {
        assert.ok(this.viewport);
        const viewportBounds = this.viewport.getBoundingClientRect();
        const availableWidth = this.viewport.clientWidth - 24;
        const availableHeight = this.viewport.clientHeight - 24;
        const left = viewportBounds.left + 12 + Math.max(0, (availableWidth - this.width) / 2) - this.viewport.scrollLeft;
        const top = viewportBounds.top + 12 + Math.max(0, (availableHeight - this.height) / 2) - this.viewport.scrollTop;
        return {left, top, width: this.width, height: this.height, right: left + this.width, bottom: top + this.height};
    }
}

class FakeDomParser {
    parseFromString(svgText: string, mediaType: string): FakeXmlDocument {
        assert.equal(mediaType, 'image/svg+xml');
        const width = Number(svgText.match(/width="([^"]+)"/)?.[1] ?? 0);
        const height = Number(svgText.match(/height="([^"]+)"/)?.[1] ?? 0);
        return new FakeXmlDocument(new FakeSvg(width, height), svgText.includes('<parsererror'));
    }
}

class FakeXmlDocument {
    constructor(
        readonly documentElement: FakeSvg,
        private readonly parserError: boolean,
    ) {}

    getElementsByTagName(name: string): unknown[] {
        return name === 'parsererror' && this.parserError ? [{}] : [];
    }
}

interface Bounds {
    left: number;
    top: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
