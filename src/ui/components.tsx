import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Button = ({ children, onClick, className, variant = 'primary', disabled }: any) => {
  const variants: any = {
    primary:   'bg-accent text-black hover:bg-accent/90',
    secondary: 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700',
    ghost:     'hover:bg-white/5 text-zinc-400 hover:text-zinc-200',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed",
        variants[variant], className
      )}
    >
      {children}
    </button>
  );
};
