export const readTextFile = async (filePath: string): Promise<string> => {
  // Mock implementation
  return Promise.resolve("file content");
};

export const writeTextFile = async (
  filePath: string,
  content: string,
): Promise<void> => {
  // Mock implementation
  return Promise.resolve();
};

export const readBinaryFile = async (filePath: string): Promise<Uint8Array> => {
  // Mock implementation
  return Promise.resolve(new Uint8Array());
};

export const writeBinaryFile = async (
  filePath: string,
  content: Uint8Array,
): Promise<void> => {
  // Mock implementation
  return Promise.resolve();
};
