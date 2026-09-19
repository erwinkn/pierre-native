import { ensureComponentFonts } from "./fonts";
import { useGpuixRequired } from "@gpuix/react";
import {
  createContext,
  createElement,
  useContext,
  useState,
  useId,
  useMemo,
  type ReactNode,
} from "react";
import type { Props, StyleDesc } from "@gpuix/react";
import { darkTheme, type UITheme } from "./theme";
import { icons, type IconName } from "./icons";
export const row: StyleDesc = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
};
export const column: StyleDesc = { display: "flex", flexDirection: "column" };
export type PartData<T = unknown> = {
  version: 1;
  value?: T;
  type: string;
  props: Record<string, unknown>;
  children: ReactNode;
  theme: UITheme;
  address: string;
  instance: string;
};
/** Keep a default part's native node and named children, without resolving the same slot again. */
export function renderDefaultPart(data: PartData) {
  if (!data || data.version !== 1)
    throw Error("Unsupported UI part contract. Expected version 1.");
  return createElement(
    data.type,
    data.props,
    <PartPath.Provider value={data.instance}>
      {data.children}
    </PartPath.Provider>,
  );
}
const PartPath = createContext("ui");
const ActionContents = createContext(false);
export type PartRenderer = (data: PartData) => ReactNode;
const UIContext = createContext({
  theme: darkTheme,
  reducedMotion: false,
  renderPart: renderDefaultPart as PartRenderer,
});
export function UIProvider({
  theme = darkTheme,
  reducedMotion = false,
  renderPart = renderDefaultPart,
  children,
}: {
  theme?: UITheme;
  reducedMotion?: boolean;
  renderPart?: PartRenderer;
  children: ReactNode;
}) {
  ensureComponentFonts(useGpuixRequired());
  const value = useMemo(
    () => ({ theme, reducedMotion, renderPart }),
    [theme, reducedMotion, renderPart],
  );
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}
export const useUI = () => useContext(UIContext);
export type PartProps = Props & {
  component: string;
  name: string;
  id: string;
  as?: string;
  nativeProps?: Record<string, unknown>;
  data?: unknown;
};
/** Hosts can replace or decorate every named part through DiffProvider.renderPart. */
export function Part({
  component,
  name,
  id,
  as = "div",
  nativeProps,
  data,
  children,
  style,
  ...props
}: PartProps) {
  const passPointer =
    useContext(ActionContents) &&
    !Object.keys(props).some((key) => key.startsWith("on"));
  const { theme, renderPart } = useUI(),
    address = `${component}/${name}`;
  return renderPart({
    version: 1,
    value: data,
    type: as,
    props: {
      ...props,
      ...nativeProps,
      testId: id,
      style: {
        ...style,
        ...(passPointer ? { pointerEvents: "none" } : {}),
        ...theme.overrides[component],
        ...theme.overrides[address],
        ...theme.overrides[`#${id}`],
      },
    },
    children,
    theme,
    address,
    instance: id,
  });
}

