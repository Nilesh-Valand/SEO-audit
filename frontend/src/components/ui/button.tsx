import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const baseClass =
  "inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors";

export function Button({
  children,
  className = "",
  type = "button",
  disabled = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`${baseClass} bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`${baseClass} bg-brand-600 text-white hover:bg-brand-700 ${className}`}>
      {children}
    </Link>
  );
}
