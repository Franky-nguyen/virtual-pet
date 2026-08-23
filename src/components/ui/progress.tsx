import * as React from "react"
import { cn } from "../../lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<"div"> & { value?: number | null }) {
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full w-full flex-1 rounded-full bg-primary transition-all duration-1000"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </div>
  )
}

export { Progress }