export function Box({ testId, children, ...props }: Props) {
  const generated = useId(),
    parent = useContext(PartPath);
  return (
    <Part
      component="common"
      name="Box"
      id={testId ?? `${parent}/${generated}`}
      {...props}
    >
      {children}
    </Part>
  );
}
function usePartId(id?: string) {
  const generated = useId(),
    parent = useContext(PartPath);
  return id ?? `${parent}/${generated}`;
}
export function Label({
  children,
  size = 13,
  tone = "ink",
  mono = false,
  style,
  ...part
}: {
  children: ReactNode;
  size?: number;
  tone?: "ink" | "secondary" | "muted" | "green" | "red" | "accentInk";
  mono?: boolean;
  style?: StyleDesc;
  component?: string;
  name?: string;
  id?: string;
}) {
  const { theme } = useUI();
  const autoId = usePartId(part.id);
  const text = Array.isArray(children)
    ? children
        .flat(Infinity)
        .filter((v) => v !== null && v !== undefined && typeof v !== "boolean")
        .join("")
    : children;
  const props = {
    style: {
      fontFamily: mono ? theme.font.mono : theme.font.sans,
      fontSize: size * theme.font.scale,
      lineHeight: size * 1.6 * theme.font.scale,
      color: theme.colors[tone],
      ...style,
    },
    children: text,
  };
  return part.component && part.name && part.id ? (
    <Part
      {...props}
      component={part.component}
      name={part.name}
      id={part.id}
      as="text"
    />
  ) : (
    <Part {...props} component="common" name="Label" id={autoId} as="text" />
  );
}
export function Glyph({
  name,
  size = 14,
  color,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const { theme } = useUI(),
    id = usePartId();
  return (
    <Part
      component="common"
      name="Icon"
      id={id}
      as="svg"
      nativeProps={{ source: icons[name] }}
      style={{
        width: size * theme.font.scale,
        height: size * theme.font.scale,
        color: color ?? theme.colors.secondary,
        flexShrink: 0,
      }}
    />
  );
}
export type ActionProps = {
  id: string;
  label: string;
  onPress?: () => unknown;
  children?: ReactNode;
  disabled?: boolean;
  selected?: boolean;
  role?: Props["role"];
  checked?: boolean | "mixed";
  expanded?: boolean;
  primary?: boolean;
  iconOnly?: boolean;
  preserveSelection?: boolean;
  tabIndex?: number;
  actionRef?: Props["ref"];
  data?: unknown;
  icon?: IconName;
  style?: StyleDesc;
  component?: string;
  name?: string;
  onKeyDown?: Props["onKeyDown"];
  onFocus?: () => void;
  onBlur?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};
export function Action({
  id,
  label,
  onPress,
  children,
  disabled = false,
  selected,
  role = "button",
  checked,
  expanded,
  primary = false,
  iconOnly = false,
  preserveSelection,
  tabIndex = 0,
  actionRef,
  data,
  icon,
  style,
  component,
  name,
  onKeyDown,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
}: ActionProps) {
  const { theme } = useUI();
  const [error, setError] = useState("");
  const invoke = () => {
    if (!disabled) {
      setError("");
      try {
        Promise.resolve(onPress?.()).catch((e) => setError(String(e)));
      } catch (e) {
        setError(String(e));
      }
    }
  };
  const props: Props = {
    testId: id,
    preserveSelection,
    role,
    ref: actionRef,
    "aria-label": label,
    "aria-selected": role === "tab" || role === "option" ? selected : undefined,
    "aria-pressed": role === "button" ? selected : undefined,
    "aria-checked": checked,
    "aria-expanded": expanded,
    "aria-disabled": disabled,
    "aria-description": error || undefined,
    tabIndex: disabled ? -1 : tabIndex,
    onClick: invoke,
    onKeyDown: (e) => {
      onKeyDown?.(e);
      if (e.key === "enter" || e.key === "space") invoke();
    },
    onFocus: () => {
      onFocus?.();
    },
    onBlur: () => {
      onBlur?.();
    },
    onMouseEnter,
    onMouseLeave,
    style: {
      ...row,
      gap: 6,
      paddingLeft: style?.padding === undefined ? 6 : undefined,
      paddingRight: style?.padding === undefined ? 6 : undefined,
      paddingTop: style?.padding === undefined ? 3 : undefined,
      paddingBottom: style?.padding === undefined ? 3 : undefined,
      minHeight: 26,
      borderRadius: theme.radius.control,
      borderWidth: 1,
      borderColor: "#00000000",
      focusVisible: {
        borderColor: theme.colors.accent,
        boxShadow: {
          offsetX: 0,
          offsetY: 0,
          blurRadius: 0,
          spreadRadius: 1,
          color: theme.colors.accent,
        },
      },
      backgroundColor: primary
        ? theme.colors.ink
        : selected
          ? theme.colors.hover
          : undefined,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.4 : 1,
      userSelect: "none",
      hover: disabled
        ? {}
        : {
            backgroundColor: primary
              ? theme.colors.secondary
              : theme.colors.hoverStrong,
          },
      ...style,
    },
    children: children ?? (
      <>
        {icon && <Glyph name={icon} />}
        {!iconOnly && (
          <Label
            size={12.5}
            style={{
              color: primary ? theme.colors.canvas : theme.colors.secondary,
            }}
          >
            {label}
          </Label>
        )}
      </>
    ),
  };
  props.children = (
    <ActionContents.Provider value={true}>
      {props.children}
    </ActionContents.Provider>
  );
  return component && name ? (
    <Part {...props} component={component} name={name} id={id} data={data} />
  ) : (
    <Part {...props} component="common" name="Action" id={id} data={data} />
  );
}
export function Card({
  id,
  component,
  children,
  style,
  data,
}: {
  id: string;
  component: string;
  children: ReactNode;
  style?: StyleDesc;
  data?: unknown;
}) {
  const { theme } = useUI();
  return (
    <Part
      component={component}
      name="Root"
      id={id}
      data={data}
      style={{
        ...column,
        width: "100%",
        maxWidth: theme.layout.componentWidth,
        borderRadius: theme.radius.card,
        borderWidth: 1,
        borderColor: theme.colors.line,
        backgroundColor: theme.colors.surface,
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </Part>
  );
}
export function Input({
  id,
  value,
  onChange,
  placeholder,
  multiline = false,
  style,
  onKeyDown,
  onSubmit,
  component = "common",
  name = "Input",
  minRows = 1,
  maxRows = 5,
  captureKeys = [],
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  style?: StyleDesc;
  onKeyDown?: Props["onKeyDown"];
  onSubmit?: Props["onSubmit"];
  component?: string;
  name?: string;
  minRows?: number;
  maxRows?: number;
  captureKeys?: string[];
  inputRef?: Props["ref"];
}) {
  const { theme } = useUI();
  return (
    <Part
      component={component}
      name={name}
      id={id}
      as={multiline ? "textarea" : "input"}
      ref={inputRef}
      aria-label={placeholder}
      onChange={(e) => onChange(e.value ?? "")}
      onKeyDown={onKeyDown}
      onSubmit={onSubmit}
      nativeProps={{
        placeholder,
        value,
        minRows,
        maxRows,
        captureKeys,
        theme: {
          appearance: theme.name === "Light" ? "light" : "dark",
          bg: theme.colors.inset,
          text: theme.colors.ink,
          fontSans: theme.font.sans,
          accent: theme.colors.accent,
          caret: theme.colors.ink,
        },
      }}
      style={{
        fontFamily: theme.font.sans,
        fontSize: 13 * theme.font.scale,
        color: theme.colors.ink,
        width: "100%",
        padding: 8,
        borderRadius: 6,
        backgroundColor: theme.colors.inset,
        ...style,
      }}
    />
  );
}
