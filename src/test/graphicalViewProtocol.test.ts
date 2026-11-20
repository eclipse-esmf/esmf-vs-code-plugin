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
import {GRAPHICAL_VIEW_RENDER_REQUEST, GraphicalViewAttributeTarget, GraphicalViewRenderResult} from '../graphicalViewProtocol';
import {acceptGraphicalViewResult, isGraphicalViewRenderResult} from '../graphicalViewResult';
import {
    openModel,
    renderWhenLoaded,
    SAMM_CLI_TIMEOUT_MS,
    SammCliSession,
    startSammCliSession,
    TEST_NAMESPACE,
    waitForDiagnostics,
} from './sammCliTestHarness';

const URI = 'file:///tmp/model.ttl';
const OWNER = 'urn:samm:example.graphical:1.0.0#Aspect';
const PREDICATE = 'urn:samm:org.eclipse.esmf.samm:meta-model:2.2.0#description';

suite('Graphical View render-result validation', () => {
    test('accepts exact header, multilingual attribute, and wrapped locator sidecars', () => {
        const ids = [
            'gv-header-aaaaaaaaaaaaaaaa',
            'gv-attribute-bbbbbbbbbbbbbbbb',
            'gv-attribute-cccccccccccccccc',
            'gv-attribute-dddddddddddddddd',
        ];
        const result: GraphicalViewRenderResult = {
            uri: URI,
            svg: `<svg>${ids.map(id => `<g id="${id}"><text>row</text></g>`).join('')}</svg>`,
            targets: [
                {id: ids[0], kind: 'elementHeader', elementUrn: OWNER},
                {id: ids[1], kind: 'attributeRow', ownerUrn: OWNER, predicateUrn: PREDICATE, selection: 'singleOccurrence', language: 'de'},
                {id: ids[2], kind: 'attributeRow', ownerUrn: OWNER, predicateUrn: PREDICATE, selection: 'singleOccurrence', language: 'en'},
                {id: ids[3], kind: 'attributeRow', ownerUrn: OWNER, predicateUrn: PREDICATE, selection: 'singleOccurrence', language: 'en'},
            ],
            warnings: [],
        };

        assert.equal(isGraphicalViewRenderResult(result), true);
        const accepted = acceptGraphicalViewResult(result, 7, true);
        assert.equal(accepted.version, 7);
        assert.equal(accepted.targetById.size, 4);
        assert.equal(accepted.targetById.get(ids[1])?.kind, 'attributeRow');
    });

    test('accepts warning results with omitted or explicit-null SVG only when the sidecar is empty', () => {
        assert.equal(isGraphicalViewRenderResult({uri: URI, targets: [], warnings: ['timeout']}), true);
        assert.equal(isGraphicalViewRenderResult({uri: URI, svg: null, targets: [], warnings: ['modelTooLarge']}), true);
        assert.equal(isGraphicalViewRenderResult({uri: URI, targets: [], warnings: []}), false);
        assert.equal(isGraphicalViewRenderResult({uri: URI, svg: null, targets: [{id: 'x'}], warnings: ['timeout']}), false);
    });

    test('rejects duplicate IDs, missing or extra markers, and malformed marker grammar', () => {
        const id = 'gv-header-aaaaaaaaaaaaaaaa';
        const target = {id, kind: 'elementHeader' as const, elementUrn: OWNER};
        const candidates = [
            {uri: URI, svg: `<svg><g id="${id}"/><g id="${id}"/></svg>`, targets: [target], warnings: []},
            {uri: URI, svg: '<svg/>', targets: [target], warnings: []},
            {uri: URI, svg: `<svg><g id="${id}"/></svg>`, targets: [], warnings: []},
            {uri: URI, svg: '<svg><g id="gv-header-short"/></svg>', targets: [{...target, id: 'gv-header-short'}], warnings: []},
        ];
        assert.ok(candidates.every(candidate => !isGraphicalViewRenderResult(candidate)));
    });

    test('rejects target kind/prefix, URN, qualifier, selector, and extra-field inconsistencies', () => {
        const base = {
            id: 'gv-attribute-aaaaaaaaaaaaaaaa',
            kind: 'attributeRow' as const,
            ownerUrn: OWNER,
            predicateUrn: PREDICATE,
            selection: 'singleOccurrence' as const,
            language: 'en',
        };
        const candidates: unknown[] = [
            {...base, id: 'gv-header-aaaaaaaaaaaaaaaa'},
            {...base, ownerUrn: 'Aspect'},
            {...base, predicateUrn: 'description'},
            {...base, selection: 'predicateStart'},
            {...base, language: 'EN'},
            {...base, sourceText: 'forbidden'},
        ];
        for (const target of candidates) {
            const id = (target as {id: string}).id;
            assert.equal(isGraphicalViewRenderResult({
                uri: URI,
                svg: `<svg><g id="${id}"/></svg>`,
                targets: [target],
                warnings: [],
            }), false);
        }
    });

    test('allows Graphper marker descendant IDs without treating them as sidecar entries', () => {
        const id = 'gv-header-aaaaaaaaaaaaaaaa';
        assert.equal(isGraphicalViewRenderResult({
            uri: URI,
            svg: `<svg><g id="${id}"><polygon id="${id}_polygon"/><text id="${id}_text_0">Aspect</text></g></svg>`,
            targets: [{id, kind: 'elementHeader', elementUrn: OWNER}],
            warnings: [],
        }), true);
    });
});

