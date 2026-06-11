package com.example.turtlelsp.aspect.model;

import java.net.URI;

public record AspectViolationInfo(
    String code,
    String message,
    URI sourceLocation,
    Long line,
    Long column
) {
}
