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

import {
    GRAPHICAL_VIEW_ATTRIBUTE_MARKER_PATTERN,
    GRAPHICAL_VIEW_HEADER_MARKER_PATTERN,
    GRAPHICAL_VIEW_MARKER_PATTERN,
    GraphicalViewRenderResult,
    GraphicalViewRenderWarning,
    GraphicalViewTarget,
} from './graphicalViewProtocol';

export interface AcceptedGraphicalViewResult {
    readonly version: number;
    readonly uri: string;
    readonly svg: string;
    readonly targets: readonly Readonly<GraphicalViewTarget>[];
    readonly warnings: readonly GraphicalViewRenderWarning[];
    readonly targetById: ReadonlyMap<string, Readonly<GraphicalViewTarget>>;
    readonly attributeRowsAvailable: boolean;
}

const RENDER_WARNINGS: ReadonlySet<string> = new Set([
    'unsupportedUri',
    'missingDocument',
    'modelTooLarge',
    'timeout',
    'temporarilyUnresolvable',
]);
const ASPECT_MODEL_URN_PATTERN = /^urn:samm:[^\s#]+#[^\s#]+$/;
const LANGUAGE_PATTERN = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/;
const SVG_ID_PATTERN = /\bid\s*=\s*(["'])([^"']+)\1/g;
const GRAPHPER_DESCENDANT_PATTERN = /^gv-(?:header|attribute)-[a-z0-9]{16,32}_(?:polygon|text_0)$/;

export function isGraphicalViewRenderResult(value: unknown): value is GraphicalViewRenderResult {
    if (!isRecord(value) || typeof value.uri !== 'string' || !Array.isArray(value.targets) || !Array.isArray(value.warnings)) {
        return false;
    }

    const allowedResultKeys = value.svg === undefined ? ['targets', 'uri', 'warnings'] : ['svg', 'targets', 'uri', 'warnings'];
    if (!hasExactKeys(value, allowedResultKeys)) {
        return false;
    }
    if (value.svg !== undefined && value.svg !== null && typeof value.svg !== 'string') {
        return false;
    }
    if (!value.warnings.every(warning => typeof warning === 'string' && RENDER_WARNINGS.has(warning))) {
        return false;
    }
    if (!value.targets.every(isGraphicalViewTarget)) {
        return false;
    }
    if (value.svg === undefined || value.svg === null) {
        return value.targets.length === 0 && value.warnings.length > 0;
    }
    return value.svg.trim().length > 0 && hasConsistentSidecar(value.svg, value.targets);
}

export function acceptGraphicalViewResult(
    result: GraphicalViewRenderResult,
    version: number,
    attributeRowsAvailable: boolean,
): AcceptedGraphicalViewResult {
    if (result.svg === undefined || result.svg === null) {
        throw new Error('A successful graphical-view result requires SVG content.');
    }
    const targets = Object.freeze(result.targets.map(target => Object.freeze({...target})));
    const warnings = Object.freeze([...result.warnings]);
    const targetById = new ImmutableMap(targets.map(target => [target.id, target] as const));
    return Object.freeze({
        version,
        uri: result.uri,
        svg: result.svg,
        targets,
        warnings,
        targetById,
        attributeRowsAvailable,
    });
}

class ImmutableMap<K, V> implements ReadonlyMap<K, V> {
    private readonly valuesByKey: Map<K, V>;

    constructor(entries: readonly (readonly [K, V])[]) {
        this.valuesByKey = new Map(entries);
        Object.freeze(this);
    }

    get size(): number {
        return this.valuesByKey.size;
    }

    get(key: K): V | undefined {
        return this.valuesByKey.get(key);
    }

    has(key: K): boolean {
        return this.valuesByKey.has(key);
    }

    forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
        this.valuesByKey.forEach((value, key) => callback.call(thisArg, value, key, this));
    }

    entries(): MapIterator<[K, V]> {
        return this.valuesByKey.entries();
    }

    keys(): MapIterator<K> {
        return this.valuesByKey.keys();
    }

    values(): MapIterator<V> {
        return this.valuesByKey.values();
    }

    [Symbol.iterator](): MapIterator<[K, V]> {
        return this.entries();
    }

    get [Symbol.toStringTag](): string {
        return 'ImmutableMap';
    }
}

function isGraphicalViewTarget(value: unknown): value is GraphicalViewTarget {
    if (!isRecord(value) || typeof value.id !== 'string') {
        return false;
    }
    if (value.kind === 'elementHeader') {
        return hasExactKeys(value, ['elementUrn', 'id', 'kind'])
            && GRAPHICAL_VIEW_HEADER_MARKER_PATTERN.test(value.id)
            && typeof value.elementUrn === 'string'
            && ASPECT_MODEL_URN_PATTERN.test(value.elementUrn);
    }
    if (value.kind !== 'attributeRow') {
        return false;
    }
    const expectedKeys = value.language === undefined
        ? ['id', 'kind', 'ownerUrn', 'predicateUrn', 'selection']
        : ['id', 'kind', 'language', 'ownerUrn', 'predicateUrn', 'selection'];
    return hasExactKeys(value, expectedKeys)
        && GRAPHICAL_VIEW_ATTRIBUTE_MARKER_PATTERN.test(value.id)
        && typeof value.ownerUrn === 'string'
        && ASPECT_MODEL_URN_PATTERN.test(value.ownerUrn)
        && typeof value.predicateUrn === 'string'
        && ASPECT_MODEL_URN_PATTERN.test(value.predicateUrn)
        && (value.selection === 'singleOccurrence' || value.selection === 'predicateStart')
        && (value.language === undefined
            || (value.selection === 'singleOccurrence'
                && typeof value.language === 'string'
                && LANGUAGE_PATTERN.test(value.language)));
}

function hasConsistentSidecar(svg: string, targets: GraphicalViewTarget[]): boolean {
    const targetIds = new Set<string>();
    for (const target of targets) {
        if (targetIds.has(target.id)) {
            return false;
        }
        targetIds.add(target.id);
    }

    const svgIds = new Set<string>();
    for (const match of svg.matchAll(SVG_ID_PATTERN)) {
        const id = match[2];
        if (GRAPHPER_DESCENDANT_PATTERN.test(id)) {
            continue;
        }
        if (!id.startsWith('gv-header-') && !id.startsWith('gv-attribute-')) {
            continue;
        }
        if (!GRAPHICAL_VIEW_MARKER_PATTERN.test(id) || svgIds.has(id)) {
            return false;
        }
        svgIds.add(id);
    }

    return targetIds.size === svgIds.size && [...targetIds].every(id => svgIds.has(id));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
    const actualKeys = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    return actualKeys.length === expected.length && actualKeys.every((key, index) => key === expected[index]);
}
