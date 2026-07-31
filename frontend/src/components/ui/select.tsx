import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

const SelectContext = React.createContext<{
  value?: string;
  onValueChange?: (value: string) => void;
  open: boolean;
  disabled: boolean;
  setOpen: (open: boolean) => void;
  activeLabel: string;
  setActiveLabel: (label: string) => void;
} | null>(null);

export interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const Select = ({ value, onValueChange, disabled = false, className, children }: SelectProps) => {
  const [open, setOpen] = React.useState(false);
  const [activeLabel, setActiveLabel] = React.useState("");
  const timeoutRef = React.useRef<number | null>(null);

  const handleMouseEnter = () => {
    if (disabled) return;
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Hover open delay
    timeoutRef.current = window.setTimeout(() => {
      setOpen(true);
    }, 100);
  };

  const handleMouseLeave = () => {
    if (disabled) return;
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // Hover close delay (300ms)
    timeoutRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 300);
  };

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <SelectContext.Provider value={{ value, onValueChange, open, disabled, setOpen, activeLabel, setActiveLabel }}>
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn("relative inline-flex flex-col min-w-0", className)}
      >
        {children}
      </div>
    </SelectContext.Provider>
  );
};

const SelectGroup = ({ children }: { children: React.ReactNode }) => {
  return <div className="flex flex-col">{children}</div>;
};

const SelectValue = ({ placeholder, children }: { placeholder?: string; children?: React.ReactNode }) => {
  const context = React.useContext(SelectContext);
  if (!context) return null;
  return <span>{children || context.activeLabel || placeholder}</span>;
};

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, disabled, ...props }, ref) => {
  const context = React.useContext(SelectContext);
  if (!context) return null;

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => context.setOpen(!context.open)}
      disabled={context.disabled || disabled}
      className={cn(
        "group flex h-9.5 w-full items-center justify-between gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[13px] font-medium text-[var(--color-text)] transition-all duration-200 outline-none cursor-pointer select-none hover:border-[var(--color-primary-hover)] focus:border-[var(--color-primary)] active:scale-[0.98]",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 text-[var(--color-text-muted)] transition-transform duration-200",
          context.open && "rotate-180"
        )}
      />
    </button>
  );
});
SelectTrigger.displayName = "SelectTrigger";

const SelectContent = ({
  className,
  children,
  side = "bottom",
}: {
  className?: string;
  children?: React.ReactNode;
  side?: "top" | "bottom";
}) => {
  const context = React.useContext(SelectContext);
  if (!context) return null;
  const motionOffset = side === "top" ? -4 : 4;

  return (
    <AnimatePresence>
      {context.open && (
        <motion.div
          initial={{ opacity: 0, y: motionOffset, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: motionOffset, scale: 0.97 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "absolute top-[calc(100%+6px)] left-0 z-[2000] min-w-[8rem] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/95 backdrop-blur-xl p-1.5 shadow-[0_12px_42px_rgba(0,0,0,0.16)]",
            side === "top" && "top-auto bottom-[calc(100%+6px)] origin-bottom",
            className
          )}
        >
          <div className="flex flex-col gap-0.5">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const SelectItem = ({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) => {
  const context = React.useContext(SelectContext);
  if (!context) return null;

  const isChecked = context.value === value;
  const label = React.Children.toArray(children)
    .map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : ""))
    .join("");

  React.useEffect(() => {
    if (isChecked) {
      context.setActiveLabel(label);
    }
  }, [isChecked, label, context]);

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (context.disabled) return;
    context.onValueChange?.(value);
    context.setOpen(false);
  };

  return (
    <div
      onClick={handleSelect}
      className={cn(
        "bb-select-item",
        isChecked && "bg-[var(--color-primary-light)] text-[var(--color-primary)]",
        className
      )}
      data-state={isChecked ? "checked" : "unchecked"}
    >
      <span className="bb-select-item-indicator">
        {isChecked && <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" />}
      </span>
      <span>{children}</span>
    </div>
  );
};

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem };
