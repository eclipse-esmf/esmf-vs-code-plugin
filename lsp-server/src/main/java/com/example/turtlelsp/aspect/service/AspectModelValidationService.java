package com.example.turtlelsp.aspect.service;

import java.io.File;
import java.nio.file.Path;

import com.example.turtlelsp.aspect.model.AspectValidationResult;

public interface AspectModelValidationService {
    AspectValidationResult validate(Path path);

    default AspectValidationResult validate(File file) {
        return validate(file.toPath());
    }
}
