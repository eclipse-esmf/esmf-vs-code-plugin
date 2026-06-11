import * as vscode from 'vscode';

export const VALIDATE_DOCUMENT_REQUEST = 'turtle/aspectValidation/validateDocument';
export const VALIDATE_DOCUMENT_COMMAND = 'turtleLsp.validateAspectModelNow';
const STATUS_MESSAGE_TIMEOUT_MS = 5000;

export type AspectValidationTrigger = 'manual' | 'save';

export interface AspectValidationError {
    type?: string;
    message?: string;
}

export interface AspectValidationResult {
    valid?: boolean;
    report?: string;
    violations?: Array<unknown>;
    error?: AspectValidationError | null;
}

export interface RequestClient {
    sendRequest<R>(method: string, params?: unknown): Thenable<R>;
}

export interface ValidationWindow {
    showInformationMessage(message: string): Thenable<unknown>;
    showWarningMessage(message: string): Thenable<unknown>;
    showErrorMessage(message: string): Thenable<unknown>;
    withProgress<R>(
        options: vscode.ProgressOptions,
        task: (progress: vscode.Progress<{message?: string; increment?: number}>, token: vscode.CancellationToken) => Thenable<R>,
    ): Thenable<R>;
    setStatusBarMessage(text: string, hideAfterTimeout: number): vscode.Disposable;
}

export interface ValidationWorkspace {
    onDidSaveTextDocument(listener: (document: vscode.TextDocument) => void): vscode.Disposable;
}

export interface ValidationOutputChannel {
    appendLine(value: string): void;
}

export class AspectValidationController {
    private readonly inFlightKeys = new Set<string>();

    constructor(
        private readonly client: RequestClient,
        private readonly window: ValidationWindow,
        private readonly workspace: ValidationWorkspace,
        private readonly outputChannel: ValidationOutputChannel,
    ) {}

    register(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand(VALIDATE_DOCUMENT_COMMAND, async () => {
                const editor = vscode.window.activeTextEditor;
                await this.validateDocument(editor?.document, 'manual');
            }),
            this.workspace.onDidSaveTextDocument(async document => {
                await this.validateDocument(document, 'save');
            }),
        );
    }

    async validateDocument(
        document: Pick<vscode.TextDocument, 'languageId' | 'uri'> | undefined,
        trigger: AspectValidationTrigger,
    ): Promise<AspectValidationResult | undefined> {
        if (!document || document.languageId !== 'turtle') {
            if (trigger === 'manual') {
                await this.window.showWarningMessage('Open a Turtle file before running aspect validation.');
            }
            return undefined;
        }

        const request = () =>
            this.client.sendRequest<AspectValidationResult>(VALIDATE_DOCUMENT_REQUEST, {
                uri: document.uri.toString(),
                reason: trigger,
            });

        return this.runValidation(`document:${document.uri.toString()}`, 'Aspect model validation', trigger, request);
    }

    private async runValidation(
        key: string,
        title: string,
        trigger: AspectValidationTrigger,
        request: () => Thenable<AspectValidationResult>,
    ): Promise<AspectValidationResult | undefined> {
        if (this.inFlightKeys.has(key)) {
            this.outputChannel.appendLine(`[aspectValidation] ${title} already running for ${key}`);
            return undefined;
        }

        this.inFlightKeys.add(key);
        try {
            const result = await this.runWithProgress(title, trigger, request);

            await this.showSummary(result, trigger);
            return result;
        } catch (error) {
            await this.handleFailure(error, trigger);
            return undefined;
        } finally {
            this.inFlightKeys.delete(key);
        }
    }

    private runWithProgress(
        title: string,
        trigger: AspectValidationTrigger,
        request: () => Thenable<AspectValidationResult>,
    ): Promise<AspectValidationResult> {
        if (trigger === 'save') {
            const disposable = this.window.setStatusBarMessage(`${title} in progress...`, STATUS_MESSAGE_TIMEOUT_MS);
            return Promise.resolve(request()).finally(() => disposable.dispose());
        }

        return Promise.resolve(
            this.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title,
                    cancellable: false,
                },
                async () => request(),
            ),
        );
    }

    private async showSummary(result: AspectValidationResult, trigger: AspectValidationTrigger): Promise<void> {
        const summary = this.formatSummary(result);
        this.outputChannel.appendLine(`[aspectValidation] ${summary}`);

        if (trigger === 'save') {
            this.window.setStatusBarMessage(summary, STATUS_MESSAGE_TIMEOUT_MS);
            return;
        }

        if (result.error) {
            await this.window.showErrorMessage(summary);
            return;
        }

        if (result.valid === false) {
            await this.window.showWarningMessage(summary);
            return;
        }

        await this.window.showInformationMessage(summary);
    }

    private async handleFailure(error: unknown, trigger: AspectValidationTrigger): Promise<void> {
        const summary = this.toFailureMessage(error);
        this.outputChannel.appendLine(`[aspectValidation] ${summary}`);

        if (trigger === 'save') {
            this.window.setStatusBarMessage(summary, STATUS_MESSAGE_TIMEOUT_MS);
            return;
        }

        await this.window.showErrorMessage(summary);
    }

    private formatSummary(result: AspectValidationResult): string {
        if (result.error?.message) {
            return `Aspect validation failed: ${result.error.message}`;
        }

        const violationCount = result.violations?.length ?? 0;
        const baseMessage =
            result.valid || violationCount === 0
                ? 'Aspect validation completed without issues.'
                : `Aspect validation found ${violationCount} issue${violationCount === 1 ? '' : 's'}.`;

        if (!result.report) {
            return baseMessage;
        }

        const firstLine = result.report
            .split(/\r?\n/)
            .map(line => line.trim())
            .find(line => line.length > 0);

        return firstLine ? `${baseMessage} ${firstLine}` : baseMessage;
    }

    private toFailureMessage(error: unknown): string {
        if (error instanceof Error) {
            if (error.message.includes('Method not found')) {
                return 'Aspect validation request is not supported by the current server build.';
            }
            return `Aspect validation request failed: ${error.message}`;
        }

        return 'Aspect validation request failed.';
    }
}
