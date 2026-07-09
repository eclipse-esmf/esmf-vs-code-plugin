# Use Markdown Any Decision Records

## Context and Problem Statement

We want to record any decisions made in this project, regardless of whether they
concern the architecture ("architectural decision record"), the code, or other
aspects of the project. Which format and structure should these records use?

## Considered Options

* [MADR](https://adr.github.io/madr/) 3.0.0 – Markdown Any Decision Records
* [Michael Nygard's
  template](http://thinkrelevance.com/blog/2011/11/15/documenting-architecture-decisions)
  – The original ADR template
* [Sustainable Architectural Decisions](https://www.infoq.com/articles/sustainable-architectural-design-decisions) – The Y-Statements
* Other templates listed at <https://github.com/joelparkerhenderson/architecture_decision_record>
* No template - No prescribed format or structure

## Decision Outcome

Chosen option: **MADR 3.0.0**, because

* Implicit assumptions should be made explicit. Design documentation is
  important to help people understanding the decisions later on. See also [A
  rational design process: How and why to fake
  it](https://doi.org/10.1109/TSE.1986.6312940).
* MADR allows for structured documentation of any decision.
* The MADR format is lean and fits our development workflow.
* The MADR structure is comprehensible and facilitates adoption and maintenance.
* The MADR project is actively maintained.
