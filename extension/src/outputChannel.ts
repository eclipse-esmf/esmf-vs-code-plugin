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
