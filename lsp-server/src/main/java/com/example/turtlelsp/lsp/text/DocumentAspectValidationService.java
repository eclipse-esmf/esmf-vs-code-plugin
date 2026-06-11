package com.example.turtlelsp.lsp.text;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.Objects;

import com.example.turtlelsp.aspect.model.AspectValidationError;
import com.example.turtlelsp.aspect.model.AspectValidationErrorType;
import com.example.turtlelsp.aspect.model.AspectValidationResult;
import com.example.turtlelsp.aspect.model.AspectViolationInfo;
import com.example.turtlelsp.aspect.service.AspectValidationCoordinator;
import com.example.turtlelsp.common.uri.DocumentUriResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class DocumentAspectValidationService {
   private static final Logger LOGGER = LoggerFactory.getLogger( DocumentAspectValidationService.class );

   private final AspectValidationCoordinator aspectValidationCoordinator;

   public DocumentAspectValidationService( AspectValidationCoordinator aspectValidationCoordinator ) {
      this.aspectValidationCoordinator = aspectValidationCoordinator;
   }

   public AspectValidationResult validateDocument( String uri, String content ) {
      if ( content == null ) {
         return failedValidation( AspectValidationErrorType.LOAD, "Document is not available in memory: " + uri );
      }

      Path path = DocumentUriResolver.toPath( uri );
      if ( path == null ) {
         return failedValidation( AspectValidationErrorType.LOAD, "Aspect validation supports only file URIs: " + uri );
      }

      return validateOpenDocument( uri, path, content );
   }

   private AspectValidationResult validateOpenDocument( String uri, Path originalPath, String content ) {
      Path parent = originalPath.getParent();
      if ( parent == null ) {
         return failedValidation( AspectValidationErrorType.LOAD, "Document path has no parent directory: " + originalPath );
      }

      String originalFileName = originalPath.getFileName() != null ? originalPath.getFileName().toString() : "aspect";
      String tempPrefix = originalFileName.replaceAll( "[^A-Za-z0-9._-]", "_" ) + "-";
      if ( tempPrefix.length() < 3 ) {
         tempPrefix = "ttl-";
      }

      Path tempFile = null;
      try {
         tempFile = Files.createTempFile( parent, tempPrefix, ".ttl" );
         Files.writeString( tempFile, content, StandardOpenOption.TRUNCATE_EXISTING );
         AspectValidationResult result = aspectValidationCoordinator.validateSync( tempFile );
         return remapValidationResult( result, tempFile, originalPath, uri );
      } catch ( IOException exception ) {
         LOGGER.error( "[validateDocument] failed to prepare in-memory validation for {}", uri, exception );
         return failedValidation( AspectValidationErrorType.PROCESSING, exception.getMessage() );
      } finally {
         if ( tempFile != null ) {
            try {
               Files.deleteIfExists( tempFile );
            } catch ( IOException exception ) {
               LOGGER.warn( "[validateDocument] failed to delete temp file {}", tempFile, exception );
            }
         }
      }
   }

   private AspectValidationResult remapValidationResult( AspectValidationResult result, Path tempFile, Path originalPath, String originalUri ) {
      URI tempUri = tempFile.toUri();
      List<AspectViolationInfo> remappedViolations = result.violations().stream()
            .map( violation -> remapViolation( violation, tempUri, originalUri ) )
            .toList();
      String remappedReport = remapReport( result.report(), tempFile, originalPath, originalUri );
      return new AspectValidationResult( result.valid(), remappedReport, remappedViolations, result.error() );
   }

   private AspectViolationInfo remapViolation( AspectViolationInfo violation, URI tempUri, String originalUri ) {
      if ( !Objects.equals( violation.sourceLocation(), tempUri ) ) {
         return violation;
      }

      return new AspectViolationInfo(
            violation.code(),
            violation.message(),
            URI.create( originalUri ),
            violation.line(),
            violation.column()
      );
   }

   private String remapReport( String report, Path tempFile, Path originalPath, String originalUri ) {
      if ( report == null || report.isBlank() ) {
         return report;
      }

      return report
            .replace( tempFile.toUri().toString(), originalUri )
            .replace( tempFile.toAbsolutePath().toString(), originalPath.toAbsolutePath().toString() );
   }

   private AspectValidationResult failedValidation( AspectValidationErrorType type, String message ) {
      return new AspectValidationResult( false, message, List.of(), new AspectValidationError( type, message ) );
   }
}
