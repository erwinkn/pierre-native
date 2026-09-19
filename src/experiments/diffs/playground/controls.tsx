import { useId, useRef, useState, type ReactNode } from "react";
import {
  useGpuixRequired,
  type PublicInstance,
  type StyleDesc,
} from "@gpuix/react";
import {
  Action,
  Box,
  Label,
  Part,
  row,
  column,
  useUI,
} from "../../../components/foundation";
import { GlideMenu } from "../../../components/glide-menu";
import { DialogLayer } from "../../../components/dialog-layer";
import sourceIcons from "../../../../assets/playground/icons.json";
export type IconName = keyof typeof sourceIcons;
export function Icon({
  name,
  color,
  size = 16,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  const { theme } = useUI();
  const id = useId();
  const viewBox = sourceIcons[name]
    .match(/viewBox="([^\"]+)"/)?.[1]
    .split(/\s+/)
    .map(Number);
  const width = viewBox ? (size * viewBox[2]) / viewBox[3] : size;
  return (
    <Part
      component="playground"
      name="Icon"
      id={"pg/icon/" + name + id}
      as="svg"
      nativeProps={{ source: sourceIcons[name] }}
      style={{
        width,
        height: size,
        flexShrink: 0,
        color: color ?? theme.colors.ink,
      }}
    />
  );
}
export function Button({
  id,
  label,
  icon,
  onPress,
  children,
  disabled,
  selected,
  compact,
  iconOnly = false,
  style,
}: {
  id: string;
  label: string;
  icon?: IconName;
  onPress: () => unknown;
  children?: ReactNode;
  disabled?: boolean;
  selected?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
  style?: StyleDesc;
}) {
  const { theme } = useUI();
  return (
    <Action
      component="playground"
      name="Button"
      id={id}
      label={label}
      disabled={disabled}
      selected={selected}
      onPress={onPress}
      style={{
        ...row,
        height: compact ? 26 : 36,
        minHeight: 0,
        padding: 0,
        paddingLeft: compact ? 8 : 12,
        paddingRight: compact ? 8 : 12,
        gap: iconOnly ? 0 : 8,
        justifyContent: iconOnly ? "center" : undefined,
        borderRadius: compact ? 5 : 8,
        borderWidth: 1,
        borderColor: selected === false ? "#00000000" : theme.colors.line,
        backgroundColor:
          selected === false ? theme.colors.segmentTrack : theme.colors.page,
        color: theme.colors.ink,
        flexShrink: 0,
        hover: disabled
          ? {}
          : { backgroundColor: style?.backgroundColor ?? theme.colors.hover },
        ...style,
      }}
    >
      {icon && <Icon name={icon} color={style?.color as string | undefined} />}
      {!iconOnly &&
        (children ?? (
          <Label
            size={compact ? 12 : 14}
            style={{ fontWeight: 500, lineHeight: 20, color: style?.color }}
          >
            {label}
          </Label>
        ))}
    </Action>
  );
}
export function Menu<T extends string>({
  id,
  label,
  icon,
  value,
  items,
  onChange,
}: {
  id: string;
  label?: string;
  icon?: IconName;
  value: T;
  items: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const { theme } = useUI(),
    native = useGpuixRequired();
  const [open, setOpen] = useState(false);
  const trigger = useRef<PublicInstance>(null);
  const close = () => {
    setOpen(false);
    if (trigger.current) native.focusElement?.(trigger.current.id);
  };
  return (
    <Box style={{ ...column, flexShrink: 0 }}>
      <Action
        component="playground"
        name="Select"
        id={id}
        actionRef={trigger}
        label={label ?? items.find((i) => i.value === value)?.label ?? value}
        expanded={open}
        onPress={() => setOpen(!open)}
        style={{
          ...row,
          height: 36,
          minHeight: 0,
          padding: 0,
          paddingLeft: 12,
          paddingRight: 12,
          gap: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.line,
          backgroundColor: theme.colors.page,
        }}
      >
        {icon && <Icon name={icon} />}
        <Label size={14} style={{ fontWeight: 500, lineHeight: 20 }}>
          {label ?? items.find((i) => i.value === value)?.label ?? value}
        </Label>
        <Icon name="ChevronSm" color={theme.colors.muted} />
      </Action>
      {open && (
        <anchored
          side="bottom"
          align="start"
          gap={4}
          snapMargin={12}
          priority={5}
        >
          <Part
            component="playground"
            name="Menu"
            id={id + "/popup"}
            onMouseDownOutside={close}
            style={{
              ...column,
              width: Math.max(
                190,
                Math.min(
                  320,
                  80 + Math.max(...items.map((i) => i.label.length)) * 7,
                ),
              ),
              maxHeight: 460,
              overflowY: "scroll",
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.line,
            }}
          >
            <GlideMenu
              id={id + "/menu"}
              label={label ?? id}
              autoFocus
              items={items.map((i) => ({
                id: i.value,
                label: i.label,
                checked: i.value === value,
              }))}
              onSelect={(item) => {
                onChange(item.id as T);
                close();
              }}
              onClose={close}
              style={{ borderRadius: 8, backgroundColor: theme.colors.page }}
            />
          </Part>
        </anchored>
      )}
    </Box>
  );
}
export function Toggle({
  id,
  label,
  icon,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  icon: IconName;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const { theme } = useUI();
  return (
    <Action
      component="playground"
      name="Toggle"
      id={id}
      label={label}
      role="switch"
      checked={checked}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={{
        ...row,
        height: 36,
        minHeight: 0,
        padding: 0,
        paddingLeft: 12,
        paddingRight: 12,
        gap: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: checked ? theme.colors.line : "#00000000",
        backgroundColor: checked
          ? theme.colors.page
          : theme.colors.segmentTrack,
        flexShrink: 0,
      }}
    >
      <Box style={{ ...row, gap: 8 }}>
        <Icon name={icon} />
        <Label size={14} style={{ fontWeight: 500 }}>
          {label}
        </Label>
      </Box>
      <Part
        component="playground"
        name="Switch"
        id={id + "/track"}
        style={{
          width: 24,
          height: 16,
          flexShrink: 0,
          borderRadius: 8,
          position: "relative",
          backgroundColor: checked ? theme.colors.ink : theme.colors.lineStrong,
        }}
      >
        <Part
          component="playground"
          name="Switch"
          id={id + "/thumb"}
          style={{
            position: "absolute",
            top: 16 / 12,
            left: 16 / 12 + (checked ? 8 : 0),
            width: 16 - 16 / 6,
            height: 16 - 16 / 6,
            borderRadius: 8,
            backgroundColor: theme.colors.page,
            boxShadow: {
              offsetX: 0,
              offsetY: 16 / 12,
              blurRadius: 16 / 12,
              spreadRadius: 0,
              color: "#00000033",
            },
          }}
        />
      </Part>
    </Action>
  );
}
export function Segments<T extends string>({
  id,
  value,
  items,
  onChange,
}: {
  id: string;
  value: T;
  items: readonly { value: T; label: string; icon: IconName }[];
  onChange: (value: T) => void;
}) {
  const { theme } = useUI();
  return (
    <Part
      component="playground"
      name="Segments"
      id={id}
      role="group"
      aria-label={id.split("/").at(-1)}
      style={{
        ...row,
        borderRadius: 8,
        backgroundColor: theme.colors.segmentTrack,
        flexShrink: 0,
      }}
    >
      {items.map((item) => (
        <Button
          key={item.value}
          id={id + "/" + item.value}
          label={item.label}
          selected={item.value === value}
          onPress={() => onChange(item.value)}
          style={{ width: 36, padding: 0, justifyContent: "center" }}
        >
          <Icon
            name={item.icon}
            color={item.value === value ? theme.colors.ink : theme.colors.muted}
          />
        </Button>
      ))}
    </Part>
  );
}
export function Divider() {
  const { theme } = useUI();
  return (
    <Box
      style={{
        width: 1,
        height: 24,
        backgroundColor: theme.colors.line,
        flexShrink: 0,
      }}
    />
  );
}
export function Card({
  id,
  children,
  style,
}: {
  id: string;
  children: ReactNode;
  style?: StyleDesc;
}) {
  const { theme } = useUI();
  return (
    <Part
      component="playground"
      name="Card"
      id={id}
      style={{
        ...column,
        borderWidth: 1,
        borderColor: theme.colors.line,
        borderRadius: 9,
        overflow: "hidden",
        minWidth: 0,
        minHeight: 0,
        backgroundColor: theme.colors.page,
        ...style,
      }}
    >
      {children}
    </Part>
  );
}
export function OptionsDialog({
  children,
  close,
}: {
  children: ReactNode;
  close: () => void;
}) {
  const { theme } = useUI();
  return (
    <DialogLayer id="pg/options-dialog" title="Options" onClose={close}>
      <Card
        id="pg/options-sheet"
        style={{
          width: "100%",
          maxWidth: 540,
          maxHeight: "95%",
          padding: 16,
          gap: 20,
          backgroundColor: theme.colors.page,
          overflowY: "scroll",
        }}
      >
        <Box style={{ ...row, justifyContent: "space-between" }}>
          <Label size={16} style={{ fontWeight: 500 }}>
            Options
          </Label>
          <Button id="pg/options-close" label="Close" compact onPress={close} />
        </Box>
        {children}
      </Card>
    </DialogLayer>
  );
}
