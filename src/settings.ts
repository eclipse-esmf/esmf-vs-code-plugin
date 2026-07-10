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

import * as vscode from 'vscode';

export class TurtleExtensionSettings {

    isEmbeddedLanguageServerStartEnabled(): boolean {
        return vscode.workspace.getConfiguration('semantic-models.languageServerSettings').get<boolean>('activateEmbeddedLanguageServer', true);
    }

    async setEmbeddedLanguageServerStartEnabled(enabled: boolean): Promise<void> {
        await vscode.workspace.getConfiguration('semantic-models.languageServerSettings').update('activateEmbeddedLanguageServer', enabled, vscode.ConfigurationTarget.Global);
    }

    getSammCliPath(): string {
        return vscode.workspace.getConfiguration('semantic-models.languageServerSettings').get<string>('sammCliPath', '');
    }

    async setSammCliPath(path: string): Promise<void> {
        await vscode.workspace.getConfiguration('semantic-models.languageServerSettings').update('sammCliPath', path, vscode.ConfigurationTarget.Global);
    }

    sammCliAutoUpdateIsEnabled(): boolean {
        return vscode.workspace.getConfiguration('semantic-models.languageServerSettings').get<boolean>('automaticUpdateCheck', true);
    }

    getSammCliLspServerPort(): number {
        return vscode.workspace.getConfiguration('semantic-models.languageServerSettings').get<number>('serverPort', 1846);
    }

    getLanguageClientTraceLevel(): 'off' | 'messages' | 'verbose' {
        return vscode.workspace.getConfiguration('semantic-models.languageServerSettings').get<'off' | 'messages' | 'verbose'>('traceLevel', 'off');
    }

}
