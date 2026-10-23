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

(function () {
    'use strict';

    const MIN_ZOOM = 0.25;
    const MAX_ZOOM = 4;
    const ZOOM_FACTOR = 1.2;
    const VIEWPORT_PADDING = 24;
    const WHEEL_LINE_PIXELS = 16;
    const MAX_WHEEL_DELTA = 100;
    const WHEEL_ZOOM_SENSITIVITY = 0.002;
    const WHEEL_GESTURE_IDLE_MS = 160;
    const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
    const MARKER_PATTERN = /^gv-(?:header|attribute)-[a-z0-9]{16,32}$/;
    const POSITIVE_DIMENSION_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:pt)?$/;
    const vscode = acquireVsCodeApi();
    const viewport = document.querySelector('#viewport');
    const diagram = document.querySelector('#diagram');
    const status = document.querySelector('#status');
    const statusText = document.querySelector('#status-text');
    const zoomValue = document.querySelector('#zoom-value');
    const STATUS_KINDS = Object.freeze(['loading', 'ready', 'stale', 'unsupported', 'disconnected']);
    let currentVersion = null;
    let currentSvg = null;
    let baseWidth = 0;
    let baseHeight = 0;
    let layoutGeneration = 0;
    let wheelFrame = null;
    let pendingWheelDelta = 0;
    let pendingWheelAnchor = null;
    let wheelGeneration = 0;
    let wheelGestureAnchor = null;
    let wheelGestureTimeout = null;
    let pendingRenderedVersion = null;
    let pendingViewportInitialization = false;
    let viewportLayoutPending = false;
    let pendingAnchorCorrection = null;
    let state = normalizeState(vscode.getState());

    function normalizeState(candidate) {
        if (!candidate || candidate.schemaVersion !== 1) {
            return {schemaVersion: 1, zoom: 1, scrollLeft: 0, scrollTop: 0, viewportInitialized: false};
        }
        const legacyStateIsValid =
            !Object.hasOwn(candidate, 'viewportInitialized') &&
            Number.isFinite(candidate.zoom) &&
            candidate.zoom >= MIN_ZOOM &&
            candidate.zoom <= MAX_ZOOM &&
            Number.isFinite(candidate.scrollLeft) &&
            candidate.scrollLeft >= 0 &&
            Number.isFinite(candidate.scrollTop) &&
            candidate.scrollTop >= 0;
        return {
            schemaVersion: 1,
            zoom: Number.isFinite(candidate.zoom) ? clamp(candidate.zoom, MIN_ZOOM, MAX_ZOOM) : 1,
            scrollLeft: Number.isFinite(candidate.scrollLeft) ? Math.max(0, candidate.scrollLeft) : 0,
            scrollTop: Number.isFinite(candidate.scrollTop) ? Math.max(0, candidate.scrollTop) : 0,
            viewportInitialized: typeof candidate.viewportInitialized === 'boolean' ? candidate.viewportInitialized : legacyStateIsValid,
        };
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function persistState() {
        state = {
            schemaVersion: 1,
            zoom: state.zoom,
            scrollLeft: Math.max(0, viewport.scrollLeft),
            scrollTop: Math.max(0, viewport.scrollTop),
            viewportInitialized: state.viewportInitialized,
        };
        vscode.setState(state);
        updateZoomLabel();
    }

    function updateZoomLabel() {
        zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
    }

    function updateStatus(candidate) {
        if (
            !candidate ||
            typeof candidate !== 'object' ||
            Array.isArray(candidate) ||
            !STATUS_KINDS.includes(candidate.kind) ||
            typeof candidate.message !== 'string'
        ) {
            return;
        }
        status.setAttribute('data-kind', candidate.kind);
        status.setAttribute('title', candidate.message);
        statusText.textContent = candidate.message;
    }

    function captureViewport() {
        state = {...state, scrollLeft: Math.max(0, viewport.scrollLeft), scrollTop: Math.max(0, viewport.scrollTop)};
    }

    function dimensions(svg) {
        const width = parseDimension(svg.getAttribute('width'));
        const height = parseDimension(svg.getAttribute('height'));
        if (width === undefined || height === undefined) {
            throw new Error('SVG dimensions are unavailable');
        }
        return {width, height};
    }

    function parseDimension(value) {
        if (typeof value !== 'string' || !POSITIVE_DIMENSION_PATTERN.test(value)) {
            return undefined;
        }
        const parsed = Number(value.endsWith('pt') ? value.slice(0, -2) : value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    function parseTrustedSvg(svgText) {
        const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
        if (parsed.getElementsByTagName('parsererror').length > 0) {
            throw new Error('SVG is not well-formed XML');
        }
        const svg = parsed.documentElement;
        if (!svg || svg.localName !== 'svg' || svg.namespaceURI !== SVG_NAMESPACE) {
            throw new Error('SVG document root is invalid');
        }
        dimensions(svg);
        const imported = document.importNode(svg, true);
        if (!(imported instanceof Element) || imported.localName !== 'svg' || imported.namespaceURI !== SVG_NAMESPACE) {
            throw new Error('SVG document root could not be imported');
        }
        return imported;
    }

    function applyZoom() {
        if (!currentSvg) {
            updateZoomLabel();
            return;
        }
        currentSvg.setAttribute('width', String(baseWidth * state.zoom));
        currentSvg.setAttribute('height', String(baseHeight * state.zoom));
        updateZoomLabel();
    }

    function restoreViewport(version, fitMeasurement) {
        viewportLayoutPending = true;
        pendingAnchorCorrection = null;
        afterLayout(version, () => {
            if (fitMeasurement && (fitMeasurement.width !== viewport.clientWidth || fitMeasurement.height !== viewport.clientHeight)) {
                applyFit(version);
                return;
            }
            const maximumLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
            const maximumTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
            viewport.scrollLeft = Math.min(state.scrollLeft, maximumLeft);
            viewport.scrollTop = Math.min(state.scrollTop, maximumTop);
            viewportLayoutPending = false;
            completeLayout(version);
        });
    }

    function completeLayout(version) {
        if (pendingRenderedVersion === version && pendingViewportInitialization) {
            state = {...state, viewportInitialized: true};
        }
        persistState();
        if (pendingRenderedVersion === version) {
            pendingRenderedVersion = null;
            pendingViewportInitialization = false;
            vscode.postMessage({type: 'rendered', version});
        }
    }

    function afterLayout(version, callback) {
        const generation = ++layoutGeneration;
        let completed = false;
        const complete = () => {
            if (completed) {
                return;
            }
            completed = true;
            if (generation === layoutGeneration && version === currentVersion) {
                callback();
            }
        };
        requestAnimationFrame(complete);
        setTimeout(complete, 100);
    }

    function viewportCenter() {
        const bounds = viewport.getBoundingClientRect();
        return {clientX: bounds.left + viewport.clientWidth / 2, clientY: bounds.top + viewport.clientHeight / 2};
    }

    function zoomAround(zoom, anchor) {
        if (!currentSvg) {
            return false;
        }
        const nextZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
        if (nextZoom === state.zoom) {
            return false;
        }
        const version = currentVersion;
        applyPendingAnchorCorrection(version);
        layoutGeneration++;
        const svgBounds = currentSvg.getBoundingClientRect();
        const anchorRatioX = svgBounds.width > 0 ? (anchor.clientX - svgBounds.left) / svgBounds.width : 0;
        const anchorRatioY = svgBounds.height > 0 ? (anchor.clientY - svgBounds.top) / svgBounds.height : 0;
        state = {...state, zoom: nextZoom};
        applyZoom();
        viewportLayoutPending = true;
        pendingAnchorCorrection = {version, anchor, anchorRatioX, anchorRatioY};
        applyPendingAnchorCorrection(version);
        completeLayout(version);
        return true;
    }

    function applyPendingAnchorCorrection(version) {
        const correction = pendingAnchorCorrection;
        if (!correction || correction.version !== version || version !== currentVersion || !currentSvg) {
            return;
        }
        const updatedBounds = currentSvg.getBoundingClientRect();
        viewport.scrollLeft += updatedBounds.left + correction.anchorRatioX * updatedBounds.width - correction.anchor.clientX;
        viewport.scrollTop += updatedBounds.top + correction.anchorRatioY * updatedBounds.height - correction.anchor.clientY;
        captureViewport();
        pendingAnchorCorrection = null;
        viewportLayoutPending = false;
    }

    function fitDiagram() {
        if (!currentSvg || baseWidth <= 0 || baseHeight <= 0) {
            return;
        }
        cancelPendingWheel();
        applyFit(currentVersion);
    }

    function applyFit(version) {
        const fitMeasurement = {width: viewport.clientWidth, height: viewport.clientHeight};
        const availableWidth = Math.max(1, fitMeasurement.width - VIEWPORT_PADDING);
        const availableHeight = Math.max(1, fitMeasurement.height - VIEWPORT_PADDING);
        state = {
            ...state,
            zoom: clamp(Math.min(availableWidth / baseWidth, availableHeight / baseHeight), MIN_ZOOM, MAX_ZOOM),
            scrollLeft: 0,
            scrollTop: 0,
        };
        applyZoom();
        restoreViewport(version, fitMeasurement);
    }

    function normalizeWheelDelta(event) {
        const unit = event.deltaMode === 1 ? WHEEL_LINE_PIXELS : event.deltaMode === 2 ? Math.max(1, viewport.clientHeight) : 1;
        return clamp(event.deltaY * unit, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA);
    }

    function handleWheel(event) {
        if (!currentSvg || (!event.ctrlKey && !event.metaKey)) {
            return;
        }
        event.preventDefault();
        const delta = normalizeWheelDelta(event);
        const proposedZoom = clamp(state.zoom * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY), MIN_ZOOM, MAX_ZOOM);
        if (proposedZoom === state.zoom && pendingWheelDelta === 0) {
            return;
        }
        if (!wheelGestureAnchor) {
            wheelGestureAnchor = {clientX: event.clientX, clientY: event.clientY};
        }
        if (wheelGestureTimeout !== null) {
            clearTimeout(wheelGestureTimeout);
        }
        wheelGestureTimeout = setTimeout(() => {
            wheelGestureAnchor = null;
            wheelGestureTimeout = null;
        }, WHEEL_GESTURE_IDLE_MS);
        pendingWheelDelta = clamp(pendingWheelDelta + delta, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA);
        pendingWheelAnchor = wheelGestureAnchor;
        if (wheelFrame !== null) {
            return;
        }
        const generation = ++wheelGeneration;
        let completed = false;
        const completeWheel = () => {
            if (completed) {
                return;
            }
            completed = true;
            if (generation !== wheelGeneration) {
                return;
            }
            wheelFrame = null;
            const accumulatedDelta = pendingWheelDelta;
            const anchor = pendingWheelAnchor;
            pendingWheelDelta = 0;
            pendingWheelAnchor = null;
            if (!anchor || accumulatedDelta === 0) {
                return;
            }
            zoomAround(state.zoom * Math.exp(-accumulatedDelta * WHEEL_ZOOM_SENSITIVITY), anchor);
        };
        wheelFrame = requestAnimationFrame(completeWheel);
        setTimeout(completeWheel, 100);
    }

    function cancelPendingWheel() {
        wheelGeneration++;
        if (wheelGestureTimeout !== null) {
            clearTimeout(wheelGestureTimeout);
        }
        wheelFrame = null;
        pendingWheelDelta = 0;
        pendingWheelAnchor = null;
        wheelGestureAnchor = null;
        wheelGestureTimeout = null;
    }

    function toolbarZoom(zoom) {
        cancelPendingWheel();
        zoomAround(zoom, viewportCenter());
    }

    function isExactMessage(message, keys) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            return false;
        }
        const actualKeys = Object.keys(message).sort();
        return actualKeys.length === keys.length && actualKeys.every((key, index) => key === keys[index]);
    }

    function render(message) {
        if (
            !isExactMessage(message, ['svg', 'type', 'version']) ||
            message.type !== 'render' ||
            !Number.isInteger(message.version) ||
            message.version < 1 ||
            typeof message.svg !== 'string'
        ) {
            return;
        }

        try {
            const parsedSvg = parseTrustedSvg(message.svg);
            const size = dimensions(parsedSvg);
            if (currentSvg) {
                applyPendingAnchorCorrection(currentVersion);
                if (!viewportLayoutPending) {
                    captureViewport();
                }
            }
            makeNavigationMarkersInteractive(parsedSvg);
            cancelPendingWheel();
            diagram.replaceChildren(parsedSvg);
            currentSvg = parsedSvg;
            currentVersion = message.version;
            baseWidth = size.width;
            baseHeight = size.height;
            pendingRenderedVersion = currentVersion;
            pendingViewportInitialization = !state.viewportInitialized;
            if (state.viewportInitialized) {
                applyZoom();
                restoreViewport(currentVersion);
            } else {
                applyFit(currentVersion);
            }
        } catch (error) {
            updateStatus({
                kind: 'stale',
                message: 'The new diagram is not a usable SVG document. The last valid diagram is retained.',
            });
            vscode.postMessage({type: 'renderError', version: message.version, reason: 'xmlParsingFailed'});
        }
    }

    viewport.addEventListener('scroll', persistState, {passive: true});
    viewport.addEventListener('wheel', handleWheel, {passive: false});
    diagram.addEventListener('click', event => {
        activateNavigationTarget(event.target);
    });
    diagram.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        if (activateNavigationTarget(event.target)) {
            event.preventDefault();
        }
    });

    function makeNavigationMarkersInteractive(svg) {
        for (const group of svg.querySelectorAll('g[id]')) {
            if (MARKER_PATTERN.test(group.id)) {
                group.setAttribute('tabindex', '0');
                group.setAttribute('role', 'link');
                group.setAttribute(
                    'aria-label',
                    group.id.startsWith('gv-attribute-') ? 'Navigate to attribute source statement' : 'Navigate to element definition',
                );
            }
        }
    }

    function activateNavigationTarget(target) {
        const group = target instanceof Element ? target.closest('g[id]') : null;
        if (!group || !diagram.contains(group) || !MARKER_PATTERN.test(group.id) || !Number.isInteger(currentVersion)) {
            return false;
        }
        vscode.postMessage({type: 'navigate', version: currentVersion, targetId: group.id});
        return true;
    }

    document.querySelector('#refresh').addEventListener('click', () => vscode.postMessage({type: 'refresh'}));
    document.querySelector('#zoom-in').addEventListener('click', () => toolbarZoom(state.zoom * ZOOM_FACTOR));
    document.querySelector('#zoom-out').addEventListener('click', () => toolbarZoom(state.zoom / ZOOM_FACTOR));
    document.querySelector('#zoom-reset').addEventListener('click', () => toolbarZoom(1));
    document.querySelector('#zoom-fit').addEventListener('click', fitDiagram);

    window.addEventListener('message', event => {
        const message = event.data;
        if (message?.type === 'render') {
            render(message);
            return;
        }
        if (
            isExactMessage(message, ['status', 'type']) &&
            message.type === 'status' &&
            message.status &&
            typeof message.status === 'object'
        ) {
            updateStatus(message.status);
        }
    });

    updateZoomLabel();
    vscode.setState(state);
    vscode.postMessage({type: 'ready'});
})();
