import * as vscode from 'vscode';
import {
    AspectValidationController,
    DiagnosticReport,
    RequestClient,
    ValidationOutputChannel,
    ValidationWindow,
    ValidationWorkspace,
} from '../aspectValidation';

type ValidationHarnessOptions = {
    response?: DiagnosticReport;
    error?: Error;
};

type RecordedRequest = {
    method: string;
    params: unknown;
};

type FakeWindow = ValidationWindow & {
    errorMessages: string[];
    infoMessages: string[];
    progressTitles: string[];
    statusMessages: string[];
    warningMessages: string[];
};

type FakeWorkspace = ValidationWorkspace & {
    fireSave(document: Pick<vscode.TextDocument, 'languageId' | 'uri'>): Promise<void>;
};

type FakeOutputChannel = ValidationOutputChannel & {
    lines: string[];
};

export function createValidationControllerHarness(options: ValidationHarnessOptions = {}) {
    const sentRequests: RecordedRequest[] = [];
    const window = createFakeWindow();
    const workspace = createFakeWorkspace();
    const outputChannel = createFakeOutputChannel();
    const client: RequestClient = {
        sendRequest: async <R>(method: string, params?: unknown) => {
            sentRequests.push({method, params});

            if (options.error) {
                throw options.error;
            }

            return (options.response ?? {valid: true}) as R;
        },
    };

    return {
        controller: new AspectValidationController(client, window, workspace, outputChannel),
        outputChannel,
        sentRequests,
        window,
        workspace,
    };
}

export function createValidationDocument(filePath: string): Pick<vscode.TextDocument, 'languageId' | 'uri'> {
    return {
        languageId: 'turtle',
        uri: vscode.Uri.file(filePath),
    };
}

function createFakeWorkspace(): FakeWorkspace {
    let saveListener: ((document: vscode.TextDocument) => void | Promise<void>) | undefined;

    return {
        onDidSaveTextDocument: (listener: (document: vscode.TextDocument) => void | Promise<void>) => {
            saveListener = listener;
            return new vscode.Disposable(() => undefined);
        },
        fireSave: async (document: Pick<vscode.TextDocument, 'languageId' | 'uri'>) => {
            await saveListener?.(document as vscode.TextDocument);
        },
    };
}

function createFakeWindow(): FakeWindow {
    return {
        errorMessages: [],
        infoMessages: [],
        progressTitles: [],
        statusMessages: [],
        warningMessages: [],
        showInformationMessage(message: string) {
            this.infoMessages.push(message);
            return Promise.resolve(undefined);
        },
        showWarningMessage(message: string) {
            this.warningMessages.push(message);
            return Promise.resolve(undefined);
        },
        showErrorMessage(message: string) {
            this.errorMessages.push(message);
            return Promise.resolve(undefined);
        },
        withProgress<R>(
            options: vscode.ProgressOptions,
            task: (progress: vscode.Progress<{message?: string; increment?: number}>, token: vscode.CancellationToken) => Thenable<R>,
        ) {
            this.progressTitles.push(options.title ?? '');
            return Promise.resolve(task({report: () => undefined}, {} as vscode.CancellationToken));
        },
        setStatusBarMessage(text: string) {
            this.statusMessages.push(text);
            return new vscode.Disposable(() => undefined);
        },
    };
}

function createFakeOutputChannel(): FakeOutputChannel {
    return {
        lines: [],
        appendLine(value: string) {
            this.lines.push(value);
        },
    };
}
