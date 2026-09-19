import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  useGpuixRequired,
  type PublicInstance,
  type StyleDesc,
} from "@gpuix/react";
import {
  Action,
  Box,
  Glyph,
  Label,
  Part,
  column,
  row,
  useUI,
} from "./foundation";
import type { IconName } from "./icons";
export type GlideMenuItem = {
  id: string;
  label: string;
  description?: string;
  icon?: IconName;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  separatorBefore?: boolean;
};
export type GlideMenuProps = {
  id?: string;
  label: string;
  items: readonly GlideMenuItem[];
  onSelect: (item: GlideMenuItem) => unknown;
  onClose?: () => void;
  autoFocus?: boolean;
  style?: StyleDesc;
};
/** A native measured highlight. Arrow keys and text search move focus through enabled items. */
export function GlideMenu(props: GlideMenuProps) {
  const {
    id: givenId,
    label,
    items,
    onSelect,
    onClose,
    autoFocus = false,
    style,
  } = props;
  const scope = useId(),
    id = givenId ?? `glide-menu-${scope}`;
  const { theme } = useUI(),
    gpuix = useGpuixRequired();
  const refs = useRef(new Map<string, PublicInstance>());
  const [active, setActive] = useState<string>();
  const [error, setError] = useState("");
  const search = useRef({ text: "", time: 0 });
  const enabled = items.filter((item) => !item.disabled);
  const focus = (key: string) => {
    const instance = refs.current.get(key);
    if (instance) gpuix.focusElement?.(instance.id);
  };
  useLayoutEffect(() => {
    if (autoFocus && enabled[0]) focus(enabled[0].id);
  }, [autoFocus]);
  const keyDown: NonNullable<import("@gpuix/react").Props["onKeyDown"]> = (
    event,
  ) => {
    if (event.key === "escape") {
      onClose?.();
      return;
    }
    if (!enabled.length) return;
    const index = enabled.findIndex((item) => item.id === active);
    let next: GlideMenuItem | undefined;
    if (event.key === "home") next = enabled[0];
    else if (event.key === "end") next = enabled.at(-1);
    else if (event.key === "down") next = enabled[(index + 1) % enabled.length];
    else if (event.key === "up")
      next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key?.length === 1) {
      const now = performance.now();
      search.current.text =
        now - search.current.time < 700
          ? search.current.text + event.key
          : event.key;
      search.current.time = now;
      const query = search.current.text.toLocaleLowerCase();
      const start = index < 0 ? 0 : index + 1;
      const ordered = [...enabled.slice(start), ...enabled.slice(0, start)];
      next = ordered.find((item) =>
        item.label.toLocaleLowerCase().startsWith(query),
      );
    }
    if (next) focus(next.id);
  };
  return (
    <Part
      component="glide-menu"
      name="Root"
      id={id}
      data={props}
      role="menu"
      aria-label={label}
      style={{
        ...column,
        width: "100%",
        padding: 4,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
        boxShadow: theme.elevation.overlay,
        ...style,
      }}
    >
      <Part
        component="glide-menu"
        name="Highlight"
        id={`${id}/highlight`}
        style={{ ...column }}
      >
        {items.map((item) => (
          <Part
            key={item.id}
            component="glide-menu"
            name="ItemGroup"
            id={`${id}/group/${item.id}`}
            data={item}
            style={column}
          >
            {item.separatorBefore && (
              <Part
                component="glide-menu"
                name="Separator"
                id={`${id}/separator/${item.id}`}
                role="separator"
                style={{
                  height: 1,
                  backgroundColor: theme.colors.line,
                  marginTop: 4,
                  marginBottom: 4,
                  marginLeft: 8,
                  marginRight: 8,
                }}
              />
            )}
            <Part
              component="glide-menu"
              name="ItemBounds"
              id={`${id}/bounds/${item.id}`}
              data={item}
              style={column}
            >
              <Action
                component="glide-menu"
                name="Item"
                id={`${id}/item/${item.id}`}
                data={item}
                actionRef={(instance) => {
                  if (instance) refs.current.set(item.id, instance);
                  else refs.current.delete(item.id);
                }}
                role={
                  item.checked === undefined ? "menuitem" : "menuitemcheckbox"
                }
                checked={item.checked}
                tabIndex={item.id === (active ?? enabled[0]?.id) ? 0 : -1}
                label={item.label}
                disabled={item.disabled}
                onKeyDown={keyDown}
                onFocus={() => setActive(item.id)}
                onBlur={() =>
                  setActive((current) =>
                    current === item.id ? undefined : current,
                  )
                }
                onPress={() => {
                  setError("");
                  try {
                    return Promise.resolve(onSelect(item)).catch((e) =>
                      setError(e instanceof Error ? e.message : String(e)),
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
                style={{
                  ...row,
                  width: "100%",
                  minHeight: 32 * theme.font.scale,
                  padding: 0,
                  paddingLeft: 10,
                  paddingRight: 10,
                  paddingTop: 6,
                  paddingBottom: 6,
                  borderWidth: 0,
                  backgroundColor:
                    active === item.id ? theme.colors.hover : "#00000000",
                  hover: item.disabled
                    ? {}
                    : { backgroundColor: theme.colors.hover },
                  gap: 10,
                }}
              >
                {item.icon && (
                  <Glyph
                    name={item.icon}
                    size={15}
                    color={theme.colors.secondary}
                  />
                )}
                <Box style={{ ...column, flexGrow: 1, minWidth: 0, gap: 2 }}>
                  <Label
                    component="glide-menu"
                    name="ItemLabel"
                    id={`${id}/label/${item.id}`}
                    size={13}
                    style={{ lineHeight: 20 * theme.font.scale }}
                  >
                    {item.label}
                  </Label>
                  {item.description && (
                    <Label
                      component="glide-menu"
                      name="ItemDescription"
                      id={`${id}/description/${item.id}`}
                      size={11.5}
                      tone="muted"
                      style={{ lineHeight: 17 * theme.font.scale }}
                    >
                      {item.description}
                    </Label>
                  )}
                </Box>
                {item.shortcut && (
                  <Label
                    component="glide-menu"
                    name="Shortcut"
                    id={`${id}/shortcut/${item.id}`}
                    size={11}
                    tone="muted"
                  >
                    {item.shortcut}
                  </Label>
                )}
                {item.checked !== undefined && (
                  <Part
                    component="glide-menu"
                    name="Check"
                    id={`${id}/check/${item.id}`}
                    style={{ width: 14, opacity: item.checked ? 1 : 0 }}
                  >
                    <Glyph name="check" size={14} />
                  </Part>
                )}
              </Action>
            </Part>
          </Part>
        ))}
        {!items.length && (
          <Label
            component="glide-menu"
            name="Empty"
            id={`${id}/empty`}
            tone="muted"
            style={{ padding: 10 }}
          >
            No actions available
          </Label>
        )}
      </Part>
      {error && (
        <anchored side="bottom" gap={8} snapMargin={12}>
          <Part
            component="glide-menu"
            name="Error"
            id={`${id}/error`}
            role="alert"
            style={{
              ...column,
              padding: 12,
              gap: 8,
              maxWidth: 300,
              borderRadius: 10,
              backgroundColor: theme.colors.surface,
              boxShadow: theme.elevation.overlay,
            }}
          >
            <Label tone="red" size={12}>
              {error}
            </Label>
            <Action
              id={`${id}/dismiss-error`}
              label="Dismiss"
              onPress={() => setError("")}
            />
          </Part>
        </anchored>
      )}
    </Part>
  );
}
