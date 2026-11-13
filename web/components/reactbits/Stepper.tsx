/*
 * Copied from React Bits (https://reactbits.dev, github.com/DavidHDev/react-bits, src/ts-default/Components/Stepper at 9d9c687)
 * and adapted for Arrow: kept the numbered track with its sliding glider and dropped the step panes
 * and footer buttons (Arrow's pages hold their own content); @hugeicons replaced by an inline SVG tick; colours come from Arrow's
 * tokens instead of the THEMES table; a rail that is only a progress indicator renders without buttons; the glider sits next to the
 * list (an <ol> may hold only <li>); on a narrow rail the active step keeps its title (the last one once every step is done).
 *
 * MIT + Commons Clause License Condition v1.0. Copyright (c) 2026 David Haz.
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
 * modify, merge, publish, and distribute the Software as part of an application, website, or product, subject to the following
 * conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software. Commons Clause: you may not sell, sublicense, or redistribute the components themselves. Full text: ./LICENSE.md.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */
"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

import "./Stepper.css";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface StepProps {
  title?: ReactNode;
}

interface StepperProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onChange"> {
  children?: ReactNode;
  /** 1-based current step; total + 1 means every step is complete. */
  step: number;
  /** When set, a step can be clicked and this is called with its number. Without it the rail is a progress indicator only. */
  onStepChange?: (step: number) => void;
  /** Accessible name of the rail. */
  label: string;
}

const SPRING =
  "linear(0, 0.0603, 0.2033, 0.3821, 0.5633, 0.7258, 0.8584, 0.9574, 1.0242, 1.0634, 1.0809, 1.0828, 1.0747, 1.0613, 1.046, 1.0313, 1.0186, 1.0085, 1.0012, 0.9965, 0.994, 0.9931, 0.9933, 0.9941, 0.9953, 0.9966, 0.9978, 0.9988, 1)";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ease = () =>
  typeof CSS !== "undefined" && CSS.supports?.("transition-timing-function", "linear(0, 1)") ? SPRING : "cubic-bezier(0.34, 1.4, 0.64, 1)";

function Check() {
  return (
    <span className="stepper__check">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

export function Step(_: StepProps) {
  return null;
}

export default function Stepper({ children, step, onStepChange, label, className = "", ...rest }: StepperProps) {
  const steps = Children.toArray(children).filter(isValidElement) as ReactElement<StepProps>[];
  const total = steps.length;
  const current = clamp(Math.round(step), 1, total + 1);
  const completed = current > total;
  const interactive = typeof onStepChange === "function";

  const [tight, setTight] = useState(false);
  const trackRef = useRef<HTMLOListElement>(null);
  const gliderRef = useRef<HTMLSpanElement>(null);
  const markerRefs = useRef<(HTMLElement | null)[]>([]);
  const titleRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const labelWidths = useRef<number[]>([]);
  const tightRef = useRef(false);
  tightRef.current = tight;
  const placedRef = useRef(false);

  // Titles fold away (numbers stay) when they no longer fit the track.
  useIsomorphicLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const segments = markerRefs.current.slice(0, total);
      if (!tightRef.current) {
        segments.forEach((segment, index) => {
          const title = titleRefs.current[index];
          labelWidths.current[index] = title && segment?.contains(title) ? title.scrollWidth + 8 : 0;
        });
      }
      const badges = segments.reduce((sum, segment) => sum + (segment?.firstElementChild?.getBoundingClientRect().width ?? 22) + 20, 0);
      const labels = labelWidths.current.slice(0, total).reduce((sum, value) => sum + (value || 0), 0);
      const room = track.clientWidth - 8 - 4 * Math.max(0, total - 1);
      setTight(badges + labels > room + 0.5);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [total]);

  useIsomorphicLayoutEffect(() => {
    const track = trackRef.current;
    const glider = gliderRef.current;
    if (!track || !glider) return;
    const place = (animate: boolean) => {
      const segment = markerRefs.current[Math.min(current, total) - 1];
      if (!segment) return;
      const spring = ease();
      glider.style.transition = animate
        ? `transform 560ms ${spring}, width 560ms ${spring}, height 560ms ${spring}, opacity 200ms ease`
        : "opacity 200ms ease";
      glider.style.transform = `translate3d(${segment.offsetLeft}px, ${segment.offsetTop}px, 0)`;
      glider.style.width = `${segment.offsetWidth}px`;
      glider.style.height = `${segment.offsetHeight}px`;
      glider.style.opacity = completed ? "0" : "1";
    };
    place(placedRef.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    placedRef.current = true;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(track);
    return () => observer.disconnect();
  }, [current, total, completed, tight]);

  return (
    <div {...rest} className={`stepper ${className}`.trim()} style={{ ["--stepper-spring" as string]: SPRING }}>
      <ol ref={trackRef} className="stepper__track" aria-label={label}>
        {steps.map((entry, index) => {
          const number = index + 1;
          const status = completed || number < current ? "complete" : number === current ? "active" : "upcoming";
          const title = entry.props.title;
          const ref = (element: HTMLElement | null) => {
            markerRefs.current[index] = element;
          };
          const inner = (
            <>
              <span className="stepper__badge" data-status={status}>
                {status === "complete" ? <Check /> : number}
              </span>
              {title ? (
                <span className={tight && status !== "active" && !(completed && number === total) ? "stepper__text sr-only" : "stepper__text"}>
                  <span
                    ref={(element) => {
                      titleRefs.current[index] = element;
                    }}
                    className="stepper__title"
                    data-status={status}
                  >
                    {title}
                  </span>
                </span>
              ) : null}
            </>
          );
          return (
            <li key={number} className="stepper__item" aria-current={number === current ? "step" : undefined} data-last-done={completed && number === total ? "" : undefined}>
              {interactive ? (
                <button
                  ref={ref}
                  type="button"
                  className="stepper__segment"
                  data-status={status}
                  aria-label={typeof title === "string" ? `Step ${number}: ${title}` : `Step ${number}`}
                  onClick={() => onStepChange!(number)}
                >
                  {inner}
                </button>
              ) : (
                <span ref={ref} className="stepper__segment" data-status={status}>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <span ref={gliderRef} className="stepper__glider" aria-hidden="true" />
    </div>
  );
}
