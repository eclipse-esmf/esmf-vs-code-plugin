import * as vscode from 'vscode';

export class TurtleExtensionSettings {
    constructor(
        private readonly context: vscode.ExtensionContext,
    ) { }

    isEmbeddedLanguageServerStartEnabled(): boolean {
        return vscode.workspace.getConfiguration('turtle.languageServerSettings').get<boolean>('activateEmbeddedLanguageServer', true);
    }

    getSammCliPath(): string {
        return vscode.workspace.getConfiguration('turtle.languageServerSettings').get<string>('sammCliPath', '');
    }

    async setSammCliPath(path: string): Promise<void> {
        await vscode.workspace.getConfiguration('turtle.languageServerSettings').update('sammCliPath', path, vscode.ConfigurationTarget.Global);
    }

    sammCliAutoUpdateIsEnabled(): boolean {
        return vscode.workspace.getConfiguration('turtle.languageServerSettings').get<boolean>('automaticUpdateCheck', true);
    }

    getSammCliLspServerPort(): number {
        return vscode.workspace.getConfiguration('turtle.languageServerSettings').get<number>('serverPort', 1846);
    }

    getLanguageClientTraceLevel(): 'off' | 'messages' | 'verbose' {
        return vscode.workspace.getConfiguration('turtle.languageServerSettings').get<'off' | 'messages' | 'verbose'>('traceLevel', 'off');
    }

}
