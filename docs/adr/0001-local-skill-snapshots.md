# ADR 0001: Keep skill snapshots local

Status: Accepted.

## Context

Shared configuration must identify adopted skill versions across devices. Installing or restoring a version also requires its exact content, but committing every snapshot would mix reusable definitions with local recovery data.

## Decision

Store skill snapshots with local target connection records in the configuration repository's Git-ignored local directory. Do not commit or push them.

Shared configuration records both the exact source commit and the skill content fingerprint. Retain only the latest adopted snapshot for each skill and replace it when adopting a new version.

If a required snapshot is unavailable, fetch the specified source version and verify its contents. Return an explicit error if that version cannot be retrieved; do not substitute another version.

## Consequences

Shared definitions remain separate from local content. Other devices can identify the required version, but need access to the source when no matching snapshot exists. Historical versions are not guaranteed to be available locally.

Rollback for a caught application failure uses separate temporary backups. It does not depend on retaining a permanent history of skill snapshots.
