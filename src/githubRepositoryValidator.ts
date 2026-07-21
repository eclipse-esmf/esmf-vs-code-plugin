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
import type { GithubRepositoryConfig } from './settings';
import type { ExtensionLogger } from './outputChannel';

/**
 * Validates the `semantic-models.modelResolution.githubRepositories` setting by checking, for
 * each configured entry, that the repository exists and is accessible using the provided token
 * (or anonymously, if none was provided). Problems are logged and surfaced to the user via an
 * error notification.
 */
export class GitHubRepositoryValidator {
    constructor(private readonly outputChannel: ExtensionLogger) { }

    async validate(repositories: Array<GithubRepositoryConfig>): Promise<void> {
        if (repositories.length === 0) {
            return;
        }

        const errors = (await Promise.all(repositories.map(repository => this.validateRepository(repository))))
            .filter((error): error is string => error !== undefined);

        if (errors.length === 0) {
            return;
        }

        const message = errors.length === 1
            ? errors[0]
            : `Multiple issues were found with the configured GitHub repositories for Aspect Model Resolution:\n- ${errors.join('\n- ')}`;

        this.outputChannel.error(message);

        const selection = await vscode.window.showErrorMessage(message, 'Check Extension Settings');
        if (selection === 'Check Extension Settings') {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'semantic-models.modelResolution');
        }
    }

    private async validateRepository(repository: GithubRepositoryConfig): Promise<string | undefined> {
        if (!repository.repository) {
            return 'A GitHub repository entry is missing the required "repository" field.';
        }

        if (repository.branch && repository.tag) {
            return `GitHub repository "${repository.repository}" has both "branch" and "tag" configured; only one of them may be set.`;
        }

        try {
            const response = await fetch(`https://api.github.com/repos/${repository.repository}`, {
                headers: this.buildHeaders(repository.token),
            });

            if (response.ok) {
                return undefined;
            }

            return this.describeError(repository, response);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `Failed to reach GitHub while validating repository "${repository.repository}": ${message}`;
        }
    }

    private buildHeaders(token: string | undefined): Record<string, string> {
        const headers: Record<string, string> = {
            'User-Agent': 'esmf-vs-code-plugin',
            Accept: 'application/vnd.github+json',
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        return headers;
    }

    private describeError(repository: GithubRepositoryConfig, response: Response): string {
        const hasToken = !!repository.token;

        switch (response.status) {
            case 401:
                return `The configured token for GitHub repository "${repository.repository}" is invalid or expired.`;
            case 403:
                if (response.headers.get('x-ratelimit-remaining') === '0') {
                    const reset = response.headers.get('x-ratelimit-reset');
                    const resetHint = reset ? ` Try again after ${new Date(Number(reset) * 1000).toLocaleTimeString()}.` : '';
                    return `GitHub API rate limit exceeded while validating repository "${repository.repository}".${resetHint}`;
                }
                return `Access to GitHub repository "${repository.repository}" is forbidden${hasToken ? ' with the configured token' : '; it may be private and require a token'}.`;
            case 404:
                return `GitHub repository "${repository.repository}" was not found or is not accessible${hasToken ? ' with the configured token' : '; it may be private, configure a token if needed'}.`;
            default:
                return `Failed to validate GitHub repository "${repository.repository}": ${response.status} ${response.statusText}`;
        }
    }
}
