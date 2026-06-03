import * as vscode from 'vscode';

const SAMM_CLI_SELECTION_CONFIG_KEY = 'sammCliSelection';
const DEFAULT_SAMM_CLI_RELEASE: ReleaseSammCliSelection = { kind: 'release', releaseTag: 'v2.14.3' };

type ReleaseSammCliSelection = {
    kind: 'release';
    releaseTag: string;
};

type CustomPathSammCliSelection = {
    kind: 'customPath';
    path: string;
};

type NoSammCliSelection = {
    kind: 'noSammCli';
};

export type SammCliSelection = ReleaseSammCliSelection | CustomPathSammCliSelection | NoSammCliSelection;

export class TurtleExtensionSettings {
    constructor(
        private readonly context: vscode.ExtensionContext,
    ) { }

    getSammCliSelection(): SammCliSelection  {
        return this.context.globalState.get<SammCliSelection>(SAMM_CLI_SELECTION_CONFIG_KEY, DEFAULT_SAMM_CLI_RELEASE);
    }

    async setSammCliSelection(selection: SammCliSelection): Promise<void> {
        await this.context.globalState.update(SAMM_CLI_SELECTION_CONFIG_KEY, selection);
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