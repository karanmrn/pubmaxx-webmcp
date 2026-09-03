"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  sheetClosedTranslateY,
  sheetTranslateY,
  SHEET_ENTRANCE_OVERSHOOT_DAMPING,
  type SheetSnap,
} from "@/lib/sheetSnap";
import { useSpringValue } from "@/lib/useSpringValue";

const TABLET_SHEET_QUERY = "(max-width: 768px)";

function subscribeTabletSheet(onChange: () => void): () => void {
  const query = window.matchMedia(TABLET_SHEET_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function tabletSheetSnapshot(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(TABLET_SHEET_QUERY).matches
  );
}

type SpringDrawerProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "children" | "style"
> & {
  open: boolean;
  side: "left" | "right";
  snap: SheetSnap;
  dragOffsetY: number | null;
  releaseVelocityY: number;
  keepMounted?: boolean;
  fade?: boolean;
  /** Beat 1: a fresh venue open springs past half with a subtle overshoot. */
  entranceOvershoot?: boolean;
  children: ReactNode;
};

type SpringDrawerStyle = CSSProperties & {
  "--drawer-spring-transform"?: string;
};

/**
 * Isolates drawer animation frames from PubMap's large render tree.
 *
 * At 641-768px the inline drawers are bottom sheets, so the spring follows the
 * same viewport-relative snap geometry as the drag hook. Above that band the
 * same component springs horizontally from the appropriate edge.
 */
const SpringDrawer = forwardRef<HTMLDivElement, SpringDrawerProps>(
  function SpringDrawer(
    {
      open,
      side,
      snap,
      dragOffsetY,
      releaseVelocityY,
      keepMounted = false,
      fade = false,
      entranceOvershoot = false,
      className,
      children,
      ...divProps
    },
    forwardedRef,
  ) {
    const tabletSheet = useSyncExternalStore(
      subscribeTabletSheet,
      tabletSheetSnapshot,
      () => false,
    );
    const closedHorizontal = side === "left" ? -100 : 100;
    const {
      value: horizontalValue,
      running: horizontalRunning,
      animateTo: animateHorizontal,
      jumpTo: jumpHorizontal,
      stop: stopHorizontal,
    } = useSpringValue(closedHorizontal, {
      response: 0.38,
      dampingRatio: 1,
    });
    const {
      value: verticalValue,
      running: verticalRunning,
      animateTo: animateVertical,
      jumpTo: jumpVertical,
      stop: stopVertical,
    } = useSpringValue(0, {
      response: 0.34,
      dampingRatio: 1,
    });
    const [ready, setReady] = useState(false);
    const [retainedChildren, setRetainedChildren] =
      useState<ReactNode>(open ? children : null);
    const drawerRef = useRef<HTMLDivElement | null>(null);
    const modeRef = useRef<"horizontal" | "vertical" | null>(null);
    const wasOpenRef = useRef(false);
    const wasDraggingRef = useRef(false);
    const overshootEntranceDoneRef = useRef(false);
    const setDrawerRef = useCallback(
      (node: HTMLDivElement | null) => {
        drawerRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    useEffect(() => {
      if (open) setRetainedChildren(children);
    }, [children, open]);

    const clearRetainedChildren = useCallback(() => {
      if (!keepMounted) setRetainedChildren(null);
    }, [keepMounted]);

    useLayoutEffect(() => {
      const mode = tabletSheet ? "vertical" : "horizontal";
      const modeChanged = modeRef.current !== mode;
      const firstRun = modeRef.current === null;
      const opening = open && !wasOpenRef.current;
      wasOpenRef.current = open;
      modeRef.current = mode;
      const initialEntrance =
        entranceOvershoot &&
        open &&
        !overshootEntranceDoneRef.current;

      if (tabletSheet) {
        stopHorizontal();
        const viewportHeight = window.innerHeight;
        const snapTarget = sheetTranslateY(snap, viewportHeight);
        const bottomClearance = drawerRef.current
          ? Number.parseFloat(
              window.getComputedStyle(drawerRef.current).bottom,
            )
          : 0;
        const closedTarget = sheetClosedTranslateY(
          viewportHeight,
          bottomClearance,
        );

        if (dragOffsetY !== null) {
          wasDraggingRef.current = true;
          jumpVertical(snapTarget + dragOffsetY);
        } else {
          const velocity = wasDraggingRef.current ? releaseVelocityY : 0;
          wasDraggingRef.current = false;
          const target = open ? snapTarget : closedTarget;
          if (firstRun || modeChanged) {
            if (initialEntrance) {
              jumpVertical(closedTarget);
              animateVertical(target, {
                dampingRatio: SHEET_ENTRANCE_OVERSHOOT_DAMPING,
                onRest: () => {
                  overshootEntranceDoneRef.current = true;
                },
              });
            } else {
              jumpVertical(target);
              if (!open) clearRetainedChildren();
            }
          } else {
            animateVertical(target, {
              velocity,
              dampingRatio:
                opening && entranceOvershoot
                  ? SHEET_ENTRANCE_OVERSHOOT_DAMPING
                  : Math.abs(velocity) >= 500
                    ? 0.8
                    : 1,
              onRest: open ? undefined : clearRetainedChildren,
            });
          }
        }
      } else {
        stopVertical();
        wasDraggingRef.current = false;
        const target = open ? 0 : closedHorizontal;
        if (firstRun || modeChanged) {
          if (initialEntrance) {
            animateHorizontal(target, {
              dampingRatio: SHEET_ENTRANCE_OVERSHOOT_DAMPING,
              onRest: () => {
                overshootEntranceDoneRef.current = true;
              },
            });
          } else {
            jumpHorizontal(target);
            if (!open) clearRetainedChildren();
          }
        } else {
          animateHorizontal(target, {
            dampingRatio:
              opening && entranceOvershoot ? SHEET_ENTRANCE_OVERSHOOT_DAMPING : 1,
            onRest: open ? undefined : clearRetainedChildren,
          });
        }
      }

      if (firstRun) setReady(true);
    }, [
      animateHorizontal,
      animateVertical,
      clearRetainedChildren,
      closedHorizontal,
      dragOffsetY,
      jumpHorizontal,
      jumpVertical,
      open,
      releaseVelocityY,
      snap,
      stopHorizontal,
      stopVertical,
      tabletSheet,
      entranceOvershoot,
    ]);

    const transform = tabletSheet
      ? `translate3d(0, ${verticalValue}px, 0)`
      : `translate3d(${horizontalValue}%, 0, 0)`;
    const running = tabletSheet ? verticalRunning : horizontalRunning;
    const presentationClassName = open || running || dragOffsetY !== null
      ? ` open sheet-${snap}`
      : "";
    const opacity = fade && !tabletSheet
      ? Math.max(0, 1 - Math.abs(horizontalValue) / 100)
      : undefined;
    const style: SpringDrawerStyle = ready
      ? {
          "--drawer-spring-transform": transform,
          transform,
          opacity,
          transition: "none",
          willChange:
            running || dragOffsetY !== null
              ? fade && !tabletSheet
                ? "transform, opacity"
                : "transform"
              : "auto",
        }
      : { transition: "none", willChange: "auto" };

    return (
      <div
        {...divProps}
        ref={setDrawerRef}
        className={`springDrawer ${className ?? ""}${presentationClassName}`.trim()}
        data-spring-axis={tabletSheet ? "vertical" : "horizontal"}
        style={style}
        inert={open ? undefined : true}
      >
        {open ? children : retainedChildren}
      </div>
    );
  },
);

export default SpringDrawer;
