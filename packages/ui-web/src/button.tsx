import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import type { ComponentProps } from "react";
import { twMerge } from "tailwind-merge";

const buttonVariants = cva(
  "inline-flex min-h-touch items-center justify-center rounded-ui px-control text-sm font-semibold " +
    "whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50 " +
    "motion-reduce:transition-none",
  {
    variants: {
      variant: {
        primary: "bg-action text-action-ink hover:bg-action-hover",
        destructive: "bg-control text-error",
        selected: "bg-control text-ink shadow-control",
        ghost: "text-muted hover:bg-control hover:text-ink",
      },
    },
    defaultVariants: { variant: "ghost" },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, asChild, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component className={twMerge(clsx(buttonVariants({ variant }), className))} {...props} />;
}

export { Button, buttonVariants };
