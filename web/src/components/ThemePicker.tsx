import { CheckOutlined } from "@ant-design/icons";
import { PixelScene } from "./PixelBackdrop";
import {
  useWorkspaceAppearance,
  type WorkspaceTheme,
} from "../WorkspaceAppearance";

const options: {
  id: WorkspaceTheme;
  name: string;
  detail: string;
  colors: string[];
}[] = [
  {
    id: "forest",
    name: "静谧森林",
    detail: "松绿 · 清透 · 自然",
    colors: ["#293f36", "#8ca896", "#edf4f0", "#ffffff"],
  },
  {
    id: "rose",
    name: "莫兰迪暖粉",
    detail: "烟粉 · 暮紫 · 柔光",
    colors: ["#985a72", "#b79ab4", "#edd0d9", "#fffbf9"],
  },
  {
    id: "pixel",
    name: "暗黑像素风",
    detail: "黑白 · 点阵 · 月球",
    colors: ["#050505", "#262626", "#777777", "#e5e5df"],
  },
];

export default function ThemePicker() {
  const { theme, setTheme } = useWorkspaceAppearance();
  return (
    <section className="settings-appearance" aria-labelledby="appearance-title">
      <div className="appearance-heading">
        <h3 id="appearance-title">主题外观</h3>
        <span>随心切换，即时生效</span>
      </div>
      <div className="theme-options" role="group" aria-label="选择工作区主题">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`theme-option theme-option-${option.id}`}
            aria-pressed={theme === option.id}
            aria-label={option.name}
            onClick={() => setTheme(option.id)}
          >
            <span className="theme-preview" aria-hidden="true">
              {option.id === "pixel" ? (
                <PixelScene preview />
              ) : (
                <>
                  <span className="theme-preview-rail">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="theme-preview-window">
                    <span className="theme-preview-title">RedNote</span>
                    <span className="theme-preview-moon" />
                    <span className="theme-preview-dune dune-back" />
                    <span className="theme-preview-dune dune-front" />
                  </span>
                </>
              )}
            </span>
            <span className="theme-option-heading">
              <strong>{option.name}</strong>
              <span className="theme-option-check" aria-hidden="true">
                {theme === option.id && <CheckOutlined />}
              </span>
            </span>
            <span className="theme-option-detail">{option.detail}</span>
            <span className="theme-swatches" aria-hidden="true">
              {option.colors.map((color) => (
                <i key={color} style={{ background: color }} />
              ))}
            </span>
          </button>
        ))}
      </div>
      <p className="appearance-saved" role="status">
        当前主题：{options.find((option) => option.id === theme)?.name}
      </p>
    </section>
  );
}
