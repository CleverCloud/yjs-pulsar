export interface Storage {
  /**
   * Stores a document update.
   * @param documentName The name of the document.
   * @param update The update to store.
   */
  storeUpdate(documentName: string, update: Uint8Array): Promise<void>;

  /**
   * Fetches the entire document state.
   * @param documentName The name of the document.
   * @returns A promise that resolves with the consolidated document state.
   */
  fetchDocument(documentName: string): Promise<Uint8Array>;
}
