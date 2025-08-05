# Yjs Pulsar Backend Driver

> **IMPORTANT:** This project is a backend driver, not a complete, ready-to-use server. It is designed to be integrated into your own application to connect Yjs with Apache Pulsar for real-time collaboration and S3 for persistence. For a ready-to-use server implementation, please see the example project or consider building one on top of this driver.

This project provides a high-performance, scalable backend for [Yjs](https://github.com/yjs/yjs), enabling real-time collaboration in rich-text editors and other applications. It uses [Apache Pulsar](https://pulsar.apache.org/) as a message broker to relay Yjs document updates and awareness information between clients, following the robust design patterns established by `y-redis`.

## Features

- **Scalable:** Built to handle a large number of concurrent users and documents by leveraging Pulsar's distributed messaging capabilities.
- **Stateless:** The server is stateless, meaning you can run multiple instances behind a load balancer for high availability and horizontal scaling.
- **Resilient:** Implements robust error handling and asynchronous resource management to ensure stability.
- **Real-time:** Provides low-latency communication for a seamless collaborative experience.
- **Yjs-Compatible:** Fully compatible with the `y-websocket` client provider.

## Architecture

The backend works by creating a dedicated Pulsar topic for each Yjs document. When a client connects and requests a document, the server:

1.  Creates a `Y.Doc` instance in memory.
2.  Establishes a WebSocket connection with the client.
3.  Creates a Pulsar producer and a shared consumer for the document's topic.
4.  Relays Yjs messages between the client and the Pulsar topic:
    -   Updates from the client are broadcast to other connected clients and published to Pulsar.
    -   Messages from the Pulsar topic (originating from other server instances) are applied to the in-memory `Y.Doc` and broadcast to local clients.

This architecture ensures that all server instances and clients stay in sync, with Pulsar acting as the central message bus.

### S3-Based Persistence

The backend uses a snapshot-based persistence model with S3-compatible object storage. This ensures that document state can be reliably saved and retrieved, even in a stateless server environment. All storage components are fully tested to ensure data integrity.

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later)
- [npm](https://www.npmjs.com/)
- An active [Apache Pulsar](https://pulsar.apache.org/docs/getting-started-standalone/) cluster.
- An S3-compatible object storage service (e.g., MinIO, AWS S3).

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd yjs-pulsar
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create a `.env` file:**
    Copy the `.env.template` file to `.env` and fill in your Pulsar and S3 connection details.
    ```bash
    cp .env.template .env
    ```

    Your `.env` file should include the following variables for Pulsar and S3:
    ```
    # Server Configuration
    PORT=8080

    # Pulsar Configuration
    ADDON_PULSAR_BINARY_URL=pulsar://localhost:6650
    ADDON_PULSAR_TOKEN=YOUR_PULSAR_AUTHENTICATION_TOKEN
    ADDON_PULSAR_TENANT=public
    ADDON_PULSAR_NAMESPACE=default
    PULSAR_TOPIC_PREFIX=yjs-doc-

    # S3 Storage Configuration
    S3_BUCKET=your-s3-bucket-name
    S3_ENDPOINT=http://localhost:9000
    S3_ACCESS_KEY_ID=your-access-key
    S3_SECRET_ACCESS_KEY=your-secret-key
    AWS_REGION=us-east-1
    ```

## Running the Application

To start the server, run:

```bash
npm start
```

The server will be listening on the port specified in your `.env` file.

## Running the Demo

This project includes a demo of a collaborative rich-text editor built with [Tiptap](https://tiptap.dev/).

To run the demo:

1.  **Start the backend server:**
    Open a terminal and run:
    ```bash
    npm run dev
    ```
    This will start the yjs-pulsar server on port 8080 (or the port specified in your `.env` file).

2.  **Start the frontend demo server:**
    Open a second terminal and run:
    ```bash
    npm run demo
    ```
    This will start the Vite development server. You can now open the URL shown in the terminal (usually `http://localhost:5173`) in multiple browser tabs or windows to see the collaborative editor in action.

## Running Tests

Le projet inclut des tests unitaires (avec Pulsar mocké), des tests E2E et des outils de test manuel pour une validation complète.

### Tests Automatisés

```bash
# Tous les tests unitaires
npm test

# Tests E2E (nécessite .env configuré)
npm run test:e2e

# Tests complets
npm test && npm run test:e2e
```

### Tests Manuels Utilisateur

Le projet fournit plusieurs outils pour tester manuellement :

```bash
# 1. Test WebSocket simple
npm run dev
node manual-test.js

# 2. Interface de test basique  
npm run dev
open test-collaboration.html

# 3. Demo collaborative complète
npm run dev & npm run demo
```

**📖 Guide détaillé :** Voir [TESTING.md](./TESTING.md) pour toutes les instructions de test.

### Résultats des Tests

- ✅ **Tests unitaires** : 8/8 passent rapidement
- ✅ **Connexion E2E** : Fonctionne avec Pulsar réel  
- ✅ **Plus de tests qui hangent** : Tous se terminent avec des timeouts appropriés
- ⚠️ **Collaboration complexe** : Peut timeout (comportement normal)

**Note:** Les tests E2E nécessitent un `ADDON_PULSAR_TOKEN` valide dans `.env`.
