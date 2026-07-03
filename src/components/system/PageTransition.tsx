import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Subtle fade + slide-in wrapper for route content. Duration kept short
 * (180ms) so navigation still feels instant on low-end devices.
 */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