suite('Graphical View render-result validation (real SAMM CLI)', function () {
    this.timeout(SAMM_CLI_TIMEOUT_MS);
    let session: SammCliSession;

    suiteSetup(async () => {
        session = await startSammCliSession();
    });

    suiteTeardown(async () => {
        await session?.dispose();
    });

    test('accepts the real header, multilingual attribute, and wrapped locator sidecars', async () => {
        const vehicle = await openModel('Vehicle.ttl');
        const result = await renderWhenLoaded(session.client, vehicle, true);

        assert.equal(isGraphicalViewRenderResult(result), true, JSON.stringify(result.targets));
        const accepted = acceptGraphicalViewResult(result, 1, true);
        assert.equal(accepted.targetById.size, result.targets.length);
        assert.ok(result.targets.some(target => target.kind === 'elementHeader' && target.elementUrn === `${TEST_NAMESPACE}Vehicle`));
        // Position is defined in a second file of the same namespace.
        assert.ok(result.targets.some(target => target.kind === 'elementHeader' && target.elementUrn === `${TEST_NAMESPACE}Position`));

        const descriptions = result.targets.filter(
            (target): target is GraphicalViewAttributeTarget =>
                target.kind === 'attributeRow' && target.ownerUrn === `${TEST_NAMESPACE}Vehicle` && target.predicateUrn === PREDICATE,
        );
        assert.deepEqual([...new Set(descriptions.map(target => target.language))].sort(), ['de', 'en']);
        assert.ok(
            descriptions.filter(target => target.language === 'en').length > 1,
            'the long English description should wrap into several rows',
        );
    });

    test('accepts the Graphper marker descendant IDs of the real SVG', async () => {
        const movement = await openModel('Movement.ttl');
        const result = await renderWhenLoaded(session.client, movement, true);

        assert.equal(isGraphicalViewRenderResult(result), true);
        assert.ok(result.targets.length > 0);
        for (const target of result.targets) {
            assert.match(result.svg ?? '', new RegExp(`id="${target.id}_polygon"`));
            assert.match(result.svg ?? '', new RegExp(`id="${target.id}_text_0"`));
        }
    });

    // Skipped until esmf-sdk sends render warnings as strings: SAMM CLI 2.16.2 sends `[4]` instead of `["unresolvable"]`.
    // Re-enable (change `test.skip` back to `test`) once a SAMM CLI release with the fix is available.
    test.skip('accepts the real warning result for an unresolvable model', async () => {
        const broken = await openModel('Broken.ttl');
        await waitForDiagnostics(broken);
        const result = await session.client.sendRequest<GraphicalViewRenderResult>(GRAPHICAL_VIEW_RENDER_REQUEST, {
            uri: broken.toString(),
            includeAttributeRows: true,
        });

        assert.deepEqual(result.warnings, ['unresolvable']);
        assert.equal(isGraphicalViewRenderResult(result), true);
    });
});
