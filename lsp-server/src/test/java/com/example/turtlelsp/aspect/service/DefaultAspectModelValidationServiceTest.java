package com.example.turtlelsp.aspect.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;

import com.example.turtlelsp.aspect.model.AspectValidationErrorType;
import com.example.turtlelsp.aspect.model.AspectValidationResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DefaultAspectModelValidationServiceTest {
    private final DefaultAspectModelValidationService service = new DefaultAspectModelValidationService();

    @TempDir
    Path tempDir;

    @Test
    void validatesAspectModelWhenFileIsValid() throws Exception {
        Path modelFile = tempDir.resolve("Aspect.ttl");
        Files.writeString(modelFile, validAspectModel());

        AspectValidationResult result = service.validate(modelFile);

        assertThat(result.valid()).isTrue();
        assertThat(result.violations()).isEmpty();
        assertThat(result.error()).isNull();
    }

    @Test
    void returnsViolationsWhenAspectModelIsInvalid() throws Exception {
        Path modelFile = tempDir.resolve("InvalidAspect.ttl");
        Files.writeString(modelFile, invalidSyntaxAspectModel());

        AspectValidationResult result = service.validate(modelFile);

        assertThat(result.valid()).isFalse();
        assertThat(result.violations()).isNotEmpty();
        assertThat(result.report()).isNotBlank();
        assertThat(result.error()).isNotNull();
        assertThat(result.error().type()).isEqualTo( AspectValidationErrorType.PARSE);
    }

    @Test
    void returnsLoadErrorWhenFileDoesNotExist() {
        Path missingFile = tempDir.resolve("missing.ttl");

        AspectValidationResult result = service.validate(missingFile);

        assertThat(result.valid()).isFalse();
        assertThat(result.violations()).isEmpty();
        assertThat(result.error()).isNotNull();
        assertThat(result.error().type()).isEqualTo(AspectValidationErrorType.LOAD);
    }

    private String validAspectModel() {
        return """
            @prefix : <urn:samm:org.eclipse.esmf.test:1.0.0#> .
            @prefix samm: <urn:samm:org.eclipse.esmf.samm:meta-model:2.2.0#> .
            @prefix samm-c: <urn:samm:org.eclipse.esmf.samm:characteristic:2.2.0#> .
            @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

            :Aspect a samm:Aspect ;
               samm:preferredName "Test Aspect"@en ;
               samm:description "This is a test description"@en ;
               samm:properties ( ) ;
               samm:operations ( ) .
            """;
    }

    private String invalidSyntaxAspectModel() {
        return """
            @prefix : <urn:samm:org.eclipse.esmf.test:1.0.0#> .
            @prefix samm: <urn:samm:org.eclipse.esmf.samm:meta-model:2.2.0#> .

            :InvalidSyntax a samm:Aspect;
               samm:preferredName "Test Aspect"@en
               samm:properties () ;
               samm:operations () .
            """;
    }
}
