import { useEffect, useState, useCallback } from "react";

export type ThemeMode = "light" | "dark";
const STORAGE_KEY = "sociohub:theme";

function readStored(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "dark" ? "dark" : "light";
}

function apply(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStored());

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    setThemeState(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}
