package com.example.turtlelsp.aspect.model;

import java.util.List;

public record AspectValidationResult(
    boolean valid,
    String report,
    List<AspectViolationInfo> violations,
    AspectValidationError error
) {
}
