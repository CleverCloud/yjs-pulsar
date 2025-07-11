export interface Storage {
  /**
   * Stores a document snapshot.
   * @param documentName The name of the document.
   * @param state The document state to store.
   */
  storeDoc(documentName: string, state: Uint8Array): Promise<void>;

  /**
   * Fetches a document snapshot.
   * @param documentName The name of the document.
   * @returns A promise that resolves with the document state or null if not found.
   */
  getDoc(documentName: string): Promise<Uint8Array | null>;
}
