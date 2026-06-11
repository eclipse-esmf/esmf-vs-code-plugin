package com.example.turtlelsp.lsp.workspace;

import com.example.turtlelsp.lsp.text.TurtleTextDocumentService;

import org.eclipse.lsp4j.DidChangeConfigurationParams;
import org.eclipse.lsp4j.DidChangeWatchedFilesParams;
import org.eclipse.lsp4j.services.WorkspaceService;

public class TurtleWorkspaceService implements WorkspaceService {
   public TurtleWorkspaceService( TurtleTextDocumentService textDocumentService ) {
   }

   @Override
   public void didChangeConfiguration( DidChangeConfigurationParams params ) {
   }

   @Override
   public void didChangeWatchedFiles( DidChangeWatchedFilesParams params ) {
   }
}
