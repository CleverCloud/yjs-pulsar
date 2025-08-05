/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-unused-vars */

// This is a manual mock for the 'pulsar-client' module.
// It is designed to prevent Jest from hanging when trying to load the native addon.

class MockProducer {
    send(_message: any) { return Promise.resolve(); }
    flush() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    isConnected() { return true; }
}

class MockConsumer {
    receive() {
        // Return a promise that never resolves to simulate waiting for messages
        return new Promise(() => { });
    }
    acknowledge(_message: any) { }
    close() { return Promise.resolve(); }
    isConnected() { return true; }
}

class MockClient {
    constructor(_config: any) { }
    createProducer(_options: any) { return Promise.resolve(new MockProducer()); }
    subscribe(_options: any) { return Promise.resolve(new MockConsumer()); }
    close() { return Promise.resolve(); }
}

class MockAuthenticationToken {
    constructor(_options: { token: string }) { }
}

const Pulsar = {
    Client: MockClient,
    AuthenticationToken: MockAuthenticationToken,
};

export default Pulsar;
