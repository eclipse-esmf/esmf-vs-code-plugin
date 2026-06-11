package com.example.turtlelsp;

import java.util.concurrent.CompletableFuture;

import com.example.turtlelsp.aspect.model.AspectValidationResult;
import com.example.turtlelsp.aspect.request.ValidateDocumentParams;
import com.example.turtlelsp.aspect.service.AspectModelValidationService;
import com.example.turtlelsp.lsp.text.TurtleTextDocumentService;
import com.example.turtlelsp.lsp.workspace.TurtleWorkspaceService;
import org.eclipse.lsp4j.InitializeParams;
import org.eclipse.lsp4j.InitializeResult;
import org.eclipse.lsp4j.SaveOptions;
import org.eclipse.lsp4j.ServerCapabilities;
import org.eclipse.lsp4j.TextDocumentSyncKind;
import org.eclipse.lsp4j.TextDocumentSyncOptions;
import org.eclipse.lsp4j.jsonrpc.services.JsonRequest;
import org.eclipse.lsp4j.services.LanguageClient;
import org.eclipse.lsp4j.services.LanguageClientAware;
import org.eclipse.lsp4j.services.LanguageServer;
import org.eclipse.lsp4j.services.TextDocumentService;
import org.eclipse.lsp4j.services.WorkspaceService;

public class TurtleLanguageServer implements LanguageServer, LanguageClientAware {
   private final TurtleTextDocumentService textDocumentService;
   private final TurtleWorkspaceService workspaceService;

   public TurtleLanguageServer() {
      this( new TurtleTextDocumentService() );
   }

   TurtleLanguageServer( TurtleTextDocumentService textDocumentService ) {
      this.textDocumentService = textDocumentService;
      this.workspaceService = new TurtleWorkspaceService( textDocumentService );
   }

   @Override
   public CompletableFuture<InitializeResult> initialize( InitializeParams params ) {
      ServerCapabilities capabilities = new ServerCapabilities();
      TextDocumentSyncOptions syncOptions = new TextDocumentSyncOptions();
      syncOptions.setOpenClose( true );
      syncOptions.setChange( TextDocumentSyncKind.Full );
      syncOptions.setSave( new SaveOptions( true ) );
      capabilities.setTextDocumentSync( syncOptions );
      capabilities.setDefinitionProvider( true );

      return CompletableFuture.completedFuture( new InitializeResult( capabilities ) );
   }

   @Override
   public CompletableFuture<Object> shutdown() {
      textDocumentService.shutdown();
      return CompletableFuture.completedFuture( null );
   }

   @Override
   public void exit() {
      throw new UnsupportedOperationException();
   }

   @Override
   public TextDocumentService getTextDocumentService() {
      return textDocumentService;
   }

   @Override
   public WorkspaceService getWorkspaceService() {
      return workspaceService;
   }

   @Override
   public void connect( LanguageClient client ) {
      textDocumentService.connect( client );
   }

   @JsonRequest("turtle/aspectValidation/validateDocument")
   public CompletableFuture<AspectValidationResult> validateDocument( ValidateDocumentParams params ) {
      String uri = params != null ? params.uri() : null;
      return CompletableFuture.completedFuture( textDocumentService.validateDocument( uri ) );
   }
}
