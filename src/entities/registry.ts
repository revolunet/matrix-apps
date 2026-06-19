import type { EntityConfig } from "./types";

const registry = new Map<string, EntityConfig>();

export const registerEntity = (config: EntityConfig): void => {
  registry.set(config.type, config);
};

export const getEntityConfig = (type: string): EntityConfig => {
  const c = registry.get(type);
  if (!c) throw new Error(`Unknown entity type: ${type}`);
  return c;
};

export const getAllEntityConfigs = (): EntityConfig[] => [...registry.values()];

export const getEntityConfigBySegment = (segment: string): EntityConfig => {
  for (const config of registry.values()) {
    if (config.urlSegment === segment) return config;
  }
  throw new Error(`Unknown entity URL segment: ${segment}`);
};
