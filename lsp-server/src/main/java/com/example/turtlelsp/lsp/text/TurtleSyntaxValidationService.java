package com.example.turtlelsp.lsp.text;

import java.util.ArrayList;
import java.util.List;

import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFParser;
import org.apache.jena.riot.RiotException;
import org.apache.jena.riot.RiotParseException;
import org.apache.jena.riot.system.ErrorHandlerFactory;
import org.apache.jena.riot.system.StreamRDFLib;
import org.eclipse.lsp4j.Diagnostic;
import org.eclipse.lsp4j.DiagnosticSeverity;
import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.Range;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class TurtleSyntaxValidationService {
   private static final Logger LOGGER = LoggerFactory.getLogger( TurtleSyntaxValidationService.class );
   private static final String SYNTAX_SOURCE = "lsp-server.syntax";

   public List<Diagnostic> validate( String content ) {
      List<Diagnostic> diagnostics = new ArrayList<>();

      try {
         RDFParser.create()
               .fromString( content )
               .lang( Lang.TTL )
               .errorHandler( ErrorHandlerFactory.errorHandlerStrictNoLogging )
               .parse( StreamRDFLib.sinkNull() );
         LOGGER.debug( "[validate] turtle parsing successful" );
      } catch ( RiotParseException exception ) {
         LOGGER.warn( "[validate] parse error at line={}, col={}: {}", exception.getLine(), exception.getCol(), exception.getMessage() );
         diagnostics.add( toDiagnostic( exception.getMessage(), exception.getLine(), exception.getCol() ) );
      } catch ( RiotException exception ) {
         LOGGER.warn( "[validate] rdf error: {}", exception.getMessage() );
         diagnostics.add( toDiagnostic( exception.getMessage(), 1, 1 ) );
      }

      LOGGER.debug( "[validate] found {} diagnostic(s)", diagnostics.size() );
      return diagnostics;
   }

   private Diagnostic toDiagnostic( String message, long line, long column ) {
      int safeLine = (int) Math.max( 0, line - 1 );
      int safeColumn = (int) Math.max( 0, column - 1 );

      Diagnostic diagnostic = new Diagnostic();
      diagnostic.setSource( SYNTAX_SOURCE );
      diagnostic.setSeverity( DiagnosticSeverity.Error );
      diagnostic.setMessage( message != null ? message : "Invalid Turtle syntax" );
      diagnostic.setRange( new Range( new Position( safeLine, safeColumn ), new Position( safeLine, safeColumn + 1 ) ) );
      return diagnostic;
   }
}
