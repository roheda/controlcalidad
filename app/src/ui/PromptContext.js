import { createContext, useContext } from "react";

export const PromptContext = createContext(null);

export function usePrompt() {
  const ctx = useContext(PromptContext);
  if (!ctx) throw new Error("usePrompt must be used within a PromptProvider");
  return ctx;
}
