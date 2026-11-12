import type { ThemeConfig } from "antd";

/** Ant Design controls; application layout and shared colors live in workspace.css. */
export const workspaceTheme: ThemeConfig = {
  token: {
    colorPrimary: "#2f64f4",
    colorText: "#25314c",
    colorTextSecondary: "#8591a5",
    colorBorder: "#e1e7f0",
    borderRadius: 8,
    fontFamily: '"Segoe UI","Microsoft YaHei",sans-serif',
    controlHeight: 36,
    colorBgLayout: "#fff",
    colorBgContainer: "#fff",
    lineHeight: 1.65,
  },
  components: {
    Table: {
      headerBg: "#f8fafc",
      headerColor: "#63738c",
      rowHoverBg: "#f5f8ff",
    },
    Button: { primaryShadow: "none" },
    Tabs: { itemSelectedColor: "#2f64f4" },
  },
};
