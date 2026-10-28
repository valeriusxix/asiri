import { useRef, useState } from "react";

/**
 * Six large digit boxes backed by ONE real input, so paste, SMS one-time-code autofill and
 * the numeric keyboard all work natively on Android and iOS.
 */
export function PinInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  label,
  id = "pin",
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  label: string;
  id?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");
  const active = Math.min(value.length, 5);

  return (
    <div className="relative mx-auto w-full max-w-[22rem]" onClick={() => ref.current?.focus()}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        value={value}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        aria-invalid={invalid || undefined}
        autoFocus
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, "").slice(0, 6);
          onChange(next);
          if (next.length === 6) onComplete?.(next);
        }}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {digits.map((d, i) => {
          const isActive = focused && i === active && !disabled;
          return (
            <div
              key={i}
              className={`flex aspect-[4/5] items-center justify-center rounded-xl bg-surface text-[1.75rem] font-bold tabular-nums text-fg ring-inset transition
                ${invalid ? "ring-2 ring-error" : isActive ? "ring-[3px] ring-brand-primary" : d.trim() ? "ring-2 ring-brand-primary/60" : "ring-2 ring-border-strong"}`}
            >
              {d.trim() || (isActive ? <span className="h-7 w-0.5 animate-pulse bg-brand-ink" /> : "")}
            </div>
          );
        })}
      </div>
    </div>
  );
}
