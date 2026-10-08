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

export const GRAPHICAL_VIEW_RENDER_REQUEST = 'turtle/graphicalView/render';
export const GRAPHICAL_VIEW_RESOLVE_TARGET_REQUEST = 'turtle/graphicalView/resolveTarget';
export const GRAPHICAL_VIEW_RESOLVE_ATTRIBUTE_TARGET_REQUEST = 'turtle/graphicalView/resolveAttributeTarget';
export const GRAPHICAL_VIEW_HEADER_MARKER_PATTERN = /^gv-header-[a-z0-9]{16,32}$/;
export const GRAPHICAL_VIEW_ATTRIBUTE_MARKER_PATTERN = /^gv-attribute-[a-z0-9]{16,32}$/;
export const GRAPHICAL_VIEW_MARKER_PATTERN = /^gv-(?:header|attribute)-[a-z0-9]{16,32}$/;

export type GraphicalViewRenderWarning =
    | 'unsupportedUri'
    | 'missingDocument'
    | 'modelTooLarge'
    | 'timeout'
    | 'temporarilyUnresolvable';

export type GraphicalViewResolveTargetWarning = 'notFound' | 'ambiguous' | 'unsupportedUri' | 'temporarilyUnresolvable';

export interface GraphicalViewRenderParams {
    uri: string;
    includeAttributeRows?: boolean;
}

export interface GraphicalViewElementHeaderTarget {
    id: string;
    kind: 'elementHeader';
    elementUrn: string;
}

export interface GraphicalViewAttributeTarget {
    id: string;
    kind: 'attributeRow';
    ownerUrn: string;
    predicateUrn: string;
    selection: 'singleOccurrence' | 'predicateStart';
    language?: string;
}

export type GraphicalViewTarget = GraphicalViewElementHeaderTarget | GraphicalViewAttributeTarget;

export interface GraphicalViewRenderResult {
    uri: string;
    svg?: string | null;
    targets: GraphicalViewTarget[];
    warnings: GraphicalViewRenderWarning[];
}

export interface GraphicalViewResolveTargetParams {
    sourceUri: string;
    elementUrn: string;
}

export interface GraphicalViewPosition {
    line: number;
    character: number;
}

export interface GraphicalViewLocation {
    uri: string;
    range: {
        start: GraphicalViewPosition;
        end: GraphicalViewPosition;
    };
}

export interface GraphicalViewResolveTargetResult {
    location?: GraphicalViewLocation | null;
    warning?: GraphicalViewResolveTargetWarning | null;
}

export interface GraphicalViewResolveAttributeTargetParams {
    sourceUri: string;
    ownerUrn: string;
    predicateUrn: string;
    selection: 'singleOccurrence' | 'predicateStart';
    language?: string;
}

export type GraphicalViewResolveAttributeTargetResult = GraphicalViewResolveTargetResult;
