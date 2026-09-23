/*
 * Copyright (c) 2026 Robert Bosch Manufacturing Solutions GmbH
 * SPDX-License-Identifier: MPL-2.0
 */

import * as assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';

suite('Graphical View webview controller', () => {
    test('posts only current ID-only navigation for pointer and Enter/Space activation', () => {
        const source = readFileSync(join(__dirname, '..', '..', 'src', 'webview', 'webview.js'), 'utf8');
        const posted: unknown[] = [];
        let currentMarker: FakeElement | undefined;
        const diagram = new FakeElement();
        const viewport = new FakeElement();
        viewport.clientWidth = 1000;
        viewport.clientHeight = 800;
        viewport.scrollWidth = 2200;
        viewport.scrollHeight = 1600;
        diagram.contains = candidate => candidate === currentMarker;
        diagram.replaceChildren = fragment => {
            currentMarker = (fragment as {marker: FakeElement}).marker;
        };

        const elements = new Map<string, FakeElement>([
            ['#diagram', diagram],
            ['#viewport', viewport],
            ['#status', new FakeElement()],
            ['#status-text', new FakeElement()],
            ['#zoom-value', new FakeElement()],
            ['#refresh', new FakeElement()],
            ['#zoom-in', new FakeElement()],
            ['#zoom-out', new FakeElement()],
            ['#zoom-reset', new FakeElement()],
            ['#zoom-fit', new FakeElement()],
        ]);
        const window = new FakeElement();
        const state: {value?: unknown} = {};
        const context = {
            acquireVsCodeApi: () => ({
                getState: () => undefined,
                setState: (value: unknown) => {
                    state.value = value;
                },
                postMessage: (message: unknown) => posted.push(message),
            }),
            document: {
                querySelector: (selector: string) => elements.get(selector),
                importNode: (node: FakeElement) => node,
            },
            window,
            Element: FakeElement,
            DOMParser: FakeDomParser,
            requestAnimationFrame: (callback: () => void) => callback(),
            setTimeout: (callback: () => void) => {
                callback();
                return 0;
            },
            Number,
            Object,
            Math,
            Error,
        };
        runInNewContext(source, context);

        const markerId = 'gv-attribute-aaaaaaaaaaaaaaaa';
        window.fire('message', {data: {type: 'render', version: 4, svg: `<svg><g id="${markerId}"/></svg>`}});
        assert.ok(currentMarker);
        assert.equal(currentMarker.attributes.get('tabindex'), '0');
        assert.equal(currentMarker.attributes.get('role'), 'link');

        diagram.fire('click', {target: currentMarker});
        let prevented = 0;
        diagram.fire('keydown', {target: currentMarker, key: 'Enter', preventDefault: () => prevented++});
        diagram.fire('keydown', {target: currentMarker, key: ' ', preventDefault: () => prevented++});
        diagram.fire('keydown', {target: currentMarker, key: 'Escape', preventDefault: () => prevented++});

        assert.deepEqual(JSON.parse(JSON.stringify(posted.filter(isNavigateMessage))), [
            {type: 'navigate', version: 4, targetId: markerId},
            {type: 'navigate', version: 4, targetId: markerId},
            {type: 'navigate', version: 4, targetId: markerId},
        ]);
        assert.equal(prevented, 2);
        assert.deepEqual(JSON.parse(JSON.stringify(state.value)), {
            schemaVersion: 1,
            zoom: 0.44363636363636366,
            scrollLeft: 0,
            scrollTop: 0,
            viewportInitialized: true,
        });
    });

    test('applies only allow-listed status kinds and preserves complete status text safely', () => {
        const source = readFileSync(join(__dirname, '..', '..', 'src', 'webview', 'webview.js'), 'utf8');
        const status = new FakeElement();
        const statusText = new FakeElement();
        const elements = new Map<string, FakeElement>([
            ['#diagram', new FakeElement()],
            ['#viewport', new FakeElement()],
            ['#status', status],
            ['#status-text', statusText],
            ['#zoom-value', new FakeElement()],
            ['#refresh', new FakeElement()],
            ['#zoom-in', new FakeElement()],
            ['#zoom-out', new FakeElement()],
            ['#zoom-reset', new FakeElement()],
            ['#zoom-fit', new FakeElement()],
        ]);
        const window = new FakeElement();
        runInNewContext(source, {
            acquireVsCodeApi: () => ({
                getState: () => undefined,
                setState: () => undefined,
                postMessage: () => undefined,
            }),
            document: {
                querySelector: (selector: string) => elements.get(selector),
                importNode: (node: FakeElement) => node,
            },
            window,
            Element: FakeElement,
            DOMParser: FakeDomParser,
            requestAnimationFrame: () => undefined,
            setTimeout: () => 0,
            Number,
            Object,
            Math,
            Error,
        });

        for (const kind of ['loading', 'ready', 'stale', 'unsupported', 'disconnected']) {
            const message = `${kind} <b>complete text</b>`;
            window.fire('message', {data: {type: 'status', status: {kind, message}}});
            assert.equal(status.attributes.get('data-kind'), kind);
            assert.equal(status.attributes.get('title'), message);
            assert.equal(statusText.textContent, message);
            assert.equal(status.textContent, '');
        }

        const acceptedKind = status.attributes.get('data-kind');
        const acceptedText = statusText.textContent;
        for (const malformed of [
            {type: 'status', status: {kind: 'unknown', message: 'Unknown'}},
            {type: 'status', status: {kind: 'ready', message: 42}},
            {type: 'status', status: null},
            {type: 'status', status: ['ready']},
            {type: 'status', status: {kind: 'ready', message: 'Injected'}, extra: true},
        ]) {
            window.fire('message', {data: malformed});
            assert.equal(status.attributes.get('data-kind'), acceptedKind);
            assert.equal(statusText.textContent, acceptedText);
        }
    });
});

class FakeElement {
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, (event: never) => void>();
    textContent = '';
    scrollLeft = 0;
    scrollTop = 0;
    scrollWidth = 0;
    scrollHeight = 0;
    clientWidth = 0;
    clientHeight = 0;
    contains: (candidate: unknown) => boolean = () => false;
    replaceChildren: (fragment: unknown) => void = () => undefined;

    constructor(
        readonly id = '',
        readonly localName = 'g',
        readonly namespaceURI = 'http://www.w3.org/2000/svg',
    ) {}

    addEventListener(type: string, listener: (event: never) => void): void {
        this.listeners.set(type, listener);
    }

    fire(type: string, event: unknown): void {
        this.listeners.get(type)?.(event as never);
    }

    closest(): FakeElement {
        return this;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }
}

class FakeSvg extends FakeElement {
    constructor(private readonly marker: FakeElement) {
        super('', 'svg');
    }

    getAttribute(name: string): string | null {
        return name === 'width' ? '2200' : name === 'height' ? '1600' : null;
    }

    querySelectorAll(): FakeElement[] {
        return [this.marker];
    }
}

class FakeDomParser {
    parseFromString(svgText: string, mediaType: string): FakeXmlDocument {
        assert.equal(mediaType, 'image/svg+xml');
        const id = svgText.match(/gv-(?:header|attribute)-[a-z0-9]{16,32}/)?.[0];
        const marker = new FakeElement(id ?? '');
        return new FakeXmlDocument(new FakeSvg(marker), svgText.includes('<parsererror'));
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

function isNavigateMessage(value: unknown): value is {type: 'navigate'; version: number; targetId: string} {
    return typeof value === 'object' && value !== null && (value as {type?: unknown}).type === 'navigate';
}
