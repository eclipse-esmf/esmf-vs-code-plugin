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
import {existsSync, readFileSync, statSync} from 'node:fs';
import {isAbsolute, relative, resolve} from 'node:path';
import {OPEN_GRAPHICAL_VIEW_COMMAND} from '../graphicalView';

const ICON_PATH = 'media/aspect-model-editor-targetsize-192.png';
const ICON_SHA_256 = 'd4e288af96113cd31e0f3fea5ea6f6629ab568230dff967ed4c12da12c4cbe5b';

type ManifestCommand = {
    command: string;
    title?: string;
    category?: string;
    enablement?: string;
    icon?: {light?: string; dark?: string};
};

type ManifestMenuItem = {
    command?: string;
    when?: string;
    group?: string;
    alt?: string;
};

type ExtensionManifest = {
    contributes: {
        commands: ManifestCommand[];
        menus: Record<string, ManifestMenuItem[] | undefined>;
    };
};

suite('Graphical View editor-title manifest contract', () => {
    const extensionRoot = resolve(__dirname, '..', '..');
    const manifest = JSON.parse(readFileSync(resolve(extensionRoot, 'package.json'), 'utf8')) as ExtensionManifest;

    test('reuses the single existing command with its approved local light and dark icon', () => {
        const commands = manifest.contributes.commands.filter(command => command.command === OPEN_GRAPHICAL_VIEW_COMMAND);
        assert.equal(commands.length, 1);
        assert.deepEqual(commands[0], {
            command: OPEN_GRAPHICAL_VIEW_COMMAND,
            title: 'Open Graphical View',
            category: 'Semantic Models',
            enablement: 'editorLangId == turtle',
            icon: {light: ICON_PATH, dark: ICON_PATH},
        });

        for (const iconPath of Object.values(commands[0].icon ?? {})) {
            assertLocalAsset(extensionRoot, iconPath);
        }
        assert.equal(sha256(resolve(extensionRoot, ICON_PATH)), ICON_SHA_256);
    });

    test('contributes exactly one Turtle-scoped primary editor-title action in stable order', () => {
        const titleItems = (manifest.contributes.menus['editor/title'] ?? []).filter(item => item.command === OPEN_GRAPHICAL_VIEW_COMMAND);
        assert.deepEqual(titleItems, [
            {
                command: OPEN_GRAPHICAL_VIEW_COMMAND,
                when: 'resourceLangId == turtle',
                group: 'navigation@10',
            },
        ]);
        assert.equal('alt' in titleItems[0], false);
    });

    test('preserves editor context and unrestricted Command Palette behavior without duplicate surfaces', () => {
        const contextItems = (manifest.contributes.menus['editor/context'] ?? []).filter(
            item => item.command === OPEN_GRAPHICAL_VIEW_COMMAND,
        );
        assert.deepEqual(contextItems, [
            {
                command: OPEN_GRAPHICAL_VIEW_COMMAND,
                when: 'resourceLangId == turtle',
                group: '1_modification@2',
            },
        ]);

        const paletteItems = (manifest.contributes.menus.commandPalette ?? []).filter(item => item.command === OPEN_GRAPHICAL_VIEW_COMMAND);
        assert.deepEqual(paletteItems, []);

        const graphicalCommands = manifest.contributes.commands.filter(command => command.command.toLowerCase().includes('graphicalview'));
        assert.deepEqual(
            graphicalCommands.map(command => command.command),
            [OPEN_GRAPHICAL_VIEW_COMMAND],
        );
    });
});

function assertLocalAsset(extensionRoot: string, assetPath: string | undefined): asserts assetPath is string {
    assert.ok(assetPath, 'The command icon path must be present');
    assert.equal(isAbsolute(assetPath), false, 'The command icon path must be extension-relative');
    assert.equal(/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(assetPath), false, 'The command icon path must not be a URL');

    const resolvedPath = resolve(extensionRoot, assetPath);
    const relativePath = relative(extensionRoot, resolvedPath);
    assert.equal(relativePath.startsWith('..') || isAbsolute(relativePath), false, 'The command icon must stay inside the extension');
    assert.equal(existsSync(resolvedPath), true, `The command icon does not exist: ${assetPath}`);
    assert.equal(statSync(resolvedPath).isFile(), true, `The command icon is not a file: ${assetPath}`);
    assert.ok(statSync(resolvedPath).size > 0, `The command icon is empty: ${assetPath}`);
}

function sha256(file: string): string {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
}
