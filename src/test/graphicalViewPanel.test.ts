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

import * as assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as vscode from 'vscode';
import {
    WEBVIEW_SCRIPT_ORDER,
    createGraphicalViewPanelOptions,
    createGraphicalViewShell,
    parseGraphicalViewPanelMessage,
    webviewAssetDirectory,
} from '../graphicalViewPanel';

suite('GraphicalView secure panel contract', () => {
    test('uses exact script/forms/command options and one out/webview resource root without retention', () => {
        const extensionUri = vscode.Uri.file('/tmp/graphical-view-extension');
        const options = createGraphicalViewPanelOptions(extensionUri);

        assert.equal(options.enableScripts, true);
        assert.equal(options.enableForms, false);
        assert.equal(options.enableCommandUris, false);
        assert.equal(options.localResourceRoots?.length, 1);
        assert.equal(options.localResourceRoots?.[0].toString(), webviewAssetDirectory(extensionUri).toString());
        assert.equal('retainContextWhenHidden' in options, false);
    });

    test('creates the exact CSP, fresh nonce, local resource URIs, and fixed external script order', () => {
        const extensionUri = vscode.Uri.file('/tmp/graphical-view-extension');
        const webview = {
            cspSource: 'vscode-webview-resource:',
            asWebviewUri: (uri: vscode.Uri) => uri.with({scheme: 'vscode-webview-resource'}),
        };
        const first = createGraphicalViewShell(webview, extensionUri);
        const second = createGraphicalViewShell(webview, extensionUri);
        const firstNonce = first.match(/script-src 'nonce-([^']+)'/)?.[1];
        const secondNonce = second.match(/script-src 'nonce-([^']+)'/)?.[1];
        assert.ok(firstNonce);
        assert.ok(secondNonce);
        assert.notEqual(firstNonce, secondNonce);

        const expectedCsp =
            `default-src 'none'; script-src 'nonce-${firstNonce}'; style-src vscode-webview-resource:; ` +
            "font-src vscode-webview-resource:; img-src 'none'; connect-src 'none'; object-src 'none'; " +
            "base-uri 'none'; form-action 'none'";
        assert.ok(first.includes(`content="${expectedCsp}"`));
        assert.equal((first.match(/<script /g) ?? []).length, 1);
        assert.equal(first.split(`nonce="${firstNonce}"`).length - 1, 1);
        assert.equal(first.includes(`<script nonce="${firstNonce}">`), false);
        assert.equal(first.includes('http://'), false);
        assert.equal(first.includes('https://'), false);

        const scriptPositions = WEBVIEW_SCRIPT_ORDER.map(asset => first.indexOf(`/out/webview/${asset}`));
        assert.ok(scriptPositions.every(position => position >= 0));
        assert.deepEqual(
            [...scriptPositions].sort((left, right) => left - right),
            scriptPositions,
        );
        assert.ok(first.includes('/out/webview/webview.css'));
    });

    test('creates accessible compact controls and a live status presentation', () => {
        const extensionUri = vscode.Uri.file('/tmp/graphical-view-extension');
        const webview = {
            cspSource: 'vscode-webview-resource:',
            asWebviewUri: (uri: vscode.Uri) => uri.with({scheme: 'vscode-webview-resource'}),
        };
        const shell = createGraphicalViewShell(webview, extensionUri);

        assert.match(shell, /id="zoom-reset"[^>]*aria-label="Reset zoom to 100 percent"[^>]*>Reset<\/button>/);
        assert.match(shell, /id="zoom-controls" role="group" aria-label="Zoom controls"/);
        assert.match(shell, /id="status" role="status" aria-live="polite" aria-atomic="true" data-kind="loading"/);
        assert.match(shell, /id="status-indicator" aria-hidden="true"/);
        assert.match(shell, /id="status-text">Preparing graphical view\.\.\.<\/span>/);
    });

    test('styles all status kinds with theme-aware responsive layout and a loading indicator', () => {
        const stylesheet = readFileSync(join(__dirname, '..', '..', 'src', 'webview', 'webview.css'), 'utf8');

        for (const kind of ['ready', 'loading', 'stale', 'unsupported', 'disconnected']) {
            assert.match(stylesheet, new RegExp(`#status\\[data-kind=['"]${kind}['"]\\]`));
        }
        for (const themeVariable of [
            '--vscode-testing-iconPassed',
            '--vscode-progressBar-background',
            '--vscode-notificationsWarningIcon-foreground',
            '--vscode-notificationsErrorIcon-foreground',
            '--vscode-panel-border',
            '--vscode-foreground',
        ]) {
            assert.ok(stylesheet.includes(themeVariable));
        }
        assert.match(stylesheet, /#toolbar\s*{[^}]*flex-wrap: wrap;/s);
        assert.match(stylesheet, /#status\[data-kind=['"]loading['"]\] #status-indicator\s*{[^}]*animation: status-spin/s);
        assert.match(stylesheet, /#status\[data-kind=['"]stale['"]\],[\s\S]*flex: 1 0 100%;/);
        assert.match(stylesheet, /@media \(max-width: 520px\)/);
    });

    test('accepts only exact production webview messages', () => {
        assert.deepEqual(parseGraphicalViewPanelMessage({type: 'ready'}), {type: 'ready'});
        assert.deepEqual(parseGraphicalViewPanelMessage({type: 'refresh'}), {type: 'refresh'});
        assert.deepEqual(parseGraphicalViewPanelMessage({type: 'rendered', version: 1}), {type: 'rendered', version: 1});
        assert.deepEqual(parseGraphicalViewPanelMessage({type: 'renderError', version: 1, reason: 'xmlParsingFailed'}), {
            type: 'renderError',
            version: 1,
            reason: 'xmlParsingFailed',
        });
        assert.deepEqual(parseGraphicalViewPanelMessage({type: 'navigate', version: 2, targetId: 'gv-attribute-aaaaaaaaaaaaaaaa'}), {
            type: 'navigate',
            version: 2,
            targetId: 'gv-attribute-aaaaaaaaaaaaaaaa',
        });
        for (const message of [
            {type: 'ready', extra: true},
            {type: 'navigate', version: 2, targetId: 'bad'},
            {type: 'navigate', version: 2, targetId: 'gv-header-aaaaaaaaaaaaaaaa', uri: 'file:///tmp/evil.ttl'},
            {type: 'rendered', version: 0},
            {type: 'renderError', version: 1, reason: 'sanitizationFailed'},
        ]) {
            assert.equal(parseGraphicalViewPanelMessage(message), undefined);
        }
    });

    test('build output contains only the deterministic webview inventory and reference hashes', () => {
        const outputDirectory = join(__dirname, '..', 'webview');
        const expectedFiles = [
            'RobotoCondensed-LICENSE-Apache-2.0.txt',
            'RobotoCondensed-NOTICE.txt',
            'RobotoCondensed-Regular.ttf',
            'webview.css',
            'webview.js',
        ];
        assert.deepEqual(readdirSync(outputDirectory).sort(), expectedFiles);
        assert.equal(
            sha256(join(outputDirectory, 'RobotoCondensed-Regular.ttf')),
            '4a7c36df4318fee50a8159c3a0ebde4572abab65447ae4a651c2fe87212302b5',
        );
    });

    test('webview controller retains a stable DOM sink and persists passive viewport state only', () => {
        const controllerSource = readFileSync(join(__dirname, '..', '..', 'src', 'webview', 'webview.js'), 'utf8');
        assert.ok(controllerSource.includes("new DOMParser().parseFromString(svgText, 'image/svg+xml')"));
        assert.ok(controllerSource.includes('document.importNode(svg, true)'));
        assert.ok(controllerSource.includes('diagram.replaceChildren(parsedSvg)'));
        assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(controllerSource), false);
        assert.equal(/DOMPurify|SanitizerContract|ALLOWED_TAGS|ALLOWED_ATTR/.test(controllerSource), false);
        assert.ok(controllerSource.includes('vscode.getState()'));
        assert.ok(controllerSource.includes('vscode.setState(state)'));
        assert.ok(controllerSource.includes('schemaVersion: 1'));
        assert.ok(controllerSource.includes('scrollLeft'));
        assert.ok(controllerSource.includes('scrollTop'));
        assert.ok(controllerSource.includes('viewportInitialized'));
        assert.equal(/setState\([^)]*(?:svg|uri|target|command)/i.test(controllerSource), false);
        assert.ok(controllerSource.includes("event.key !== 'Enter' && event.key !== ' '"));
        assert.ok(controllerSource.includes("vscode.postMessage({type: 'navigate', version: currentVersion, targetId: group.id})"));
        assert.equal(/testMode|testSetViewport|testClickMarker|testKeyMarker|testState|testRenderDiagnostic/.test(controllerSource), false);
    });
});

function sha256(file: string): string {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
}
