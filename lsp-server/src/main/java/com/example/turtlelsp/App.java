package com.example.turtlelsp;

import org.eclipse.lsp4j.jsonrpc.Launcher;
import org.eclipse.lsp4j.services.LanguageClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class App {
    private static final Logger LOGGER = LoggerFactory.getLogger(App.class);

    public static void main(String[] args) {
        LOGGER.info("Starting lsp-server");
        TurtleLanguageServer server = new TurtleLanguageServer();

        try {
            Launcher<LanguageClient> launcher = Launcher.createLauncher(
                server,
                LanguageClient.class,
                System.in,
                System.out
            );

            server.connect(launcher.getRemoteProxy());
            launcher.startListening().get();
            LOGGER.info("Language server listener stopped");
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            LOGGER.error("Language server listener was interrupted", ex);
        } catch (Exception ex) {
            LOGGER.error("Language server terminated with an error", ex);
        }
    }
}
