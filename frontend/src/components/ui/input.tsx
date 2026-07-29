import type { InputHTMLAttributes } from "react";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500 ${
        props.className ?? ""
      }`}
    />
  );
}
