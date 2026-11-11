import fs from "node:fs/promises";

export const loadConfiguration = async (configFilePath: string) => {
  try {
    await fs.access(configFilePath);
  } catch {
    throw new Error(`Configuration file not found: ${configFilePath}`);
  }
  const fileContent = await fs.readFile(configFilePath, "utf-8");
  const config = JSON.parse(fileContent);
  for (const [key, value] of Object.entries(config)) {
    configuration.set(key, value as string);
  }
};

export const configuration = {
  get(key: string, defaultValue?: string) {
    return process.env[key] ?? defaultValue;
  },

  set(key: string, value: string) {
    process.env[key] = value;
  },
};
