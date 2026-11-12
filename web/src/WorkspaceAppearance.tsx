import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { pixelTheme, roseTheme, workspaceTheme } from "./theme";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { adminTheme } from "./admin/adminTheme";

export type WorkspaceTheme = "forest" | "rose" | "pixel";
const storageKey = "rednote.appearance.theme";
const normalize = (value: string | null): WorkspaceTheme =>
  value === "rose" || value === "pixel" ? value : "forest";
function savedTheme(): WorkspaceTheme {
  try {
    return normalize(localStorage.getItem(storageKey));
  } catch {
    return "forest";
  }
}
function isAdminSurface() {
  return /^#\/?(?:(?:xhs|douyin)\/)?admin(?:\/|$)/.test(location.hash);
}
function applyTheme(theme: WorkspaceTheme, admin: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = admin ? "admin" : theme;
  document.documentElement.dataset.surface = admin ? "admin" : "workspace";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      admin
        ? "#faf9f5"
        : theme === "pixel"
          ? "#050505"
          : theme === "rose"
            ? "#f3e4e8"
            : "#f5f7fa",
    );
}
applyTheme(savedTheme(), isAdminSurface());
const AppearanceContext = createContext<{
  theme: WorkspaceTheme;
  setTheme: (theme: WorkspaceTheme) => void;
} | null>(null);

export function WorkspaceAppearance({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState(savedTheme);
  const [adminSurface, setAdminSurface] = useState(isAdminSurface);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const controlTheme = useMemo(() => {
    const base = adminSurface
      ? adminTheme
      : theme === "pixel"
        ? pixelTheme
        : theme === "rose"
          ? roseTheme
          : workspaceTheme;
    return reducedMotion
      ? { ...base, token: { ...base.token, motion: false } }
      : base;
  }, [theme, adminSurface, reducedMotion]);
  useLayoutEffect(() => {
    applyTheme(theme, adminSurface);
  }, [theme, adminSurface]);
  useEffect(() => {
    const syncSurface = () => {
      const next = isAdminSurface();
      applyTheme(theme, next);
      setAdminSurface(next);
    };
    window.addEventListener("hashchange", syncSurface);
    return () => window.removeEventListener("hashchange", syncSurface);
  }, [theme]);
  const setTheme = (next: WorkspaceTheme) => {
    applyTheme(next, adminSurface);
    updateTheme(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* Keep switching available when storage is unavailable. */
    }
  };
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      const next = savedTheme();
      updateTheme(next);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return (
    <AppearanceContext.Provider
      value={{ theme: adminSurface ? "forest" : theme, setTheme }}
    >
      <ConfigProvider locale={zhCN} theme={controlTheme}>
        {children}
      </ConfigProvider>
    </AppearanceContext.Provider>
  );
}

export function useWorkspaceAppearance() {
  const appearance = useContext(AppearanceContext);
  if (!appearance) throw new Error("WorkspaceAppearance provider is required");
  return appearance;
}
