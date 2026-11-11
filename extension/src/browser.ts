/**
 * The parts of the WebExtension API this extension uses. Firefox exposes them as
 * `browser`, Chrome and Edge as `chrome`. Both return promises under Manifest V3.
 */
export interface ExtensionApi {
  storage: {
    sync: {
      get(keys: string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    onChanged: {
      addListener(listener: (changes: Record<string, unknown>, area: string) => void): void;
    };
  };
  runtime: {
    openOptionsPage(): Promise<void>;
    onMessage: {
      addListener(
        listener: (message: unknown, sender: unknown, respond: (response: unknown) => void) => void,
      ): void;
    };
  };
  tabs: {
    query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: unknown, options?: { frameId?: number }): Promise<unknown>;
  };
}

const scope = globalThis as unknown as { browser?: ExtensionApi; chrome?: ExtensionApi };

export const api: ExtensionApi = (scope.browser ?? scope.chrome)!;
