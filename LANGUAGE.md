# Ubiquitous Language

This document defines the core domain language for the AI Harness. All code, documentation, and agent prompts must strictly adhere to these terms.

## Core Concepts

- **Harness**: The orchestrator system (this codebase) that manages the autonomous development lifecycle.
- **Project**: The external codebase that the Harness is currently operating on.
- **Feature**: A discrete, atomic unit of requirement or a bug fix (formerly "Issue" or "Task").
- **Blueprint**: The source of truth for all Features in a project, including their status and metadata (formerly `feature_list.json`).
- **Sprint**: The end-to-end execution lifecycle for a single **Feature**, from contract negotiation to final merge.
- **Cycle**: A single attempt or iteration within a **Sprint** (formerly "Iteration").
- **Contract**: The technical specification and success criteria for a **Feature**, negotiated before coding begins.
- **Blueprint Repository**: The persistent storage and management logic for the **Blueprint**.
- **Feature Source**: An external system (GitHub, File System) from which **Features** are ingested into the **Blueprint**.
- **VCS (Version Control System)**: The abstraction for managing the **Project's** source control (formerly `Scm`).
- **Agent**: A specialized LLM persona (Planner, Contractor, Generator, etc.) performing a role within the **Harness**.

## Personas (Agents)

- **Planner**: The visionary that transforms a goal into a **Blueprint**.
- **Contractor**: The specifier that proposes a **Contract** for a **Feature**.
- **Reviewer**: The persona that evaluates **Contracts** (formerly "Contract Evaluator").
- **Generator**: The craftsman that implements the code for a **Feature**.
- **Evaluator**: The guardian that performs empirical testing and quality assurance.

## Workflow States

- **Pending**: A **Feature** that has not yet been started.
- **In-Sprint**: A **Feature** currently being worked on.
- **Passed**: A **Feature** that has successfully met all **Contract** criteria and been merged.
- **Failed**: A **Feature** that could not be completed within the allocated **Cycles**.
