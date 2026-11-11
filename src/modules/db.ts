export interface Connection {
  query<P extends unknown[], T>(sql: string, params?: P): Promise<T>;
  execute<P extends unknown[], T>(sql: string, params?: P): Promise<T>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  dispose(): Promise<void>;
}

export const connectToMySQL = (
  host: string,
  user: string,
  password: string,
  database: string,
): Connection => {
  // Mock implementation
  return {
    query: async (sql, params) => {
      return Promise.resolve([]) as Promise<any>;
    },
    execute: async (sql, params) => {
      return Promise.resolve([]) as Promise<any>;
    },
    beginTransaction: async () => {
      return Promise.resolve();
    },
    commitTransaction: async () => {
      return Promise.resolve();
    },
    rollbackTransaction: async () => {
      return Promise.resolve();
    },
    dispose: async () => {
      return Promise.resolve();
    },
  };
};
