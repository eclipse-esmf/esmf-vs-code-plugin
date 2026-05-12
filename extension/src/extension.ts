import * as vscode from 'vscode';
import {LanguageClient, LanguageClientOptions, State, StreamInfo} from 'vscode-languageclient/node';
import {AspectValidationController} from './aspectValidation';
import {ExtensionContext, workspace} from 'vscode';
import net from 'net';
import { Trace } from 'vscode-jsonrpc';

var client: LanguageClient | undefined;
let aspectValidationController: AspectValidationController;

export async function activate(context: ExtensionContext): Promise<void> {
    // The server is a started as a separate app and listens on port 2113
    let connectionInfo = {
        port: 1846
    };
    let serverOptions = () => {
        // Connect to language server via socket
        let socket = net.connect(connectionInfo);
        let result: StreamInfo = {
            writer: socket,
            reader: socket
        };
        return Promise.resolve(result);
    };

    let clientOptions: LanguageClientOptions = {
        documentSelector: ['turtle'],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher('**/*.ttl')
        }
    };

    // Create the language client and start the client.
    client = new LanguageClient('RDF/Turtle language client', serverOptions, clientOptions);

    const outputChannel = vscode.window.createOutputChannel('Turtle LSP');
    outputChannel.appendLine(`[startup] Connecting to Turtle language server at port ${ connectionInfo.port }...`);

    // enable tracing (Off, Messages, Verbose)
    client.setTrace(Trace.Verbose);
    aspectValidationController = new AspectValidationController(client, vscode.window, vscode.workspace, outputChannel);
    aspectValidationController.register(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('turtleLsp.reconnect', async () => {
            if (client && client.state === State.Running) {
                await client.stop();
            }
            outputChannel.appendLine(`[startup] Connecting to Turtle language server at port ${ connectionInfo.port }...`);
            client = new LanguageClient('RDF/Turtle language client', serverOptions, clientOptions);
            client.setTrace(Trace.Verbose);
            aspectValidationController.setClient(client);
            startClient(client, outputChannel);
        })
    );

    startClient(client, outputChannel);
}

async function startClient(theClient: LanguageClient, outputChannel: vscode.OutputChannel): Promise<void> {
    try {
        await Promise.race([
            theClient.start(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error()), 2000))
        ]);
        outputChannel.appendLine(`[startup] Connected to language server`);
    } catch (e) {
        outputChannel.appendLine(`[startup] Failed to connect to language server`);
    }
}

export async function deactivate(): Promise<void> {
    if (client) {
        await client.stop();
        client = undefined;
    }
}
