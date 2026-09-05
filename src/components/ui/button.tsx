import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 shrink-0 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        outline: "border bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-white hover:opacity-90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>

// Depth color per variant — a darkened shade of each variant's fill, consumed by
// the `.btn-tactile` box-shadow. `ghost` gets no solid chunk (depth 0).
const TACTILE_DEPTH_COLOR: Record<ButtonVariant, string> = {
  default: "color-mix(in oklab, var(--primary) 60%, black)",
  secondary: "color-mix(in oklab, var(--secondary) 70%, black)",
  destructive: "color-mix(in oklab, var(--destructive) 60%, black)",
  outline: "color-mix(in oklab, var(--border) 60%, black)",
  ghost: "transparent",
}

const TACTILE_DEPTH_PX: Record<ButtonSize, string> = {
  default: "5px",
  sm: "3px",
  lg: "6px",
  icon: "3px",
}

interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  /** Opt out of the tactile 3D treatment (e.g. the Evolve button). */
  tactile?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant, size, type = "button", tactile = true, style, ...props },
    ref
  ) {
    const resolvedVariant: ButtonVariant = variant ?? "default"
    const resolvedSize: ButtonSize = size ?? "default"

    return (
      <button
        ref={ref}
        type={type}
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }), tactile && "btn-tactile")}
        style={
          tactile
            ? ({
                "--tactile-depth": TACTILE_DEPTH_PX[resolvedSize],
                "--tactile-depth-color": TACTILE_DEPTH_COLOR[resolvedVariant],
                ...style,
              } as React.CSSProperties)
            : style
        }
        {...props}
      />
    )
  }
)

export { Button, buttonVariants }
