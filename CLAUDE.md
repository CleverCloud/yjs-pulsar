# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development Commands
```bash
# Start development server with hot reload
npm run dev

# Start production server (requires build first)
npm start

# Build everything (demo + server)
npm run build

# Run demo frontend 
npm run demo

# Full development setup (run both in separate terminals)
npm run dev & npm run demo
```

### Testing Commands
```bash
# Run all unit tests (with mocked Pulsar)
npm test

# Run E2E tests (requires real Pulsar credentials in .env)
npm run test:e2e

# Run single test file
npx jest tests/path/to/test.spec.ts --runInBand

# Run tests with specific pattern
npx jest --testNamePattern="should handle" --runInBand

# Run storage tests specifically
npx jest tests/storage/ --runInBand

# Run E2E tests for CI (consolidated Pulsar test)
npx jest tests/e2e/pulsar-e2e.spec.ts --runInBand --forceExit
```

### Build and Deployment
```bash
# TypeScript compilation check
npx tsc --noEmit

# Deploy to Clever Cloud (automated)
./deploy-clever.sh

# Manual Clever Cloud deployment
clever create yjs-pulsar-demo --type node
clever addon create pulsar-addon addon-pulsar
clever addon link pulsar-addon
clever deploy
```

## Architecture Overview

### Core Components

**YjsPulsarServer**: The main server architecture combines Express HTTP server, WebSocket server, and Pulsar messaging to provide real-time Yjs collaboration.

**Storage System**: Dual-layer architecture with configurable storage backends:
- `STORAGE_TYPE=s3`: Pure S3 storage for document persistence
- `STORAGE_TYPE=pulsar`: Hybrid Pulsar+S3 with MessageID-based snapshots and incremental replay
- `STORAGE_TYPE=none`: Memory-only (no persistence)

**Document Management**: Each Yjs document gets a dedicated Pulsar topic (`{PULSAR_TOPIC_PREFIX}{documentName}`) with producers/consumers managing real-time sync across multiple server instances.

### Key Technical Patterns

**Pulsar Integration**: 
- Each document has its own Pulsar topic for horizontal scaling
- Messages are routed between WebSocket clients and Pulsar topics
- Supports both producer (outbound) and consumer (inbound) message flows
- Uses consumer restart and AlreadyClosed error handling for resilience

**Snapshot System** (PulsarStorage only):
- Periodic snapshots saved to S3 with Pulsar MessageID checkpoints
- Document restoration: load snapshot + replay messages from checkpoint
- MessageID serialization uses `serialize().toString('base64')` format
- Error handling clears corrupted snapshots with old MessageID formats

**Connection Management**:
- WebSocket connections in `/src/server/utils.ts` with `setupWSConnection`
- Authentication via pluggable `AuthStrategy` interface (default: NoAuthStrategy)  
- Resource cleanup via `CleanupManager` for graceful shutdowns

### Storage Architecture Details

The `PulsarStorage` class implements a sophisticated snapshot-based persistence:

1. **Snapshot Creation**: Every N messages (configurable `SNAPSHOT_INTERVAL`), current document state is saved to S3 with the last processed Pulsar MessageID
2. **Document Restoration**: Load latest snapshot from S3, then replay only messages after the snapshot's MessageID checkpoint
3. **MessageID Handling**: Critical serialization using `messageId.serialize().toString('base64')` - the `toString()` method produces unusable format
4. **Error Recovery**: Invalid MessageIDs trigger snapshot clearing and full replay from earliest message

### Testing Strategy

**Unit Tests**: Mock Pulsar client for fast, isolated testing of core logic
**E2E Tests**: Use real Pulsar instances with credentials in `.env` file
**CI Constraints**: 
- Pulsar client doesn't handle concurrent connections well - all E2E tests consolidated into single sequential test
- Memory issues require 12GB heap allocation and test splitting
- Cellar (S3-compatible) used instead of MinIO for CI stability

## Environment Configuration

Required `.env` variables:
```bash
# Server
PORT=8080

# Pulsar (all required)
ADDON_PULSAR_BINARY_URL=pulsar://localhost:6650
ADDON_PULSAR_TOKEN=your-token
ADDON_PULSAR_TENANT=public  
ADDON_PULSAR_NAMESPACE=default
PULSAR_TOPIC_PREFIX=yjs-doc-

# S3 Storage (required for persistence)
S3_BUCKET=bucket-name
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=key
S3_SECRET_ACCESS_KEY=secret

# Storage Configuration
STORAGE_TYPE=pulsar  # or "s3" or "none"
SNAPSHOT_INTERVAL=30  # messages between snapshots
```

## Common Issues and Debugging

**Pulsar Connection Issues**: Check that `ADDON_PULSAR_TOKEN` is valid and Pulsar cluster is accessible
**MessageID Crashes**: Ensure snapshots use `serialize().toString('base64')` not `toString()`
**Test Timeouts**: E2E tests require real Pulsar - use mock credentials locally, skip real E2E if cluster unavailable
**CI Memory Issues**: Storage tests may exceed allocated memory in GitHub Actions environment
**Concurrent Pulsar Tests**: Always run with `--runInBand` flag - Pulsar client cannot handle parallel connections

## File Structure Notes

- `src/server/`: Main server logic and WebSocket handling
- `src/storage/`: Storage abstraction with S3, Pulsar, and hybrid implementations  
- `src/types.ts`: Core interfaces for ServerConfig, AuthStrategy, etc.
- `tests/e2e/pulsar-e2e.spec.ts`: Consolidated E2E test (replaces individual disabled tests)
- `demo/`: Tiptap-based collaborative editor frontend
- `deploy-clever.sh`: Automated Clever Cloud deployment script

This is a backend driver library, not a standalone application - it's designed to be integrated into larger applications that need Yjs real-time collaboration with Pulsar messaging.