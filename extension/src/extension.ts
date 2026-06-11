import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {Executable, LanguageClient, LanguageClientOptions, ServerOptions} from 'vscode-languageclient/node';
import {AspectValidationController} from './aspectValidation';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const serverProjectPath = path.join(context.extensionPath, '..', 'lsp-server');
    const jarPath = path.join(serverProjectPath, 'target', 'lsp-server.jar');
    const outputChannel = vscode.window.createOutputChannel('Turtle LSP');

    context.subscriptions.push(outputChannel);

    const executable = resolveServerExecutable(serverProjectPath, jarPath);
    if (!executable) {
        const message = `Turtle language server launch target not found in ${serverProjectPath}`;
        outputChannel.appendLine(message);
        void vscode.window.showErrorMessage(`${message}. Run mvn package in the server project before using the extension.`);
        return;
    }

    outputChannel.appendLine(`[startup] Launching Turtle language server via: java ${(executable.args ?? []).join(' ')}`);

    const serverOptions: ServerOptions = {
        run: executable,
        debug: executable,
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            {scheme: 'file', language: 'turtle'},
            {scheme: 'untitled', language: 'turtle'},
        ],
        outputChannel,
        synchronize: {
            configurationSection: 'turtleLsp',
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ttl'),
        },
    };

    client = new LanguageClient('turtleLanguageServer', 'Turtle Language Server', serverOptions, clientOptions);
    context.subscriptions.push(client);
    await client.start();

    const aspectValidationController = new AspectValidationController(client, vscode.window, vscode.workspace, outputChannel);
    aspectValidationController.register(context);
}

function resolveServerExecutable(serverProjectPath: string, jarPath: string): Executable | undefined {
    const runtimeClasspath = resolveMavenRuntimeClasspath(serverProjectPath);

    if (runtimeClasspath) {
        return {
            command: 'java',
            args: ['-cp', runtimeClasspath, 'com.example.turtlelsp.App'],
            options: {
                cwd: serverProjectPath,
            },
        };
    }

    if (fs.existsSync(jarPath)) {
        return {
            command: 'java',
            args: ['-jar', jarPath],
            options: {
                cwd: serverProjectPath,
            },
        };
    }

    return undefined;
}

function resolveMavenRuntimeClasspath(serverProjectPath: string): string | undefined {
    const reportsDirectory = path.join(serverProjectPath, 'target', 'surefire-reports');
    if (!fs.existsSync(reportsDirectory)) {
        return undefined;
    }

    const reportFile = fs.readdirSync(reportsDirectory).find(fileName => fileName.startsWith('TEST-') && fileName.endsWith('.xml'));
    if (!reportFile) {
        return undefined;
    }

    const reportContents = fs.readFileSync(path.join(reportsDirectory, reportFile), 'utf8');
    const match = reportContents.match(/<property name="java\.class\.path" value="([^"]+)"\/>/);
    if (!match) {
        return undefined;
    }

    const entries = match[1]
        .split(path.delimiter)
        .filter(Boolean)
        .filter((entry, index) => !(index === 0 && entry.endsWith(path.join('target', 'test-classes'))))
        .filter(entry => fs.existsSync(entry));

    return entries.length > 0 ? entries.join(path.delimiter) : undefined;
}

export async function deactivate(): Promise<void> {
    if (client) {
        await client.stop();
        client = undefined;
    }
}
