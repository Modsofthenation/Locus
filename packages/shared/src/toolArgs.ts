import type { JsonSchema } from "./models/tools.js";

export function validateToolArgs(
  name: string,
  args: Record<string, unknown>,
  schema?: JsonSchema,
): string | undefined {
  if (!schema) return undefined;
  const required = schema.required ?? [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      return `${name} is missing required argument "${key}".`;
    }
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (args[key] === undefined) continue;
    const value = args[key];
    if (spec.enum && !spec.enum.includes(String(value))) {
      return `${name}.${key} must be one of: ${spec.enum.join(", ")}.`;
    }
    if (spec.type === "string" && typeof value !== "string") {
      return `${name}.${key} must be a string.`;
    }
    if (spec.type === "number" && typeof value !== "number") {
      return `${name}.${key} must be a number.`;
    }
    if (spec.type === "boolean" && typeof value !== "boolean") {
      return `${name}.${key} must be a boolean.`;
    }
    if (spec.type === "array" && !Array.isArray(value)) {
      return `${name}.${key} must be an array.`;
    }
    if (
      spec.type === "object" &&
      (typeof value !== "object" || value === null || Array.isArray(value))
    ) {
      return `${name}.${key} must be an object.`;
    }
  }
  return undefined;
}
