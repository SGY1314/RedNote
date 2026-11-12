import { useState } from "react";

const PIN_KEY = "gin.rewrite.pinned-projects";
export function usePinnedProjects() {
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(PIN_KEY) || "[]");
      return Array.isArray(value)
        ? [
            ...new Set(
              value.filter((id): id is string => typeof id === "string"),
            ),
          ]
        : [];
    } catch {
      return [];
    }
  });
  const togglePin = (id: string) =>
    setPinned((old) => {
      const next = old.includes(id)
        ? old.filter((value) => value !== id)
        : [id, ...old];
      try {
        localStorage.setItem(PIN_KEY, JSON.stringify(next));
      } catch {
        /* Keep the preference for this visit. */
      }
      return next;
    });
  return { pinned, togglePin };
}
