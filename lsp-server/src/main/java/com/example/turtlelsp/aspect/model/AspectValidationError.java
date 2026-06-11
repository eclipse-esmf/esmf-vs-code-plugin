package com.example.turtlelsp.aspect.model;

public record AspectValidationError(
    AspectValidationErrorType type,
    String message
) {
}
