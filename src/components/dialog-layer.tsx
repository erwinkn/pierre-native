import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  useGpuixRequired,
  useWindowSize,
  type PublicInstance,
} from "@gpuix/react";
import { Part, column, useUI } from "./foundation";
/** A native window-sized modal layer. Focus traversal remains in its subtree. */
export function DialogLayer({
  id,
  title,
  onClose,
  children,
}: {
  id: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { theme } = useUI(),
    size = useWindowSize(),
    native = useGpuixRequired(),
    ref = useRef<PublicInstance>(null);
  const previous = useRef<number | null | undefined>(undefined);
  useLayoutEffect(() => {
    previous.current = native.getFocusedElementId?.();
    if (ref.current) native.focusElement?.(ref.current.id);
    return () => {
      if (previous.current) native.focusElement?.(previous.current);
    };
  }, [native]);
  return (
    <Part
      component="dialog-layer"
      name="Root"
      id={`${id}/layer`}
      as="anchored"
      nativeProps={{
        position: { x: 0, y: 0 },
        anchor: "topLeft",
        snapMargin: 0,
        priority: 20,
        occlude: true,
      }}
      style={{
        width: size.width,
        height: size.height,
        backgroundColor: "#00000000",
      }}
    >
      <Part
        component="dialog-layer"
        name="Backdrop"
        id={`${id}/backdrop`}
        onClick={onClose}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: theme.name === "Light" ? "#00000099" : "#000000bf",
        }}
      />
      <Part
        component="dialog-layer"
        name="Content"
        id={id}
        ref={ref}
        role="dialog"
        aria-modal
        aria-label={title}
        focusScope
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "escape") onClose();
        }}
        style={{
          ...column,
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          pointerEvents: "none",
        }}
      >
        {children}
      </Part>
    </Part>
  );
}
