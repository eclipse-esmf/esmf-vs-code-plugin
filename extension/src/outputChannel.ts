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

/**
 * Minimal structured-logging interface shared by all extension modules.
 * The real implementation is `vscode.LogOutputChannel`; tests supply a fake.
 */
export interface ExtensionLogger {
    trace(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string | Error): void;
}
