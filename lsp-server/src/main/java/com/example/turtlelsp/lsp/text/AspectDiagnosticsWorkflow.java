package com.example.turtlelsp.lsp.text;

import java.nio.file.Path;

import com.example.turtlelsp.aspect.service.AspectValidationCoordinator;
import com.example.turtlelsp.common.uri.DocumentUriResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AspectDiagnosticsWorkflow {
   private static final Logger LOGGER = LoggerFactory.getLogger( AspectDiagnosticsWorkflow.class );

   private final AspectValidationCoordinator aspectValidationCoordinator;
   private final DocumentDiagnosticsService diagnosticsService;
   private final TextDocumentClientNotifier clientNotifier;

   public AspectDiagnosticsWorkflow(
         AspectValidationCoordinator aspectValidationCoordinator,
         DocumentDiagnosticsService diagnosticsService,
         TextDocumentClientNotifier clientNotifier ) {
      this.aspectValidationCoordinator = aspectValidationCoordinator;
      this.diagnosticsService = diagnosticsService;
      this.clientNotifier = clientNotifier;
   }

   public void onDocumentChanged( String uri ) {
      aspectValidationCoordinator.cancel( uri );
      diagnosticsService.clearAspect( uri );
   }

   public void onDocumentClosed( String uri ) {
      aspectValidationCoordinator.cancel( uri );
      diagnosticsService.clearAll( uri );
   }

   public void onDocumentSaved( String uri ) {
      Path path = DocumentUriResolver.toPath( uri );
      if ( path == null ) {
         LOGGER.info( "[scheduleAspectValidation] unsupported non-file uri={}, skipping aspect validation", uri );
         diagnosticsService.clearAspect( uri );
         clientNotifier.publishCombinedDiagnostics( uri );
         return;
      }

      long generation = aspectValidationCoordinator.nextGeneration( uri );
      aspectValidationCoordinator.submit( uri, path, generation, ( completedGeneration, result ) -> {
         long currentGeneration = aspectValidationCoordinator.currentGeneration( uri );
         if ( completedGeneration != currentGeneration ) {
            LOGGER.debug( "[publish diagnostics] ignoring stale aspect diagnostics for uri={}, generation={}, current={}", uri,
                  completedGeneration, currentGeneration );
            return;
         }

         diagnosticsService.updateAspect( uri, result );
         clientNotifier.publishCombinedDiagnostics( uri );
      } );
   }
}
