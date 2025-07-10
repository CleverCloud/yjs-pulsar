# Yjs Pulsar Backend

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

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later)
- [npm](https://www.npmjs.com/)
- An active [Apache Pulsar](https://pulsar.apache.org/docs/getting-started-standalone/) cluster.

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
    Copy the `.env.example` file to `.env` and fill in your Pulsar connection details.
    ```bash
    cp .env.example .env
    ```

    Your `.env` file should look like this:
    ```
    # Server Configuration
    PORT=8080

    # Pulsar Configuration
    ADDON_PULSAR_BINARY_URL=pulsar://localhost:6650
    ADDON_PULSAR_TOKEN=YOUR_PULSAR_AUTHENTICATION_TOKEN
    ADDON_PULSAR_TENANT=public
    ADDON_PULSAR_NAMESPACE=default
    PULSAR_TOPIC_PREFIX=yjs-doc-
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

The project includes both unit tests (with a mocked Pulsar client) and end-to-end (E2E) tests that run against a real Pulsar instance.

To run all tests:

```bash
npm test
```

**Note:** The E2E tests require a valid `ADDON_PULSAR_TOKEN` in your `.env` file to run. If the token is missing or invalid, the E2E tests will be skipped.
