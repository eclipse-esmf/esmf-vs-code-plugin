package com.example.turtlelsp.lsp.text;

import java.util.List;
import java.util.concurrent.CompletableFuture;

import com.example.turtlelsp.aspect.model.AspectValidationResult;
import com.example.turtlelsp.aspect.service.AspectModelValidationService;
import com.example.turtlelsp.aspect.service.AspectValidationCoordinator;
import com.example.turtlelsp.aspect.service.DefaultAspectModelValidationService;
import com.example.turtlelsp.turtle.navigation.TurtlePrefixDefinitionService;
import org.eclipse.lsp4j.DefinitionParams;
import org.eclipse.lsp4j.DidChangeTextDocumentParams;
import org.eclipse.lsp4j.DidCloseTextDocumentParams;
import org.eclipse.lsp4j.DidOpenTextDocumentParams;
import org.eclipse.lsp4j.DidSaveTextDocumentParams;
import org.eclipse.lsp4j.Location;
import org.eclipse.lsp4j.jsonrpc.messages.Either;
import org.eclipse.lsp4j.services.LanguageClient;
import org.eclipse.lsp4j.services.TextDocumentService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class TurtleTextDocumentService implements TextDocumentService {
   private static final Logger LOGGER = LoggerFactory.getLogger( TurtleTextDocumentService.class );
   private final DocumentStore documentStore;
   private final DocumentDiagnosticsService diagnosticsService;
   private final TextDocumentClientNotifier clientNotifier;
   private final TurtlePrefixDefinitionService prefixDefinitionService;
   private final DocumentAspectValidationService documentValidationService;
   private final AspectDiagnosticsWorkflow aspectDiagnosticsWorkflow;
   private final AspectValidationCoordinator aspectValidationCoordinator;

   public TurtleTextDocumentService() {
      this( new DefaultAspectModelValidationService() );
   }

   public TurtleTextDocumentService( AspectModelValidationService aspectValidationService ) {
      this(
            new DocumentStore(),
            new DocumentDiagnosticsService(),
            new TurtlePrefixDefinitionService(),
            new AspectValidationCoordinator( aspectValidationService )
      );
   }

   TurtleTextDocumentService(
         DocumentStore documentStore,
         DocumentDiagnosticsService diagnosticsService,
         TurtlePrefixDefinitionService prefixDefinitionService,
         AspectValidationCoordinator aspectValidationCoordinator ) {
      this.documentStore = documentStore;
      this.diagnosticsService = diagnosticsService;
      this.prefixDefinitionService = prefixDefinitionService;
      this.aspectValidationCoordinator = aspectValidationCoordinator;
      this.clientNotifier = new TextDocumentClientNotifier( diagnosticsService );
      this.documentValidationService = new DocumentAspectValidationService( aspectValidationCoordinator );
      this.aspectDiagnosticsWorkflow = new AspectDiagnosticsWorkflow( aspectValidationCoordinator, diagnosticsService, clientNotifier );
   }

   public void connect( LanguageClient client ) {
      clientNotifier.connect( client );
   }

   public void shutdown() {
      aspectValidationCoordinator.close();
   }

   public AspectValidationResult validateDocument( String uri ) {
      return documentValidationService.validateDocument( uri, documentStore.get( uri ) );
   }

   @Override
   public void didOpen( DidOpenTextDocumentParams params ) {
      String uri = params.getTextDocument().getUri();
      String content = params.getTextDocument().getText();
      LOGGER.info( "[didOpen] uri={}, contentLength={}", uri, content.length() );
      documentStore.put( uri, content );
      diagnosticsService.updateSyntax( uri, content );
      clientNotifier.publishCombinedDiagnostics( uri );
   }

   @Override
   public void didChange( DidChangeTextDocumentParams params ) {
      String uri = params.getTextDocument().getUri();
      String content = params.getContentChanges().isEmpty() ?
            documentStore.getOrDefault( uri, "" ) :
            params.getContentChanges().getLast().getText();
      LOGGER.debug( "[didChange] uri={}, contentLength={}, changes={}", uri, content.length(), params.getContentChanges().size() );
      documentStore.put( uri, content );
      diagnosticsService.updateSyntax( uri, content );
      aspectDiagnosticsWorkflow.onDocumentChanged( uri );
      clientNotifier.publishCombinedDiagnostics( uri );
   }

   @Override
   public void didClose( DidCloseTextDocumentParams params ) {
      String uri = params.getTextDocument().getUri();
      LOGGER.info( "[didClose] uri={}", uri );
      documentStore.remove( uri );
      aspectDiagnosticsWorkflow.onDocumentClosed( uri );
      clientNotifier.publishEmptyDiagnostics( uri );
   }

   @Override
   public void didSave( DidSaveTextDocumentParams params ) {
      String uri = params.getTextDocument().getUri();
      String content = documentStore.getOrDefault( uri, "" );
      LOGGER.info( "[didSave] uri={}, contentLength={}", uri, content.length() );
      diagnosticsService.updateSyntax( uri, content );
      clientNotifier.publishCombinedDiagnostics( uri );
      aspectDiagnosticsWorkflow.onDocumentSaved( uri );
   }

   @Override
   public CompletableFuture<Either<List<? extends Location>, List<? extends org.eclipse.lsp4j.LocationLink>>> definition(
         DefinitionParams params ) {
      String uri = params.getTextDocument().getUri();
      String content = documentStore.get( uri );
      if ( content == null ) {
         return CompletableFuture.completedFuture( Either.forLeft( List.of() ) );
      }

      Location declaration = prefixDefinitionService.findPrefixDeclaration( uri, content, params.getPosition() );
      if ( declaration == null ) {
         return CompletableFuture.completedFuture( Either.forLeft( List.of() ) );
      }

      return CompletableFuture.completedFuture( Either.forLeft( List.of( declaration ) ) );
   }
}
