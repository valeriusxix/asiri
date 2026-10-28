import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { common } from "../copy";
import { copyText } from "../hooks";

type Variant = "primary" | "dark" | "secondary" | "danger" | "ghost" | "success";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-primary text-white hover:bg-brand-primary-hover active:bg-brand-primary-pressed focus-visible:outline-brand-primary",
  dark: "bg-brand-ink text-white hover:bg-brand-ink-hover focus-visible:outline-brand-primary",
  secondary: "bg-surface text-fg ring-1 ring-inset ring-border-strong hover:bg-surface-muted focus-visible:outline-brand-primary",
  danger: "bg-surface text-error ring-1 ring-inset ring-error/40 hover:bg-error-tint focus-visible:outline-error",
  ghost: "text-muted hover:text-fg hover:bg-surface-muted focus-visible:outline-brand-primary",
  success: "bg-success text-white hover:bg-success-hover focus-visible:outline-success",
};

const SIZES = {
  sm: "min-h-9 px-3 text-sm rounded-lg",
  md: "min-h-11 px-4 text-base rounded-xl",
  lg: "min-h-14 px-6 text-lg rounded-2xl",
};

export function buttonClass(variant: Variant = "primary", size: keyof typeof SIZES = "md", extra = "") {
  return `inline-flex items-center justify-center gap-2 font-semibold transition-colors select-none
    focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed
    ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  block,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES; block?: boolean }) {
  return <button type="button" className={buttonClass(variant, size, `${block ? "w-full" : ""} ${className}`)} {...rest} />;
}

export function ButtonLink({
  to,
  variant = "primary",
  size = "md",
  block,
  children,
}: {
  to: string;
  variant?: Variant;
  size?: keyof typeof SIZES;
  block?: boolean;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={buttonClass(variant, size, block ? "w-full" : "")}>
      {children}
    </Link>
  );
}

export function Card({ children, className = "", as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <Tag className={`rounded-2xl bg-surface p-5 shadow-xs shadow-brand-ink/5 ring-1 ring-border ${className}`}>{children}</Tag>;
}

export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-warning-tint-strong px-2 py-0.5 text-xs font-bold tracking-wide text-warning-text ring-1 ring-inset ring-warning-border ${className}`}
    >
      {common.demo}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-5 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}

export function CopyButton({ text, label = common.copy, className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      className={`shrink-0 ${className}`}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      <span aria-live="polite">{copied ? common.copied : label}</span>
    </Button>
  );
}

/** Monospace value with a copy button. Long values wrap; nothing scrolls sideways at 360 px. */
export function CopyBox({ value, label, className = "" }: { value: string; label?: string; className?: string }) {
  return (
    <div className={className}>
      {label && <div className="mb-1.5 text-sm font-medium text-muted">{label}</div>}
      <div className="flex items-start gap-2 rounded-xl bg-surface-muted p-3 ring-1 ring-inset ring-border">
        <code className="min-w-0 flex-1 break-all font-mono text-[13px] leading-relaxed text-fg">{value}</code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "info" | "success" | "warning"; children: ReactNode }) {
  const tones = {
    error: "bg-error-tint text-error ring-error-border",
    info: "bg-info-tint text-info-text ring-info-border",
    success: "bg-success-tint text-success-text ring-success-border",
    warning: "bg-warning-tint text-warning-text ring-warning-border",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl p-3.5 text-[15px] leading-snug ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Field({ label, help, error, htmlFor, children }: { label: string; help?: ReactNode; error?: string | null; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-sm font-medium text-error">{error}</p>
      ) : help ? (
        <p className="mt-1.5 text-sm text-muted">{help}</p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "block w-full min-h-12 rounded-xl bg-surface px-3.5 text-base text-fg ring-1 ring-inset ring-input placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand-primary";

export function Icon({ name, className = "size-5" }: { name: "check" | "bank" | "clock" | "wallet" | "lock" | "alert" | "shield" | "arrow"; className?: string }) {
  const paths: Record<typeof name, ReactNode> = {
    check: <path d="M5 12.5l4.2 4.2L19 7" />,
    bank: <path d="M3 10h18M5 10v8m4.67-8v8m4.66-8v8M19 10v8M3 20h18M12 3l9 5H3l9-5z" />,
    clock: <path d="M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />,
    wallet: <path d="M3 7a2 2 0 012-2h13v4M3 7v11a2 2 0 002 2h15V9H5a2 2 0 01-2-2zm14 6.5h.01" />,
    lock: <path d="M7 11V8a5 5 0 0110 0v3M5 11h14v10H5V11z" />,
    alert: <path d="M12 9v4m0 4h.01M10.3 3.9L2.4 17.5A2 2 0 004.1 20.5h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />,
    shield: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />,
    arrow: <path d="M5 12h14m-6-6l6 6-6 6" />,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {paths[name]}
    </svg>
  );
}
