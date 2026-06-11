package com.example.turtlelsp.lsp.text;

import java.util.List;

import org.eclipse.lsp4j.Diagnostic;
import org.eclipse.lsp4j.PublishDiagnosticsParams;
import org.eclipse.lsp4j.services.LanguageClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class TextDocumentClientNotifier {
   private static final Logger LOGGER = LoggerFactory.getLogger( TextDocumentClientNotifier.class );

   private final DocumentDiagnosticsService diagnosticsService;
   private LanguageClient client;

   public TextDocumentClientNotifier( DocumentDiagnosticsService diagnosticsService ) {
      this.diagnosticsService = diagnosticsService;
   }

   public void connect( LanguageClient client ) {
      this.client = client;
   }

   public void publishCombinedDiagnostics( String uri ) {
      if ( client == null ) {
         LOGGER.warn( "[publishDiagnostics] client is null, skipping for uri={}", uri );
         return;
      }

      List<Diagnostic> diagnostics = diagnosticsService.getCombined( uri );
      LOGGER.debug( "[publish diagnostics] publishing {} diagnostic(s) for uri={}", diagnostics.size(), uri );
      client.publishDiagnostics( new PublishDiagnosticsParams( uri, diagnostics ) );
   }

   public void publishEmptyDiagnostics( String uri ) {
      if ( client == null ) {
         return;
      }

      client.publishDiagnostics( new PublishDiagnosticsParams( uri, List.of() ) );
   }
}
