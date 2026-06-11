package com.example.turtlelsp.aspect.service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import org.eclipse.esmf.aspectmodel.loader.AspectModelLoader;
import org.eclipse.esmf.aspectmodel.shacl.violation.Violation;
import org.eclipse.esmf.aspectmodel.validation.InvalidLexicalValueViolation;
import org.eclipse.esmf.aspectmodel.validation.InvalidSyntaxViolation;
import org.eclipse.esmf.aspectmodel.validation.ProcessingViolation;
import org.eclipse.esmf.aspectmodel.validation.services.AspectModelValidator;
import org.eclipse.esmf.aspectmodel.validation.services.DetailedViolationFormatter;
import org.eclipse.esmf.metamodel.AspectModel;

import com.example.turtlelsp.aspect.model.AspectValidationError;
import com.example.turtlelsp.aspect.model.AspectValidationErrorType;
import com.example.turtlelsp.aspect.model.AspectValidationResult;
import com.example.turtlelsp.aspect.model.AspectViolationInfo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class DefaultAspectModelValidationService implements AspectModelValidationService {
    private static final Logger LOAD_LOGGER = LoggerFactory.getLogger("com.example.turtlelsp.validation.aspect.load");
    private static final Logger RESOLVE_LOGGER = LoggerFactory.getLogger("com.example.turtlelsp.validation.aspect.resolve");
    private static final Logger VALIDATE_LOGGER = LoggerFactory.getLogger("com.example.turtlelsp.validation.aspect.validate");

    private final AspectModelLoader loader;
    private final AspectModelValidator validator;

    public DefaultAspectModelValidationService() {
        this(new AspectModelLoader(), new AspectModelValidator());
    }

    DefaultAspectModelValidationService(AspectModelLoader loader, AspectModelValidator validator) {
        this.loader = loader;
        this.validator = validator;
    }

    @Override
    public AspectValidationResult validate(Path path) {
        if (path == null) {
            return failedResult( AspectValidationErrorType.LOAD, "Path must not be null");
        }

        if (!Files.exists(path)) {
            return failedResult(AspectValidationErrorType.LOAD, "Aspect model file does not exist: " + path);
        }

        if (!Files.isRegularFile(path) || !Files.isReadable(path)) {
            return failedResult(AspectValidationErrorType.LOAD, "Aspect model file is not readable: " + path);
        }

        try {
            LOAD_LOGGER.debug("[load] loading aspect model from {}", path);
            List<Violation> violations = validator.validateModel(() -> loadAspectModel(path));
            VALIDATE_LOGGER.debug("[validate] validation finished for {} with {} violation(s)", path, violations.size());
            String report = new DetailedViolationFormatter().apply(violations);
            AspectValidationError error = classifyError(violations);
            return new AspectValidationResult(violations.isEmpty(), report, violations.stream().map(this::toViolationInfo).toList(), error);
        } catch (Exception exception) {
            VALIDATE_LOGGER.error("[validate] unexpected runtime failure for {}", path, exception);
            return failedResult(AspectValidationErrorType.PROCESSING, exception.getMessage());
        }
    }

    private AspectModel loadAspectModel(Path path) {
        RESOLVE_LOGGER.debug("[resolve imports] resolving imports for {}", path);
        return loader.load(path.toFile());
    }

    private AspectValidationResult failedResult(AspectValidationErrorType type, String message) {
        return new AspectValidationResult(false, message, List.of(), new AspectValidationError(type, message));
    }

    private AspectValidationError classifyError(List<Violation> violations) {
        Optional<Violation> firstFailure = violations.stream()
            .filter(violation -> violation instanceof InvalidSyntaxViolation || violation instanceof InvalidLexicalValueViolation || violation instanceof ProcessingViolation)
            .findFirst();

        if (firstFailure.isEmpty()) {
            return null;
        }

        Violation violation = firstFailure.get();
        if (violation instanceof InvalidSyntaxViolation syntaxViolation) {
            return new AspectValidationError(AspectValidationErrorType.PARSE, syntaxViolation.message());
        }
        if (violation instanceof InvalidLexicalValueViolation lexicalValueViolation) {
            return new AspectValidationError(AspectValidationErrorType.PARSE, lexicalValueViolation.message());
        }

        String message = violation.message();
        AspectValidationErrorType type = message != null && message.toLowerCase().contains("resolve")
            ? AspectValidationErrorType.RESOLVE
            : AspectValidationErrorType.PROCESSING;
        return new AspectValidationError(type, message);
    }

    private AspectViolationInfo toViolationInfo(Violation violation) {
        if (violation instanceof InvalidSyntaxViolation syntaxViolation) {
            return new AspectViolationInfo(
                syntaxViolation.errorCode(),
                syntaxViolation.message(),
                syntaxViolation.sourceLocation().orElse(null),
                syntaxViolation.line(),
                syntaxViolation.column()
            );
        }
        if (violation instanceof InvalidLexicalValueViolation lexicalValueViolation) {
            return new AspectViolationInfo(
                lexicalValueViolation.errorCode(),
                lexicalValueViolation.message(),
                lexicalValueViolation.sourceLocation().orElse(null),
                (long) lexicalValueViolation.line(),
                (long) lexicalValueViolation.column()
            );
        }

        return new AspectViolationInfo(
            violation.errorCode(),
            violation.message(),
            violation.sourceLocation().orElse(null),
            null,
            null
        );
    }
}
