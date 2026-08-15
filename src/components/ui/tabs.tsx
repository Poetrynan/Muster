import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

interface TabsProps {
  tabs: string[];
  activeTab: string;
  onChange: (tab: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  return (
    <div className={cn("inline-flex rounded-xl bg-secondary/50 p-1", className)}>
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={cn(
            "relative rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-200",
            activeTab === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {activeTab === tab && (
            <motion.div
              layoutId="active-tab"
              className="absolute inset-0 rounded-lg bg-background shadow-sm"
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            />
          )}
          <span className="relative z-10">{tab}</span>
        </button>
      ))}
    </div>
  );
}
